//! O aviso de "esperando você": um popup pequeno no canto de baixo à direita (uma janela sem moldura,
//! sempre por cima, fora da barra de tarefas, que não rouba o foco) e um toque curto. Com o Windows em
//! apresentação, num jogo ou vídeo em tela cheia, ou com a tela bloqueada, o aviso não aparece nem toca:
//! o ponto magenta na bandeja continua lá.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::avisos::Aviso;

/// O tamanho da janela do popup (o cartão e, em volta, a folga da sombra).
const LARGURA: f64 = 392.0;
const ALTURA: f64 = 116.0;
/// A distância da borda da área útil (acima da barra de tarefas).
const MARGEM: f64 = 8.0;
/// Quantos popups cabem empilhados; o próximo toma o lugar do mais antigo.
const VAGAS: usize = 3;

/// As vagas do canto, de baixo para cima, com o rótulo da janela que está em cada uma.
#[derive(Default)]
pub struct Vagas(Mutex<[Option<String>; VAGAS]>);

impl Vagas {
    /// O popup fechou: a vaga dele fica livre.
    pub fn liberar(&self, rotulo: &str) {
        for vaga in self.0.lock().unwrap().iter_mut() {
            if vaga.as_deref() == Some(rotulo) {
                *vaga = None;
            }
        }
    }
}

/// Mostra o popup e toca o som, se o Windows não estiver pedindo silêncio (o teste dos Ajustes, que você
/// mesmo pediu, aparece sempre).
pub fn mostrar(app: &AppHandle, aviso: &Aviso, com_som: bool, forcar: bool) {
    if !forcar && !windows_aceita_avisos() {
        return;
    }
    if let Err(erro) = abrir_popup(app, aviso) {
        eprintln!("[vagents] não deu para mostrar o aviso: {erro}");
    }
    if com_som {
        tocar();
    }
}

fn abrir_popup(app: &AppHandle, aviso: &Aviso) -> tauri::Result<()> {
    static CONTADOR: AtomicU32 = AtomicU32::new(0);
    let Some(monitor) = app.primary_monitor()? else {
        return Ok(());
    };
    let escala = monitor.scale_factor();
    let area = monitor.work_area();
    let direita = (area.position.x as f64 + area.size.width as f64) / escala;
    let baixo = (area.position.y as f64 + area.size.height as f64) / escala;

    let vagas = app.state::<Vagas>();
    let mut lista = vagas.0.lock().unwrap();
    let indice = match lista.iter().position(Option::is_none) {
        Some(livre) => livre,
        None => {
            // Sem vaga: o mais antigo (o de baixo) sai e o novo entra no lugar dele.
            if let Some(antigo) = lista[0].take() {
                if let Some(janela) = app.get_webview_window(&antigo) {
                    let _ = janela.close();
                }
            }
            0
        }
    };

    let rotulo = format!("aviso-{}", CONTADOR.fetch_add(1, Ordering::Relaxed));
    let dados = serde_json::json!({
        "titulo": aviso.titulo,
        "motivo": aviso.motivo,
        "projeto": aviso.projeto,
        "chave": aviso.chave,
    });
    WebviewWindowBuilder::new(app, &rotulo, WebviewUrl::App("index.html".into()))
        .title("vAgents · aviso")
        .inner_size(LARGURA, ALTURA)
        .position(direita - LARGURA - MARGEM, baixo - MARGEM - (indice as f64 + 1.0) * ALTURA)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(true)
        .initialization_script(format!("window.__AVISO__ = {dados};"))
        .build()?;
    lista[indice] = Some(rotulo);
    Ok(())
}

/// O Windows aceita avisos agora? Não em apresentação, em tela cheia, com a tela bloqueada nem
/// nas horas de silêncio. Se a consulta falhar, avisa.
#[cfg(windows)]
fn windows_aceita_avisos() -> bool {
    use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_ACCEPTS_NOTIFICATIONS};
    let mut estado = 0;
    let resultado = unsafe { SHQueryUserNotificationState(&mut estado) };
    resultado != 0 || estado == QUNS_ACCEPTS_NOTIFICATIONS
}

#[cfg(not(windows))]
fn windows_aceita_avisos() -> bool {
    true
}

/// O toque: dois tons curtos, subindo, sintetizados uma vez e tocados da memória (sem arquivo).
fn tocar() {
    static SOM: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = SOM.get_or_init(gerar_toque);
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
        PlaySoundW(wav.as_ptr().cast(), std::ptr::null_mut(), SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
    }
    #[cfg(not(windows))]
    let _ = wav;
}

/// Um WAV (PCM de 16 bits, mono, 44,1 kHz) com dois tons de sino suaves: lá e mi, 110 ms um do outro.
pub fn gerar_toque() -> Vec<u8> {
    const TAXA: u32 = 44_100;
    const DURACAO: f64 = 0.6;
    let n = (TAXA as f64 * DURACAO) as usize;
    let mut amostras = vec![0f64; n];
    for (inicio, frequencia) in [(0.0, 880.0), (0.11, 1318.51)] {
        for (i, amostra) in amostras.iter_mut().enumerate() {
            let t = i as f64 / TAXA as f64 - inicio;
            if t < 0.0 {
                continue;
            }
            // Ataque de 5 ms (sem estalo) e queda exponencial; um pouco do segundo harmônico dá o timbre de sino.
            let envelope = (t / 0.005).min(1.0) * (-t * 8.0).exp();
            let fase = std::f64::consts::TAU * frequencia * t;
            *amostra += envelope * (fase.sin() + 0.16 * (2.0 * fase).sin()) * 0.2;
        }
    }
    let dados: Vec<u8> = amostras
        .iter()
        .flat_map(|a| ((a.clamp(-1.0, 1.0) * i16::MAX as f64) as i16).to_le_bytes())
        .collect();

    let mut wav = Vec::with_capacity(44 + dados.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + dados.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // o tamanho do bloco fmt
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&TAXA.to_le_bytes());
    wav.extend_from_slice(&(TAXA * 2).to_le_bytes()); // bytes por segundo
    wav.extend_from_slice(&2u16.to_le_bytes()); // bytes por amostra
    wav.extend_from_slice(&16u16.to_le_bytes()); // bits por amostra
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(dados.len() as u32).to_le_bytes());
    wav.extend_from_slice(&dados);
    wav
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn o_toque_e_um_wav_valido_e_baixinho() {
        let wav = gerar_toque();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        let tamanho = u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize;
        assert_eq!(wav.len(), 44 + tamanho);
        let pico = wav[44..]
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs())
            .max()
            .unwrap();
        // Alto o bastante para ouvir, longe de saturar.
        assert!(pico > 3_000 && pico < 16_000, "pico {pico}");
    }

    #[test]
    fn a_vaga_de_um_popup_fechado_fica_livre() {
        let vagas = Vagas::default();
        vagas.0.lock().unwrap()[1] = Some("aviso-7".into());
        vagas.liberar("aviso-7");
        assert!(vagas.0.lock().unwrap().iter().all(Option::is_none));
    }
}
