//! Confere a leitura nas pastas reais do Claude Code desta máquina. Só lê, e não roda por padrão:
//!
//! ```text
//! cargo test --manifest-path src-tauri/sessoes/Cargo.toml --test dados_reais -- --ignored --nocapture
//! ```

use std::path::{Path, PathBuf};
use std::time::Instant;

use vagents_sessoes::{load_settings, Monitor};

#[test]
#[ignore = "lê as sessões reais do Claude Code desta máquina"]
fn retrato_das_sessoes_reais() {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .expect("sem a pasta do usuário");
    let nenhum = Path::new(env!("CARGO_MANIFEST_DIR")).join("nao-existe.config.json");
    let settings = load_settings(&nenhum, None, &home);
    for account in &settings.accounts {
        println!("conta: {} ({})", account.name, account.dir);
    }

    let mut monitor = Monitor::new(settings);
    let started = Instant::now();
    let snapshot = monitor
        .tick()
        .expect("o primeiro tick sempre traz um retrato");
    println!(
        "primeiro tick: {:?}, {} sessões",
        started.elapsed(),
        snapshot.sessions.len()
    );
    for session in &snapshot.sessions {
        let status = serde_json::to_value(session.status).unwrap();
        println!(
            "{:<9} {:<8} {:>2} subagentes  {}",
            status.as_str().unwrap_or_default(),
            session.account,
            session.agents.len(),
            session.title
        );
    }

    let started = Instant::now();
    let changed = monitor.tick().is_some();
    println!("segundo tick: {:?} (mudou: {changed})", started.elapsed());
}
