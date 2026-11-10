import { describe, expect, it } from 'vitest'
import { PAGINA_DAS_VERSOES, lerRelease, maisNova, partes } from '../src/lib/versao.ts'

describe('partes', () => {
  it('lê a versão com ou sem o "v", e ignora o sufixo', () => {
    expect(partes('v0.1.2')).toEqual([0, 1, 2])
    expect(partes(' 1.10.0 ')).toEqual([1, 10, 0])
    expect(partes('2.0.0-beta.1')).toEqual([2, 0, 0])
    expect(partes('nightly')).toBeNull()
    expect(partes('1.2')).toBeNull()
  })
})

describe('maisNova', () => {
  it('compara número a número, não como texto', () => {
    expect(maisNova('0.1.2', '0.1.1')).toBe(true)
    expect(maisNova('0.1.10', '0.1.9')).toBe(true)
    expect(maisNova('1.0.0', '0.9.9')).toBe(true)
    expect(maisNova('0.1.1', '0.1.1')).toBe(false)
    expect(maisNova('0.1.0', '0.1.1')).toBe(false)
  })

  it('na dúvida, não avisa', () => {
    expect(maisNova('lixo', '0.1.1')).toBe(false)
    expect(maisNova('0.2.0', '')).toBe(false)
  })
})

describe('lerRelease', () => {
  it('pega a versão da tag e a página da Release', () => {
    const url = 'https://github.com/viniventur/vagents/releases/tag/v0.1.2'
    expect(lerRelease({ tag_name: 'v0.1.2', html_url: url, assets: [] })).toEqual({ versao: '0.1.2', url })
  })

  it('não abre uma página de fora do repositório', () => {
    expect(lerRelease({ tag_name: 'v0.2.0', html_url: 'https://exemplo.com/releases/x' })?.url).toBe(PAGINA_DAS_VERSOES)
    expect(lerRelease({ tag_name: 'v0.2.0' })?.url).toBe(PAGINA_DAS_VERSOES)
  })

  it('ignora o que não é uma Release', () => {
    expect(lerRelease(null)).toBeNull()
    expect(lerRelease({ message: 'Not Found' })).toBeNull()
    expect(lerRelease({ tag_name: 'nightly' })).toBeNull()
  })
})
