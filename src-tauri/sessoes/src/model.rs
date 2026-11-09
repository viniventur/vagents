//! O que vai para a tela: as sessões e os subagentes de cada uma.
//!
//! O JSON é exatamente o do `shared/model.ts`: nomes em camelCase, os campos opcionais ausentes
//! ficam de fora, os horários são milissegundos desde 1970 e o `parentId` de um subagente vai como
//! `null` quando quem o criou foi o agente principal.

use serde::{Deserialize, Serialize};

/// running: trabalhando · waiting: esperando você · idle: parada, pronta para o próximo pedido ·
/// ended: processo fechado.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Running,
    Waiting,
    Idle,
    Ended,
}

/// running: rodando · done: terminou · interrupted: parou sem terminar.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Running,
    Done,
    Interrupted,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    /// O id do subagente (o nome do arquivo, sem "agent-").
    pub id: String,
    /// O subagente que criou este; `None` (`null` no JSON) quando foi o agente principal.
    pub parent_id: Option<String>,
    pub description: String,
    pub agent_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub status: AgentStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    /// A última escrita no histórico do subagente (ou o fim, se já terminou).
    pub updated_at: i64,
    /// O último passo: a ferramenta em uso ou o começo do último texto.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
    pub depth: u32,
}

/// Uma pasta de configuração do Claude Code, que é uma conta (ex.: ~/.claude-trabalho = "Trabalho").
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub dir: String,
    pub name: String,
    /// O comando que abre o Claude nessa conta (ex.: "claude-trabalho"), para retomar uma sessão.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    /// Único entre as pastas de configuração: pasta + id da sessão.
    pub key: String,
    pub session_id: String,
    pub config_dir: String,
    /// O nome da conta (da pasta de configuração).
    pub account: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub cwd: String,
    pub project: String,
    /// O tema: o nome dado por você ou o título que o Claude gera.
    pub title: String,
    /// O seu último pedido nessa sessão.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    pub status: SessionStatus,
    /// O motivo da espera, como o Claude Code grava (ex.: "input needed").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waiting_for: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_since: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    pub updated_at: i64,
    pub agents: Vec<AgentView>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub generated_at: i64,
    pub config_dirs: Vec<String>,
    /// Por quanto tempo uma sessão encerrada continua na lista.
    pub retention_ms: i64,
    pub sessions: Vec<SessionView>,
}
