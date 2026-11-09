//! Os subagentes de uma sessão: `<config>/projects/<pasta>/<sessão>/subagents/agent-<id>.meta.json`
//! (quem é) e `agent-<id>.jsonl` (o histórico dele).

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::clock::system_time_ms;
use crate::json::non_empty;
use crate::jsonl::{scan_backward, JsonlTail};
use crate::model::{AgentStatus, AgentView, SessionStatus};
use crate::transcript::{apply_entry, parse_line, Mode, TranscriptInfo};

/// O meta de um subagente. tool_use_id é a chamada (no histórico do pai) que o criou; spawn_depth,
/// o nível na árvore; finished só aparece, com true, quando ele termina.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct AgentMeta {
    pub(crate) agent_type: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) picked_effort_model: Option<String>,
    pub(crate) tool_use_id: Option<String>,
    pub(crate) spawn_depth: Option<u32>,
    pub(crate) finished: bool,
}

/// Sem o "finished", um subagente que escreveu há pouco ainda conta como rodando.
const RECENT_WRITE_MS: i64 = 60_000;
/// De quanto em quanto tempo procurar de novo o pai de um subagente aninhado ainda sem pai achado
/// (enquanto isso, ele aparece ligado ao principal).
const PARENT_RETRY_MS: i64 = 10_000;
/// Quantas vezes procurar o pai antes de desistir e ligá-lo de vez ao principal. Cada procura lê os
/// históricos dos outros subagentes, que numa sessão grande passam de 100 MB.
const PARENT_ATTEMPTS: u8 = 3;
/// A primeira janela da leitura de trás para frente do histórico de um subagente.
const FIRST_WINDOW: u64 = 256 * 1024;

pub(crate) fn parse_meta(content: Option<&str>) -> Option<AgentMeta> {
    let content = content.filter(|c| !c.is_empty())?;
    let r = match serde_json::from_str::<Value>(content).ok()? {
        Value::Object(r) => r,
        // Como no JavaScript, uma lista é um "objeto" sem nenhum dos campos.
        Value::Array(_) => return Some(AgentMeta::default()),
        _ => return None,
    };
    Some(AgentMeta {
        agent_type: non_empty(r.get("agentType")),
        description: non_empty(r.get("description")),
        name: non_empty(r.get("name")),
        model: non_empty(r.get("model")),
        picked_effort_model: non_empty(r.get("pickedEffortModel")),
        tool_use_id: non_empty(r.get("toolUseId")),
        spawn_depth: r
            .get("spawnDepth")
            .and_then(Value::as_f64)
            .map(|depth| depth as u32),
        finished: r.get("finished") == Some(&Value::Bool(true)),
    })
}

pub(crate) fn agent_status(
    meta: Option<&AgentMeta>,
    session: SessionStatus,
    last_write_at: i64,
    now: i64,
) -> AgentStatus {
    if meta.is_some_and(|m| m.finished) {
        return AgentStatus::Done;
    }
    if matches!(session, SessionStatus::Running | SessionStatus::Waiting) {
        return AgentStatus::Running;
    }
    if now.saturating_sub(last_write_at) < RECENT_WRITE_MS {
        AgentStatus::Running
    } else {
        AgentStatus::Interrupted
    }
}

/// Um subagente: lê o meta quando muda e acompanha o histórico enquanto ele roda.
#[derive(Debug)]
pub(crate) struct AgentTracker {
    pub(crate) id: String,
    dir: PathBuf,
    pub(crate) meta: Option<AgentMeta>,
    pub(crate) info: TranscriptInfo,
    pub(crate) started_at: Option<i64>,
    pub(crate) updated_at: i64,
    /// None: ainda não resolvido; Some(None): filho do agente principal; Some(Some(id)): do subagente id.
    pub(crate) parent_id: Option<Option<String>>,
    parent_tried_at: Option<i64>,
    parent_attempts: u8,
    meta_mtime: Option<SystemTime>,
    loaded: bool,
    tail: Option<JsonlTail>,
}

impl AgentTracker {
    pub(crate) fn new(dir: PathBuf, id: String) -> AgentTracker {
        AgentTracker {
            id,
            dir,
            meta: None,
            info: TranscriptInfo::default(),
            started_at: None,
            updated_at: 0,
            parent_id: None,
            parent_tried_at: None,
            parent_attempts: 0,
            meta_mtime: None,
            loaded: false,
            tail: None,
        }
    }

    fn meta_path(&self) -> PathBuf {
        self.dir.join(format!("agent-{}.meta.json", self.id))
    }

    pub(crate) fn jsonl_path(&self) -> PathBuf {
        self.dir.join(format!("agent-{}.jsonl", self.id))
    }

    pub(crate) fn refresh(&mut self) {
        let meta_path = self.meta_path();
        if let Ok(st) = fs::metadata(&meta_path) {
            let mtime = st.modified().unwrap_or(UNIX_EPOCH);
            if self.meta_mtime != Some(mtime) {
                self.meta_mtime = Some(mtime);
                let content = fs::read(&meta_path)
                    .ok()
                    .map(|b| String::from_utf8_lossy(&b).into_owned());
                if let Some(meta) = parse_meta(content.as_deref()) {
                    self.meta = Some(meta);
                }
            }
        }
        let jsonl_path = self.jsonl_path();
        let Ok(js) = fs::metadata(&jsonl_path) else {
            return;
        };
        let js_mtime = js.modified().map(system_time_ms).unwrap_or(0);
        if self.started_at.is_none() {
            let created = js.created().map(system_time_ms).ok().filter(|&t| t > 0);
            self.started_at = Some(created.unwrap_or(js_mtime));
        }
        let finished = self.meta.as_ref().is_some_and(|m| m.finished);
        let finished_at = if finished {
            self.meta_mtime.map_or(0, system_time_ms)
        } else {
            0
        };
        self.updated_at = js_mtime.max(finished_at);

        if !self.loaded {
            let info = &mut self.info;
            let scanned = scan_backward(
                &jsonl_path,
                js.len(),
                |line| {
                    if let Some(e) = parse_line(line) {
                        apply_entry(info, &e, Mode::Fill, true);
                    }
                    info.activity.is_some() && info.model.is_some()
                },
                FIRST_WINDOW,
            );
            match scanned {
                Ok(resume) => {
                    self.loaded = true;
                    if !finished {
                        self.tail = Some(JsonlTail::new(jsonl_path, resume));
                    }
                }
                // Não deu para ler agora: começa do zero na próxima.
                Err(_) => self.info = TranscriptInfo::default(),
            }
        } else if let Some(tail) = self.tail.as_mut() {
            for line in tail.read_new() {
                if let Some(e) = parse_line(&line) {
                    apply_entry(&mut self.info, &e, Mode::Overwrite, true);
                }
            }
        }
        if finished {
            self.tail = None;
        }
    }

    pub(crate) fn view(&self, session: SessionStatus, now: i64) -> AgentView {
        let meta = self.meta.as_ref();
        AgentView {
            id: self.id.clone(),
            parent_id: self.parent_id.clone().flatten(),
            description: meta
                .and_then(|m| m.description.clone().or_else(|| m.name.clone()))
                .unwrap_or_else(|| "Subagente".to_string()),
            agent_type: meta
                .and_then(|m| m.agent_type.clone())
                .unwrap_or_else(|| "subagente".to_string()),
            name: meta.and_then(|m| m.name.clone()),
            model: self.info.model.clone().or_else(|| {
                meta.and_then(|m| m.picked_effort_model.clone().or_else(|| m.model.clone()))
            }),
            status: agent_status(meta, session, self.updated_at, now),
            started_at: self.started_at,
            updated_at: self.updated_at,
            activity: self.info.activity.clone(),
            depth: meta.and_then(|m| m.spawn_depth).unwrap_or(1),
        }
    }
}

/// Liga cada subagente aninhado (spawn_depth > 1) ao subagente que o criou: o pai é o que tem, no
/// próprio histórico, a chamada com o tool_use_id do filho. Os de nível 1 são do principal.
pub(crate) fn resolve_parents(agents: &mut [AgentTracker], now: i64) {
    // O histórico de cada um, lido só se precisar e uma vez só por chamada.
    let mut contents: Vec<Option<Vec<u8>>> = vec![None; agents.len()];
    for i in 0..agents.len() {
        if agents[i].parent_id.is_some() {
            continue;
        }
        let Some(meta) = agents[i].meta.as_ref() else {
            continue;
        };
        let tool_use_id = match &meta.tool_use_id {
            Some(id) if meta.spawn_depth.unwrap_or(1) > 1 => id.clone(),
            _ => {
                agents[i].parent_id = Some(None);
                continue;
            }
        };
        if agents[i]
            .parent_tried_at
            .is_some_and(|at| now.saturating_sub(at) < PARENT_RETRY_MS)
        {
            continue;
        }
        if agents[i].parent_attempts >= PARENT_ATTEMPTS {
            agents[i].parent_id = Some(None);
            continue;
        }
        agents[i].parent_tried_at = Some(now);
        agents[i].parent_attempts += 1;
        let needle = format!("\"id\":\"{tool_use_id}\"");
        let mut parent = None;
        for (j, other) in agents.iter().enumerate() {
            if j == i {
                continue;
            }
            let content =
                contents[j].get_or_insert_with(|| fs::read(other.jsonl_path()).unwrap_or_default());
            if contains(content, needle.as_bytes()) {
                parent = Some(other.id.clone());
                break;
            }
        }
        if let Some(parent) = parent {
            agents[i].parent_id = Some(Some(parent));
        }
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}
