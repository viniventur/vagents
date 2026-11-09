import { describe, expect, it } from 'vitest'
import type { SessionView, Snapshot } from '../shared/model.ts'
import { buildGraph } from '../src/layout.ts'
import { CORES_PRONTAS, hexParaHsv, hsvParaHex, normalizarHex } from '../src/lib/cor.ts'
import { montarLista } from '../src/lib/lista.ts'
import {
  VAZIA,
  alternarRecolhido,
  corDaSessao,
  criarGrupo,
  definirCorDaSessao,
  definirCorDoGrupo,
  moverSessao,
  normalizar,
  renomearSessao,
} from '../src/lib/organizacao.ts'

describe('o hex', () => {
  it('aceita #rgb e #rrggbb, com ou sem #, e guarda sempre #rrggbb minúsculo', () => {
    expect(normalizarHex('#0088B0')).toBe('#0088b0')
    expect(normalizarHex('0088b0')).toBe('#0088b0')
    expect(normalizarHex(' #abc ')).toBe('#aabbcc')
    for (const ruim of ['', '#', '#12', '#12345', '#1234567', 'red', '#gg0000', 'rgb(0,0,0)']) expect(normalizarHex(ruim)).toBeNull()
  })

  it('vai e volta entre hex e matiz/saturação/brilho sem mudar a cor', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080', ...CORES_PRONTAS.map((c) => c.hex)]) {
      expect(hsvParaHex(hexParaHsv(hex))).toBe(hex)
    }
    expect(hexParaHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hexParaHsv('#00ff00').h).toBeCloseTo(120)
    expect(hexParaHsv('#0000ff').h).toBeCloseTo(240)
    expect(hsvParaHex({ h: 0, s: 0, v: 0.5 })).toBe('#808080')
  })
})

describe('a cor do grupo e do card', () => {
  it('é guardada, trocada e tirada (null volta à de sempre); um hex inválido não muda nada', () => {
    const org = criarGrupo(VAZIA, 'Loja', 'loja').org
    expect(org.grupos[0]?.cor).toBeUndefined()
    const azul = definirCorDoGrupo(org, 'loja', '#2F6FD0')
    expect(azul.grupos[0]).toEqual({ id: 'loja', nome: 'Loja', cor: '#2f6fd0' })
    expect(definirCorDoGrupo(azul, 'loja', 'azul')).toBe(azul)
    expect(definirCorDoGrupo(azul, 'loja', null).grupos[0]).toEqual({ id: 'loja', nome: 'Loja' })

    const card = definirCorDaSessao(VAZIA, 's1', '#d64545')
    expect(corDaSessao(card, 's1')).toBe('#d64545')
    expect(corDaSessao(card, 'outra')).toBeNull()
    // Tirar a cor de uma sessão sem mais nada apaga o ajuste dela; com outras coisas, só a cor sai.
    expect(definirCorDaSessao(card, 's1', null).sessoes).toEqual({})
    const comNome = renomearSessao(card, 's1', 'Meu nome')
    expect(definirCorDaSessao(comNome, 's1', null).sessoes).toEqual({ s1: { nome: 'Meu nome' } })
    // Mudar de grupo não leva a cor embora.
    expect(moverSessao(card, 's1', null).sessoes.s1).toEqual({ grupo: '', cor: '#d64545' })
  })

  it('recolher e mostrar o grupo não perde a cor', () => {
    const org = definirCorDoGrupo(criarGrupo(VAZIA, 'Loja', 'loja').org, 'loja', '#2e9e6a')
    const recolhido = alternarRecolhido(org, 'loja')
    expect(recolhido.grupos[0]).toEqual({ id: 'loja', nome: 'Loja', recolhido: true, cor: '#2e9e6a' })
    expect(alternarRecolhido(recolhido, 'loja').grupos[0]).toEqual({ id: 'loja', nome: 'Loja', cor: '#2e9e6a' })
  })

  it('do arquivo, vale só um hex de verdade', () => {
    const lido = normalizar({
      grupos: [
        { id: 'a', nome: 'A', cor: '#ABC' },
        { id: 'b', nome: 'B', cor: 'vermelho' },
        { id: 'c', nome: 'C', cor: 12 },
      ],
      sessoes: { s1: { cor: '#7B5CC4' }, s2: { cor: 'url(x)' }, s3: { nome: 'x', cor: '#12' } },
      pastas: {},
    })
    expect(lido.grupos).toEqual([
      { id: 'a', nome: 'A', cor: '#aabbcc' },
      { id: 'b', nome: 'B' },
      { id: 'c', nome: 'C' },
    ])
    expect(lido.sessoes).toEqual({ s1: { cor: '#7b5cc4' }, s3: { nome: 'x' } })
  })

  it('chega ao mapa (o card e o quadro do grupo) e à lista', () => {
    const sessao = (key: string): SessionView => ({
      key,
      sessionId: key,
      configDir: 'cfg',
      account: 'Pessoal',
      cwd: 'D:\\x',
      project: 'x',
      title: key,
      status: 'idle',
      updatedAt: 1_000_000,
      agents: [],
    })
    const snap: Snapshot = { generatedAt: 1_000_000, configDirs: ['cfg'], retentionMs: 0, sessions: [sessao('a'), sessao('b')] }
    let org = definirCorDoGrupo(criarGrupo(VAZIA, 'Loja', 'loja').org, 'loja', '#c9a227')
    org = definirCorDaSessao(moverSessao(org, 'a', 'loja'), 'a', '#0088b0')
    const g = buildGraph(snap, { expanded: new Set(), endedWindowMs: 3_600_000, selectedId: null, organizacao: org })
    const no = (id: string) => g.nodes.find((n) => n.id === id)!
    expect((no('s:a').data as { cor: string | null }).cor).toBe('#0088b0')
    expect((no('s:b').data as { cor: string | null }).cor).toBeNull()
    expect((no('g:loja').data as { grupo: { cor?: string } }).grupo.cor).toBe('#c9a227')

    const lista = montarLista(snap, { endedWindowMs: 3_600_000, organizacao: org, abertos: new Set() })
    const naLista = lista.secoes.flatMap((s) => s.sessoes)
    expect(naLista.find((s) => s.sessao.key === 'a')?.cor).toBe('#0088b0')
    expect(naLista.find((s) => s.sessao.key === 'b')?.cor).toBeNull()
    expect(lista.secoes.find((s) => s.id === 'loja')?.grupo?.cor).toBe('#c9a227')
  })
})
