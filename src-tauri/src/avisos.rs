//! Quando avisar (o popup do aviso.rs). São dois avisos:
//! - esperando: a sessão que passa a esperar por você (uma permissão, uma resposta);
//! - terminou: a sessão que estava trabalhando e parou, pronta para o próximo pedido. Trabalhar é rodar
//!   ou, já parada, ter subagente rodando (os subagentes em segundo plano ainda vão acordar o agente
//!   principal). A conta começa na última vez que ela passou a rodar: depois de uma espera, vale a partir
//!   da sua resposta. Menos de 15 s de trabalho não avisa: você ainda está olhando.
//!
//! O que já esperava quando o app abriu não avisa (a janela mostra), e a mesma sessão não repete o mesmo
//! aviso antes de 30 s (uma sequência de permissões seguidas viraria uma rajada).

use std::collections::{HashMap, HashSet};
use vagents_sessoes::model::{AgentStatus, SessionStatus, SessionView, Snapshot};

const INTERVALO_MS: i64 = 30_000;
const MINIMO_TRABALHANDO_MS: i64 = 15_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tipo {
    Esperando,
    Terminou,
}

impl Tipo {
    /// Como a tela chama (window.__AVISO__.tipo, os comandos dos Ajustes).
    pub fn nome(self) -> &'static str {
        match self {
            Tipo::Esperando => "esperando",
            Tipo::Terminou => "terminou",
        }
    }

    /// Pelo nome; o que não for "terminou" é o de esperando.
    pub fn de(nome: &str) -> Tipo {
        if nome == "terminou" {
            Tipo::Terminou
        } else {
            Tipo::Esperando
        }
    }
}

/// O que o popup mostra: a sessão (como a tela a chama), o motivo e o projeto; a chave abre a sessão.
#[derive(Debug, Clone, PartialEq)]
pub struct Aviso {
    pub tipo: Tipo,
    pub titulo: String,
    pub motivo: String,
    pub projeto: String,
    pub chave: String,
}

#[derive(Default)]
pub struct Avisos {
    esperando: HashSet<String>,
    /// Desde quando cada sessão está trabalhando.
    trabalhando: HashMap<String, i64>,
    ultimo: HashMap<(Tipo, String), i64>,
    comecou: bool,
}

/// O motivo, como a tela diz ("Esperando " + isto).
pub fn motivo(bruto: Option<&str>) -> String {
    match bruto {
        Some("input needed") => "uma resposta sua".into(),
        Some("goal proposal") => "você aprovar um objetivo".into(),
        Some("sandbox request") => "uma permissão do sandbox".into(),
        Some("worker request") => "um pedido de outro agente".into(),
        Some("permission") => "uma permissão".into(),
        Some("dialog open") => "uma janela aberta no terminal".into(),
        Some(outro) if !outro.is_empty() => outro.into(),
        _ => "você".into(),
    }
}

/// Quanto tempo a sessão trabalhou, curto: "45 s", "12 min", "1 h 5 min".
pub fn duracao(ms: i64) -> String {
    let segundos = (ms / 1000).max(0);
    if segundos < 60 {
        return format!("{segundos} s");
    }
    let minutos = segundos / 60;
    if minutos < 60 {
        return format!("{minutos} min");
    }
    match (minutos / 60, minutos % 60) {
        (horas, 0) => format!("{horas} h"),
        (horas, resto) => format!("{horas} h {resto} min"),
    }
}

/// Uma janela que você mesmo abriu no terminal (o /config, por exemplo) não é motivo para avisar.
fn merece_aviso(s: &SessionView) -> bool {
    s.status == SessionStatus::Waiting && s.waiting_for.as_deref() != Some("dialog open")
}

fn trabalhando(s: &SessionView) -> bool {
    match s.status {
        SessionStatus::Running => true,
        SessionStatus::Idle => s.agents.iter().any(|a| a.status == AgentStatus::Running),
        _ => false,
    }
}

/// Quando a sessão começou a trabalhar, vista agora pela primeira vez trabalhando. Rodando, o Claude Code
/// diz desde quando (vale para a sessão que já rodava quando o app abriu).
fn inicio(s: &SessionView, agora: i64) -> i64 {
    match s.status {
        SessionStatus::Running => s.status_since.map_or(agora, |t| t.min(agora)),
        _ => agora,
    }
}

impl Avisos {
    /// Os avisos deste retrato. `nome` dá o nome da sessão como a tela mostra (o seu, ou o título).
    pub fn novos(&mut self, retrato: &Snapshot, agora: i64, nome: impl Fn(&SessionView) -> String) -> Vec<Aviso> {
        self.ultimo.retain(|_, &mut t| agora - t < INTERVALO_MS);
        let mut avisos = Vec::new();
        let mut esperando = HashSet::new();
        let mut trabalhando_agora = HashMap::new();
        for s in &retrato.sessions {
            if trabalhando(s) {
                let desde = self.trabalhando.get(&s.key).copied().unwrap_or_else(|| inicio(s, agora));
                trabalhando_agora.insert(s.key.clone(), desde);
                continue;
            }
            let (tipo, motivo) = if merece_aviso(s) {
                esperando.insert(s.key.clone());
                if !self.comecou || self.esperando.contains(&s.key) {
                    continue;
                }
                (Tipo::Esperando, format!("Esperando {}", motivo(s.waiting_for.as_deref())))
            } else if s.status == SessionStatus::Idle {
                match self.trabalhando.get(&s.key) {
                    Some(&desde) if agora - desde >= MINIMO_TRABALHANDO_MS => {
                        (Tipo::Terminou, format!("Terminou em {}", duracao(agora - desde)))
                    }
                    _ => continue,
                }
            } else {
                continue;
            };
            let chave = (tipo, s.key.clone());
            if self.ultimo.contains_key(&chave) {
                continue;
            }
            self.ultimo.insert(chave, agora);
            avisos.push(Aviso { tipo, titulo: nome(s), motivo, projeto: s.project.clone(), chave: s.key.clone() });
        }
        self.esperando = esperando;
        self.trabalhando = trabalhando_agora;
        self.comecou = true;
        avisos
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use vagents_sessoes::model::AgentView;

    fn sessao(chave: &str, status: SessionStatus) -> SessionView {
        serde_json::from_value(serde_json::json!({
            "key": chave, "sessionId": chave, "configDir": "c", "account": "Pessoal", "cwd": "D:\\x",
            "project": "x", "title": format!("Sessão {chave}"), "status": status, "updatedAt": 0, "agents": []
        }))
        .unwrap()
    }

    fn esperando(chave: &str, motivo: Option<&str>) -> SessionView {
        let mut s = sessao(chave, SessionStatus::Waiting);
        s.waiting_for = motivo.map(String::from);
        s
    }

    fn com_subagente(mut s: SessionView, status: AgentStatus) -> SessionView {
        s.agents.push(AgentView {
            id: "a1".into(),
            parent_id: None,
            description: "Explorar".into(),
            agent_type: "Explore".into(),
            name: None,
            model: None,
            status,
            started_at: None,
            updated_at: 0,
            activity: None,
            depth: 1,
        });
        s
    }

    fn retrato(sessions: Vec<SessionView>) -> Snapshot {
        Snapshot { generated_at: 0, config_dirs: vec![], retention_ms: 0, sessions }
    }

    fn titulo(s: &SessionView) -> String {
        s.title.clone()
    }

    /// Os motivos dos avisos de um retrato, para comparar curto.
    fn motivos(a: &mut Avisos, sessoes: Vec<SessionView>, agora: i64) -> Vec<String> {
        a.novos(&retrato(sessoes), agora, titulo).into_iter().map(|aviso| aviso.motivo).collect()
    }

    #[test]
    fn nao_avisa_o_que_ja_esperava_ao_abrir_mas_avisa_o_que_passa_a_esperar() {
        let mut a = Avisos::default();
        assert!(a.novos(&retrato(vec![esperando("1", Some("input needed"))]), 0, titulo).is_empty());
        let avisos = a.novos(
            &retrato(vec![esperando("1", Some("input needed")), esperando("2", Some("input needed"))]),
            1000,
            titulo,
        );
        assert_eq!(
            avisos,
            vec![Aviso {
                tipo: Tipo::Esperando,
                titulo: "Sessão 2".into(),
                motivo: "Esperando uma resposta sua".into(),
                projeto: "x".into(),
                chave: "2".into(),
            }]
        );
    }

    #[test]
    fn nao_repete_antes_de_30_s_nem_avisa_janela_aberta() {
        let mut a = Avisos::default();
        let rodando = || vec![sessao("1", SessionStatus::Running)];
        a.novos(&retrato(rodando()), 0, titulo);
        assert_eq!(a.novos(&retrato(vec![esperando("1", Some("input needed"))]), 1_000, titulo).len(), 1);
        a.novos(&retrato(rodando()), 2_000, titulo);
        assert!(a.novos(&retrato(vec![esperando("1", Some("input needed"))]), 5_000, titulo).is_empty());
        a.novos(&retrato(rodando()), 40_000, titulo);
        assert_eq!(a.novos(&retrato(vec![esperando("1", None)]), 41_000, titulo).len(), 1);
        a.novos(&retrato(rodando()), 90_000, titulo);
        assert!(a.novos(&retrato(vec![esperando("1", Some("dialog open"))]), 95_000, titulo).is_empty());
    }

    #[test]
    fn avisa_quando_termina_depois_de_trabalhar() {
        let mut a = Avisos::default();
        a.novos(&retrato(vec![sessao("1", SessionStatus::Idle)]), 0, titulo);
        a.novos(&retrato(vec![sessao("1", SessionStatus::Running)]), 1_000, titulo);
        let avisos = a.novos(&retrato(vec![sessao("1", SessionStatus::Idle)]), 21_000, titulo);
        assert_eq!(
            avisos,
            vec![Aviso {
                tipo: Tipo::Terminou,
                titulo: "Sessão 1".into(),
                motivo: "Terminou em 20 s".into(),
                projeto: "x".into(),
                chave: "1".into(),
            }]
        );
        // Parada, continua parada: um aviso só.
        assert!(a.novos(&retrato(vec![sessao("1", SessionStatus::Idle)]), 22_000, titulo).is_empty());
    }

    #[test]
    fn uma_vez_curta_nao_avisa() {
        let mut a = Avisos::default();
        a.novos(&retrato(vec![sessao("1", SessionStatus::Running)]), 0, titulo);
        assert!(motivos(&mut a, vec![sessao("1", SessionStatus::Idle)], 14_000).is_empty());
    }

    #[test]
    fn com_subagente_rodando_ainda_nao_terminou() {
        let mut a = Avisos::default();
        a.novos(&retrato(vec![sessao("1", SessionStatus::Running)]), 0, titulo);
        let parada = |agente| vec![com_subagente(sessao("1", SessionStatus::Idle), agente)];
        assert!(motivos(&mut a, parada(AgentStatus::Running), 20_000).is_empty());
        // O subagente acorda o agente principal, que fecha a vez depois.
        a.novos(&retrato(vec![sessao("1", SessionStatus::Running)]), 50_000, titulo);
        assert_eq!(motivos(&mut a, parada(AgentStatus::Done), 65_000), vec!["Terminou em 1 min"]);
    }

    #[test]
    fn a_espera_recomeca_a_conta() {
        let mut a = Avisos::default();
        a.novos(&retrato(vec![sessao("1", SessionStatus::Running)]), 0, titulo);
        assert_eq!(motivos(&mut a, vec![esperando("1", Some("permission"))], 30_000), vec!["Esperando uma permissão"]);
        a.novos(&retrato(vec![sessao("1", SessionStatus::Running)]), 32_000, titulo);
        assert!(motivos(&mut a, vec![sessao("1", SessionStatus::Idle)], 40_000).is_empty());
    }

    #[test]
    fn a_que_ja_rodava_ao_abrir_conta_desde_quando_comecou() {
        let mut a = Avisos::default();
        let mut rodando = sessao("1", SessionStatus::Running);
        rodando.status_since = Some(-120_000);
        a.novos(&retrato(vec![rodando]), 0, titulo);
        assert_eq!(motivos(&mut a, vec![sessao("1", SessionStatus::Idle)], 1_000), vec!["Terminou em 2 min"]);
    }

    #[test]
    fn nao_repete_o_terminou_antes_de_30_s() {
        let mut a = Avisos::default();
        let rodando = || vec![sessao("1", SessionStatus::Running)];
        let parada = || vec![sessao("1", SessionStatus::Idle)];
        a.novos(&retrato(rodando()), 0, titulo);
        assert_eq!(motivos(&mut a, parada(), 20_000).len(), 1);
        a.novos(&retrato(rodando()), 21_000, titulo);
        assert!(motivos(&mut a, parada(), 40_000).is_empty());
        a.novos(&retrato(rodando()), 41_000, titulo);
        assert_eq!(motivos(&mut a, parada(), 70_000), vec!["Terminou em 29 s"]);
    }

    #[test]
    fn encerrada_no_meio_nao_e_terminou() {
        let mut a = Avisos::default();
        a.novos(&retrato(vec![sessao("1", SessionStatus::Running)]), 0, titulo);
        assert!(motivos(&mut a, vec![sessao("1", SessionStatus::Ended)], 20_000).is_empty());
    }

    #[test]
    fn a_duracao_e_curta() {
        assert_eq!(duracao(15_400), "15 s");
        assert_eq!(duracao(59_999), "59 s");
        assert_eq!(duracao(60_000), "1 min");
        assert_eq!(duracao(3_599_000), "59 min");
        assert_eq!(duracao(3_600_000), "1 h");
        assert_eq!(duracao(5_460_000), "1 h 31 min");
    }
}
