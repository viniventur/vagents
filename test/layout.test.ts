import { describe, expect, it } from 'vitest'
import type { AgentView, SessionView, Snapshot } from '../shared/model.ts'
import { SEM_GRUPO, SIZE, areaNoPonto, buildGraph, collapse, perColumn, roundedPath } from '../src/layout.ts'
import { VAZIA, alternarRecolhido, criarGrupo, moverSessao } from '../src/lib/organizacao.ts'

const agent = (id: string, status: AgentView['status'], updatedAt: number, parentId: string | null = null): AgentView => ({
  id,
  parentId,
  description: id,
  agentType: 'general-purpose',
  status,
  startedAt: updatedAt - 1000,
  updatedAt,
  depth: parentId ? 2 : 1,
})

const session = (key: string, status: SessionView['status'], agents: AgentView[] = [], updatedAt = 1_000_000): SessionView => ({
  key,
  sessionId: key,
  configDir: 'cfg',
  account: 'Pessoal',
  cwd: 'D:\\x',
  project: 'x',
  title: key,
  status,
  updatedAt,
  agents,
})

const snap = (sessions: SessionView[]): Snapshot => ({ generatedAt: 1_000_000, configDirs: ['cfg'], retentionMs: 0, sessions })
const opts = { expanded: new Set<string>(), endedWindowMs: 3_600_000, selectedId: null }

describe('collapse', () => {
  it('mostra os que rodam e os 3 concluídos mais recentes; o resto vai para o "+N"', () => {
    const list = [agent('r1', 'running', 50), ...Array.from({ length: 6 }, (_, i) => agent(`d${i}`, 'done', i))]
    const { shown, hidden } = collapse(list, false)
    expect(shown.map((a) => a.id)).toEqual(['r1', 'd3', 'd4', 'd5'])
    expect(hidden.map((a) => a.id).sort()).toEqual(['d0', 'd1', 'd2'])
  })

  it('não cria um "+1"', () => {
    const list = Array.from({ length: 4 }, (_, i) => agent(`d${i}`, 'done', i))
    expect(collapse(list, false).hidden).toEqual([])
  })
})

describe('buildGraph', () => {
  it('deixa cada árvore dentro da sua caixa e as caixas sem se sobrepor', () => {
    const many = Array.from({ length: 12 }, (_, i) => agent(`a${i}`, i < 10 ? 'running' : 'done', i))
    const graph = buildGraph(
      snap([
        session('s1', 'running', many),
        session('s2', 'waiting', [agent('b', 'running', 1), agent('c', 'running', 2, 'b')]),
        session('s3', 'idle'),
      ]),
      opts,
    )
    const boxes = graph.nodes.filter((n) => n.type === 'session')
    expect(boxes).toHaveLength(3)
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.position.x + (a.width ?? 0) <= b.position.x ||
          b.position.x + (b.width ?? 0) <= a.position.x ||
          a.position.y + (a.height ?? 0) <= b.position.y ||
          b.position.y + (b.height ?? 0) <= a.position.y
        expect(apart).toBe(true)
      }
    }
    for (const node of graph.nodes) {
      if (node.type === 'session') continue
      const key = node.id.split(':')[1]
      const box = boxes.find((b) => b.id === `s:${key}`)!
      expect(node.position.x).toBeGreaterThanOrEqual(box.position.x)
      expect(node.position.y).toBeGreaterThanOrEqual(box.position.y + SIZE.head)
      expect(node.position.x + (node.width ?? 0)).toBeLessThanOrEqual(box.position.x + (box.width ?? 0))
      expect(node.position.y + (node.height ?? 0)).toBeLessThanOrEqual(box.position.y + (box.height ?? 0))
    }
    // O neto "c" se liga ao "b", não ao principal.
    expect(graph.edges.some((e) => e.source === 'a:s2:b' && e.target === 'a:s2:c')).toBe(true)
    // 12 à mostra: não cabem numa coluna de 10, e nenhum some.
    expect(graph.nodes.filter((n) => n.type === 'agent' && n.id.startsWith('a:s1:'))).toHaveLength(12)
    // Em duas colunas as ligações viram pente; numa coluna só, continuam curvas.
    const s1 = graph.edges.filter((e) => e.source === 'm:s1')
    expect(s1.every((e) => e.data?.route !== undefined)).toBe(true)
    expect(s1.filter((e) => e.data?.route?.laneK === null)).toHaveLength(10)
    expect(graph.edges.filter((e) => e.source === 'm:s2').every((e) => e.data?.route === undefined)).toBe(true)
  })

  it('com muitos filhos, as colunas crescem para o bloco não virar uma faixa', () => {
    expect(perColumn(4)).toBe(SIZE.perCol)
    expect(perColumn(109)).toBe(17)
  })

  it('o caminho do pente arredonda as curvas e ignora pontos repetidos', () => {
    expect(roundedPath([[0, 0], [10, 0], [10, 0], [20, 0]])).toBe('M 0 0 L 20 0')
    expect(roundedPath([[0, 0], [40, 0], [40, 40]], 10)).toBe('M 0 0 L 30 0 Q 40 0 40 10 L 40 40')
  })

  it('esconde as encerradas fora da janela escolhida', () => {
    const sessions = [session('nova', 'ended', [], 1_000_000 - 60_000), session('velha', 'ended', [], 1_000_000 - 7_200_000)]
    expect(buildGraph(snap(sessions), opts).sessions.map((s) => s.key)).toEqual(['nova'])
    expect(buildGraph(snap(sessions), { ...opts, endedWindowMs: 0 }).sessions).toEqual([])
  })
})

describe('grupos', () => {
  const tres = [session('s1', 'running'), session('s2', 'idle'), session('s3', 'waiting')]
  const comGrupos = () => {
    let org = criarGrupo(VAZIA, 'Trabalho', 'trab').org
    org = criarGrupo(org, 'Vazio', 'vaz').org
    org = moverSessao(org, 's1', 'trab')
    return moverSessao(org, 's3', 'trab')
  }

  it('cada sessão fica dentro da faixa do seu grupo; o resto vai para "sem grupo"', () => {
    const graph = buildGraph(snap(tres), { ...opts, organizacao: comGrupos() })
    // De cima para baixo, na ordem dos grupos (a ordem da lista é outra: é a do DOM, que fica estável).
    const faixas = graph.nodes.filter((n) => n.type === 'lane').sort((a, b) => a.position.y - b.position.y)
    expect(faixas.map((f) => f.id)).toEqual(['g:trab', 'g:vaz', `g:${SEM_GRUPO}`])
    const dentro = (sessaoId: string, faixaId: string) => {
      const s = graph.nodes.find((n) => n.id === sessaoId)!
      const f = faixas.find((n) => n.id === faixaId)!
      return (
        s.position.x >= f.position.x &&
        s.position.y >= f.position.y + SIZE.laneHead &&
        s.position.x + (s.width ?? 0) <= f.position.x + (f.width ?? 0) &&
        s.position.y + (s.height ?? 0) <= f.position.y + (f.height ?? 0)
      )
    }
    expect(dentro('s:s1', 'g:trab')).toBe(true)
    expect(dentro('s:s3', 'g:trab')).toBe(true)
    expect(dentro('s:s2', `g:${SEM_GRUPO}`)).toBe(true)
    // O grupo vazio continua lá, como alvo para arrastar.
    expect(faixas.find((f) => f.id === 'g:vaz')?.height).toBe(SIZE.laneHead + SIZE.laneEmpty)
    // As faixas não se sobrepõem.
    for (let i = 1; i < faixas.length; i++) {
      const a = faixas[i - 1]!
      expect(faixas[i]!.position.y).toBeGreaterThanOrEqual(a.position.y + (a.height ?? 0))
    }
  })

  it('o grupo recolhido mostra só o cabeçalho, com a contagem', () => {
    const graph = buildGraph(snap(tres), { ...opts, organizacao: alternarRecolhido(comGrupos(), 'trab') })
    expect(graph.nodes.some((n) => n.id === 's:s1')).toBe(false)
    const faixa = graph.nodes.find((n) => n.id === 'g:trab')!
    expect(faixa.height).toBe(SIZE.laneHead)
    expect(faixa.type === 'lane' && faixa.data.contagem).toEqual({ waiting: 1, running: 1, idle: 0, ended: 0 })
  })

  it('acha o grupo sob o ponto do arraste', () => {
    const graph = buildGraph(snap(tres), { ...opts, organizacao: comGrupos() })
    const vazio = graph.areas.find((a) => a.id === 'vaz')!
    expect(areaNoPonto(graph.areas, vazio.x + 10, vazio.y + 10)).toBe('vaz')
    expect(areaNoPonto(graph.areas, -50, -50)).toBeNull()
  })
})
