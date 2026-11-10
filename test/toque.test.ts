import { describe, expect, it } from 'vitest'
import { DURACAO_MAXIMA_S, SomVazio, TAXA, codificarWav, emMono, prepararAmostras } from '../src/lib/toque.ts'

/** Um seno de `segundos`, com `silencio` segundos antes e depois. */
function seno(segundos: number, silencio = 0, amplitude = 0.8): Float32Array {
  const pausa = Math.round(silencio * TAXA)
  const som = Math.round(segundos * TAXA)
  const a = new Float32Array(pausa + som + pausa)
  for (let i = 0; i < som; i++) a[pausa + i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / TAXA)
  return a
}

const pico = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0)

describe('prepararAmostras', () => {
  it('tira o silêncio das pontas, mas guarda um respiro antes do som', () => {
    const saida = prepararAmostras(seno(1, 0.5))
    expect(saida.length).toBeGreaterThan(TAXA * 0.99)
    expect(saida.length).toBeLessThan(TAXA * 1.02)
  })

  it('põe qualquer volume no mesmo pico dos toques do app', () => {
    expect(pico(prepararAmostras(seno(1, 0, 0.05)))).toBeCloseTo(0.3, 2)
    expect(pico(prepararAmostras(seno(1, 0, 1)))).toBeCloseTo(0.3, 2)
  })

  it('corta um som longo em 5 s, descendo até o silêncio no fim', () => {
    const saida = prepararAmostras(seno(12))
    expect(saida.length).toBe(DURACAO_MAXIMA_S * TAXA)
    expect(Math.abs(saida.at(-1) ?? 1)).toBeLessThan(0.001)
    expect(pico(saida.slice(-50))).toBeLessThan(0.01)
  })

  it('recusa um arquivo em silêncio', () => {
    expect(() => prepararAmostras(new Float32Array(TAXA))).toThrow(SomVazio)
  })
})

describe('codificarWav', () => {
  it('escreve um WAV PCM de 16 bits, mono, a 44,1 kHz', () => {
    const wav = codificarWav(new Float32Array([0, 0.5, -1, 2]))
    const v = new DataView(wav.buffer)
    const texto = (pos: number, n: number) => String.fromCharCode(...wav.slice(pos, pos + n))
    expect(texto(0, 4)).toBe('RIFF')
    expect(texto(8, 8)).toBe('WAVEfmt ')
    expect(v.getUint32(4, true)).toBe(wav.length - 8)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(44_100)
    expect(v.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 16384, -32767, 32767])
  })
})

describe('emMono', () => {
  it('faz a média dos canais', () => {
    expect([...emMono([new Float32Array([1, 0]), new Float32Array([0, -1])])]).toEqual([0.5, -0.5])
  })
})
