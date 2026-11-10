//! A janela principal e a bandeja. Fechar a janela a destrói de verdade: o WebView2 (uns 280 MB) sai da
//! memória, e o app continua na bandeja, de olho nas sessões e avisando. Mostrar a janela de novo a
//! recria a partir da configuração (tauri.conf.json, com "create": false). Quando alguma sessão espera
//! por você, o ícone da bandeja ganha um ponto magenta, a barra de tarefas mostra o mesmo ponto sobre o
//! ícone e o título da janela diz quantas.

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use vagents_sessoes::model::{SessionStatus, Snapshot};

use crate::avisos::Tipo;
use crate::preferencias::Preferencias;

pub const JANELA: &str = "principal";
const BANDEJA: &str = "bandeja";

/// O magenta da marca (#d6006c): o "esperando você" da tela.
const MAGENTA: [u8; 3] = [0xd6, 0x00, 0x6c];

/// Traz a janela; se ela foi fechada (destruída), cria de novo. Ela nasce escondida e aparece quando a
/// tela avisa que pintou (o comando janela_pronta).
pub fn mostrar(app: &AppHandle) {
    if let Some(janela) = app.get_webview_window(JANELA) {
        let _ = janela.unminimize();
        let _ = janela.show();
        let _ = janela.set_focus();
        return;
    }
    if let Err(erro) = criar(app) {
        eprintln!("[vagents] não deu para criar a janela: {erro}");
    }
}

/// A janela principal, com a configuração do tauri.conf.json.
pub fn criar(app: &AppHandle) -> tauri::Result<()> {
    let Some(config) = app.config().app.windows.iter().find(|w| w.label == JANELA).cloned() else {
        return Ok(());
    };
    tauri::WebviewWindowBuilder::from_config(app, &config)?
        // A janela nunca sai do app: um link externo abre no navegador (o comando abrir_link).
        .on_navigation(|url| matches!(url.host_str(), Some("localhost") | Some("tauri.localhost")) || url.scheme() == "tauri")
        .build()?;
    Ok(())
}

/// Abre um endereço https no navegador padrão (os links da tela, como o do React Flow).
#[tauri::command]
pub async fn abrir_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("só endereços https".into());
    }
    std::process::Command::new("explorer").arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Aberto pelo "iniciar com o Windows" (`--na-bandeja`), o app começa só na bandeja.
pub fn comecar_na_bandeja(args: &[String]) -> bool {
    args.iter().any(|a| a == "--na-bandeja")
}

/// Os itens marcáveis do menu da bandeja, para a tela poder marcá-los também.
pub struct ItensDoMenu {
    pub avisar: CheckMenuItem<Wry>,
    pub avisar_terminou: CheckMenuItem<Wry>,
    pub iniciar: CheckMenuItem<Wry>,
}

pub fn criar_bandeja(app: &AppHandle, prefs: &Preferencias, iniciar: bool, icone: Image<'static>) -> tauri::Result<ItensDoMenu> {
    let mostrar_item = MenuItem::with_id(app, "mostrar", "Mostrar o vAgents", true, None::<&str>)?;
    let avisar_item =
        CheckMenuItem::with_id(app, "avisar", "Avisar quando uma sessão esperar por mim", true, prefs.avisar, None::<&str>)?;
    let terminou_item =
        CheckMenuItem::with_id(app, "avisar-terminou", "Avisar quando uma sessão terminar", true, prefs.avisar_terminou, None::<&str>)?;
    let iniciar_item = CheckMenuItem::with_id(app, "iniciar", "Abrir com o Windows", true, iniciar, None::<&str>)?;
    let separador = PredefinedMenuItem::separator(app)?;
    let separador2 = PredefinedMenuItem::separator(app)?;
    let sair = MenuItem::with_id(app, "sair", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&mostrar_item, &separador, &avisar_item, &terminou_item, &iniciar_item, &separador2, &sair])?;

    TrayIconBuilder::with_id(BANDEJA)
        .icon(icone)
        .tooltip("vAgents")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id.as_ref() {
            "mostrar" => mostrar(app),
            "avisar" => crate::alternar_aviso(app, Tipo::Esperando),
            "avisar-terminou" => crate::alternar_aviso(app, Tipo::Terminou),
            "iniciar" => crate::alternar_inicio(app),
            "sair" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|bandeja, evento| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = evento {
                mostrar(bandeja.app_handle());
            }
        })
        .build(app)?;

    Ok(ItensDoMenu { avisar: avisar_item, avisar_terminou: terminou_item, iniciar: iniciar_item })
}

/// Os ícones prontos: o normal, o com o ponto e o selo da barra de tarefas.
pub struct Icones {
    pub normal: Image<'static>,
    esperando: Image<'static>,
    selo: Image<'static>,
}

impl Icones {
    pub fn new() -> Icones {
        let normal = Image::from_bytes(include_bytes!("../icons/32x32.png")).expect("o ícone 32x32 do app").to_owned();
        let esperando = com_ponto(&normal);
        Icones { normal, esperando, selo: ponto(16) }
    }
}

/// A bandeja, o selo da barra de tarefas e o título da janela, conforme o retrato.
pub fn atualizar(app: &AppHandle, retrato: &Snapshot, icones: &Icones) {
    let contar = |status: SessionStatus| retrato.sessions.iter().filter(|s| s.status == status).count();
    let (esperando, rodando) = (contar(SessionStatus::Waiting), contar(SessionStatus::Running));

    let mut partes = Vec::new();
    if esperando > 0 {
        partes.push(format!("{esperando} esperando você"));
    }
    if rodando > 0 {
        partes.push(format!("{rodando} rodando"));
    }
    let dica = if partes.is_empty() { "vAgents".to_string() } else { format!("vAgents · {}", partes.join(" · ")) };

    if let Some(bandeja) = app.tray_by_id(BANDEJA) {
        let _ = bandeja.set_tooltip(Some(&dica));
        let _ = bandeja.set_icon(Some(if esperando > 0 { icones.esperando.clone() } else { icones.normal.clone() }));
    }
    if let Some(janela) = app.get_webview_window(JANELA) {
        let _ = janela.set_overlay_icon(if esperando > 0 { Some(icones.selo.clone()) } else { None });
        let titulo = if esperando > 0 { format!("vAgents ({esperando} esperando você)") } else { "vAgents".into() };
        let _ = janela.set_title(&titulo);
    }
}

/// Um ponto magenta com borda branca, liso nas bordas (cobertura por distância).
fn ponto(tamanho: u32) -> Image<'static> {
    let mut rgba = vec![0u8; (tamanho * tamanho * 4) as usize];
    let centro = tamanho as f32 / 2.0;
    pintar_ponto(&mut rgba, tamanho, tamanho, centro, centro, centro - 1.0);
    Image::new_owned(rgba, tamanho, tamanho)
}

/// O ícone com o ponto no canto de baixo à direita.
fn com_ponto(base: &Image<'_>) -> Image<'static> {
    let (l, a) = (base.width(), base.height());
    let mut rgba = base.rgba().to_vec();
    let raio = l as f32 * 0.24;
    pintar_ponto(&mut rgba, l, a, l as f32 - raio - 0.5, a as f32 - raio - 0.5, raio);
    Image::new_owned(rgba, l, a)
}

fn pintar_ponto(rgba: &mut [u8], largura: u32, altura: u32, cx: f32, cy: f32, raio: f32) {
    let borda = (raio * 0.22).max(1.0);
    for y in 0..altura {
        for x in 0..largura {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let fora = (raio + 0.5 - d).clamp(0.0, 1.0); // o disco todo, com a borda
            if fora <= 0.0 {
                continue;
            }
            let miolo = (raio - borda + 0.5 - d).clamp(0.0, 1.0); // só o magenta
            let cor = [
                mistura(255, MAGENTA[0], miolo),
                mistura(255, MAGENTA[1], miolo),
                mistura(255, MAGENTA[2], miolo),
            ];
            let i = ((y * largura + x) * 4) as usize;
            let a_antes = rgba[i + 3] as f32 / 255.0;
            let a_final = fora + a_antes * (1.0 - fora);
            for c in 0..3 {
                let antes = rgba[i + c] as f32 * a_antes;
                let novo = (cor[c] as f32 * fora + antes * (1.0 - fora)) / a_final.max(f32::EPSILON);
                rgba[i + c] = novo.round().clamp(0.0, 255.0) as u8;
            }
            rgba[i + 3] = (a_final * 255.0).round() as u8;
        }
    }
}

fn mistura(de: u8, para: u8, t: f32) -> u8 {
    (de as f32 + (para as f32 - de as f32) * t).round() as u8
}
