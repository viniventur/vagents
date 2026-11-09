//! O que o app guarda na pasta de configuração (%APPDATA%\br.com.viniciusventura.vagents):
//! - preferencias.json: o tema e os avisos;
//! - organizacao.json: os grupos e os nomes que você dá às sessões (o formato é da tela, src/organizacao.ts;
//!   aqui só se lê o nome de cada sessão, para o aviso usar o mesmo nome da tela);
//! - vagents.config.json: as contas do Claude (lido pela biblioteca de sessões).

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
    /// O toque curto junto com o popup.
    pub som: bool,
}

impl Default for Preferencias {
    fn default() -> Self {
        Self { tema: "sistema".into(), avisar: true, som: true }
    }
}

/// O arquivo como o tipo pede; sem arquivo (ou com um que não se lê), o padrão.
pub fn ler<T: DeserializeOwned + Default>(arquivo: &Path) -> T {
    fs::read_to_string(arquivo)
        .ok()
        .and_then(|texto| serde_json::from_str(&texto).ok())
        .unwrap_or_default()
}

/// Grava num .tmp e troca: um desligamento no meio não deixa o arquivo pela metade.
pub fn gravar(arquivo: &Path, valor: &impl Serialize) -> Result<(), String> {
    if let Some(pasta) = arquivo.parent() {
        fs::create_dir_all(pasta).map_err(|e| e.to_string())?;
    }
    let texto = serde_json::to_string_pretty(valor).map_err(|e| e.to_string())?;
    let tmp = arquivo.with_extension("json.tmp");
    fs::write(&tmp, texto).map_err(|e| e.to_string())?;
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
    fn grava_e_le_de_volta() {
        let pasta = std::env::temp_dir().join(format!("vagents-pref-{}", std::process::id()));
        let arquivo = pasta.join("preferencias.json");
        let p = Preferencias { tema: "escuro".into(), avisar: false, som: false };
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
