//! As pastas de configuração do Claude Code (cada uma é uma conta) e o que se faz com caminhos.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde_json::Value;

use crate::json::non_empty;
use crate::model::Account;

/// As pastas a observar quando o vagents.config.json não diz quais: CLAUDE_CONFIG_DIR, se houver,
/// mais toda pasta ".claude" ou ".claude-*" da pasta do usuário que tenha "projects" ou "sessions".
pub(crate) fn find_config_dirs(claude_config_dir: Option<&str>, home: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    if let Some(dir) = claude_config_dir
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
    {
        found.push(resolve(Path::new(dir)));
    }
    let mut names: Vec<String> = match fs::read_dir(home) {
        Ok(entries) => entries
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    for name in names {
        if name != ".claude" && !name.starts_with(".claude-") {
            continue;
        }
        let dir = home.join(&name);
        if dir.join("projects").exists() || dir.join("sessions").exists() {
            found.push(dir);
        }
    }
    unique(found)
}

/// Tira as pastas repetidas (sem diferenciar maiúsculas, como o Windows), mantendo a primeira.
pub(crate) fn unique(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(dir_key(&path.to_string_lossy())))
        .collect()
}

/// O nome e o comando de cada pasta de configuração. Vêm do "contas" do vagents.config.json
/// (`[{"pasta": "~/.claude-trabalho", "nome": "Trabalho", "comando": "claude-trabalho"}]`); a pasta que não estiver
/// lá ganha o nome dela mesma (".claude" → "padrão", ".claude-x" → "x").
pub(crate) fn load_accounts(
    config_dirs: &[PathBuf],
    contas: Option<&Value>,
    home: &Path,
) -> Vec<Account> {
    let mut listed: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    for conta in contas.and_then(Value::as_array).into_iter().flatten() {
        let Some(pasta) = conta.get("pasta").and_then(Value::as_str) else {
            continue;
        };
        let dir = resolve(&expand_home(pasta, home));
        listed.insert(
            dir_key(&dir.to_string_lossy()),
            (
                non_empty(conta.get("nome")),
                non_empty(conta.get("comando")),
            ),
        );
    }
    config_dirs
        .iter()
        .map(|dir| {
            let shown = dir.to_string_lossy().into_owned();
            let (name, command) = listed
                .get(&dir_key(&resolve(dir).to_string_lossy()))
                .cloned()
                .unwrap_or_default();
            let folder = last_segment(&shown);
            let fallback = if folder == ".claude" {
                "padrão".to_string()
            } else {
                folder
                    .strip_prefix(".claude-")
                    .unwrap_or(folder)
                    .to_string()
            };
            Account {
                name: name.unwrap_or(fallback),
                command,
                dir: shown,
            }
        })
        .collect()
}

/// O último pedaço de um caminho, com barra de Windows ou não.
pub(crate) fn last_segment(path: &str) -> &str {
    path.rsplit(['\\', '/'])
        .find(|part| !part.is_empty())
        .unwrap_or(path)
}

/// Como o `path.resolve` do Node: o caminho absoluto, sem "." nem "..", e sem barra no fim.
pub(crate) fn resolve(path: &Path) -> PathBuf {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    let mut out = PathBuf::new();
    for part in absolute.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// "~" no começo (sozinho ou seguido de barra) é a pasta do usuário.
pub(crate) fn expand_home(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
            let mut expanded = OsString::from(home.as_os_str());
            expanded.push(rest);
            PathBuf::from(expanded)
        }
        _ => PathBuf::from(path),
    }
}

/// A chave para comparar pastas: sem diferenciar maiúsculas, o tipo de barra nem a barra no fim.
pub(crate) fn dir_key(path: &str) -> String {
    let lower = path.to_lowercase();
    let unified = if cfg!(windows) {
        lower.replace('/', "\\")
    } else {
        lower
    };
    unified.trim_end_matches(['\\', '/']).to_string()
}
