//! As sessões abertas, pelo arquivo que o Claude Code mantém em `<config>/sessions/<pid>.json`
//! enquanto o processo vive.

use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::json::{non_empty, number};
use crate::model::SessionStatus;

/// Uma sessão aberta. O campo status vale "busy", "idle" ou "waiting"; com "waiting", waiting_for
/// diz o motivo ("input needed", "dialog open", "sandbox request"...).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LiveRecord {
    pub(crate) config_dir: String,
    pub(crate) pid: u32,
    pub(crate) session_id: String,
    pub(crate) cwd: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) name_source: Option<String>,
    pub(crate) kind: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) waiting_for: Option<String>,
    pub(crate) started_at: Option<i64>,
    pub(crate) updated_at: Option<i64>,
    pub(crate) status_updated_at: Option<i64>,
    pub(crate) alive: bool,
}

/// O processo ainda roda? No Windows, abre o processo só para consulta e vê se ele ainda não tem
/// código de saída; sem permissão para abrir, ele existe (é de outro usuário ou protegido).
#[cfg(windows)]
pub(crate) fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, STILL_ACTIVE,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    // SAFETY: chamadas simples da API do Windows; o código de saída vai para uma variável local e o
    // handle, quando abre, é fechado antes de sair.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return GetLastError() == ERROR_ACCESS_DENIED;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(process, &mut code) != 0;
        CloseHandle(process);
        ok && code == STILL_ACTIVE as u32
    }
}

/// O processo ainda roda? Fora do Windows, pelo /proc.
#[cfg(not(windows))]
pub(crate) fn pid_alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

/// Os registros de `<config>/sessions/`, com `alive` dito por `is_alive`.
pub(crate) fn read_registry(config_dir: &Path, is_alive: &dyn Fn(u32) -> bool) -> Vec<LiveRecord> {
    let Ok(entries) = fs::read_dir(config_dir.join("sessions")) else {
        return Vec::new();
    };
    let label = config_dir.to_string_lossy();
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_str().is_some_and(is_record_name) {
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()) else {
            continue;
        };
        if let Some(rec) = parse_record(&String::from_utf8_lossy(&bytes), &label, is_alive) {
            out.push(rec);
        }
    }
    out
}

/// O nome de um registro: `<pid>.json`.
fn is_record_name(name: &str) -> bool {
    name.strip_suffix(".json")
        .is_some_and(|pid| !pid.is_empty() && pid.bytes().all(|b| b.is_ascii_digit()))
}

pub(crate) fn parse_record(
    content: &str,
    config_dir: &str,
    is_alive: &dyn Fn(u32) -> bool,
) -> Option<LiveRecord> {
    // Pode ter sido lido no meio de uma gravação: aí não é JSON e fica para a próxima.
    let Ok(Value::Object(r)) = serde_json::from_str::<Value>(content) else {
        return None;
    };
    let pid = pid_number(r.get("pid")?)?;
    let session_id = r.get("sessionId")?.as_str()?.to_string();
    Some(LiveRecord {
        config_dir: config_dir.to_string(),
        pid,
        session_id,
        cwd: non_empty(r.get("cwd")),
        name: non_empty(r.get("name")),
        name_source: non_empty(r.get("nameSource")),
        kind: non_empty(r.get("kind")),
        status: non_empty(r.get("status")),
        waiting_for: non_empty(r.get("waitingFor")),
        started_at: number(r.get("startedAt")),
        updated_at: number(r.get("updatedAt")),
        status_updated_at: number(r.get("statusUpdatedAt")),
        alive: is_alive(pid),
    })
}

/// Um pid que caiba num u32 (os do Windows cabem).
fn pid_number(value: &Value) -> Option<u32> {
    let n = value.as_number()?;
    match n.as_u64() {
        Some(pid) => u32::try_from(pid).ok(),
        None => n
            .as_f64()
            .filter(|f| f.fract() == 0.0 && *f >= 0.0 && *f <= f64::from(u32::MAX))
            .map(|f| f as u32),
    }
}

/// O estado da sessão para a tela e, se ela espera por você, o motivo.
pub(crate) fn session_status(rec: Option<&LiveRecord>) -> (SessionStatus, Option<String>) {
    let Some(rec) = rec.filter(|r| r.alive) else {
        return (SessionStatus::Ended, None);
    };
    match rec.status.as_deref() {
        Some("waiting") => (SessionStatus::Waiting, rec.waiting_for.clone()),
        Some("busy") => (SessionStatus::Running, None),
        _ => (SessionStatus::Idle, None),
    }
}
