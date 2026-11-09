//! A leitura das sessões do Claude Code para o vAgents: as abertas, as encerradas há pouco e os
//! subagentes de cada uma, montadas num retrato ([`model::Snapshot`]) que vai para a tela.
//!
//! Nada de hooks nem de configuração no Claude Code: só se lê o que ele já grava em disco.
//!
//! | Arquivo | O que dá |
//! | --- | --- |
//! | `<config>/sessions/<pid>.json` | as sessões abertas e o estado: `status` = `busy`, `idle` ou `waiting` (com `waitingFor`) |
//! | `<config>/projects/<pasta>/<sessão>.jsonl` | o histórico: `ai-title` (tema), `last-prompt` (descrição), o último passo, modelo e branch |
//! | `<config>/projects/<pasta>/<sessão>/subagents/agent-<id>.meta.json` | cada subagente: tipo, descrição, `spawnDepth`, `toolUseId` (quem o criou) e `finished` |
//! | `<config>/projects/<pasta>/<sessão>/subagents/agent-<id>.jsonl` | o passo atual de cada subagente |
//!
//! Os históricos são lidos do fim para o começo e depois só no que cresce, então arquivos de dezenas
//! de MB não pesam.
//!
//! **Atenção:** esses arquivos são formato interno do Claude Code, não uma API. Se uma atualização
//! mudar algum campo, o conserto fica aqui, a única parte que conhece esses formatos.
//!
//! ```no_run
//! use vagents_sessoes::{load_settings, Monitor};
//! use std::path::Path;
//!
//! let home = Path::new(r"C:\Users\voce");
//! let settings = load_settings(Path::new("vagents.config.json"), None, home);
//! let mut monitor = Monitor::new(settings);
//! if let Some(snapshot) = monitor.tick() {
//!     println!("{} sessões", snapshot.sessions.len());
//! }
//! ```

pub mod model;

mod clock;
mod config;
mod json;
mod jsonl;
mod monitor;
mod paths;
mod registry;
mod subagents;
mod transcript;

#[cfg(test)]
mod tests;

pub use config::{load_settings, Settings};
pub use monitor::Monitor;
