//! As configurações: o vagents.config.json (que pode não existir) decide as pastas observadas, o
//! nome e o comando de cada conta e por quanto tempo uma sessão encerrada fica na lista.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::clock::HOUR_MS;
use crate::model::Account;
use crate::paths::{expand_home, find_config_dirs, load_accounts, resolve, unique};

/// Por quantas horas uma sessão encerrada continua na lista, se o arquivo não disser.
const DEFAULT_RETENTION_HOURS: f64 = 24.0;

/// O que o [`Monitor`](crate::Monitor) precisa saber: as pastas, as contas e a retenção.
#[derive(Clone, Debug, PartialEq)]
pub struct Settings {
    /// As pastas de configuração do Claude Code observadas (cada uma é uma conta).
    pub config_dirs: Vec<PathBuf>,
    /// O nome e o comando de cada pasta, na mesma ordem.
    pub accounts: Vec<Account>,
    /// Por quanto tempo uma sessão encerrada continua na lista.
    pub retention_ms: i64,
}

/// Lê o vagents.config.json (pode não existir) e decide as pastas e as contas.
///
/// Formato: `{ "contas": [{"pasta": "~/.claude-trabalho", "nome": "Trabalho", "comando": "claude-trabalho"}],
/// "pastas": ["..."], "retencaoHoras": 24 }`, tudo opcional. Com "pastas" (e alguma pasta nela),
/// são exatamente essas as observadas. Sem: CLAUDE_CONFIG_DIR (o argumento) mais toda pasta
/// ".claude" ou ".claude-*" de `home` que tenha "projects" ou "sessions". "~" no começo de uma
/// pasta é `home`. "retencaoHoras" vale se for um número maior que zero; o padrão é 24.
///
/// Um arquivo que não existe conta como vazio; um inválido também, com um aviso no stderr.
pub fn load_settings(config_file: &Path, claude_config_dir: Option<&str>, home: &Path) -> Settings {
    let file = read_config(config_file).unwrap_or_default();
    let config_dirs = listed_dirs(file.get("pastas"), home)
        .unwrap_or_else(|| find_config_dirs(claude_config_dir, home));
    let accounts = load_accounts(&config_dirs, file.get("contas"), home);
    let hours = retention_hours(file.get("retencaoHoras")).unwrap_or(DEFAULT_RETENTION_HOURS);
    Settings {
        config_dirs,
        accounts,
        retention_ms: (hours * HOUR_MS as f64) as i64,
    }
}

fn read_config(path: &Path) -> Option<Map<String, Value>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(err) => {
            eprintln!("[vagents] ignorando {}: {err}", path.display());
            return None;
        }
    };
    // O Bloco de Notas pode gravar o arquivo com BOM.
    let content = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes);
    match serde_json::from_slice::<Value>(content) {
        Ok(Value::Object(map)) => Some(map),
        Ok(_) => {
            eprintln!(
                "[vagents] ignorando {}: não é um objeto JSON",
                path.display()
            );
            None
        }
        Err(err) => {
            eprintln!("[vagents] ignorando {}: {err}", path.display());
            None
        }
    }
}

/// As pastas do "pastas", se vier alguma (como a VAGENTES_DIRS do servidor em Node: vazia, conta
/// como ausente).
fn listed_dirs(value: Option<&Value>, home: &Path) -> Option<Vec<PathBuf>> {
    let dirs: Vec<PathBuf> = value?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
        .map(|dir| resolve(&expand_home(dir, home)))
        .collect();
    (!dirs.is_empty()).then(|| unique(dirs))
}

/// O "retencaoHoras": um número (ou um texto com um número) maior que zero.
fn retention_hours(value: Option<&Value>) -> Option<f64> {
    let hours = match value? {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().parse().ok()?,
        _ => return None,
    };
    (hours.is_finite() && hours > 0.0).then_some(hours)
}
