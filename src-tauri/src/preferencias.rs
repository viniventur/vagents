//! O que o app guarda na pasta de configuração (%APPDATA%\br.com.viniciusventura.vagents):
//! - preferencias.json: o tema e os avisos;
//! - organizacao.json: os grupos e os nomes que você dá às sessões (o formato é da tela, src/organizacao.ts;
//!   aqui só se lê o nome de cada sessão, para o aviso usar o mesmo nome da tela);
//! - vagents.config.json: as contas do Claude (lido pela biblioteca de sessões).

use crate::avisos::Tipo;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferencias {
    /// "sistema", "claro" ou "escuro".
    pub tema: String,
    /// O popup no canto da tela quando uma sessão começa a esperar por você.
    pub avisar: bool,
    /// O toque curto junto com esse popup.
    pub som: bool,
    /// Qual toque (um dos aviso::TOQUES, ou "proprio": o arquivo que você enviou).
    pub toque: String,
    /// O nome do arquivo que você enviou para esse aviso, para a tela mostrar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arquivo_do_toque: Option<String>,
    /// O mesmo popup quando uma sessão termina o que estava fazendo.
    pub avisar_terminou: bool,
    /// E o toque dele, como os de cima.
    pub som_terminou: bool,
    pub toque_terminou: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arquivo_do_toque_terminou: Option<String>,
    /// Consultar as versões do vAgents no GitHub (a tela faz isso, no máximo a cada 6 h) para mostrar a
    /// pílula de versão nova.
    pub procurar_versao: bool,
}

impl Default for Preferencias {
    fn default() -> Self {
        Self {
            tema: "sistema".into(),
            avisar: true,
            som: true,
            // Batidas de madeira, curtas: duas para "esperando você", uma para "terminou" (dá para saber
            // qual aviso chegou sem olhar).
            toque: "madeira-dupla".into(),
            arquivo_do_toque: None,
            avisar_terminou: true,
            som_terminou: true,
            toque_terminou: "madeira".into(),
            arquivo_do_toque_terminou: None,
            procurar_versao: true,
        }
    }
}

impl Preferencias {
    /// O popup desse aviso está ligado?
    pub fn avisa(&self, tipo: Tipo) -> bool {
        match tipo {
            Tipo::Esperando => self.avisar,
            Tipo::Terminou => self.avisar_terminou,
        }
    }

    /// E o som dele?
    pub fn toca(&self, tipo: Tipo) -> bool {
        match tipo {
            Tipo::Esperando => self.som,
            Tipo::Terminou => self.som_terminou,
        }
    }

    /// Qual toque.
    pub fn toque(&self, tipo: Tipo) -> &str {
        match tipo {
            Tipo::Esperando => &self.toque,
            Tipo::Terminou => &self.toque_terminou,
        }
    }

    /// O arquivo que você enviou passa a ser o toque do aviso (com o som ligado).
    pub fn usar_toque_proprio(&mut self, tipo: Tipo, nome: String) {
        let (som, toque, arquivo) = match tipo {
            Tipo::Esperando => (&mut self.som, &mut self.toque, &mut self.arquivo_do_toque),
            Tipo::Terminou => (&mut self.som_terminou, &mut self.toque_terminou, &mut self.arquivo_do_toque_terminou),
        };
        *som = true;
        *toque = crate::aviso::PROPRIO.into();
        *arquivo = Some(nome);
    }
}

/// O arquivo como o tipo pede; sem arquivo (ou com um que não se lê), o padrão.
pub fn ler<T: DeserializeOwned + Default>(arquivo: &Path) -> T {
    fs::read_to_string(arquivo)
        .ok()
        .and_then(|texto| serde_json::from_str(&texto).ok())
        .unwrap_or_default()
}

/// Grava o JSON (veja gravar_bytes).
pub fn gravar(arquivo: &Path, valor: &impl Serialize) -> Result<(), String> {
    let texto = serde_json::to_string_pretty(valor).map_err(|e| e.to_string())?;
    gravar_bytes(arquivo, texto.as_bytes())
}

/// Grava num .tmp e troca: um desligamento no meio não deixa o arquivo pela metade.
pub fn gravar_bytes(arquivo: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(pasta) = arquivo.parent() {
        fs::create_dir_all(pasta).map_err(|e| e.to_string())?;
    }
    let mut tmp = arquivo.as_os_str().to_owned();
    tmp.push(".tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, arquivo).map_err(|e| e.to_string())
}

/// O nome que você deu à sessão na tela (organizacao.json → sessoes[chave].nome), se houver.
pub fn nome_da_sessao(organizacao: &serde_json::Value, chave: &str) -> Option<String> {
    organizacao
        .get("sessoes")?
        .get(chave)?
        .get("nome")?
        .as_str()
        .map(str::trim)
        .filter(|nome| !nome.is_empty())
        .map(String::from)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn sem_arquivo_vale_o_padrao() {
        let p: Preferencias = ler(Path::new("Z:/nao/existe.json"));
        assert_eq!(p, Preferencias::default());
    }

    #[test]
    fn o_arquivo_de_antes_liga_o_aviso_de_terminou() {
        let p: Preferencias = serde_json::from_str(r#"{ "tema": "claro", "avisar": false, "som": false }"#).unwrap();
        assert_eq!(p, Preferencias { tema: "claro".into(), avisar: false, som: false, ..Preferencias::default() });
        assert!(p.avisar_terminou && p.som_terminou && p.procurar_versao);
        assert_eq!((p.toque(Tipo::Esperando), p.toque(Tipo::Terminou)), ("madeira-dupla", "madeira"));
    }

    #[test]
    fn cada_aviso_tem_o_seu_popup_e_o_seu_som() {
        let p = Preferencias { avisar: true, som: false, avisar_terminou: false, som_terminou: true, ..Preferencias::default() };
        assert!(p.avisa(Tipo::Esperando) && !p.toca(Tipo::Esperando));
        assert!(!p.avisa(Tipo::Terminou) && p.toca(Tipo::Terminou));
    }

    #[test]
    fn o_arquivo_enviado_vira_o_toque_so_daquele_aviso() {
        let mut p = Preferencias { som_terminou: false, ..Preferencias::default() };
        p.usar_toque_proprio(Tipo::Terminou, "ping.mp3".into());
        assert!(p.som_terminou);
        assert_eq!(p.toque(Tipo::Terminou), "proprio");
        assert_eq!(p.arquivo_do_toque_terminou.as_deref(), Some("ping.mp3"));
        assert_eq!(p.toque(Tipo::Esperando), "madeira-dupla");
        assert_eq!(p.arquivo_do_toque, None);
    }

    #[test]
    fn grava_e_le_de_volta() {
        let pasta = std::env::temp_dir().join(format!("vagents-pref-{}", std::process::id()));
        let arquivo = pasta.join("preferencias.json");
        let mut p = Preferencias { tema: "escuro".into(), avisar: false, som: false, ..Preferencias::default() };
        p.usar_toque_proprio(Tipo::Esperando, "Ding (1).wav".into());
        gravar(&arquivo, &p).unwrap();
        assert_eq!(ler::<Preferencias>(&arquivo), p);
        let _ = fs::remove_dir_all(pasta);
    }

    #[test]
    fn acha_o_nome_dado_na_tela() {
        let org = serde_json::json!({ "sessoes": { "a|1": { "nome": "  Migração  " }, "a|2": { "nome": "" } } });
        assert_eq!(nome_da_sessao(&org, "a|1").as_deref(), Some("Migração"));
        assert_eq!(nome_da_sessao(&org, "a|2"), None);
        assert_eq!(nome_da_sessao(&org, "a|3"), None);
    }
}
