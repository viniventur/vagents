//! O aviso de "esperando você" ou de "terminou": um popup pequeno no canto de baixo à direita (uma janela
//! sem moldura, sempre por cima, fora da barra de tarefas, que não rouba o foco) e um toque curto. Com o
//! Windows em apresentação, num jogo ou vídeo em tela cheia, ou com a tela bloqueada, o aviso não aparece
//! nem toca: o ponto magenta na bandeja continua lá.
//!
//! Os toques: quatro sintetizados na hora (sem arquivo) ou o arquivo que você enviou para o aviso, que a
//! tela já converte num WAV curto e fica em toques/<aviso>.wav, na pasta de configuração.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::avisos::{Aviso, Tipo};

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
    /// Guarda a vaga do popup novo: a primeira livre ou, sem nenhuma, a do mais antigo (o de número menor),
    /// que sai. Devolve a vaga e o rótulo do que saiu, para fechar.
    ///
    /// Só a escolha acontece com a trava presa: fechar e criar as janelas vem depois, sem ela. Fechar um
    /// popup dispara, na linha principal, o liberar (que pega a trava), e criar uma janela espera a linha
    /// principal; com a trava presa nas duas coisas, uma esperava a outra e o app travava inteiro.
    pub fn reservar(&self, rotulo: &str) -> (usize, Option<String>) {
        let mut lista = self.0.lock().unwrap();
        let (indice, saiu) = match lista.iter().position(Option::is_none) {
            Some(livre) => (livre, None),
            None => {
                let numero = |vaga: &Option<String>| vaga.as_deref().and_then(numero_do_popup).unwrap_or(u32::MAX);
                let antigo = (0..VAGAS).min_by_key(|&i| numero(&lista[i])).unwrap_or(0);
                (antigo, lista[antigo].take())
            }
        };
        lista[indice] = Some(rotulo.to_string());
        (indice, saiu)
    }

    /// O popup ainda tem uma vaga?
    pub fn ocupa(&self, rotulo: &str) -> bool {
        self.0.lock().unwrap().iter().any(|vaga| vaga.as_deref() == Some(rotulo))
    }

    /// O popup fechou: a vaga dele fica livre.
    pub fn liberar(&self, rotulo: &str) {
        for vaga in self.0.lock().unwrap().iter_mut() {
            if vaga.as_deref() == Some(rotulo) {
                *vaga = None;
            }
        }
    }
}

/// "aviso-12" → 12: a ordem em que os popups abriram.
fn numero_do_popup(rotulo: &str) -> Option<u32> {
    rotulo.strip_prefix("aviso-")?.parse().ok()
}

/// Mostra o popup e toca o som (sem som, `None`), se o Windows não estiver pedindo silêncio (o teste dos
/// Ajustes, que você mesmo pediu, aparece sempre).
pub fn mostrar(app: &AppHandle, aviso: &Aviso, toque: Option<&Toque>, forcar: bool) {
    if !forcar && !windows_aceita_avisos() {
        return;
    }
    if let Err(erro) = abrir_popup(app, aviso) {
        eprintln!("[vagents] não deu para mostrar o aviso: {erro}");
    }
    if let Some(toque) = toque {
        tocar(toque);
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

    let rotulo = format!("aviso-{}", CONTADOR.fetch_add(1, Ordering::Relaxed));
    // A trava das vagas já foi solta aqui (veja Vagas::reservar).
    let (indice, saiu) = app.state::<Vagas>().reservar(&rotulo);
    if let Some(janela) = saiu.and_then(|antigo| app.get_webview_window(&antigo)) {
        let _ = janela.close();
    }

    let dados = serde_json::json!({
        "tipo": aviso.tipo.nome(),
        "titulo": aviso.titulo,
        "motivo": aviso.motivo,
        "projeto": aviso.projeto,
        "chave": aviso.chave,
    });
    let criado = WebviewWindowBuilder::new(app, &rotulo, WebviewUrl::App("index.html".into()))
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
        .build();
    match criado {
        Ok(janela) => {
            // Com vários avisos de uma vez, outro pode ter tomado a vaga deste enquanto ele nascia (e aí não
            // havia janela para fechar): ele sai na hora, como sairia se já estivesse aberto.
            if !app.state::<Vagas>().ocupa(&rotulo) {
                let _ = janela.close();
            }
            Ok(())
        }
        Err(erro) => {
            app.state::<Vagas>().liberar(&rotulo);
            Err(erro)
        }
    }
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

/// Os toques sintetizados, pelo nome que as preferências guardam (o primeiro vale para um nome que não se
/// conhece). O "proprio" é o arquivo que você enviou.
pub const TOQUES: [&str; 6] = ["madeira", "madeira-dupla", "sino", "descendo", "gota", "acorde"];
pub const PROPRIO: &str = "proprio";

/// O maior WAV que a tela manda (5 s, mono, 16 bits, 44,1 kHz são uns 441 kB).
const MAIOR_WAV: usize = 2_000_000;

/// O som de um aviso: o nome do toque e, para o "proprio", o arquivo dele.
pub struct Toque {
    pub nome: String,
    pub arquivo: PathBuf,
}

/// O arquivo do toque que você enviou para esse aviso.
pub fn arquivo_do_toque(pasta: &Path, tipo: Tipo) -> PathBuf {
    pasta.join("toques").join(format!("{}.wav", tipo.nome()))
}

/// O seu arquivo, se o toque for o "proprio" e ele existir; senão um dos sintetizados.
pub fn tocar(toque: &Toque) {
    if toque.nome == PROPRIO && toque.arquivo.is_file() {
        tocar_arquivo(&toque.arquivo);
    } else {
        tocar_da_memoria(sintetizado(&toque.nome));
    }
}

/// O WAV que a tela mandou é mesmo um WAV, e curto?
pub fn validar_wav(wav: &[u8]) -> Result<(), String> {
    if wav.len() <= 44 || wav.len() > MAIOR_WAV || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return Err("o som não é um WAV curto".into());
    }
    Ok(())
}

fn sintetizado(toque: &str) -> &'static [u8] {
    static SONS: OnceLock<Vec<Vec<u8>>> = OnceLock::new();
    let sons = SONS.get_or_init(|| TOQUES.iter().map(|t| gerar_toque(t)).collect());
    &sons[TOQUES.iter().position(|t| *t == toque).unwrap_or(0)]
}

// O SND_MEMORY toca direto da memória, sem copiar: o som precisa viver até acabar (os sintetizados vivem
// para sempre). O SND_FILENAME lê o arquivo.
#[cfg(windows)]
fn tocar_da_memoria(wav: &'static [u8]) {
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
    unsafe {
        PlaySoundW(wav.as_ptr().cast(), std::ptr::null_mut(), SND_MEMORY | SND_ASYNC | SND_NODEFAULT);
    }
}

#[cfg(windows)]
fn tocar_arquivo(arquivo: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_FILENAME, SND_NODEFAULT};
    let caminho: Vec<u16> = arquivo.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        PlaySoundW(caminho.as_ptr(), std::ptr::null_mut(), SND_FILENAME | SND_ASYNC | SND_NODEFAULT);
    }
}

/// Para o que estiver tocando (antes de trocar o arquivo de um toque).
#[cfg(windows)]
pub fn parar_som() {
    use windows_sys::Win32::Media::Audio::PlaySoundW;
    unsafe {
        PlaySoundW(std::ptr::null(), std::ptr::null_mut(), 0);
    }
}

#[cfg(not(windows))]
fn tocar_da_memoria(_wav: &'static [u8]) {}

#[cfg(not(windows))]
fn tocar_arquivo(_arquivo: &Path) {}

#[cfg(not(windows))]
pub fn parar_som() {}

const TAXA: u32 = 44_100;
/// O pico dos toques (o mesmo que a tela usa para o seu arquivo): alto o bastante para ouvir, longe de
/// saturar.
const PICO: f64 = 0.3;
/// O da madeira, mais alto: um som de 150 ms, no mesmo pico de um sino, soaria mais baixo que ele.
const PICO_CURTO: f64 = 0.45;

/// Um toque sintetizado, em WAV (PCM de 16 bits, mono, 44,1 kHz).
pub fn gerar_toque(toque: &str) -> Vec<u8> {
    let (amostras, pico) = match toque {
        // Toc-toc, como quem bate à porta: a segunda batida um pouco mais fraca.
        "madeira-dupla" => (madeira(&[(0.0, 820.0, 1.0), (0.13, 820.0, 0.8)], 0.32), PICO_CURTO),
        // O sino: lá e mi, subindo.
        "sino" => (sinos(&[(0.0, 880.0), (0.11, 1318.51)], 0.6), PICO),
        // Mi e lá, descendo: o contrário do sino.
        "descendo" => (sinos(&[(0.0, 1318.51), (0.11, 880.0)], 0.6), PICO),
        // Duas gotas, a segunda mais aguda e mais baixa.
        "gota" => (gotas(&[(0.0, 1.0, 1.0), (0.13, 1.25, 0.55)], 0.45), PICO),
        // Dó, mi e sol, um atrás do outro.
        "acorde" => (sinos(&[(0.0, 1046.5), (0.08, 1318.51), (0.16, 1567.98)], 0.8), PICO),
        // Uma batida só, num bloco de madeira.
        _ => (madeira(&[(0.0, 820.0, 1.0)], 0.2), PICO_CURTO),
    };
    wav(&normalizar(amostras, pico))
}

/// Batidas num bloco de madeira oco (o começo, o tom e a força de cada uma): três modos de vibração de
/// uma barra de madeira, que somem em dezenas de milissegundos (os agudos antes), e o estalo da baqueta,
/// um ruído que dura 1 ou 2 ms.
fn madeira(batidas: &[(f64, f64, f64)], duracao: f64) -> Vec<f64> {
    // De cada modo: a razão para o tom, o volume e a constante da queda (s).
    const MODOS: [(f64, f64, f64); 3] = [(1.0, 1.0, 0.035), (2.76, 0.4, 0.014), (5.40, 0.15, 0.006)];
    let mut amostras = vec![0f64; (TAXA as f64 * duracao) as usize];
    // Um ruído que se repete igual (xorshift): o toque soa sempre do mesmo jeito.
    let mut semente: u32 = 0x9E37_79B9;
    for &(inicio, tom, forca) in batidas {
        for (i, amostra) in amostras.iter_mut().enumerate() {
            let t = i as f64 / TAXA as f64 - inicio;
            if t < 0.0 {
                continue;
            }
            let corpo: f64 = MODOS
                .iter()
                .map(|&(razao, volume, queda)| volume * (-t / queda).exp() * (std::f64::consts::TAU * tom * razao * t).sin())
                .sum();
            semente ^= semente << 13;
            semente ^= semente >> 17;
            semente ^= semente << 5;
            let ruido = semente as f64 / u32::MAX as f64 * 2.0 - 1.0;
            let estalo = 0.35 * ruido * (-t / 0.0012).exp();
            // Meio milissegundo de subida, para o estalo não virar um clique seco.
            *amostra += forca * (t / 0.0005).min(1.0) * (corpo + estalo);
        }
    }
    amostras
}

/// Tons de sino (cada um com o começo e a frequência): ataque de 5 ms, sem estalo, e queda exponencial;
/// um pouco do segundo harmônico dá o timbre.
fn sinos(notas: &[(f64, f64)], duracao: f64) -> Vec<f64> {
    let mut amostras = vec![0f64; (TAXA as f64 * duracao) as usize];
    for &(inicio, frequencia) in notas {
        for (i, amostra) in amostras.iter_mut().enumerate() {
            let t = i as f64 / TAXA as f64 - inicio;
            if t < 0.0 {
                continue;
            }
            let envelope = (t / 0.005).min(1.0) * (-t * 8.0).exp();
            let fase = std::f64::consts::TAU * frequencia * t;
            *amostra += envelope * (fase.sin() + 0.16 * (2.0 * fase).sin());
        }
    }
    amostras
}

/// Gotas (o começo, quanto mais aguda e o volume): o tom sobe rápido, como o de uma gota caindo na água,
/// e some em menos de meio segundo.
fn gotas(gotas: &[(f64, f64, f64)], duracao: f64) -> Vec<f64> {
    let mut amostras = vec![0f64; (TAXA as f64 * duracao) as usize];
    for &(inicio, agudo, volume) in gotas {
        let mut fase = 0.0;
        for (i, amostra) in amostras.iter_mut().enumerate() {
            let t = i as f64 / TAXA as f64 - inicio;
            if t < 0.0 {
                continue;
            }
            let frequencia = agudo * (1500.0 - 1000.0 * (-t * 35.0).exp());
            fase += std::f64::consts::TAU * frequencia / TAXA as f64;
            let envelope = (t / 0.004).min(1.0) * (-t * 14.0).exp();
            *amostra += volume * envelope * fase.sin();
        }
    }
    amostras
}

fn normalizar(mut amostras: Vec<f64>, alvo: f64) -> Vec<f64> {
    let pico = amostras.iter().fold(0f64, |m, a| m.max(a.abs()));
    if pico > 0.0 {
        amostras.iter_mut().for_each(|a| *a *= alvo / pico);
    }
    amostras
}

fn wav(amostras: &[f64]) -> Vec<u8> {
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
    fn os_toques_sao_wavs_validos_baixinhos_e_diferentes() {
        let toques: Vec<Vec<u8>> = TOQUES.iter().map(|t| gerar_toque(t)).collect();
        for (nome, wav) in TOQUES.iter().zip(&toques) {
            assert!(validar_wav(wav).is_ok(), "{nome}");
            assert_eq!(&wav[8..16], b"WAVEfmt ");
            let tamanho = u32::from_le_bytes(wav[40..44].try_into().unwrap()) as usize;
            assert_eq!(wav.len(), 44 + tamanho, "{nome}");
            let pico = wav[44..]
                .chunks_exact(2)
                .map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs())
                .max()
                .unwrap();
            // Alto o bastante para ouvir, longe de saturar.
            assert!(pico > 3_000 && pico < 16_000, "{nome}: pico {pico}");
        }
        for i in 0..toques.len() {
            for j in i + 1..toques.len() {
                assert_ne!(toques[i], toques[j], "{} e {}", TOQUES[i], TOQUES[j]);
            }
        }
    }

    #[test]
    fn um_nome_que_nao_se_conhece_toca_a_madeira() {
        assert_eq!(sintetizado("trombone"), sintetizado("madeira"));
    }

    #[test]
    fn a_madeira_e_curta() {
        let ms = |toque: &str| (gerar_toque(toque).len() - 44) as f64 / 2.0 / TAXA as f64 * 1000.0;
        assert!(ms("madeira") <= 200.0, "{}", ms("madeira"));
        assert!(ms("madeira-dupla") <= 320.0, "{}", ms("madeira-dupla"));
        // E some logo: depois de 150 ms, quase nada da batida.
        let wav = gerar_toque("madeira");
        let depois: Vec<u16> = wav[44..]
            .chunks_exact(2)
            .skip((TAXA as f64 * 0.15) as usize)
            .map(|b| i16::from_le_bytes([b[0], b[1]]).unsigned_abs())
            .collect();
        assert!(depois.iter().all(|&a| a < 400), "{:?}", depois.iter().max());
    }

    #[test]
    fn recusa_o_que_nao_e_wav_ou_e_grande_demais() {
        assert!(validar_wav(b"ID3\x04 isto e um mp3, nao um wav, e tem mais de 44 bytes...").is_err());
        let mut grande = gerar_toque("sino");
        grande.resize(MAIOR_WAV + 1, 0);
        assert!(validar_wav(&grande).is_err());
    }

    #[test]
    fn o_toque_proprio_mora_na_pasta_dos_toques() {
        let pasta = Path::new("C:/config");
        assert_eq!(arquivo_do_toque(pasta, Tipo::Terminou), pasta.join("toques").join("terminou.wav"));
    }

    #[test]
    fn sem_vaga_sai_o_popup_mais_antigo() {
        let vagas = Vagas::default();
        assert_eq!(vagas.reservar("aviso-0"), (0, None));
        assert_eq!(vagas.reservar("aviso-1"), (1, None));
        assert_eq!(vagas.reservar("aviso-2"), (2, None));
        // Cheio: sai o 0 (o de baixo, o mais antigo) e o 3 entra no lugar dele.
        assert_eq!(vagas.reservar("aviso-3"), (0, Some("aviso-0".into())));
        // De novo cheio: agora o mais antigo é o 1, não o 3 que acabou de entrar embaixo.
        assert_eq!(vagas.reservar("aviso-4"), (1, Some("aviso-1".into())));
        // O que saiu fecha depois: liberar o rótulo dele não mexe em quem já está na vaga.
        vagas.liberar("aviso-0");
        assert_eq!(vagas.0.lock().unwrap().clone(), [Some("aviso-3".into()), Some("aviso-4".into()), Some("aviso-2".into())]);
        // O que perdeu a vaga sabe disso (para fechar, se ainda estava nascendo).
        assert!(!vagas.ocupa("aviso-1"));
        assert!(vagas.ocupa("aviso-4"));
    }

    #[test]
    fn a_vaga_liberada_e_a_proxima_a_ser_usada() {
        let vagas = Vagas::default();
        for i in 0..3 {
            vagas.reservar(&format!("aviso-{i}"));
        }
        vagas.liberar("aviso-1");
        assert_eq!(vagas.reservar("aviso-9"), (1, None));
    }

    #[test]
    fn a_vaga_de_um_popup_fechado_fica_livre() {
        let vagas = Vagas::default();
        vagas.0.lock().unwrap()[1] = Some("aviso-7".into());
        vagas.liberar("aviso-7");
        assert!(vagas.0.lock().unwrap().iter().all(Option::is_none));
    }
}
