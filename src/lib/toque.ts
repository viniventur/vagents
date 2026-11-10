// O arquivo de som que você escolhe para um aviso vira um toque: a própria página decodifica (MP3, WAV,
// OGG, M4A, o que o navegador tocar), junta os canais em mono a 44,1 kHz, tira o silêncio das pontas,
// corta em 5 s (com um fim suave), põe no mesmo pico dos toques do app e grava um WAV de 16 bits, que o
// Windows toca sozinho (src-tauri/src/aviso.rs). As contas são puras; só arquivoParaWav usa o áudio da página.

export const TAXA = 44_100
export const DURACAO_MAXIMA_S = 5
/** O maior arquivo que vale a pena decodificar (um toque é curto). */
export const MAIOR_ARQUIVO = 5 * 1024 * 1024
/** O mesmo pico dos toques sintetizados (PICO, em aviso.rs). */
const PICO = 0.3
/** Abaixo disto (do pico do arquivo), é silêncio. */
const LIMIAR_DO_SILENCIO = 0.02
/** O que fica antes do primeiro som, para não comer o ataque. */
const FOLGA_S = 0.005
/** A descida no fim, quando o som foi cortado no meio. */
const FIM_SUAVE_S = 0.05

/** Os toques sintetizados pelo app, na ordem da lista. */
export const TOQUES = [
  { toque: 'madeira', rotulo: 'Madeira, uma batida' },
  { toque: 'madeira-dupla', rotulo: 'Madeira, duas batidas' },
  { toque: 'sino', rotulo: 'Sino' },
  { toque: 'descendo', rotulo: 'Sino descendo' },
  { toque: 'gota', rotulo: 'Gota' },
  { toque: 'acorde', rotulo: 'Acorde' },
] as const

/** O arquivo que você enviou. */
export const PROPRIO = 'proprio'

export class SomVazio extends Error {}

/** Tira o silêncio das pontas, corta na duração máxima (com um fim suave) e põe no pico dos toques. */
export function prepararAmostras(amostras: Float32Array, taxa = TAXA): Float32Array {
  let pico = 0
  for (const a of amostras) pico = Math.max(pico, Math.abs(a))
  if (pico < 1e-4) throw new SomVazio('o som está em silêncio')

  const limiar = pico * LIMIAR_DO_SILENCIO
  let inicio = amostras.findIndex((a) => Math.abs(a) >= limiar)
  let fim = amostras.length
  while (fim > inicio && Math.abs(amostras[fim - 1] ?? 0) < limiar) fim--
  inicio = Math.max(0, inicio - Math.round(FOLGA_S * taxa))

  const maximo = Math.round(DURACAO_MAXIMA_S * taxa)
  const cortado = fim - inicio > maximo
  const saida = amostras.slice(inicio, cortado ? inicio + maximo : fim)
  const escala = PICO / pico
  const descida = cortado ? Math.min(saida.length, Math.round(FIM_SUAVE_S * taxa)) : 0
  return saida.map((a, i) => {
    const resta = saida.length - i
    return a * escala * (resta <= descida ? resta / descida : 1)
  })
}

/** Um WAV PCM de 16 bits, mono. */
export function codificarWav(amostras: Float32Array, taxa = TAXA): Uint8Array {
  const bytes = new Uint8Array(44 + amostras.length * 2)
  const v = new DataView(bytes.buffer)
  const texto = (pos: number, s: string) => [...s].forEach((c, i) => v.setUint8(pos + i, c.charCodeAt(0)))
  texto(0, 'RIFF')
  v.setUint32(4, 36 + amostras.length * 2, true)
  texto(8, 'WAVEfmt ')
  v.setUint32(16, 16, true) // o tamanho do bloco fmt
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, taxa, true)
  v.setUint32(28, taxa * 2, true) // bytes por segundo
  v.setUint16(32, 2, true) // bytes por amostra
  v.setUint16(34, 16, true) // bits por amostra
  texto(36, 'data')
  v.setUint32(40, amostras.length * 2, true)
  amostras.forEach((a, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, a)) * 0x7fff), true))
  return bytes
}

/** Junta os canais num só (a média). */
export function emMono(canais: Float32Array[]): Float32Array {
  const [primeiro, ...resto] = canais
  if (!primeiro) return new Float32Array(0)
  if (resto.length === 0) return primeiro
  return primeiro.map((_, i) => canais.reduce((soma, canal) => soma + (canal[i] ?? 0), 0) / canais.length)
}

/** O arquivo, pronto para virar o toque de um aviso. */
export async function arquivoParaWav(arquivo: Blob): Promise<Uint8Array> {
  if (arquivo.size > MAIOR_ARQUIVO) throw new RangeError('o arquivo é grande demais para um toque')
  // O contexto offline decodifica já na taxa dele (44,1 kHz), sem tocar nada.
  const contexto = new OfflineAudioContext(1, 1, TAXA)
  const audio = await contexto.decodeAudioData(await arquivo.arrayBuffer())
  const canais = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  return codificarWav(prepararAmostras(emMono(canais)))
}
