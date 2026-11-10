//! A casca do vAgents: a janela, a bandeja e os avisos. Quem lê as sessões do Claude Code é a
//! biblioteca vagents-sessoes (src-tauri/sessoes); aqui uma linha de execução a consulta a cada
//! segundo e manda o retrato novo para a tela (o evento "retrato") quando algo muda.

mod aviso;
mod avisos;
mod janela;
mod preferencias;

use preferencias::Preferencias;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, Theme, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use vagents_sessoes::model::{Account, Snapshot};
use vagents_sessoes::{load_settings, Monitor, Settings};

/// O arquivo das contas (e, opcionais, das pastas e da retenção), na pasta de configuração do app.
const CONFIG: &str = "vagents.config.json";

struct Estado {
    /// None até o primeiro ciclo de leitura terminar (com o disco frio, ele pode levar segundos).
    retrato: Mutex<Option<Snapshot>>,
    preferencias: Mutex<Preferencias>,
    organizacao: Mutex<serde_json::Value>,
    pasta: PathBuf,
    home: PathBuf,
    menu: Mutex<Option<janela::ItensDoMenu>>,
    /// A sessão que o clique num aviso pediu para abrir, até a janela pegar (ela pode estar sendo criada).
    focar: Mutex<Option<String>>,
    /// As contas que valem agora (as pastas achadas, com o nome e o comando de cada uma).
    contas: Mutex<Vec<Account>>,
    /// As contas mudaram: a linha de fundo relê a configuração no próximo ciclo.
    recarregar: AtomicBool,
}

impl Estado {
    fn arquivo(&self, nome: &str) -> PathBuf {
        self.pasta.join(nome)
    }
}

fn carregar_ajustes(pasta: &Path, home: &Path) -> Settings {
    load_settings(&pasta.join(CONFIG), std::env::var("CLAUDE_CONFIG_DIR").ok().as_deref(), home)
}

/// Uma conta como a tela manda de volta: a pasta, o nome e o comando (vazios valem o padrão).
#[derive(Deserialize, Debug)]
struct ContaEditada {
    dir: String,
    name: String,
    command: Option<String>,
}

/// As contas do Claude Code que o app achou, com o nome e o comando de cada uma.
#[tauri::command]
fn ler_contas(estado: State<Estado>) -> Vec<Account> {
    estado.contas.lock().unwrap().clone()
}

/// Grava o nome e o comando de cada conta no vagents.config.json (mantendo o resto do arquivo) e relê.
#[tauri::command]
fn salvar_contas(estado: State<Estado>, contas: Vec<ContaEditada>) -> Result<(), String> {
    let arquivo = estado.arquivo(CONFIG);
    let mut config = preferencias::ler::<Option<serde_json::Value>>(&arquivo)
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    config["contas"] = contas_no_arquivo(&contas).into();
    preferencias::gravar(&arquivo, &config)?;
    estado.recarregar.store(true, Ordering::SeqCst);
    Ok(())
}

/// As contas como o vagents.config.json guarda: só o que foi preenchido (o resto vale o padrão).
fn contas_no_arquivo(contas: &[ContaEditada]) -> Vec<serde_json::Value> {
    contas
        .iter()
        .filter_map(|c| {
            let nome = c.name.trim();
            let comando = c.command.as_deref().map(str::trim).unwrap_or_default();
            if nome.is_empty() && comando.is_empty() {
                return None; // nada a guardar: vale o padrão (o nome da pasta e o "claude")
            }
            let mut conta = serde_json::json!({ "pasta": c.dir });
            if !nome.is_empty() {
                conta["nome"] = nome.into();
            }
            if !comando.is_empty() {
                conta["comando"] = comando.into();
            }
            Some(conta)
        })
        .collect()
}

#[cfg(test)]
mod testes {
    use super::*;

    fn conta(dir: &str, nome: &str, comando: Option<&str>) -> ContaEditada {
        ContaEditada { dir: dir.into(), name: nome.into(), command: comando.map(String::from) }
    }

    #[test]
    fn guarda_so_o_que_foi_preenchido() {
        let lista = contas_no_arquivo(&[
            conta("C:/u/.claude", "  Pessoal ", Some(" ")),
            conta("C:/u/.claude-trabalho", "", Some("claude-trabalho")),
            conta("C:/u/.claude-teste", " ", None),
        ]);
        assert_eq!(
            lista,
            vec![
                serde_json::json!({ "pasta": "C:/u/.claude", "nome": "Pessoal" }),
                serde_json::json!({ "pasta": "C:/u/.claude-trabalho", "comando": "claude-trabalho" }),
            ]
        );
    }
}

/// As preferências como a tela vê: as do arquivo mais o "abrir com o Windows", que mora no registro.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PreferenciasDaTela {
    #[serde(flatten)]
    preferencias: Preferencias,
    iniciar_com_windows: bool,
}

#[tauri::command]
fn retrato(estado: State<Estado>) -> Option<Snapshot> {
    estado.retrato.lock().unwrap().clone()
}

#[tauri::command]
fn ler_organizacao(estado: State<Estado>) -> serde_json::Value {
    estado.organizacao.lock().unwrap().clone()
}

#[tauri::command]
fn gravar_organizacao(estado: State<Estado>, organizacao: serde_json::Value) -> Result<(), String> {
    preferencias::gravar(&estado.arquivo("organizacao.json"), &organizacao)?;
    *estado.organizacao.lock().unwrap() = organizacao;
    Ok(())
}

#[tauri::command]
fn ler_preferencias(app: AppHandle, estado: State<Estado>) -> PreferenciasDaTela {
    PreferenciasDaTela {
        preferencias: estado.preferencias.lock().unwrap().clone(),
        iniciar_com_windows: app.autolaunch().is_enabled().unwrap_or(false),
    }
}

#[tauri::command]
fn definir_preferencias(app: AppHandle, estado: State<Estado>, preferencias: PreferenciasDaTela) -> Result<PreferenciasDaTela, String> {
    let novas = preferencias.preferencias;
    preferencias::gravar(&estado.arquivo("preferencias.json"), &novas)?;
    let tema = novas.tema.clone();
    *estado.preferencias.lock().unwrap() = novas;
    aplicar_tema(&app, &tema);
    definir_inicio(&app, preferencias.iniciar_com_windows)?;
    marcar_menu(&app);
    Ok(ler_preferencias(app.clone(), estado))
}

/// A tela já pintou: hora de mostrar a janela (escondida até aqui para não piscar em branco) e de pôr nela
/// o tema e o estado da bandeja.
#[tauri::command]
fn janela_pronta(app: AppHandle, estado: State<Estado>) {
    aplicar_tema(&app, &estado.preferencias.lock().unwrap().tema);
    if let Some(retrato) = estado.retrato.lock().unwrap().as_ref() {
        janela::atualizar(&app, retrato, &janela::Icones::new());
    }
    janela::mostrar(&app);
}

// Os comandos que criam ou fecham janelas são async: num comando síncrono, criar uma janela trava o app
// no Windows (o IPC segura a linha principal, que é quem cria a janela).

/// O som de um aviso, como as preferências pedem (sem som, `None`).
fn toque_do_aviso(estado: &Estado, p: &Preferencias, tipo: avisos::Tipo) -> Option<aviso::Toque> {
    p.toca(tipo).then(|| aviso::Toque {
        nome: p.toque(tipo).to_string(),
        arquivo: aviso::arquivo_do_toque(&estado.pasta, tipo),
    })
}

/// A prévia de um toque, ao escolher nos Ajustes (o "proprio" é o arquivo enviado para esse aviso).
#[tauri::command]
fn ouvir_toque(estado: State<Estado>, tipo: String, toque: String) {
    let arquivo = aviso::arquivo_do_toque(&estado.pasta, avisos::Tipo::de(&tipo));
    aviso::tocar(&aviso::Toque { nome: toque, arquivo });
}

/// O arquivo de som que você escolheu para um aviso, já convertido pela tela num WAV curto: fica em
/// toques/<aviso>.wav, e o aviso passa a tocá-lo.
#[tauri::command]
fn enviar_toque(
    app: AppHandle,
    estado: State<Estado>,
    tipo: String,
    nome: String,
    wav: Vec<u8>,
) -> Result<PreferenciasDaTela, String> {
    aviso::validar_wav(&wav)?;
    let tipo = avisos::Tipo::de(&tipo);
    // O arquivo antigo pode estar tocando.
    aviso::parar_som();
    preferencias::gravar_bytes(&aviso::arquivo_do_toque(&estado.pasta, tipo), &wav)?;
    let nome: String = nome.trim().chars().take(80).collect();
    let novas = {
        let mut p = estado.preferencias.lock().unwrap();
        p.usar_toque_proprio(tipo, if nome.is_empty() { "Meu som".into() } else { nome });
        p.clone()
    };
    preferencias::gravar(&estado.arquivo("preferencias.json"), &novas)?;
    marcar_menu(&app);
    Ok(ler_preferencias(app.clone(), estado))
}

/// O "Testar" de cada aviso nos Ajustes ("esperando" ou "terminou"): o popup com a primeira sessão aberta
/// (o clique abre ela) e o som, se o desse aviso estiver ligado.
#[tauri::command]
async fn testar_aviso(app: AppHandle, tipo: String) -> Result<(), String> {
    let tipo = avisos::Tipo::de(&tipo);
    let motivo = match tipo {
        avisos::Tipo::Esperando => "Esperando uma resposta sua (teste)",
        avisos::Tipo::Terminou => "Terminou em 4 min (teste)",
    };
    let estado = app.state::<Estado>();
    let exemplo = estado.retrato.lock().unwrap().as_ref().and_then(|r| {
        let s = r.sessions.iter().find(|s| s.status != vagents_sessoes::model::SessionStatus::Ended)?;
        let organizacao = estado.organizacao.lock().unwrap();
        Some(avisos::Aviso {
            tipo,
            titulo: preferencias::nome_da_sessao(&organizacao, &s.key).unwrap_or_else(|| s.title.clone()),
            motivo: motivo.into(),
            projeto: s.project.clone(),
            chave: s.key.clone(),
        })
    });
    let aviso = exemplo.unwrap_or_else(|| avisos::Aviso {
        tipo,
        titulo: "Uma sessão do Claude Code".into(),
        motivo: motivo.into(),
        projeto: "exemplo".into(),
        chave: String::new(),
    });
    let p = estado.preferencias.lock().unwrap().clone();
    aviso::mostrar(&app, &aviso, toque_do_aviso(&estado, &p, tipo).as_ref(), true);
    Ok(())
}

/// O X do popup de aviso, ou o tempo dele acabou.
#[tauri::command]
async fn fechar_aviso(janela: WebviewWindow) -> Result<(), String> {
    janela.close().map_err(|e| e.to_string())
}

/// O clique no popup: fecha o aviso e abre a janela principal na sessão dele.
#[tauri::command]
async fn abrir_sessao(app: AppHandle, janela: WebviewWindow, chave: String) -> Result<(), String> {
    *app.state::<Estado>().focar.lock().unwrap() = Some(chave.clone());
    let _ = janela.close();
    janela::mostrar(&app);
    // Com a janela já aberta, ela recebe o evento; recém-criada, ela pede a sessão_pendente ao abrir.
    let _ = app.emit_to(janela::JANELA, "focar-sessao", chave);
    Ok(())
}

/// A sessão que um aviso pediu para abrir (e esquece o pedido).
#[tauri::command]
fn sessao_pendente(estado: State<Estado>) -> Option<String> {
    estado.focar.lock().unwrap().take()
}

fn aplicar_tema(app: &AppHandle, tema: &str) {
    if let Some(j) = app.get_webview_window(janela::JANELA) {
        let _ = j.set_theme(match tema {
            "claro" => Some(Theme::Light),
            "escuro" => Some(Theme::Dark),
            _ => None,
        });
    }
}

fn definir_inicio(app: &AppHandle, ligar: bool) -> Result<(), String> {
    let auto = app.autolaunch();
    if auto.is_enabled().unwrap_or(false) == ligar {
        return Ok(());
    }
    if ligar { auto.enable() } else { auto.disable() }.map_err(|e| e.to_string())
}

/// Os itens marcáveis da bandeja acompanham o que vale agora.
fn marcar_menu(app: &AppHandle) {
    let estado = app.state::<Estado>();
    let p = estado.preferencias.lock().unwrap().clone();
    let iniciar = app.autolaunch().is_enabled().unwrap_or(false);
    if let Some(itens) = estado.menu.lock().unwrap().as_ref() {
        let _ = itens.avisar.set_checked(p.avisar);
        let _ = itens.avisar_terminou.set_checked(p.avisar_terminou);
        let _ = itens.iniciar.set_checked(iniciar);
    }
    let _ = app.emit("preferencias", ler_preferencias(app.clone(), estado));
}

/// Pelo menu da bandeja: liga ou desliga o aviso de "esperando" ou o de "terminou".
pub(crate) fn alternar_aviso(app: &AppHandle, tipo: avisos::Tipo) {
    let estado = app.state::<Estado>();
    let novas = {
        let mut p = estado.preferencias.lock().unwrap();
        match tipo {
            avisos::Tipo::Esperando => p.avisar = !p.avisar,
            avisos::Tipo::Terminou => p.avisar_terminou = !p.avisar_terminou,
        }
        p.clone()
    };
    let _ = preferencias::gravar(&estado.arquivo("preferencias.json"), &novas);
    marcar_menu(app);
}

/// Pelo menu da bandeja.
pub(crate) fn alternar_inicio(app: &AppHandle) {
    let ligado = app.autolaunch().is_enabled().unwrap_or(false);
    let _ = definir_inicio(app, !ligado);
    marcar_menu(app);
}

fn agora() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// A linha de execução que acompanha as sessões: a cada segundo, um tick; se mudou, o retrato vai para
/// a tela, a bandeja se atualiza e as sessões que passaram a esperar por você ou que terminaram viram avisos.
fn vigiar(app: AppHandle, mut monitor: Monitor, icones: janela::Icones) {
    let mut avisos = avisos::Avisos::default();
    let mut publicado = false;
    loop {
        // As contas mudaram nos Ajustes: relê a configuração e recomeça a leitura com os nomes novos.
        {
            let estado = app.state::<Estado>();
            if estado.recarregar.swap(false, Ordering::SeqCst) {
                let ajustes = carregar_ajustes(&estado.pasta, &estado.home);
                *estado.contas.lock().unwrap() = ajustes.accounts.clone();
                monitor = Monitor::new(ajustes);
                publicado = false;
            }
        }
        // O primeiro retrato sai mesmo sem mudança (sem sessão nenhuma, o tick não muda nada).
        let novo = match monitor.tick() {
            Some(retrato) => Some(retrato),
            None if !publicado => Some(monitor.snapshot().clone()),
            None => None,
        };
        if let Some(retrato) = novo {
            publicado = true;
            let estado = app.state::<Estado>();
            *estado.retrato.lock().unwrap() = Some(retrato.clone());
            let _ = app.emit("retrato", &retrato);
            janela::atualizar(&app, &retrato, &icones);
            let p = estado.preferencias.lock().unwrap().clone();
            let organizacao = estado.organizacao.lock().unwrap().clone();
            let nome = |s: &vagents_sessoes::model::SessionView| {
                preferencias::nome_da_sessao(&organizacao, &s.key).unwrap_or_else(|| s.title.clone())
            };
            for novo in avisos.novos(&retrato, agora(), nome) {
                if p.avisa(novo.tipo) {
                    aviso::mostrar(&app, &novo, toque_do_aviso(&estado, &p, novo.tipo).as_ref(), false);
                }
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Abrir de novo só traz a janela que já existe.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| janela::mostrar(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--na-bandeja"])))
        .manage(aviso::Vagas::default())
        .setup(|app| {
            let pasta = app.path().app_config_dir()?;
            let home = app.path().home_dir()?;
            let prefs: Preferencias = preferencias::ler(&pasta.join("preferencias.json"));
            let organizacao: serde_json::Value = preferencias::ler::<Option<serde_json::Value>>(&pasta.join("organizacao.json"))
                .unwrap_or_else(|| serde_json::json!({}));

            let ajustes = carregar_ajustes(&pasta, &home);
            let contas = ajustes.accounts.clone();
            let monitor = Monitor::new(ajustes);

            app.manage(Estado {
                retrato: Mutex::new(None),
                preferencias: Mutex::new(prefs.clone()),
                organizacao: Mutex::new(organizacao),
                pasta,
                home,
                menu: Mutex::new(None),
                focar: Mutex::new(None),
                contas: Mutex::new(contas),
                recarregar: AtomicBool::new(false),
            });

            let icones = janela::Icones::new();
            let iniciar = app.autolaunch().is_enabled().unwrap_or(false);
            let itens = janela::criar_bandeja(app.handle(), &prefs, iniciar, icones.normal.clone())?;
            *app.state::<Estado>().menu.lock().unwrap() = Some(itens);

            // Aberto pelo "iniciar com o Windows" (--na-bandeja), o app nem cria a janela: fica só na
            // bandeja, sem o WebView na memória, até você chamar.
            let args: Vec<String> = std::env::args().collect();
            if !janela::comecar_na_bandeja(&args) {
                janela::criar(app.handle())?;
            }

            let handle = app.handle().clone();
            std::thread::Builder::new().name("vigia".into()).spawn(move || vigiar(handle, monitor, icones))?;
            Ok(())
        })
        .on_window_event(|janela, evento| {
            // Um popup de aviso fechou: a vaga dele no canto fica livre.
            if let WindowEvent::Destroyed = evento {
                if janela.label().starts_with("aviso-") {
                    janela.app_handle().state::<aviso::Vagas>().liberar(janela.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            retrato,
            ler_organizacao,
            gravar_organizacao,
            ler_preferencias,
            definir_preferencias,
            janela_pronta,
            janela::abrir_link,
            ler_contas,
            salvar_contas,
            testar_aviso,
            ouvir_toque,
            enviar_toque,
            fechar_aviso,
            abrir_sessao,
            sessao_pendente
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o vAgents")
        .run(|_app, evento| {
            // Fechar a janela não encerra o app (ele segue na bandeja); só o "Sair" do menu encerra.
            if let RunEvent::ExitRequested { api, code: None, .. } = evento {
                api.prevent_exit();
            }
        });
}
