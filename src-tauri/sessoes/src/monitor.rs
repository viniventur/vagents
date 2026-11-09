//! O retrato das sessões: as abertas (pelo registro em sessions/) e as encerradas há pouco (pelo
//! histórico), cada uma com os seus subagentes.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::clock::{now_ms, parse_iso_ms, system_time_ms};
use crate::config::Settings;
use crate::jsonl::{read_range, scan_backward, split_lines, JsonlTail};
use crate::model::{Account, AgentView, SessionStatus, SessionView, Snapshot};
use crate::paths::{dir_key, last_segment};
use crate::registry::{pid_alive, read_registry, session_status, LiveRecord};
use crate::subagents::{resolve_parents, AgentTracker};
use crate::transcript::{apply_entry, clip, first_line, parse_line, Mode, TranscriptInfo};

/// De quanto em quanto tempo varrer as pastas atrás de históricos novos.
const INDEX_EVERY_MS: i64 = 3000;
/// Uma sessão aberta que ainda não tem histórico apressa a varredura seguinte.
const INDEX_MISSING_EVERY_MS: i64 = 1000;
/// Sessões encerradas mudam pouco: os subagentes delas são relidos com menos frequência.
const ENDED_AGENTS_EVERY_MS: i64 = 10_000;
/// A primeira janela da leitura de trás para frente do histórico de uma sessão.
const FIRST_WINDOW: u64 = 4 * 1024 * 1024;
/// Quanto do começo do histórico ler para achar o horário de início.
const FIRST_TIMESTAMP_BYTES: u64 = 256 * 1024;
/// O tamanho máximo do tema que sai do seu pedido.
const MAX_TITLE: usize = 90;

/// Um mapa que lembra a ordem de inserção, como o Map do JavaScript: a ordem decide os empates na
/// lista, e ela tem de ser a mesma a cada leitura para o retrato não "mudar" à toa.
struct OrderedMap<V> {
    positions: HashMap<String, usize>,
    entries: Vec<(String, V)>,
}

impl<V> Default for OrderedMap<V> {
    fn default() -> Self {
        OrderedMap {
            positions: HashMap::new(),
            entries: Vec::new(),
        }
    }
}

impl<V> OrderedMap<V> {
    fn get(&self, key: &str) -> Option<&V> {
        self.positions.get(key).map(|&i| &self.entries[i].1)
    }

    fn contains_key(&self, key: &str) -> bool {
        self.positions.contains_key(key)
    }

    /// Uma chave que já existe troca o valor e fica onde estava.
    fn insert(&mut self, key: String, value: V) {
        match self.positions.get(&key) {
            Some(&i) => self.entries[i].1 = value,
            None => {
                self.positions.insert(key.clone(), self.entries.len());
                self.entries.push((key, value));
            }
        }
    }

    fn iter(&self) -> impl Iterator<Item = (&String, &V)> {
        self.entries.iter().map(|(key, value)| (key, value))
    }

    fn len(&self) -> usize {
        self.entries.len()
    }
}

/// Um histórico principal achado na varredura: `<config>/projects/<pasta>/<sessão>.jsonl`.
struct TranscriptRef {
    path: PathBuf,
    config_dir: String,
    mtime_ms: i64,
}

/// Uma sessão que vai para o retrato: de que pasta é e onde está o histórico, se já houver.
struct Wanted {
    config_dir: String,
    path: Option<PathBuf>,
}

/// Uma pasta de configuração observada: o caminho, para ler, e o texto, para mostrar.
struct ConfigDir {
    path: PathBuf,
    shown: String,
}

/// Uma sessão sendo acompanhada: o histórico principal e a pasta de subagentes.
struct SessionState {
    session_id: String,
    config_dir: String,
    path: Option<PathBuf>,
    info: TranscriptInfo,
    first_at: Option<i64>,
    mtime_ms: i64,
    /// Na ordem em que apareceram (a da pasta), como o Map do servidor em Node.
    agents: Vec<AgentTracker>,
    agent_ids: HashSet<String>,
    agents_at: Option<i64>,
    tail: Option<JsonlTail>,
}

impl SessionState {
    fn new(session_id: String, config_dir: String) -> SessionState {
        SessionState {
            session_id,
            config_dir,
            path: None,
            info: TranscriptInfo::default(),
            first_at: None,
            mtime_ms: 0,
            agents: Vec::new(),
            agent_ids: HashSet::new(),
            agents_at: None,
            tail: None,
        }
    }

    fn refresh_transcript(&mut self, path: &Path) {
        if self.path.as_deref() != Some(path) {
            self.path = Some(path.to_path_buf());
            self.tail = None;
            self.info = TranscriptInfo::default();
        }
        let Ok(st) = fs::metadata(path) else {
            return;
        };
        let size = st.len();
        self.mtime_ms = st.modified().map(system_time_ms).unwrap_or(0);
        if self.tail.is_none() {
            self.first_at = first_timestamp(path);
            let info = &mut self.info;
            let scanned = scan_backward(
                path,
                size,
                |line| {
                    if let Some(e) = parse_line(line) {
                        apply_entry(info, &e, Mode::Fill, false);
                    }
                    complete(info)
                },
                FIRST_WINDOW,
            );
            match scanned {
                Ok(resume) => self.tail = Some(JsonlTail::new(path.to_path_buf(), resume)),
                // Não deu para ler agora (o arquivo sumiu no meio): começa do zero no próximo tick.
                Err(_) => self.info = TranscriptInfo::default(),
            }
            return;
        }
        if let Some(tail) = self.tail.as_mut() {
            for line in tail.read_new() {
                if let Some(e) = parse_line(&line) {
                    apply_entry(&mut self.info, &e, Mode::Overwrite, false);
                }
            }
        }
    }

    fn refresh_agents(&mut self, now: i64, ended: bool) {
        let Some(path) = &self.path else {
            return;
        };
        if ended
            && self
                .agents_at
                .is_some_and(|at| now.saturating_sub(at) < ENDED_AGENTS_EVERY_MS)
        {
            return;
        }
        self.agents_at = Some(now);
        let dir = subagents_dir(path);
        let Ok(entries) = fs::read_dir(&dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(id) = name.to_str().and_then(agent_id) else {
                continue;
            };
            if self.agent_ids.insert(id.to_string()) {
                self.agents
                    .push(AgentTracker::new(dir.clone(), id.to_string()));
            }
        }
        for agent in &mut self.agents {
            agent.refresh();
        }
        resolve_parents(&mut self.agents, now);
    }
}

/// Já achou o que importa para a tela? (Então não precisa ler mais para trás.)
fn complete(info: &TranscriptInfo) -> bool {
    (info.ai_title.is_some() || info.custom_title.is_some())
        && info.last_prompt.is_some()
        && info.activity.is_some()
        && info.cwd.is_some()
}

/// A pasta dos subagentes de uma sessão: o histórico sem o ".jsonl", mais "subagents".
fn subagents_dir(transcript: &Path) -> PathBuf {
    let name = transcript
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    let bytes = name.as_bytes();
    let stem = if bytes.len() >= 6 && bytes[bytes.len() - 6..].eq_ignore_ascii_case(b".jsonl") {
        &name[..name.len() - 6]
    } else {
        name
    };
    transcript.with_file_name(stem).join("subagents")
}

/// O id de um arquivo de subagente: `agent-<id>.meta.json` ou `agent-<id>.jsonl`.
fn agent_id(name: &str) -> Option<&str> {
    let rest = name.strip_prefix("agent-")?;
    let id = rest
        .strip_suffix(".meta.json")
        .or_else(|| rest.strip_suffix(".jsonl"))?;
    (!id.is_empty()).then_some(id)
}

/// O instante da primeira linha com horário do histórico.
fn first_timestamp(path: &Path) -> Option<i64> {
    let buf = read_range(path, 0, FIRST_TIMESTAMP_BYTES).ok()?;
    let (lines, _) = split_lines(&buf);
    lines.iter().find_map(|line| {
        let e = parse_line(line)?;
        parse_iso_ms(e.get("timestamp")?.as_str()?)
    })
}

/// Acompanha as pastas de configuração do Claude Code e monta o retrato das sessões: as abertas
/// (pelo registro em sessions/) e as encerradas há pouco (pelo histórico).
///
/// Não tem relógio próprio: quem usa chama [`Monitor::tick`] a cada segundo (numa thread à parte;
/// o Monitor é `Send`).
pub struct Monitor {
    config_dirs: Vec<ConfigDir>,
    retention_ms: i64,
    accounts: HashMap<String, Account>,
    now: Box<dyn Fn() -> i64 + Send>,
    is_alive: Box<dyn Fn(u32) -> bool + Send>,
    states: HashMap<String, SessionState>,
    index: OrderedMap<TranscriptRef>,
    indexed_at: Option<i64>,
    last_body: Option<String>,
    current: Snapshot,
}

impl Monitor {
    /// Com o relógio do sistema e a checagem real de pid.
    pub fn new(settings: Settings) -> Monitor {
        Monitor::with_clock(settings, Box::new(now_ms), Box::new(pid_alive))
    }

    /// Com outro relógio (ms desde 1970) e outra checagem de pid, para os testes.
    pub fn with_clock(
        settings: Settings,
        now: Box<dyn Fn() -> i64 + Send>,
        is_alive: Box<dyn Fn(u32) -> bool + Send>,
    ) -> Monitor {
        let config_dirs: Vec<ConfigDir> = settings
            .config_dirs
            .into_iter()
            .map(|path| ConfigDir {
                shown: path.to_string_lossy().into_owned(),
                path,
            })
            .collect();
        let accounts = settings
            .accounts
            .into_iter()
            .map(|account| (dir_key(&account.dir), account))
            .collect();
        let current = Snapshot {
            generated_at: now(),
            config_dirs: config_dirs.iter().map(|dir| dir.shown.clone()).collect(),
            retention_ms: settings.retention_ms,
            sessions: Vec::new(),
        };
        Monitor {
            config_dirs,
            retention_ms: settings.retention_ms,
            accounts,
            now,
            is_alive,
            states: HashMap::new(),
            index: OrderedMap::default(),
            indexed_at: None,
            last_body: None,
            current,
        }
    }

    /// O último retrato montado.
    pub fn snapshot(&self) -> &Snapshot {
        &self.current
    }

    /// Lê tudo uma vez. Devolve Some(retrato) só quando mudou desde o tick anterior (o primeiro
    /// sempre devolve).
    pub fn tick(&mut self) -> Option<Snapshot> {
        let now = (self.now)();
        let mut live: OrderedMap<LiveRecord> = OrderedMap::default();
        for dir in &self.config_dirs {
            for rec in read_registry(&dir.path, &*self.is_alive) {
                // Dois registros da mesma sessão: fica o do processo vivo, e entre esses o mais recente.
                let replace = match live.get(&rec.session_id) {
                    None => true,
                    Some(prev) => {
                        (rec.alive && !prev.alive)
                            || (rec.alive == prev.alive
                                && rec.updated_at.unwrap_or(0) > prev.updated_at.unwrap_or(0))
                    }
                };
                if replace {
                    live.insert(rec.session_id.clone(), rec);
                }
            }
        }

        let missing = live.iter().any(|(id, _)| !self.index.contains_key(id));
        let since = self
            .indexed_at
            .map_or(i64::MAX, |at| now.saturating_sub(at));
        if since >= INDEX_EVERY_MS || (missing && since >= INDEX_MISSING_EVERY_MS) {
            self.index = scan_index(&self.config_dirs);
            self.indexed_at = Some(now);
        }

        let mut wanted: OrderedMap<Wanted> = OrderedMap::default();
        for (id, rec) in live.iter() {
            // O registro que sobrou de um processo que morreu (um Claude que travou) não segura a
            // sessão na lista: ela fica só se o histórico estiver dentro da retenção, como as outras.
            if !rec.alive {
                continue;
            }
            let path = self.index.get(id).map(|r| r.path.clone());
            wanted.insert(
                id.clone(),
                Wanted {
                    config_dir: rec.config_dir.clone(),
                    path,
                },
            );
        }
        for (id, r) in self.index.iter() {
            if wanted.contains_key(id) || now.saturating_sub(r.mtime_ms) > self.retention_ms {
                continue;
            }
            wanted.insert(
                id.clone(),
                Wanted {
                    config_dir: r.config_dir.clone(),
                    path: Some(r.path.clone()),
                },
            );
        }

        self.states.retain(|id, _| wanted.contains_key(id));

        let mut sessions = Vec::with_capacity(wanted.len());
        for (id, want) in wanted.iter() {
            let state = self
                .states
                .entry(id.clone())
                .or_insert_with(|| SessionState::new(id.clone(), want.config_dir.clone()));
            let rec = live.get(id);
            let (status, waiting_for) = session_status(rec);
            if let Some(path) = &want.path {
                state.refresh_transcript(path);
            }
            state.refresh_agents(now, status == SessionStatus::Ended);
            sessions.push(session_view(
                &self.accounts,
                state,
                rec,
                status,
                waiting_for,
                now,
            ));
        }
        sessions.sort_by(compare_sessions);

        // Só há retrato novo quando o JSON das sessões muda.
        let body = serde_json::to_string(&sessions).unwrap_or_default();
        if self.last_body.as_deref() == Some(body.as_str()) {
            return None;
        }
        self.last_body = Some(body);
        self.current = Snapshot {
            generated_at: now,
            config_dirs: self
                .config_dirs
                .iter()
                .map(|dir| dir.shown.clone())
                .collect(),
            retention_ms: self.retention_ms,
            sessions,
        };
        Some(self.current.clone())
    }
}

/// As abertas primeiro, da mais antiga para a mais nova; depois as encerradas, da que mexeu por
/// último para a mais velha. (O servidor em Node desempatava pelo localeCompare da chave; aqui é a
/// ordem dos bytes, que dá o mesmo para os ids e as pastas de sempre.)
fn compare_sessions(a: &SessionView, b: &SessionView) -> Ordering {
    let ended_a = a.status == SessionStatus::Ended;
    let ended_b = b.status == SessionStatus::Ended;
    if ended_a != ended_b {
        return if ended_a {
            Ordering::Greater
        } else {
            Ordering::Less
        };
    }
    if !ended_a {
        return a
            .started_at
            .unwrap_or(0)
            .cmp(&b.started_at.unwrap_or(0))
            .then_with(|| a.key.cmp(&b.key));
    }
    b.updated_at.cmp(&a.updated_at)
}

fn session_view(
    accounts: &HashMap<String, Account>,
    state: &SessionState,
    rec: Option<&LiveRecord>,
    status: SessionStatus,
    waiting_for: Option<String>,
    now: i64,
) -> SessionView {
    let info = &state.info;
    let alive = rec.filter(|r| r.alive);
    let cwd = rec
        .and_then(|r| r.cwd.clone())
        .or_else(|| info.cwd.clone())
        .unwrap_or_default();
    let project = if cwd.is_empty() {
        "(sem pasta)".to_string()
    } else {
        last_segment(&cwd).to_string()
    };
    let account = accounts.get(&dir_key(&state.config_dir));
    let title = pick_title(rec, info, &project);
    let updated_at = state
        .mtime_ms
        .max(info.last_at.unwrap_or(0))
        .max(alive.and_then(|r| r.updated_at).unwrap_or(0));
    let mut agents: Vec<AgentView> = state
        .agents
        .iter()
        .filter(|agent| agent.meta.is_some() || agent.updated_at > 0)
        .map(|agent| agent.view(status, now))
        .collect();
    agents.sort_by_key(|agent| agent.started_at.unwrap_or(0));

    SessionView {
        key: format!("{}|{}", state.config_dir, state.session_id),
        session_id: state.session_id.clone(),
        config_dir: state.config_dir.clone(),
        account: account.map_or_else(
            || last_segment(&state.config_dir).to_string(),
            |a| a.name.clone(),
        ),
        account_command: account.and_then(|a| a.command.clone()),
        pid: alive.map(|r| r.pid),
        kind: rec.and_then(|r| r.kind.clone()),
        cwd,
        project,
        title,
        last_prompt: info
            .last_prompt
            .clone()
            .or_else(|| info.user_prompt.clone()),
        activity: info.activity.clone(),
        activity_at: info.activity_at,
        model: info.model.clone(),
        git_branch: info.git_branch.clone(),
        permission_mode: info.permission_mode.clone(),
        status,
        waiting_for,
        status_since: alive.and_then(|r| r.status_updated_at),
        started_at: rec.and_then(|r| r.started_at).or(state.first_at),
        updated_at,
        agents,
    }
}

/// Todos os históricos principais: `<config>/projects/<pasta>/<sessão>.jsonl`. A mesma sessão em
/// duas pastas fica com o histórico mexido por último.
fn scan_index(config_dirs: &[ConfigDir]) -> OrderedMap<TranscriptRef> {
    let mut next = OrderedMap::default();
    for config_dir in config_dirs {
        let Ok(folders) = fs::read_dir(config_dir.path.join("projects")) else {
            continue;
        };
        for folder in folders.flatten() {
            let Ok(files) = fs::read_dir(folder.path()) else {
                continue; // não é pasta
            };
            for file in files.flatten() {
                let name = file.file_name();
                let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".jsonl")) else {
                    continue;
                };
                let path = file.path();
                let Ok(st) = fs::metadata(&path) else {
                    continue; // sumiu entre o readdir e o stat
                };
                if !st.is_file() {
                    continue;
                }
                let mtime_ms = st.modified().map(system_time_ms).unwrap_or(0);
                if next
                    .get(id)
                    .is_none_or(|prev: &TranscriptRef| mtime_ms > prev.mtime_ms)
                {
                    next.insert(
                        id.to_string(),
                        TranscriptRef {
                            path,
                            config_dir: config_dir.shown.clone(),
                            mtime_ms,
                        },
                    );
                }
            }
        }
    }
    next
}

/// O tema da sessão: o nome dado por você, senão o título que o Claude gera, senão o pedido.
pub(crate) fn pick_title(rec: Option<&LiveRecord>, info: &TranscriptInfo, project: &str) -> String {
    if let Some(title) = &info.custom_title {
        return title.clone();
    }
    if let Some(rec) = rec {
        if let (Some(name), Some(source)) = (&rec.name, &rec.name_source) {
            if source != "derived" {
                return name.clone();
            }
        }
    }
    if let Some(title) = &info.ai_title {
        return title.clone();
    }
    let prompt = info.last_prompt.as_deref().or(info.user_prompt.as_deref());
    if let Some(line) = prompt.and_then(first_line) {
        return clip(&line, MAX_TITLE);
    }
    rec.and_then(|r| r.name.clone())
        .unwrap_or_else(|| project.to_string())
}
