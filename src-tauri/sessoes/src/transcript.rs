//! O que interessa no histórico (JSONL) de uma sessão ou de um subagente.

use serde_json::Value;

use crate::clock::parse_iso_ms;
use crate::json::{js_trim, number, text, Json};
use crate::paths::last_segment;

/// O que se tira do histórico para a tela.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct TranscriptInfo {
    pub(crate) custom_title: Option<String>,
    pub(crate) ai_title: Option<String>,
    pub(crate) last_prompt: Option<String>,
    pub(crate) user_prompt: Option<String>,
    pub(crate) permission_mode: Option<String>,
    pub(crate) cwd: Option<String>,
    pub(crate) git_branch: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) activity: Option<String>,
    pub(crate) activity_at: Option<i64>,
    pub(crate) last_at: Option<i64>,
}

/// Overwrite: as linhas chegam em ordem (o arquivo crescendo) e a mais nova vence.
/// Fill: as linhas chegam da mais nova para a mais velha e só se preenche o que falta.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Overwrite,
    Fill,
}

pub(crate) const MAX_ACTIVITY: usize = 140;
const MAX_PROMPT: usize = 2000;

/// Linhas que nunca interessam e podem ter mais de 1 MB: nem se lê o JSON delas.
fn skippable(line: &str) -> bool {
    line.starts_with(r#"{"type":"api-request"#) || line.starts_with(r#"{"type":"file-history"#)
}

/// Uma linha do histórico, se for um objeto JSON (e não uma das enormes que não interessam).
pub(crate) fn parse_line(line: &str) -> Option<Json> {
    if skippable(line) {
        return None;
    }
    match serde_json::from_str::<Value>(line) {
        Ok(Value::Object(entry)) => Some(entry),
        _ => None,
    }
}

/// Junta uma linha do histórico ao que já se sabe. `sidechain`: o histórico é de um subagente,
/// em que todas as linhas são "sidechain"; no da sessão, essas linhas são dos subagentes e não contam.
pub(crate) fn apply_entry(info: &mut TranscriptInfo, e: &Json, mode: Mode, sidechain: bool) {
    let kind = e.get("type").and_then(Value::as_str);
    match kind {
        Some("ai-title") => {
            set(&mut info.ai_title, text(e.get("aiTitle")), mode);
            return;
        }
        Some("custom-title") => {
            set(&mut info.custom_title, text(e.get("customTitle")), mode);
            return;
        }
        Some("last-prompt") => {
            set(
                &mut info.last_prompt,
                text(e.get("lastPrompt")).map(|p| clip(&p, MAX_PROMPT)),
                mode,
            );
            return;
        }
        Some("permission-mode") => {
            set(
                &mut info.permission_mode,
                text(e.get("permissionMode")),
                mode,
            );
            return;
        }
        Some("user" | "assistant") => {}
        _ => return,
    }

    if e.get("isSidechain") == Some(&Value::Bool(true)) && !sidechain {
        return;
    }
    set(&mut info.cwd, text(e.get("cwd")), mode);
    set(&mut info.git_branch, text(e.get("gitBranch")), mode);
    let at = time(e.get("timestamp"));
    set(&mut info.last_at, at, mode);

    let Some(msg) = e.get("message").and_then(Value::as_object) else {
        return;
    };
    if kind == Some("user") {
        if e.get("isMeta") != Some(&Value::Bool(true)) {
            set(&mut info.user_prompt, prompt_text(msg.get("content")), mode);
        }
        return;
    }
    if let Some(model) = text(msg.get("model")).filter(|m| !m.starts_with('<')) {
        set(&mut info.model, Some(model), mode);
    }
    let activity = describe_content(msg.get("content"));
    if activity.is_some() && (mode == Mode::Overwrite || info.activity.is_none()) {
        info.activity = activity;
        info.activity_at = at;
    }
}

fn set<T>(slot: &mut Option<T>, value: Option<T>, mode: Mode) {
    let Some(value) = value else {
        return;
    };
    if mode == Mode::Fill && slot.is_some() {
        return;
    }
    *slot = Some(value);
}

/// O último bloco de uma mensagem do assistente, em uma linha.
pub(crate) fn describe_content(content: Option<&Value>) -> Option<String> {
    let blocks = match content? {
        Value::String(s) => return first_line(s),
        Value::Array(blocks) => blocks,
        _ => return None,
    };
    for block in blocks.iter().rev() {
        let Some(block) = block.as_object() else {
            continue;
        };
        match block.get("type").and_then(Value::as_str) {
            Some("tool_use") => {
                let name = text(block.get("name")).unwrap_or_else(|| "ferramenta".to_string());
                let empty = Json::new();
                let input = block
                    .get("input")
                    .and_then(Value::as_object)
                    .unwrap_or(&empty);
                return Some(describe_tool(&name, input));
            }
            Some("text") => {
                if let Some(line) = first_line(&text(block.get("text")).unwrap_or_default()) {
                    return Some(line);
                }
            }
            Some("thinking" | "redacted_thinking") => return Some("Pensando…".to_string()),
            _ => {}
        }
    }
    None
}

/// Uma chamada de ferramenta, em uma linha: "Bash: Roda os testes", "Read: main.ts"...
pub(crate) fn describe_tool(name: &str, input: &Json) -> String {
    let s = |key: &str| text(input.get(key));
    match name {
        "Bash" | "PowerShell" => with_detail(
            name,
            s("description").or_else(|| first_line(&s("command").unwrap_or_default())),
        ),
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            let path = s("file_path").or_else(|| s("notebook_path"));
            with_detail(name, path.map(|p| last_segment(&p).to_string()))
        }
        "Grep" | "Glob" => with_detail(name, s("pattern")),
        "Agent" | "Task" => with_detail("Subagente", s("description")),
        "WebSearch" => with_detail("Pesquisa", s("query")),
        "WebFetch" => with_detail("Lendo", host(s("url"))),
        "Skill" => with_detail("Skill", s("skill")),
        "AskUserQuestion" => "Fazendo uma pergunta para você".to_string(),
        "TodoWrite" => "Atualizando a lista de tarefas".to_string(),
        _ if name.starts_with("mcp__") => {
            // mcp__<servidor>__<ferramenta>
            let mut parts = name.split("__").skip(1);
            let server = parts.next();
            let tool = parts.next();
            clip(
                &format!("{} ({})", tool.unwrap_or(name), server.unwrap_or("MCP")),
                MAX_ACTIVITY,
            )
        }
        _ => name.to_string(),
    }
}

fn with_detail(label: &str, detail: Option<String>) -> String {
    match detail.filter(|d| !d.is_empty()) {
        Some(detail) => clip(&format!("{label}: {detail}"), MAX_ACTIVITY),
        None => clip(label, MAX_ACTIVITY),
    }
}

/// O texto de um pedido seu. Comandos, saídas de comandos e avisos do sistema chegam como
/// `<tag>...` e não contam.
fn prompt_text(content: Option<&Value>) -> Option<String> {
    let raw = match content? {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(Value::as_object)
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let value = js_trim(&raw);
    if value.is_empty() || value.starts_with('<') || value.starts_with("[Request interrupted") {
        return None;
    }
    Some(clip(value, MAX_PROMPT))
}

/// A primeira linha com algum texto, aparada e cortada em [`MAX_ACTIVITY`].
pub(crate) fn first_line(value: &str) -> Option<String> {
    value
        .split('\n')
        .map(js_trim)
        .find(|line| !line.is_empty())
        .map(|line| clip(line, MAX_ACTIVITY))
}

/// Corta em `max` com "…" no fim. Conta como o JavaScript (unidades UTF-16), sem partir um emoji.
pub(crate) fn clip(value: &str, max: usize) -> String {
    let length: usize = value.chars().map(char::len_utf16).sum();
    if length <= max {
        return value.to_string();
    }
    let room = max.saturating_sub(1);
    let mut out = String::new();
    let mut used = 0;
    for c in value.chars() {
        used += c.len_utf16();
        if used > room {
            break;
        }
        out.push(c);
    }
    out.push('…');
    out
}

/// O host de uma URL (como o `new URL(url).host`, no que interessa a um WebFetch); se não for
/// uma URL, ela mesma.
fn host(url: Option<String>) -> Option<String> {
    let url = url?;
    Some(url_host(&url).unwrap_or(url))
}

fn url_host(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once(':')?;
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    if !valid {
        return None;
    }
    let scheme = scheme.to_ascii_lowercase();
    let default_port = match scheme.as_str() {
        "http" | "ws" => Some("80"),
        "https" | "wss" => Some("443"),
        "ftp" => Some("21"),
        _ => None,
    };
    let special = default_port.is_some() || scheme == "file";
    let Some(after) = rest.strip_prefix("//") else {
        // "mailto:x@y", "C:\x": URL sem host.
        return Some(String::new());
    };
    let stop: &[char] = if special {
        &['/', '?', '#', '\\']
    } else {
        &['/', '?', '#']
    };
    let authority = after.split(stop).next().unwrap_or_default();
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    if !special {
        return Some(host_port.to_string());
    }
    if host_port.is_empty() {
        // "https://" sem host não é URL; "file:///x" é, com host vazio.
        return (scheme == "file").then(String::new);
    }
    // A porta vem depois do último ":" que não esteja dentro de um IPv6 ("[::1]:8080").
    let port_at = host_port
        .rfind(':')
        .filter(|&i| !host_port[i..].contains(']'));
    let (host, port) = match port_at {
        Some(i) => (&host_port[..i], &host_port[i + 1..]),
        None => (host_port, ""),
    };
    let host = host.to_lowercase();
    if port.is_empty() || Some(port) == default_port {
        Some(host)
    } else {
        Some(format!("{host}:{port}"))
    }
}

/// Um horário do histórico: um número (ms) ou um texto ISO 8601.
fn time(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::String(s) => parse_iso_ms(s),
        number_value @ Value::Number(_) => number(Some(number_value)),
        _ => None,
    }
}
