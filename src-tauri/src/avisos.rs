//! Quando avisar: a sessão que passa a esperar por você vira um aviso (o popup do aviso.rs). A que já
//! esperava quando o app abriu não avisa (a janela mostra), e a mesma sessão não avisa de novo antes
//! de 30 s (uma sequência de permissões seguidas viraria uma rajada).

use std::collections::{HashMap, HashSet};
use vagents_sessoes::model::{SessionStatus, SessionView, Snapshot};

const INTERVALO_MS: i64 = 30_000;

/// O que o popup mostra: a sessão (como a tela a chama), o motivo e o projeto; a chave abre a sessão.
#[derive(Debug, Clone, PartialEq)]
pub struct Aviso {
    pub titulo: String,
    pub motivo: String,
    pub projeto: String,
    pub chave: String,
}

#[derive(Default)]
pub struct Avisos {
    esperando: HashSet<String>,
    ultimo: HashMap<String, i64>,
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

/// Uma janela que você mesmo abriu no terminal (o /config, por exemplo) não é motivo para avisar.
fn merece_aviso(s: &SessionView) -> bool {
    s.status == SessionStatus::Waiting && s.waiting_for.as_deref() != Some("dialog open")
}

impl Avisos {
    /// Os avisos deste retrato. `nome` dá o nome da sessão como a tela mostra (o seu, ou o título).
    pub fn novos(&mut self, retrato: &Snapshot, agora: i64, nome: impl Fn(&SessionView) -> String) -> Vec<Aviso> {
        let mut avisos = Vec::new();
        let mut esperando = HashSet::new();
        for s in retrato.sessions.iter().filter(|s| merece_aviso(s)) {
            esperando.insert(s.key.clone());
            if !self.comecou || self.esperando.contains(&s.key) {
                continue;
            }
            if self.ultimo.get(&s.key).is_some_and(|&t| agora - t < INTERVALO_MS) {
                continue;
            }
            self.ultimo.insert(s.key.clone(), agora);
            avisos.push(Aviso {
                titulo: nome(s),
                motivo: format!("Esperando {}", motivo(s.waiting_for.as_deref())),
                projeto: s.project.clone(),
                chave: s.key.clone(),
            });
        }
        self.esperando = esperando;
        self.comecou = true;
        avisos
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn retrato(sessoes: &[(&str, SessionStatus, Option<&str>)]) -> Snapshot {
        let modelo = serde_json::json!({
            "generatedAt": 0, "configDirs": [], "retentionMs": 0,
            "sessions": sessoes.iter().map(|(k, _, _)| serde_json::json!({
                "key": k, "sessionId": k, "configDir": "c", "account": "Pessoal", "cwd": "D:\\x",
                "project": "x", "title": format!("Sessão {k}"), "status": "idle", "updatedAt": 0, "agents": []
            })).collect::<Vec<_>>()
        });
        let mut r: Snapshot = serde_json::from_value(modelo).unwrap();
        for (s, (_, status, motivo)) in r.sessions.iter_mut().zip(sessoes) {
            s.status = status.clone();
            s.waiting_for = motivo.map(String::from);
        }
        r
    }

    #[test]
    fn nao_avisa_o_que_ja_esperava_ao_abrir_mas_avisa_o_que_passa_a_esperar() {
        let mut a = Avisos::default();
        let nome = |s: &SessionView| s.title.clone();
        assert!(a.novos(&retrato(&[("1", SessionStatus::Waiting, Some("input needed"))]), 0, nome).is_empty());
        let avisos = a.novos(
            &retrato(&[("1", SessionStatus::Waiting, Some("input needed")), ("2", SessionStatus::Waiting, Some("input needed"))]),
            1000,
            nome,
        );
        assert_eq!(
            avisos,
            vec![Aviso {
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
        let nome = |s: &SessionView| s.title.clone();
        a.novos(&retrato(&[("1", SessionStatus::Running, None)]), 0, nome);
        assert_eq!(a.novos(&retrato(&[("1", SessionStatus::Waiting, Some("input needed"))]), 1_000, nome).len(), 1);
        a.novos(&retrato(&[("1", SessionStatus::Running, None)]), 2_000, nome);
        assert!(a.novos(&retrato(&[("1", SessionStatus::Waiting, Some("input needed"))]), 5_000, nome).is_empty());
        a.novos(&retrato(&[("1", SessionStatus::Running, None)]), 40_000, nome);
        assert_eq!(a.novos(&retrato(&[("1", SessionStatus::Waiting, None)]), 41_000, nome).len(), 1);
        a.novos(&retrato(&[("1", SessionStatus::Running, None)]), 90_000, nome);
        assert!(a.novos(&retrato(&[("1", SessionStatus::Waiting, Some("dialog open"))]), 95_000, nome).is_empty());
    }
}
