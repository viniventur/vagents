// As cores que você escolhe para os grupos e os cards: o hex que fica guardado e as contas do seletor
// (matiz, saturação e brilho, o "HSV"). Tudo puro.

/** "#rgb" ou "#rrggbb" (com ou sem o #, em maiúsculas ou não) vira "#rrggbb"; o resto, null. */
export function normalizarHex(texto: string): string | null {
  const t = texto.trim().replace(/^#/, '').toLowerCase()
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`
  if (/^[0-9a-f]{3}$/.test(t)) return `#${[...t].map((c) => c + c).join('')}`
  return null
}

/** Matiz de 0 a 360, saturação e brilho de 0 a 1. */
export interface Hsv {
  h: number
  s: number
  v: number
}

export function hexParaHsv(hex: string): Hsv {
  const n = Number.parseInt((normalizarHex(hex) ?? '#000000').slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvParaHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    const canal = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(Math.min(1, Math.max(0, canal)) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}

/** Prontas para um clique: as da marca e vizinhas, que ficam bem como tom de fundo nos dois temas. */
export const CORES_PRONTAS: readonly { hex: string; nome: string }[] = [
  { hex: '#0088b0', nome: 'Ciano' },
  { hex: '#2f6fd0', nome: 'Azul' },
  { hex: '#7b5cc4', nome: 'Roxo' },
  { hex: '#d6006c', nome: 'Magenta' },
  { hex: '#d64545', nome: 'Vermelho' },
  { hex: '#e07b39', nome: 'Laranja' },
  { hex: '#c9a227', nome: 'Amarelo' },
  { hex: '#2e9e6a', nome: 'Verde' },
]
