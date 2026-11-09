import { describe, expect, it } from 'vitest'
import type { SessionView, Snapshot } from '../shared/model.ts'
import { SEM_GRUPO, SIZE, afastar, buildGraph, deslocarSessao, marcarAlvo, type Graph } from '../src/layout.ts'
import {
  VAZIA,
  apagarGrupo,
  criarGrupo,
  moverSessao,
  normalizar,
  posicaoDaSessao,
  posicionarSessoes,
  renomearSessao,
  reorganizar,
  temPosicoes,
} from '../src/lib/organizacao.ts'

const sessao = (key: string, cwd = 'D:\\x'): SessionView => ({
  key,
  sessionId: key,
  configDir: 'cfg',
  account: 'Pessoal',
  cwd,
  project: 'x',
  title: key,
  status: 'idle',
  updatedAt: 1_000_000,
  agents: [],
})
const snap = (sessions: SessionView[]): Snapshot => ({ generatedAt: 1_000_000, configDirs: ['cfg'], retentionMs: 0, sessions })
const opts = { expanded: new Set<string>(), endedWindowMs: 3_600_000, selectedId: null }
const caixa = (g: Graph, key: string) => g.caixas.get(key)!

function semSobreposicao(g: Graph) {
  const cs = [...g.caixas.values()]
  for (const [i, a] of cs.entries()) {
    for (const b of cs.slice(i + 1)) {
      const longe = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
      expect(longe).toBe(true)
    }
  }
}

describe('o lugar dos cards no mapa', () => {
  const tres = [sessao('a'), sessao('b'), sessao('c')]

  it('sem posições, o automático de sempre; com uma, o grupo inteiro passa a ser arrumado à mão', () => {
    const auto = buildGraph(snap(tres), { ...opts, organizacao: VAZIA })
    expect(auto.manuais.size).toBe(0)
    expect(caixa(auto, 'a')).toMatchObject({ grupo: SEM_GRUPO, x: 0, y: 0 })

    const org = posicionarSessoes(VAZIA, [{ chave: 'b', x: 900, y: 600, grupo: '' }])
    const g = buildGraph(snap(tres), { ...opts, organizacao: org })
    expect(g.manuais.has(SEM_GRUPO)).toBe(true)
    expect(caixa(g, 'b')).toMatchObject({ x: 900, y: 600 })
    // As que não têm lugar marcado vão para uma prateleira abaixo das marcadas.
    const fundo = 600 + caixa(g, 'b').h + SIZE.gapSession
    expect(caixa(g, 'a').y).toBe(fundo)
    expect(caixa(g, 'c').y).toBe(fundo)
    semSobreposicao(g)
  })

  it('o card que cai em cima de outro se encaixa ao lado (se estava mais à direita) ou embaixo', () => {
    const w = 400
    const h = 300
    const [a, b] = afastar([
      { x: 0, y: 0, box: { w, h } },
      { x: 300, y: 40, box: { w, h } },
    ])
    expect(a).toMatchObject({ x: 0, y: 0 })
    expect(b).toMatchObject({ x: w + SIZE.folga, y: 40 })
    const [, c] = afastar([
      { x: 0, y: 0, box: { w, h } },
      { x: 40, y: 200, box: { w, h } },
    ])
    expect(c).toMatchObject({ x: 40, y: h + SIZE.folga })
    // Em cadeia: empurrar um não deixa ele por cima de um terceiro.
    const empurrados = afastar([
      { x: 0, y: 0, box: { w, h } },
      { x: 0, y: 100, box: { w, h } },
      { x: 0, y: h + SIZE.folga, box: { w, h } },
    ])
    expect(empurrados.map((p) => p.y)).toEqual([0, h + SIZE.folga, 2 * (h + SIZE.folga)])
  })

  it('num grupo, a posição conta do canto do miolo da faixa, e nada fica antes dele', () => {
    let org = criarGrupo(VAZIA, 'Loja', 'loja').org
    org = moverSessao(org, 'a', 'loja')
    org = moverSessao(org, 'b', 'loja')
    org = posicionarSessoes(org, [
      { chave: 'a', x: 500, y: 40, grupo: 'loja' },
      { chave: 'b', x: -300, y: -80, grupo: 'loja' },
    ])
    const g = buildGraph(snap(tres), { ...opts, organizacao: org })
    const origem = g.origens.get('loja')!
    expect(caixa(g, 'a')).toMatchObject({ grupo: 'loja', x: origem.x + 500, y: origem.y + 40 })
    expect(caixa(g, 'b')).toMatchObject({ x: origem.x, y: origem.y })
    expect(g.manuais.has('loja')).toBe(true)
    expect(g.manuais.has(SEM_GRUPO)).toBe(false)
    // A faixa cresce para caber o card que foi para a direita.
    const faixa = g.nodes.find((n) => n.id === 'g:loja')!
    expect(faixa.width).toBeGreaterThanOrEqual(500 + caixa(g, 'a').w + 2 * SIZE.lanePad)
    semSobreposicao(g)
  })

  it('trocar de grupo apaga o lugar marcado no grupo antigo', () => {
    let org = criarGrupo(VAZIA, 'Loja', 'loja').org
    org = posicionarSessoes(org, [{ chave: 'a', x: 10, y: 20, grupo: '' }])
    expect(posicaoDaSessao(org, sessao('a'))).toEqual({ x: 10, y: 20 })
    const movida = moverSessao(org, 'a', 'loja')
    expect(posicaoDaSessao(movida, sessao('a'))).toBeNull()
    expect(movida.sessoes.a?.posicao).toBeUndefined()
    // Mover para o mesmo grupo não perde o lugar.
    expect(moverSessao(org, 'a', null).sessoes.a?.posicao).toEqual({ x: 10, y: 20, grupo: '' })
  })

  it('a posição vale só no grupo em que foi marcada (mesmo que o grupo mude pela regra da pasta)', () => {
    const org = posicionarSessoes(criarGrupo(VAZIA, 'Loja', 'loja').org, [{ chave: 'a', x: 10, y: 20, grupo: 'loja' }])
    expect(posicaoDaSessao(org, sessao('a'))).toBeNull()
  })

  it('"Reorganizar" tira todas as posições e guarda o resto', () => {
    let org = renomearSessao(VAZIA, 'a', 'Minha')
    org = posicionarSessoes(org, [
      { chave: 'a', x: 1, y: 2, grupo: '' },
      { chave: 'b', x: 3, y: 4, grupo: '' },
    ])
    expect(temPosicoes(org)).toBe(true)
    const limpa = reorganizar(org)
    expect(temPosicoes(limpa)).toBe(false)
    expect(limpa.sessoes).toEqual({ a: { nome: 'Minha' } })
    expect(reorganizar(limpa)).toBe(limpa)
  })

  it('apagar o grupo tira as posições marcadas nele', () => {
    let org = criarGrupo(VAZIA, 'Loja', 'loja').org
    org = moverSessao(org, 'a', 'loja')
    org = posicionarSessoes(org, [{ chave: 'a', x: 1, y: 2, grupo: 'loja' }])
    expect(apagarGrupo(org, 'loja').sessoes).toEqual({})
  })

  it('lê as posições do arquivo sem confiar nele', () => {
    const lido = normalizar({
      grupos: [{ id: 'a', nome: 'A' }],
      sessoes: {
        s1: { posicao: { x: 10.4, y: -3.6, grupo: 'a' } },
        s2: { posicao: { x: 'longe', y: 0, grupo: '' } },
        s3: { posicao: { x: 1, y: 2, grupo: 'sumiu' } },
        s4: { posicao: { x: 1, y: 2, grupo: '' } },
      },
    })
    expect(lido.sessoes).toEqual({ s1: { posicao: { x: 10, y: -4, grupo: 'a' } }, s4: { posicao: { x: 1, y: 2, grupo: '' } } })
  })
})

describe('o card arrastado', () => {
  it('anda inteiro (o card, os agentes e as ligações) e o resto do desenho fica igual', () => {
    const agentes = Array.from({ length: 12 }, (_, i) => ({
      id: `a${i}`,
      parentId: null,
      description: `a${i}`,
      agentType: 'general-purpose',
      status: 'running' as const,
      startedAt: 1,
      updatedAt: 2,
      depth: 1,
    }))
    const g = buildGraph(snap([{ ...sessao('a'), agents: agentes }, sessao('b')]), { ...opts, organizacao: VAZIA })
    const c = caixa(g, 'a')
    const movido = deslocarSessao(g, 'a', c.x + 100, c.y + 50)
    const antes = new Map(g.nodes.map((n) => [n.id, n]))
    for (const n of movido.nodes) {
      const velho = antes.get(n.id)!
      if (g.porSessao.get('a')!.nodes.includes(n.id)) {
        expect(n.position).toEqual({ x: velho.position.x + 100, y: velho.position.y + 50 })
        expect(n.zIndex).toBeGreaterThan(velho.zIndex ?? 0)
        // Sem transição (a classe), ainda medido (o React Flow não mede de novo) e com o mesmo data (o
        // conteúdo do nó não se redesenha a cada quadro).
        expect(n.className).toBe('is-arrastando')
        expect(n.measured).toEqual(velho.measured)
        expect(n.data).toBe(velho.data)
      } else expect(n).toBe(velho)
    }
    const ligacoesDeA = new Set(g.porSessao.get('a')!.edges)
    for (const e of movido.edges) {
      if (ligacoesDeA.has(e.id)) expect(e.className).toBe('is-arrastando')
      else expect(e).toBe(g.edges.find((v) => v.id === e.id))
    }
    // As ligações em pente (12 filhos, duas colunas) andam junto.
    const pente = g.edges.find((e) => e.data?.route?.laneK != null)!
    const pente2 = movido.edges.find((e) => e.id === pente.id)!
    expect(pente2.data?.route).toEqual({
      lane0: pente.data!.route!.lane0 + 100,
      busY: pente.data!.route!.busY + 50,
      laneK: pente.data!.route!.laneK! + 100,
    })
    expect(deslocarSessao(g, 'sumiu', 0, 0)).toBe(g)
  })

  it('todo nó já nasce medido, com a largura e a altura do layout', () => {
    const agentes = [{ id: 'r', parentId: null, description: 'r', agentType: 'Explore', status: 'done' as const, startedAt: 1, updatedAt: 2, depth: 1 }]
    const org = moverSessao(criarGrupo(VAZIA, 'Loja', 'loja').org, 'a', 'loja')
    const g = buildGraph(snap([{ ...sessao('a'), agents: agentes }, sessao('b')]), { ...opts, organizacao: org })
    expect(g.nodes.length).toBeGreaterThan(4)
    for (const n of g.nodes) expect(n.measured).toEqual({ width: n.width, height: n.height })
  })

  it('a ordem dos nós e das ligações não muda quando uma sessão troca de grupo (o card desliza, não pula)', () => {
    const filhos = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `f${i}`, parentId: null, description: `f${i}`, agentType: 'Explore', status: 'done' as const, startedAt: 1, updatedAt: 2, depth: 1 }))
    const sessoes = [{ ...sessao('a'), agents: filhos(3) }, { ...sessao('b'), agents: filhos(2) }, sessao('c')]
    let org = criarGrupo(VAZIA, 'Loja', 'loja').org
    org = criarGrupo(org, 'Blog', 'blog').org
    org = moverSessao(moverSessao(org, 'a', 'loja'), 'b', 'blog')
    const antes = buildGraph(snap(sessoes), { ...opts, organizacao: org })
    // "a" vai para o fim do Blog e o Blog sobe para antes da Loja: no desenho, tudo troca de lugar.
    const depois = buildGraph(snap(sessoes), { ...opts, organizacao: moverSessao({ ...org, grupos: [...org.grupos].reverse() }, 'a', 'blog') })
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id)
    expect(ids(depois.nodes)).toEqual(ids(antes.nodes))
    expect(ids(depois.edges)).toEqual(ids(antes.edges))
    expect(caixa(depois, 'a')).not.toEqual(caixa(antes, 'a'))
    // As faixas vêm primeiro (o minimapa desenha na ordem da lista).
    const primeiroNaoFaixa = antes.nodes.findIndex((n) => n.type !== 'lane')
    expect(antes.nodes.slice(0, primeiroNaoFaixa).every((n) => n.type === 'lane')).toBe(true)
    expect(antes.nodes.slice(primeiroNaoFaixa).some((n) => n.type === 'lane')).toBe(false)
  })

  it('o grupo sob o ponteiro acende sem refazer o resto do desenho', () => {
    let org = criarGrupo(VAZIA, 'Loja', 'loja').org
    org = criarGrupo(org, 'Blog', 'blog').org
    org = moverSessao(org, 'a', 'loja')
    const g = buildGraph(snap([sessao('a'), sessao('b')]), { ...opts, organizacao: org })
    const acesas = (x: Graph) => x.nodes.filter((n) => n.type === 'lane' && n.data.alvo).map((n) => n.id)
    expect(acesas(g)).toEqual([])
    expect(marcarAlvo(g, null)).toBe(g)

    const naLoja = marcarAlvo(g, 'loja')
    expect(acesas(naLoja)).toEqual(['g:loja'])
    naLoja.nodes.forEach((n, i) => (n.id === 'g:loja' ? expect(n).not.toBe(g.nodes[i]) : expect(n).toBe(g.nodes[i])))
    expect(naLoja.edges).toBe(g.edges)
    expect(marcarAlvo(naLoja, 'loja')).toBe(naLoja)

    // Trocar de grupo apaga um e acende o outro; "sem grupo" também é alvo.
    const semGrupo = marcarAlvo(naLoja, SEM_GRUPO)
    expect(acesas(semGrupo)).toEqual([`g:${SEM_GRUPO}`])
    semGrupo.nodes.forEach((n, i) =>
      n.id === 'g:loja' || n.id === `g:${SEM_GRUPO}` ? expect(n).not.toBe(naLoja.nodes[i]) : expect(n).toBe(naLoja.nodes[i]),
    )
    expect(acesas(marcarAlvo(semGrupo, null))).toEqual([])
  })
})
