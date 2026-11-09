//! Leituras pequenas de valores JSON, com as regras do JavaScript que o servidor em Node usava.

use serde_json::{Map, Value};

/// Um objeto JSON lido de uma linha ou de um arquivo.
pub(crate) type Json = Map<String, Value>;

/// Como o `trim()` do JavaScript: o mesmo espaço em branco do Rust, menos o U+0085 e mais o U+FEFF.
pub(crate) fn js_trim(value: &str) -> &str {
    value.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// Um texto aparado e não vazio.
pub(crate) fn text(value: Option<&Value>) -> Option<String> {
    let trimmed = js_trim(value?.as_str()?);
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// Um texto não vazio, como veio (sem aparar).
pub(crate) fn non_empty(value: Option<&Value>) -> Option<String> {
    value?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Um número finito, em inteiro (os horários são milissegundos; a fração não interessa).
pub(crate) fn number(value: Option<&Value>) -> Option<i64> {
    let n = value?.as_number()?;
    n.as_i64()
        .or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f as i64))
}
