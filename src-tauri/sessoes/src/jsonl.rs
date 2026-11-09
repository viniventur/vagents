//! A leitura dos arquivos JSONL (uma linha, um JSON) que o Claude Code só faz crescer.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const NL: u8 = b'\n';
/// O tanto que se reserva de uma vez para uma leitura; o resto cresce conforme chega.
const MAX_PREALLOC: u64 = 64 * 1024 * 1024;

/// Os bytes [from, to) do arquivo (menos, se ele acabar antes).
pub(crate) fn read_range(path: &Path, from: u64, to: u64) -> io::Result<Vec<u8>> {
    let length = to.saturating_sub(from);
    if length == 0 {
        return Ok(Vec::new());
    }
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(from))?;
    let mut buf = Vec::with_capacity(usize::try_from(length.min(MAX_PREALLOC)).unwrap_or(0));
    file.take(length).read_to_end(&mut buf)?;
    Ok(buf)
}

/// As linhas completas (terminadas em "\n", sem as vazias) e o resto, a linha ainda incompleta.
/// Bytes que não são UTF-8 viram "�", como no Node.
pub(crate) fn split_lines(buf: &[u8]) -> (Vec<String>, &[u8]) {
    let mut lines = Vec::new();
    let mut start = 0;
    while let Some(i) = buf[start..].iter().position(|&b| b == NL) {
        let end = start + i;
        if end > start {
            lines.push(String::from_utf8_lossy(&buf[start..end]).into_owned());
        }
        start = end + 1;
    }
    (lines, &buf[start..])
}

/// Acompanha um arquivo JSONL que só cresce: cada `read_new()` devolve as linhas completas
/// acrescentadas desde a anterior. Se o arquivo encolher, recomeça do zero.
#[derive(Debug)]
pub(crate) struct JsonlTail {
    path: PathBuf,
    offset: u64,
    carry: Vec<u8>,
}

impl JsonlTail {
    /// `offset` tem de cair no começo de uma linha.
    pub(crate) fn new(path: PathBuf, offset: u64) -> JsonlTail {
        JsonlTail {
            path,
            offset,
            carry: Vec::new(),
        }
    }

    pub(crate) fn read_new(&mut self) -> Vec<String> {
        let Ok(meta) = fs::metadata(&self.path) else {
            return Vec::new();
        };
        let size = meta.len();
        if size < self.offset {
            self.offset = 0;
            self.carry.clear();
        }
        if size == self.offset {
            return Vec::new();
        }
        // Se não der para ler agora (o arquivo sumiu ou está preso), tenta de novo na próxima.
        let Ok(chunk) = read_range(&self.path, self.offset, size) else {
            return Vec::new();
        };
        self.offset += chunk.len() as u64;
        let data = if self.carry.is_empty() {
            chunk
        } else {
            let mut data = std::mem::take(&mut self.carry);
            data.extend_from_slice(&chunk);
            data
        };
        let (lines, rest) = split_lines(&data);
        // Copia o resto para não segurar o pedaço inteiro na memória.
        self.carry = rest.to_vec();
        lines
    }
}

/// Lê o fim do arquivo em janelas cada vez maiores (×4) e entrega as linhas completas, da mais nova
/// para a mais velha, até `visit` devolver true ou o arquivo acabar. Uma linha pode ser entregue
/// mais de uma vez (as janelas se sobrepõem), então `visit` tem de tolerar repetição.
///
/// Devolve onde termina a última linha completa: é dali que um [`JsonlTail`] deve continuar. Um
/// erro de leitura (o arquivo sumiu no meio) volta como erro, para quem chamou tentar de novo.
pub(crate) fn scan_backward(
    path: &Path,
    size: u64,
    mut visit: impl FnMut(&str) -> bool,
    first_window: u64,
) -> io::Result<u64> {
    let mut window = first_window.max(1);
    loop {
        let start = size.saturating_sub(window);
        let buf = read_range(path, start, size)?;
        let Some(last_nl) = buf.iter().rposition(|&b| b == NL) else {
            if start == 0 {
                return Ok(0);
            }
            window = window.saturating_mul(4);
            continue;
        };
        let resume = start + last_nl as u64 + 1;
        // Anda de linha em linha para trás; `end` é o "\n" que fecha a linha da vez.
        let mut end = last_nl;
        loop {
            let begin = buf[..end]
                .iter()
                .rposition(|&b| b == NL)
                .map_or(0, |i| i + 1);
            // A primeira linha de uma janela que não começa no início do arquivo pode estar cortada.
            if begin == 0 && start != 0 {
                break;
            }
            if end > begin && visit(&String::from_utf8_lossy(&buf[begin..end])) {
                return Ok(resume);
            }
            if begin == 0 {
                break;
            }
            end = begin - 1;
        }
        if start == 0 {
            return Ok(resume);
        }
        window = window.saturating_mul(4);
    }
}
