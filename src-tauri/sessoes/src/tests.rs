//! Os testes do test/claude.test.ts do servidor em Node, mais os do horário ISO e do formato do JSON.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde_json::{json, Value};

use crate::json::Json;

/// Uma linha JSONL.
fn line(value: Value) -> String {
    format!("{value}\n")
}

fn append(path: &Path, bytes: &[u8]) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    file.write_all(bytes).unwrap();
}

fn object(value: Value) -> Json {
    match value {
        Value::Object(map) => map,
        other => panic!("não é um objeto: {other}"),
    }
}

mod jsonl_tail {
    use super::*;
    use crate::jsonl::JsonlTail;

    #[test]
    fn entrega_so_linhas_completas_e_guarda_o_pedaco_que_ainda_esta_sendo_escrito() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.jsonl");
        fs::write(&file, "{\"n\":1}\n{\"n\":").unwrap();
        let mut tail = JsonlTail::new(file.clone(), 0);
        assert_eq!(tail.read_new(), vec![r#"{"n":1}"#]);
        append(&file, b"2}\n");
        assert_eq!(tail.read_new(), vec![r#"{"n":2}"#]);
        assert!(tail.read_new().is_empty());
    }

    #[test]
    fn nao_quebra_um_caractere_acentuado_dividido_entre_duas_leituras() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("b.jsonl");
        let bytes = "{\"t\":\"ação\"}\n".as_bytes();
        let cut = bytes.windows(2).position(|w| w == "ç".as_bytes()).unwrap() + 1; // no meio dos 2 bytes do "ç"
        fs::write(&file, &bytes[..cut]).unwrap();
        let mut tail = JsonlTail::new(file.clone(), 0);
        assert!(tail.read_new().is_empty());
        append(&file, &bytes[cut..]);
        assert_eq!(tail.read_new(), vec![r#"{"t":"ação"}"#]);
    }

    #[test]
    fn recomeca_do_zero_se_o_arquivo_encolher() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("c.jsonl");
        fs::write(&file, "{\"n\":1}\n{\"n\":2}\n").unwrap();
        let mut tail = JsonlTail::new(file.clone(), 0);
        tail.read_new();
        fs::write(&file, "{\"n\":3}\n").unwrap();
        assert_eq!(tail.read_new(), vec![r#"{"n":3}"#]);
    }

    #[test]
    fn arquivo_que_sumiu_ou_esta_vazio_nao_da_linhas() {
        let dir = tempfile::tempdir().unwrap();
        let mut sumiu = JsonlTail::new(dir.path().join("nao-existe.jsonl"), 0);
        assert!(sumiu.read_new().is_empty());
        let vazio = dir.path().join("vazio.jsonl");
        fs::write(&vazio, "").unwrap();
        assert!(JsonlTail::new(vazio, 0).read_new().is_empty());
    }

    #[test]
    fn bytes_que_nao_sao_utf8_viram_o_caractere_de_troca() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("d.jsonl");
        fs::write(&file, b"{\"t\":\"a\xffb\"}\n").unwrap();
        assert_eq!(
            JsonlTail::new(file, 0).read_new(),
            vec!["{\"t\":\"a\u{fffd}b\"}"]
        );
    }
}

mod scan_backward {
    use super::*;
    use crate::jsonl::scan_backward;

    #[test]
    fn le_do_fim_para_o_comeco_alargando_a_janela_e_diz_onde_continuar() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("d.jsonl");
        let body: String = (0..50).map(|i| line(json!({ "i": i }))).collect();
        fs::write(&file, format!("{body}{{\"incompleta\":")).unwrap();
        let mut seen: Vec<i64> = Vec::new();
        let resume = scan_backward(
            &file,
            body.len() as u64 + 14,
            |l| {
                let i = serde_json::from_str::<Value>(l).unwrap()["i"]
                    .as_i64()
                    .unwrap();
                if !seen.contains(&i) {
                    seen.push(i);
                }
                i == 3
            },
            64,
        )
        .unwrap();
        assert_eq!(seen.first(), Some(&49));
        assert_eq!(seen.last(), Some(&3));
        assert_eq!(resume, body.len() as u64);
    }

    #[test]
    fn arquivo_vazio_ou_sem_linha_completa_continua_do_zero() {
        let dir = tempfile::tempdir().unwrap();
        let vazio = dir.path().join("vazio.jsonl");
        fs::write(&vazio, "").unwrap();
        assert_eq!(scan_backward(&vazio, 0, |_| false, 64).unwrap(), 0);
        let cortada = dir.path().join("cortada.jsonl");
        fs::write(&cortada, "{\"sem\":\"fim").unwrap();
        assert_eq!(
            scan_backward(&cortada, 11, |_| panic!("não há linha completa"), 4).unwrap(),
            0
        );
        assert!(scan_backward(&dir.path().join("nao-existe.jsonl"), 10, |_| false, 64).is_err());
    }
}

mod registro {
    use super::*;
    use crate::model::SessionStatus;
    use crate::registry::{parse_record, pid_alive, session_status, LiveRecord};

    fn rec(extra: Value, alive: bool) -> Option<LiveRecord> {
        let mut o = object(json!({ "pid": 10, "sessionId": "s1" }));
        o.extend(object(extra));
        parse_record(&Value::Object(o).to_string(), "cfg", &|_| alive)
    }

    #[test]
    fn traduz_busy_waiting_e_idle() {
        assert_eq!(
            session_status(rec(json!({ "status": "busy" }), true).as_ref()),
            (SessionStatus::Running, None)
        );
        assert_eq!(
            session_status(
                rec(
                    json!({ "status": "waiting", "waitingFor": "input needed" }),
                    true
                )
                .as_ref()
            ),
            (SessionStatus::Waiting, Some("input needed".to_string()))
        );
        assert_eq!(
            session_status(rec(json!({ "status": "idle" }), true).as_ref()),
            (SessionStatus::Idle, None)
        );
    }

    #[test]
    fn processo_morto_ou_sem_registro_e_sessao_encerrada() {
        assert_eq!(
            session_status(rec(json!({ "status": "busy" }), false).as_ref()),
            (SessionStatus::Ended, None)
        );
        assert_eq!(session_status(None), (SessionStatus::Ended, None));
    }

    #[test]
    fn ignora_arquivo_pela_metade() {
        assert_eq!(
            parse_record(r#"{"pid":10,"sessio"#, "cfg", &pid_alive),
            None
        );
        assert_eq!(parse_record("", "cfg", &pid_alive), None);
        assert_eq!(
            parse_record(r#"{"pid":"10","sessionId":"s1"}"#, "cfg", &pid_alive),
            None
        );
    }

    #[test]
    fn o_proprio_processo_esta_vivo() {
        assert!(pid_alive(std::process::id()));
        assert!(!pid_alive(u32::MAX - 1));
    }
}

mod historico {
    use super::*;
    use crate::clock::parse_iso_ms;
    use crate::transcript::{apply_entry, describe_tool, parse_line, Mode, TranscriptInfo};

    fn entries() -> Vec<Json> {
        [
            json!({ "type": "ai-title", "aiTitle": "Título velho" }),
            json!({ "type": "user", "cwd": "D:\\x", "gitBranch": "main", "timestamp": "2026-11-09T10:00:00Z", "message": { "content": "faz isso" } }),
            json!({
                "type": "assistant",
                "timestamp": "2026-11-09T10:00:05Z",
                "message": { "model": "claude-opus-5-5", "content": [{ "type": "tool_use", "name": "Bash", "input": { "command": "npm test", "description": "Roda os testes" } }] }
            }),
            json!({ "type": "assistant", "isSidechain": true, "timestamp": "2026-11-09T10:00:06Z", "message": { "content": [{ "type": "text", "text": "de um subagente" }] } }),
            json!({ "type": "ai-title", "aiTitle": "Título novo" }),
            json!({ "type": "last-prompt", "lastPrompt": "faz isso" }),
        ]
        .into_iter()
        .map(object)
        .collect()
    }

    #[test]
    fn em_ordem_a_linha_mais_nova_vence_linhas_de_subagente_nao_contam() {
        let mut info = TranscriptInfo::default();
        for e in entries() {
            apply_entry(&mut info, &e, Mode::Overwrite, false);
        }
        assert_eq!(info.ai_title.as_deref(), Some("Título novo"));
        assert_eq!(info.activity.as_deref(), Some("Bash: Roda os testes"));
        assert_eq!(info.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(info.cwd.as_deref(), Some("D:\\x"));
        assert_eq!(info.last_prompt.as_deref(), Some("faz isso"));
    }

    #[test]
    fn de_tras_para_frente_chega_ao_mesmo_resultado() {
        let mut info = TranscriptInfo::default();
        for e in entries().iter().rev() {
            apply_entry(&mut info, e, Mode::Fill, false);
        }
        assert_eq!(info.ai_title.as_deref(), Some("Título novo"));
        assert_eq!(info.activity.as_deref(), Some("Bash: Roda os testes"));
        assert_eq!(info.activity_at, parse_iso_ms("2026-11-09T10:00:05Z"));
        assert_eq!(info.activity_at, Some(1_794_218_405_000));
    }

    #[test]
    fn no_historico_de_um_subagente_as_linhas_sidechain_contam() {
        let mut info = TranscriptInfo::default();
        for e in entries() {
            apply_entry(&mut info, &e, Mode::Overwrite, true);
        }
        assert_eq!(info.activity.as_deref(), Some("de um subagente"));
    }

    #[test]
    fn pula_sem_ler_as_linhas_enormes_de_api_request() {
        assert_eq!(parse_line(r#"{"type":"api-request-blob","x":1}"#), None);
        assert_eq!(
            parse_line(r#"{"type":"file-history-snapshot","x":1}"#),
            None
        );
        assert_eq!(
            parse_line(r#"{"type":"ai-title","aiTitle":"x"}"#),
            Some(object(json!({ "type": "ai-title", "aiTitle": "x" })))
        );
        assert_eq!(parse_line(r#"{"type":"ai-title","aiTi"#), None);
        assert_eq!(parse_line("[1,2]"), None);
    }

    #[test]
    fn descreve_as_ferramentas_em_uma_linha() {
        let tool = |name: &str, input: Value| describe_tool(name, &object(input));
        assert_eq!(
            tool(
                "Read",
                json!({ "file_path": "D:\\projetos\\app\\src\\main.ts" })
            ),
            "Read: main.ts"
        );
        assert_eq!(
            tool("Agent", json!({ "description": "Revisar o PR" })),
            "Subagente: Revisar o PR"
        );
        assert_eq!(
            tool("mcp__vagas__buscar_vagas", json!({})),
            "buscar_vagas (vagas)"
        );
        assert_eq!(
            tool("Bash", json!({ "command": "git status\ngit log" })),
            "Bash: git status"
        );
        assert_eq!(
            tool(
                "WebFetch",
                json!({ "url": "https://Docs.Example.com:443/x?y" })
            ),
            "Lendo: docs.example.com"
        );
        assert_eq!(
            tool("WebFetch", json!({ "url": "não é url" })),
            "Lendo: não é url"
        );
        assert_eq!(tool("Grep", json!({})), "Grep");
        assert_eq!(tool("Desconhecida", json!({})), "Desconhecida");
    }

    #[test]
    fn corta_como_o_javascript_sem_partir_emoji() {
        use crate::transcript::clip;
        assert_eq!(clip("abcdef", 6), "abcdef");
        assert_eq!(clip("abcdefg", 6), "abcde…");
        // "😀" vale 2 no JavaScript: não cabe inteiro, então fica de fora.
        assert_eq!(clip("abcd😀fg", 6), "abcd…");
        assert_eq!(clip("ação", 3), "aç…");
    }
}

mod subagentes {
    use crate::model::{AgentStatus, SessionStatus};
    use crate::subagents::{agent_status, parse_meta, AgentMeta};

    #[test]
    fn le_o_meta_e_decide_o_estado() {
        let meta = parse_meta(Some(
            r#"{"agentType":"Explore","description":"Mapear","toolUseId":"toolu_1","spawnDepth":1}"#,
        ))
        .unwrap();
        assert!(!meta.finished);
        assert_eq!(meta.spawn_depth, Some(1));
        let finished = AgentMeta {
            finished: true,
            ..meta.clone()
        };
        assert_eq!(
            agent_status(Some(&finished), SessionStatus::Running, 0, 0),
            AgentStatus::Done
        );
        assert_eq!(
            agent_status(Some(&meta), SessionStatus::Running, 0, 1_000_000_000),
            AgentStatus::Running
        );
        assert_eq!(
            agent_status(Some(&meta), SessionStatus::Idle, 0, 1_000_000_000),
            AgentStatus::Interrupted
        );
        assert_eq!(
            agent_status(
                Some(&meta),
                SessionStatus::Ended,
                1_000_000_000 - 5000,
                1_000_000_000
            ),
            AgentStatus::Running
        );
    }

    #[test]
    fn meta_pela_metade_ou_vazio_nao_conta() {
        assert_eq!(parse_meta(Some(r#"{"agentType":"Exp"#)), None);
        assert_eq!(parse_meta(Some("")), None);
        assert_eq!(parse_meta(None), None);
    }
}

mod pastas {
    use super::*;
    use crate::load_settings;
    use crate::model::Account;

    #[test]
    fn acha_claude_e_claude_traco_que_tenham_projects_ou_sessions() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path();
        fs::create_dir_all(dir.join(".claude").join("projects")).unwrap();
        fs::create_dir_all(dir.join(".claude-pessoal").join("sessions")).unwrap();
        fs::create_dir_all(dir.join(".claude-vazia")).unwrap();
        fs::write(dir.join(".claude.json"), "{}").unwrap();
        let nenhum = dir.join("nao-existe.json");
        assert_eq!(
            load_settings(&nenhum, None, dir).config_dirs,
            vec![dir.join(".claude"), dir.join(".claude-pessoal")]
        );

        // "pastas" no arquivo manda, como a VAGENTES_DIRS do servidor em Node.
        let file = dir.join("vagents.config.json");
        fs::write(&file, json!({ "pastas": [dir.join("x")] }).to_string()).unwrap();
        assert_eq!(
            load_settings(&file, None, dir).config_dirs,
            vec![dir.join("x")]
        );
    }

    #[test]
    fn claude_config_dir_entra_primeiro_e_sem_repetir() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path();
        fs::create_dir_all(dir.join(".claude").join("projects")).unwrap();
        let outra = dir.join("outra");
        let settings = load_settings(
            &dir.join("nao-existe.json"),
            Some(&outra.to_string_lossy()),
            dir,
        );
        assert_eq!(settings.config_dirs, vec![outra, dir.join(".claude")]);
        let mesma = dir.join(".CLAUDE").to_string_lossy().into_owned();
        let settings = load_settings(&dir.join("nao-existe.json"), Some(&mesma), dir);
        assert_eq!(settings.config_dirs.len(), 1);
    }

    #[test]
    fn da_nome_e_comando_as_contas_pelo_vagents_config_json_as_outras_ficam_com_o_nome_da_pasta() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path();
        let dirs = [
            dir.join(".claude-pessoal"),
            dir.join(".claude"),
            dir.join(".claude-teste"),
        ];
        let file = dir.join("vagents.config.json");
        fs::write(
            &file,
            json!({
                "contas": [{ "pasta": "~/.claude-pessoal", "nome": "Pessoal", "comando": "claude" }],
                "pastas": dirs,
            })
            .to_string(),
        )
        .unwrap();
        let shown = |i: usize| dirs[i].to_string_lossy().into_owned();
        assert_eq!(
            load_settings(&file, None, dir).accounts,
            vec![
                Account {
                    dir: shown(0),
                    name: "Pessoal".into(),
                    command: Some("claude".into())
                },
                Account {
                    dir: shown(1),
                    name: "padrão".into(),
                    command: None
                },
                Account {
                    dir: shown(2),
                    name: "teste".into(),
                    command: None
                },
            ]
        );

        fs::create_dir_all(dir.join(".claude-pessoal").join("sessions")).unwrap();
        assert_eq!(
            load_settings(&dir.join("nao-existe.json"), None, dir).accounts[0].name,
            "pessoal"
        );
    }

    #[test]
    fn retencao_em_horas_com_padrao_de_24() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path();
        let file = dir.join("vagents.config.json");
        assert_eq!(load_settings(&file, None, dir).retention_ms, 24 * 3_600_000);
        for (valor, esperado) in [
            (json!(2), 2 * 3_600_000),
            (json!(0.5), 1_800_000),
            (json!("3"), 3 * 3_600_000),
            (json!(-1), 24 * 3_600_000),
            (json!("abc"), 24 * 3_600_000),
        ] {
            fs::write(&file, json!({ "retencaoHoras": valor }).to_string()).unwrap();
            assert_eq!(
                load_settings(&file, None, dir).retention_ms,
                esperado,
                "retencaoHoras = {valor}"
            );
        }
    }

    #[test]
    fn arquivo_invalido_ou_com_bom_nao_atrapalha() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path();
        fs::create_dir_all(dir.join(".claude").join("sessions")).unwrap();
        let file = dir.join("vagents.config.json");
        fs::write(&file, "{ \"contas\": [").unwrap();
        let settings = load_settings(&file, None, dir);
        assert_eq!(settings.config_dirs, vec![dir.join(".claude")]);
        assert_eq!(settings.accounts[0].name, "padrão");

        let conta = json!({ "contas": [{ "pasta": "~/.claude", "nome": "Trabalho" }] }).to_string();
        fs::write(
            &file,
            [b"\xef\xbb\xbf".as_slice(), conta.as_bytes()].concat(),
        )
        .unwrap();
        assert_eq!(load_settings(&file, None, dir).accounts[0].name, "Trabalho");
    }
}

mod monitor {
    use super::*;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, SystemTime};

    use crate::clock::{format_iso_ms, now_ms};
    use crate::model::{Account, SessionStatus};
    use crate::{Monitor, Settings};

    const HOUR: i64 = 3_600_000;

    fn settings(cfg: &Path) -> Settings {
        Settings {
            config_dirs: vec![cfg.to_path_buf()],
            accounts: vec![Account {
                dir: cfg.to_string_lossy().into_owned(),
                name: "Trabalho".into(),
                command: Some("claude-trabalho".into()),
            }],
            retention_ms: 24 * HOUR,
        }
    }

    #[test]
    fn e_send_para_rodar_numa_thread() {
        fn send<T: Send>() {}
        send::<Monitor>();
    }

    #[test]
    fn monta_as_sessoes_abertas_e_as_encerradas_ha_pouco_com_os_subagentes() {
        let now = now_ms();
        let home = tempfile::tempdir().unwrap();
        let cfg = home.path().join(".claude");
        let project = cfg.join("projects").join("D--app");
        fs::create_dir_all(cfg.join("sessions")).unwrap();
        fs::create_dir_all(project.join("aberta").join("subagents")).unwrap();

        fs::write(
            cfg.join("sessions").join("111.json"),
            json!({ "pid": 111, "sessionId": "aberta", "cwd": "D:\\app", "name": "app-1", "nameSource": "derived", "status": "waiting", "waitingFor": "input needed", "startedAt": now - 60_000 }).to_string(),
        )
        .unwrap();
        let transcript: String = [
            json!({ "type": "user", "cwd": "D:\\app", "timestamp": format_iso_ms(now - 50_000), "message": { "content": "arruma o login" } }),
            json!({ "type": "assistant", "timestamp": format_iso_ms(now - 40_000), "message": { "model": "claude-opus-5-5", "content": [{ "type": "tool_use", "name": "AskUserQuestion", "input": {} }] } }),
            json!({ "type": "ai-title", "aiTitle": "Login quebrado" }),
            json!({ "type": "last-prompt", "lastPrompt": "arruma o login" }),
        ]
        .into_iter()
        .map(line)
        .collect();
        fs::write(project.join("aberta.jsonl"), transcript).unwrap();
        let sub = project.join("aberta").join("subagents");
        fs::write(
            sub.join("agent-a1.meta.json"),
            json!({ "agentType": "Explore", "description": "Achar o bug", "spawnDepth": 1, "toolUseId": "t1", "finished": true }).to_string(),
        )
        .unwrap();
        fs::write(
            sub.join("agent-a1.jsonl"),
            line(json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "Achei." }] } })),
        )
        .unwrap();
        fs::write(
            sub.join("agent-a2.meta.json"),
            json!({ "agentType": "general-purpose", "description": "Corrigir", "spawnDepth": 1, "toolUseId": "t2" }).to_string(),
        )
        .unwrap();
        fs::write(
            sub.join("agent-a2.jsonl"),
            line(json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "tool_use", "id": "t3", "name": "Agent", "input": { "description": "Testar" } }] } })),
        )
        .unwrap();
        // Um neto: criado pela chamada t3, que está no histórico do a2.
        fs::write(
            sub.join("agent-a3.meta.json"),
            json!({ "agentType": "general-purpose", "description": "Testar", "spawnDepth": 2, "toolUseId": "t3" }).to_string(),
        )
        .unwrap();
        fs::write(
            sub.join("agent-a3.jsonl"),
            line(json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "text", "text": "rodando" }] } })),
        )
        .unwrap();

        fs::write(
            project.join("antiga.jsonl"),
            line(json!({ "type": "ai-title", "aiTitle": "Antiga" })),
        )
        .unwrap();
        fs::write(
            project.join("velha.jsonl"),
            line(json!({ "type": "ai-title", "aiTitle": "Velha" })),
        )
        .unwrap();
        let two_days_ago = SystemTime::now() - Duration::from_secs(48 * 3600);
        OpenOptions::new()
            .write(true)
            .open(project.join("velha.jsonl"))
            .unwrap()
            .set_modified(two_days_ago)
            .unwrap();

        let mut monitor = Monitor::with_clock(
            settings(&cfg),
            Box::new(move || now),
            Box::new(|pid| pid == 111),
        );
        let snap = monitor
            .tick()
            .expect("o primeiro tick sempre traz um retrato");

        let resumo: Vec<(&str, SessionStatus)> = snap
            .sessions
            .iter()
            .map(|s| (s.title.as_str(), s.status))
            .collect();
        assert_eq!(
            resumo,
            vec![
                ("Login quebrado", SessionStatus::Waiting),
                ("Antiga", SessionStatus::Ended)
            ]
        );
        let open = &snap.sessions[0];
        assert_eq!(open.waiting_for.as_deref(), Some("input needed"));
        assert_eq!(open.last_prompt.as_deref(), Some("arruma o login"));
        assert_eq!(
            open.activity.as_deref(),
            Some("Fazendo uma pergunta para você")
        );
        assert_eq!(open.project, "app");
        assert_eq!(open.account, "Trabalho");
        assert_eq!(open.account_command.as_deref(), Some("claude-trabalho"));
        assert_eq!(open.pid, Some(111));
        assert_eq!(open.started_at, Some(now - 60_000));
        assert_eq!(open.activity_at, Some(now - 40_000));
        assert_eq!(open.key, format!("{}|aberta", cfg.to_string_lossy()));
        let agent = |id: &str| {
            open.agents
                .iter()
                .find(|a| a.id == id)
                .unwrap_or_else(|| panic!("sem o subagente {id}"))
        };
        assert_eq!(agent("a1").status, crate::model::AgentStatus::Done);
        assert_eq!(agent("a1").activity.as_deref(), Some("Achei."));
        assert_eq!(agent("a2").status, crate::model::AgentStatus::Running);
        assert_eq!(agent("a2").parent_id, None);
        assert_eq!(agent("a3").parent_id.as_deref(), Some("a2"));
        assert_eq!(agent("a3").depth, 2);

        let antiga = &snap.sessions[1];
        assert_eq!(antiga.pid, None);
        assert_eq!(antiga.project, "(sem pasta)");
        assert!(antiga.agents.is_empty());
        assert_eq!(monitor.snapshot(), &snap);
    }

    #[test]
    fn so_devolve_retrato_quando_algo_muda() {
        let clock = Arc::new(AtomicI64::new(now_ms()));
        let home = tempfile::tempdir().unwrap();
        let cfg = home.path().join(".claude");
        let project = cfg.join("projects").join("D--app");
        fs::create_dir_all(cfg.join("sessions")).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(
            cfg.join("sessions").join("7.json"),
            json!({ "pid": 7, "sessionId": "s", "cwd": "D:\\app", "status": "busy" }).to_string(),
        )
        .unwrap();
        let transcript = project.join("s.jsonl");
        fs::write(
            &transcript,
            line(json!({ "type": "ai-title", "aiTitle": "Tema" })),
        )
        .unwrap();

        let now = Arc::clone(&clock);
        let mut monitor = Monitor::with_clock(
            settings(&cfg),
            Box::new(move || now.load(Ordering::SeqCst)),
            Box::new(|_| true),
        );
        let first = monitor
            .tick()
            .expect("o primeiro tick sempre traz um retrato");
        assert_eq!(first.sessions[0].status, SessionStatus::Running);
        assert_eq!(first.sessions[0].activity, None);

        clock.fetch_add(1000, Ordering::SeqCst);
        assert_eq!(monitor.tick(), None, "nada mudou");

        append(
            &transcript,
            line(json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": "Read", "input": { "file_path": "D:\\app\\x.rs" } }] } }))
                .as_bytes(),
        );
        clock.fetch_add(1000, Ordering::SeqCst);
        let next = monitor.tick().expect("o histórico cresceu");
        assert_eq!(next.sessions[0].activity.as_deref(), Some("Read: x.rs"));
        assert_eq!(next.generated_at, clock.load(Ordering::SeqCst));
    }

    #[test]
    fn sessao_aberta_sem_historico_apressa_a_varredura() {
        let t0 = now_ms();
        let clock = Arc::new(AtomicI64::new(t0));
        let home = tempfile::tempdir().unwrap();
        let cfg = home.path().join(".claude");
        let project = cfg.join("projects").join("D--app");
        fs::create_dir_all(cfg.join("sessions")).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(
            cfg.join("sessions").join("7.json"),
            json!({ "pid": 7, "sessionId": "nova", "cwd": "D:\\app", "name": "app-7", "status": "idle" }).to_string(),
        )
        .unwrap();

        let now = Arc::clone(&clock);
        let mut monitor = Monitor::with_clock(
            settings(&cfg),
            Box::new(move || now.load(Ordering::SeqCst)),
            Box::new(|_| true),
        );
        let first = monitor.tick().unwrap();
        assert_eq!(first.sessions[0].title, "app-7");

        fs::write(
            project.join("nova.jsonl"),
            line(json!({ "type": "ai-title", "aiTitle": "Tema novo" })),
        )
        .unwrap();
        clock.store(t0 + 500, Ordering::SeqCst);
        assert_eq!(monitor.tick(), None, "antes de 1 s não varre de novo");
        clock.store(t0 + 1000, Ordering::SeqCst);
        assert_eq!(monitor.tick().unwrap().sessions[0].title, "Tema novo");
    }

    #[test]
    fn registro_de_processo_morto_so_fica_se_o_historico_estiver_na_retencao() {
        let t0 = now_ms();
        let clock = Arc::new(AtomicI64::new(t0));
        let home = tempfile::tempdir().unwrap();
        let cfg = home.path().join(".claude");
        let project = cfg.join("projects").join("D--app");
        fs::create_dir_all(cfg.join("sessions")).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(
            cfg.join("sessions").join("8.json"),
            json!({ "pid": 8, "sessionId": "morta", "cwd": "D:\\app", "status": "busy" }).to_string(),
        )
        .unwrap();

        let now = Arc::clone(&clock);
        let mut monitor = Monitor::with_clock(
            settings(&cfg),
            Box::new(move || now.load(Ordering::SeqCst)),
            Box::new(|_| false),
        );
        monitor.tick();
        assert!(monitor.snapshot().sessions.is_empty(), "sem histórico, o registro órfão não aparece");

        fs::write(project.join("morta.jsonl"), line(json!({ "type": "ai-title", "aiTitle": "Travou" }))).unwrap();
        clock.store(t0 + 3_000, Ordering::SeqCst);
        monitor.tick();
        let sessoes = &monitor.snapshot().sessions;
        assert_eq!(sessoes.len(), 1);
        assert_eq!(sessoes[0].status, SessionStatus::Ended);
        assert_eq!(sessoes[0].title, "Travou");
    }
}

mod pais {
    use crate::subagents::{parse_meta, resolve_parents, AgentTracker};

    #[test]
    fn neto_sem_pai_achado_desiste_depois_de_3_tentativas() {
        let dir = tempfile::tempdir().unwrap();
        let mut agentes = vec![AgentTracker::new(dir.path().to_path_buf(), "neto".into())];
        agentes[0].meta = parse_meta(Some(r#"{"spawnDepth":2,"toolUseId":"toolu_x"}"#));
        for tentativa in 0..3 {
            resolve_parents(&mut agentes, tentativa * 10_000);
            assert_eq!(agentes[0].parent_id, None, "tentativa {}", tentativa + 1);
        }
        resolve_parents(&mut agentes, 30_000);
        assert_eq!(agentes[0].parent_id, Some(None), "depois de 3, fica ligado ao principal");
    }
}

mod horario {
    use crate::clock::{format_iso_ms, parse_iso_ms};

    #[test]
    fn le_os_horarios_dos_historicos_como_o_date_parse() {
        // Os valores esperados vieram do Date.parse do Node.
        assert_eq!(
            parse_iso_ms("2026-11-09T14:44:24.748Z"),
            Some(1_794_235_464_748)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09T10:00:00Z"),
            Some(1_794_218_400_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09T10:00:00+00:00"),
            Some(1_794_218_400_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09T10:00:00+0000"),
            Some(1_794_218_400_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09T07:00:00-03:00"),
            Some(1_794_218_400_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09T10:00:00.5Z"),
            Some(1_794_218_400_500)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09T10:00:00.123456Z"),
            Some(1_794_218_400_123)
        );
        assert_eq!(parse_iso_ms("2026-11-09T10:00Z"), Some(1_794_218_400_000));
        assert_eq!(
            parse_iso_ms("2026-11-09t10:00:00z"),
            Some(1_794_218_400_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09 10:00:00Z"),
            Some(1_794_218_400_000)
        );
        assert_eq!(parse_iso_ms("2026-11-09"), Some(1_794_182_400_000));
        assert_eq!(
            parse_iso_ms("2024-02-29T00:00:00Z"),
            Some(1_709_164_800_000)
        );
        assert_eq!(
            parse_iso_ms("2026-02-30T00:00:00Z"),
            Some(1_772_409_600_000)
        );
        assert_eq!(
            parse_iso_ms("2026-11-09T24:00:00Z"),
            Some(1_794_268_800_000)
        );
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("1969-12-31T23:59:59.999Z"), Some(-1));
    }

    #[test]
    fn recusa_o_que_nao_e_horario() {
        for invalido in [
            "",
            "ontem",
            "2026-13-01T00:00:00Z",
            "2026-11-32T00:00:00Z",
            "2026-11-09T23:59:60Z",
            "2026-11-09T24:00:01Z",
            "2026-11-09T10:00:00,5Z",
            "2026-11-09T10:00:00.Z",
            "2026-11-09T10:00:00+05",
            " 2026-11-09T10:00:00Z",
            "2026-11-09T10:00:00Z ",
            "2026-11-09T10:00:00",
            "2026-1-09T10:00:00Z",
            "2026-11-09T10:00:00Zx",
            "2026-11-09T1ç:00:00Z",
        ] {
            assert_eq!(parse_iso_ms(invalido), None, "{invalido:?}");
        }
    }

    #[test]
    fn escreve_e_le_de_volta() {
        for ms in [
            0,
            -1,
            1_794_235_464_748,
            951_782_400_000,
            4_102_444_799_999,
            -62_135_596_800_000,
        ] {
            assert_eq!(
                parse_iso_ms(&format_iso_ms(ms)),
                Some(ms),
                "{}",
                format_iso_ms(ms)
            );
        }
        assert_eq!(format_iso_ms(1_794_235_464_748), "2026-11-09T14:44:24.748Z");
    }
}

mod formato_json {
    use serde_json::{json, Value};

    use crate::model::{AgentStatus, AgentView, SessionStatus, SessionView, Snapshot};

    fn keys(value: &Value) -> Vec<&str> {
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        keys
    }

    fn snapshot() -> Snapshot {
        Snapshot {
            generated_at: 1_794_235_464_748,
            config_dirs: vec!["C:\\Users\\voce\\.claude".into()],
            retention_ms: 86_400_000,
            sessions: vec![SessionView {
                key: "C:\\Users\\voce\\.claude|s1".into(),
                session_id: "s1".into(),
                config_dir: "C:\\Users\\voce\\.claude".into(),
                account: "Trabalho".into(),
                account_command: Some("claude-trabalho".into()),
                pid: Some(111),
                kind: None,
                cwd: "D:\\app".into(),
                project: "app".into(),
                title: "Login quebrado".into(),
                last_prompt: None,
                activity: Some("Bash: Roda os testes".into()),
                activity_at: None,
                model: None,
                git_branch: None,
                permission_mode: None,
                status: SessionStatus::Waiting,
                waiting_for: Some("input needed".into()),
                status_since: None,
                started_at: Some(5),
                updated_at: 9,
                agents: vec![AgentView {
                    id: "a1".into(),
                    parent_id: None,
                    description: "Achar o bug".into(),
                    agent_type: "Explore".into(),
                    name: None,
                    model: None,
                    status: AgentStatus::Interrupted,
                    started_at: None,
                    updated_at: 3,
                    activity: None,
                    depth: 1,
                }],
            }],
        }
    }

    #[test]
    fn o_retrato_sai_no_formato_do_model_ts() {
        let snap = snapshot();
        let value = serde_json::to_value(&snap).unwrap();
        assert_eq!(
            keys(&value),
            ["configDirs", "generatedAt", "retentionMs", "sessions"]
        );
        let session = &value["sessions"][0];
        assert_eq!(
            keys(session),
            [
                "account",
                "accountCommand",
                "activity",
                "agents",
                "configDir",
                "cwd",
                "key",
                "pid",
                "project",
                "sessionId",
                "startedAt",
                "status",
                "title",
                "updatedAt",
                "waitingFor"
            ]
        );
        assert_eq!(session["status"], json!("waiting"));
        assert_eq!(session["pid"], json!(111));
        let agent = &session["agents"][0];
        assert_eq!(
            keys(agent),
            [
                "agentType",
                "depth",
                "description",
                "id",
                "parentId",
                "status",
                "updatedAt"
            ]
        );
        assert_eq!(agent["parentId"], Value::Null);
        assert_eq!(agent["status"], json!("interrupted"));

        // E volta igual.
        assert_eq!(serde_json::from_value::<Snapshot>(value).unwrap(), snap);
    }

    #[test]
    fn os_estados_saem_em_minusculas() {
        let session = [
            SessionStatus::Running,
            SessionStatus::Waiting,
            SessionStatus::Idle,
            SessionStatus::Ended,
        ];
        assert_eq!(
            serde_json::to_value(session).unwrap(),
            json!(["running", "waiting", "idle", "ended"])
        );
        let agent = [
            AgentStatus::Running,
            AgentStatus::Done,
            AgentStatus::Interrupted,
        ];
        assert_eq!(
            serde_json::to_value(agent).unwrap(),
            json!(["running", "done", "interrupted"])
        );
    }

    #[test]
    fn o_pai_aparece_quando_existe() {
        let mut snap = snapshot();
        snap.sessions[0].agents[0].parent_id = Some("a0".into());
        let value = serde_json::to_value(&snap).unwrap();
        assert_eq!(value["sessions"][0]["agents"][0]["parentId"], json!("a0"));
    }
}
