//! O "Salvar como" e o "Imprimir" da tela. A tela pede primeiro o destino (escolher_destino, a janela de
//! salvar do Windows), depois monta o arquivo e manda os bytes (gravar_destino: o PNG, o Markdown, o JSON)
//! ou pede o PDF da própria página (gravar_pdf: o PrintToPdf do WebView2, com o CSS de impressão, que
//! mostra só o documento). Só se grava no arquivo que você acabou de escolher na janela.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request};
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

/// O arquivo escolhido na janela de salvar (até a tela mandar o conteúdo) e o último que foi salvo.
#[derive(Default)]
pub struct Destinos {
    escolhido: Mutex<Option<PathBuf>>,
    ultimo: Mutex<Option<PathBuf>>,
}

/// O nome do tipo na janela de salvar e a extensão de cada formato.
fn tipo_do_arquivo(formato: &str) -> Result<(&'static str, &'static str), String> {
    match formato {
        "png" => Ok(("Imagem PNG", "png")),
        "pdf" => Ok(("Documento PDF", "pdf")),
        "md" => Ok(("Markdown", "md")),
        "json" => Ok(("JSON", "json")),
        _ => Err(format!("formato desconhecido: {formato}")),
    }
}

/// Garante a extensão do formato ("relatorio" vira "relatorio.png"; "relatorio.PNG" fica como está).
fn com_extensao(caminho: PathBuf, extensao: &str) -> PathBuf {
    let tem = caminho.extension().is_some_and(|e| e.eq_ignore_ascii_case(extensao));
    if tem {
        return caminho;
    }
    let mut nome = caminho.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    nome.push(".");
    nome.push(extensao);
    caminho.with_file_name(nome)
}

/// O nome sugerido, sem o que o Windows não aceita num nome de arquivo.
fn nome_sugerido(nome: &str) -> String {
    let limpo: String = nome
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '-' } else { c })
        .take(120)
        .collect();
    let limpo = limpo.trim().trim_matches('.').to_string();
    if limpo.is_empty() { "vagents".into() } else { limpo }
}

fn nome_do_arquivo(caminho: &Path) -> String {
    caminho.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// A janela de salvar do Windows, presa à janela do app. Devolve o nome do arquivo escolhido (None: você
/// cancelou). É async: a janela espera você, e um comando síncrono seguraria a linha principal.
#[tauri::command]
pub async fn escolher_destino(
    janela: WebviewWindow,
    destinos: State<'_, Destinos>,
    nome: String,
    formato: String,
) -> Result<Option<String>, String> {
    let (descricao, extensao) = tipo_do_arquivo(&formato)?;
    *destinos.escolhido.lock().unwrap() = None;
    let escolhido = janela
        .dialog()
        .file()
        .set_parent(&janela)
        .set_title("Salvar como")
        .set_file_name(nome_sugerido(&nome))
        .add_filter(descricao, &[extensao])
        .blocking_save_file();
    let Some(escolhido) = escolhido else {
        return Ok(None);
    };
    let caminho = com_extensao(escolhido.into_path().map_err(|e| e.to_string())?, extensao);
    let nome = nome_do_arquivo(&caminho);
    *destinos.escolhido.lock().unwrap() = Some(caminho);
    Ok(Some(nome))
}

/// O destino escolhido, uma vez só.
fn tomar_destino(destinos: &Destinos) -> Result<PathBuf, String> {
    destinos.escolhido.lock().unwrap().take().ok_or_else(|| "escolha antes onde salvar".to_string())
}

fn lembrar(destinos: &Destinos, caminho: PathBuf) -> String {
    let texto = caminho.display().to_string();
    *destinos.ultimo.lock().unwrap() = Some(caminho);
    texto
}

/// Grava os bytes que a tela mandou (o corpo cru do pedido) no arquivo escolhido. Devolve o caminho.
#[tauri::command]
pub async fn gravar_destino(request: Request<'_>, destinos: State<'_, Destinos>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("o conteúdo do arquivo não chegou".into());
    };
    let caminho = tomar_destino(&destinos)?;
    std::fs::write(&caminho, bytes).map_err(|e| format!("não deu para gravar {}: {e}", caminho.display()))?;
    Ok(lembrar(&destinos, caminho))
}

/// O PDF da página como ela sai na impressão (só o documento que a tela montou), no arquivo escolhido.
#[tauri::command]
pub async fn gravar_pdf(janela: WebviewWindow, destinos: State<'_, Destinos>) -> Result<String, String> {
    let caminho = tomar_destino(&destinos)?;
    pdf_da_pagina(&janela, caminho.clone()).await?;
    Ok(lembrar(&destinos, caminho))
}

/// O "Mostrar na pasta" do recado de salvo: o Explorador com o arquivo selecionado.
#[tauri::command]
pub async fn mostrar_salvo(destinos: State<'_, Destinos>) -> Result<(), String> {
    let caminho = destinos.ultimo.lock().unwrap().clone().ok_or_else(|| "nada foi salvo ainda".to_string())?;
    abrir_no_explorador(&caminho)
}

#[cfg(windows)]
fn abrir_no_explorador(caminho: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // O /select do Explorador quer o caminho entre aspas logo depois da vírgula (um caminho do Windows
    // não tem aspas, então nada escapa daqui).
    std::process::Command::new("explorer")
        .raw_arg(format!("/select,\"{}\"", caminho.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn abrir_no_explorador(_caminho: &Path) -> Result<(), String> {
    Err("só no Windows".into())
}

/// O PrintToPdf do WebView2: A4, sem margem (o documento traz o respiro dele, e o fundo do tema vai até a
/// borda), com os fundos e sem o cabeçalho e o rodapé do navegador. O WebView2 chama de volta na linha
/// principal; aqui se espera a resposta fora dela.
#[cfg(windows)]
async fn pdf_da_pagina(janela: &WebviewWindow, caminho: PathBuf) -> Result<(), String> {
    use std::sync::mpsc;
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    let (pronto, resposta) = mpsc::channel::<Result<(), String>>();
    janela
        .with_webview(move |webview| {
            let avisar = pronto.clone();
            let pedido = (|| -> windows_core::Result<()> {
                unsafe {
                    let core = webview.controller().CoreWebView2()?;
                    let core: ICoreWebView2_7 = core.cast()?;
                    let ambiente: ICoreWebView2Environment6 = webview.environment().cast()?;
                    let ajustes = ambiente.CreatePrintSettings()?;
                    ajustes.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
                    // A4, em polegadas.
                    ajustes.SetPageWidth(8.27)?;
                    ajustes.SetPageHeight(11.69)?;
                    ajustes.SetMarginTop(0.0)?;
                    ajustes.SetMarginBottom(0.0)?;
                    ajustes.SetMarginLeft(0.0)?;
                    ajustes.SetMarginRight(0.0)?;
                    ajustes.SetScaleFactor(1.0)?;
                    ajustes.SetShouldPrintBackgrounds(true)?;
                    ajustes.SetShouldPrintHeaderAndFooter(false)?;
                    let destino = HSTRING::from(caminho.as_path());
                    let feito = PrintToPdfCompletedHandler::create(Box::new(move |erro, gerou| {
                        let _ = avisar.send(match erro {
                            Err(e) => Err(e.message()),
                            Ok(()) if gerou => Ok(()),
                            Ok(()) => Err("o WebView2 não conseguiu gerar o PDF".into()),
                        });
                        Ok(())
                    }));
                    core.PrintToPdf(&destino, &ajustes, &feito)?;
                }
                Ok(())
            })();
            if let Err(e) = pedido {
                let _ = pronto.send(Err(format!(
                    "o WebView2 deste Windows não gera PDF ({}). Use Imprimir e escolha \"Microsoft Print to PDF\".",
                    e.message()
                )));
            }
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || resposta.recv_timeout(Duration::from_secs(120)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "o PDF demorou demais para ficar pronto".to_string())?
}

#[cfg(not(windows))]
async fn pdf_da_pagina(_janela: &WebviewWindow, _caminho: PathBuf) -> Result<(), String> {
    Err("o PDF direto só existe no Windows: use Imprimir".into())
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn poe_a_extensao_que_falta() {
        assert_eq!(com_extensao(PathBuf::from("C:/a/relatorio"), "png"), PathBuf::from("C:/a/relatorio.png"));
        assert_eq!(com_extensao(PathBuf::from("C:/a/relatorio.PNG"), "png"), PathBuf::from("C:/a/relatorio.PNG"));
        assert_eq!(com_extensao(PathBuf::from("C:/a/v1.final"), "md"), PathBuf::from("C:/a/v1.final.md"));
    }

    #[test]
    fn limpa_o_nome_sugerido() {
        assert_eq!(nome_sugerido("vagents-a:b?.png"), "vagents-a-b-.png");
        assert_eq!(nome_sugerido("  ..  "), "vagents");
    }

    #[test]
    fn so_formatos_conhecidos() {
        assert!(tipo_do_arquivo("exe").is_err());
        assert_eq!(tipo_do_arquivo("md").unwrap().1, "md");
    }
}
