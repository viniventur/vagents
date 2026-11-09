import type { Edge, Node } from '@xyflow/react'
import type { AgentStatus, AgentView, SessionStatus, SessionView, Snapshot } from '../shared/model.ts'
import { VAZIA, corDaSessao, grupoDaSessao, nomeDaSessao, posicaoDaSessao, type Grupo, type Organizacao } from './lib/organizacao.ts'

/** Medidas fixas (em pixels do canvas) usadas no layout e nos componentes. */
export const SIZE = {
  pad: 20,
  head: 124,
  mainW: 300,
  mainH: 116,
  agentW: 276,
  agentH: 98,
  moreW: 276,
  moreH: 46,
  /** O cabeçalho de um grupo, o respiro dentro dele e o espaço entre um grupo e o próximo. */
  laneHead: 64,
  lanePad: 24,
  laneGap: 36,
  /** A altura do miolo de um grupo vazio (o "arraste sessões para cá"). */
  laneEmpty: 96,
  /** Entre o pai e a coluna dos filhos. */
  gapX: 64,
  /** Entre irmãos. */
  gapY: 12,
  /** Entre colunas de irmãos, quando não cabem numa só. */
  gapCol: 28,
  /** Mínimo de filhos por coluna; com muitos, a coluna cresce para o bloco ficar mais quadrado. */
  perCol: 10,
  /** A faixa acima das colunas por onde passa o barramento, quando há mais de uma coluna. */
  bus: 28,
  minSessionW: 400,
  gapSession: 48,
  /** Concluídos que continuam à mostra antes de recolher o resto. */
  recentDone: 3,
  /** Entre os cards arrumados à mão, quando um empurra o outro. */
  folga: 24,
} as const

export interface Counts {
  running: number
  done: number
  interrupted: number
}

export type SessionNodeData = {
  session: SessionView
  nome: string
  selected: boolean
  multiConfig: boolean
  /** A cor que você deu ao card (null: a de sempre). */
  cor: string | null
}

/** Quantas sessões de cada estado. */
export type StatusCounts = Record<SessionStatus, number>

/** Um grupo (ou o "sem grupo", com grupo null) como faixa do canvas. */
export type LaneNodeData = {
  grupo: Grupo | null
  contagem: StatusCounts
  total: number
  /** É para onde a sessão arrastada vai se você soltar agora. */
  alvo: boolean
  editando: boolean
  primeiro: boolean
  ultimo: boolean
}
export type MainNodeData = { session: SessionView; counts: Counts; selected: boolean }
export type AgentNodeData = { agent: AgentView; sessionKey: string; selected: boolean }
export type MoreNodeData = { groupKey: string; sessionKey: string; hidden: Counts; total: number; expanded: boolean }

/**
 * Com os filhos em várias colunas, a ligação vira um "pente": sai do pai até a pista lane0,
 * sobe ao barramento (busY), corre até o corredor da coluna do filho (laneK) e desce até ele.
 * Na primeira coluna (laneK null) desce direto pela lane0.
 */
export type EdgeRoute = { lane0: number; busY: number; laneK: number | null }
export type FlowEdgeData = { status: AgentStatus | 'more'; route?: EdgeRoute }

export type SessionFlowNode = Node<SessionNodeData, 'session'>
export type MainFlowNode = Node<MainNodeData, 'main'>
export type AgentFlowNode = Node<AgentNodeData, 'agent'>
export type MoreFlowNode = Node<MoreNodeData, 'more'>
export type LaneFlowNode = Node<LaneNodeData, 'lane'>
export type FlowNode = SessionFlowNode | MainFlowNode | AgentFlowNode | MoreFlowNode | LaneFlowNode
export type FlowEdge = Edge<FlowEdgeData, 'flow'>

export interface GraphOptions {
  expanded: ReadonlySet<string>
  /** Sessões encerradas há mais tempo que isso ficam de fora (0: nenhuma encerrada). */
  endedWindowMs: number
  selectedId: string | null
  organizacao?: Organizacao
  /** O grupo com o nome em edição. */
  editandoGrupo?: string | null
}

/** O alvo "sem grupo" do arraste. */
export const SEM_GRUPO = '__sem-grupo__'

/** A área de uma faixa no canvas, para saber onde a sessão arrastada foi solta. */
export interface AreaDoGrupo {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface Selection {
  session: SessionView
  agent?: AgentView
}

/** Onde o card de uma sessão ficou no canvas, e em que faixa (o id do grupo, ou SEM_GRUPO). */
export interface CaixaDaSessao {
  grupo: string
  x: number
  y: number
  w: number
  h: number
}

export interface Graph {
  nodes: FlowNode[]
  edges: FlowEdge[]
  sessions: SessionView[]
  /** Muda quando entra ou sai sessão, ou o desenho muda de tamanho: hora de reenquadrar. */
  boundsKey: string
  lookup: Map<string, Selection>
  /** As faixas dos grupos (vazio quando não há grupos). */
  areas: AreaDoGrupo[]
  /** O card de cada sessão à mostra, pela chave da sessão. */
  caixas: Map<string, CaixaDaSessao>
  /** O canto do miolo de cada faixa aberta (sem grupos, só SEM_GRUPO, em 0,0): as posições contam daqui. */
  origens: Map<string, { x: number; y: number }>
  /** As faixas com cards arrumados à mão. */
  manuais: Set<string>
  /** Os nós e as ligações de cada sessão, para o card andar inteiro no arraste. */
  porSessao: Map<string, { nodes: string[]; edges: string[] }>
}

export const sessionNodeId = (key: string) => `s:${key}`
export const laneNodeId = (id: string) => `g:${id}`
export const mainNodeId = (key: string) => `m:${key}`
export const agentNodeId = (key: string, id: string) => `a:${key}:${id}`
const moreNodeId = (groupKey: string) => `x:${groupKey}`

/**
 * Os filhos de um mesmo pai, do mais recente ao mais antigo: os que estão rodando primeiro (o que
 * começou por último em cima), depois os que terminaram, do que terminou por último ao mais antigo.
 */
export function porRecencia(list: AgentView[]): AgentView[] {
  const rodando = (a: AgentView) => a.status === 'running'
  return [...list].sort((a, b) => {
    if (rodando(a) !== rodando(b)) return rodando(a) ? -1 : 1
    const quando = (x: AgentView) => (rodando(x) ? (x.startedAt ?? x.updatedAt) : x.updatedAt)
    return quando(b) - quando(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}

/** O que fica à mostra entre os filhos de um mesmo pai (em ordem de recência), e o que vai para o "+N". */
export function collapse(list: AgentView[], expanded: boolean): { shown: AgentView[]; hidden: AgentView[] } {
  const ordem = porRecencia(list)
  if (expanded) return { shown: ordem, hidden: [] }
  const rodando = ordem.filter((a) => a.status === 'running')
  const rest = ordem.filter((a) => a.status !== 'running')
  let keep = rest.slice(0, SIZE.recentDone)
  let hidden = rest.slice(SIZE.recentDone)
  if (hidden.length === 1) {
    // Um "+1" ocupa o mesmo espaço que o próprio subagente.
    keep = rest
    hidden = []
  }
  return { shown: [...rodando, ...keep], hidden }
}

export function countAgents(agents: AgentView[]): Counts {
  const counts: Counts = { running: 0, done: 0, interrupted: 0 }
  for (const a of agents) counts[a.status]++
  return counts
}

interface Item {
  node: FlowNode
  w: number
  h: number
  children: Item[]
  /** O estado da ligação que chega neste item. */
  edge?: FlowEdgeData['status']
}

interface Measure {
  w: number
  h: number
  columns: { items: Item[]; w: number; h: number }[]
  /** Mais de uma coluna: filhos alinhados no topo, com o barramento por cima. */
  comb: boolean
}

/** Quantos filhos por coluna: nunca menos que SIZE.perCol; com muitos, ~ raiz de 2,5·n. */
export function perColumn(n: number): number {
  return Math.max(SIZE.perCol, Math.ceil(Math.sqrt(n * 2.5)))
}

function measure(item: Item, memo: Map<Item, Measure>): Measure {
  const cached = memo.get(item)
  if (cached) return cached
  const per = perColumn(item.children.length)
  const columns: Measure['columns'] = []
  for (let i = 0; i < item.children.length; i += per) {
    const items = item.children.slice(i, i + per)
    let w = 0
    let h = 0
    for (const child of items) {
      const m = measure(child, memo)
      w = Math.max(w, m.w)
      h += m.h
    }
    h += SIZE.gapY * (items.length - 1)
    columns.push({ items, w, h })
  }
  let result: Measure
  if (columns.length === 0) result = { w: item.w, h: item.h, columns, comb: false }
  else {
    const comb = columns.length > 1
    const childrenW = columns.reduce((sum, c) => sum + c.w, 0) + SIZE.gapCol * (columns.length - 1)
    const childrenH = Math.max(...columns.map((c) => c.h))
    const h = comb ? SIZE.bus + Math.max(item.h, childrenH) : Math.max(item.h, childrenH)
    result = { w: item.w + SIZE.gapX + childrenW, h, columns, comb }
  }
  memo.set(item, result)
  return result
}

/** Põe o item e a subárvore dele no bloco que começa em (x, y). */
function place(item: Item, x: number, y: number, memo: Map<Item, Measure>, nodes: FlowNode[], edges: FlowEdge[]): void {
  const m = measure(item, memo)
  // Numa coluna só, o pai fica no meio dos filhos; no pente, alinhado com a primeira linha.
  item.node.position = { x, y: m.comb ? y + SIZE.bus : y + (m.h - item.h) / 2 }
  nodes.push(item.node)
  const lane0 = x + item.w + SIZE.gapX / 2
  const busY = y + SIZE.bus / 2
  let cx = x + item.w + SIZE.gapX
  m.columns.forEach((column, k) => {
    let cy = m.comb ? y + SIZE.bus : y + (m.h - column.h) / 2
    for (const child of column.items) {
      const cm = measure(child, memo)
      place(child, cx, cy, memo, nodes, edges)
      const data: FlowEdgeData = { status: child.edge ?? 'done' }
      if (m.comb) data.route = { lane0, busY, laneK: k === 0 ? null : cx - SIZE.gapCol / 2 }
      edges.push({
        id: `e:${item.node.id}>${child.node.id}`,
        source: item.node.id,
        target: child.node.id,
        type: 'flow',
        data,
        zIndex: 2,
      })
      cy += cm.h + SIZE.gapY
    }
    cx += column.w + SIZE.gapCol
  })
}

/** Um caminho ortogonal pelos pontos dados, com as curvas arredondadas. */
export function roundedPath(points: [number, number][], radius = 10): string {
  const pts: [number, number][] = []
  for (const p of points) {
    const last = pts[pts.length - 1]
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    const prev = pts[pts.length - 2]
    // Três pontos na mesma reta: o do meio sobra.
    if (prev && last && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) pts.pop()
    pts.push(p)
  }
  const first = pts[0]
  if (!first) return ''
  let d = `M ${first[0]} ${first[1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1] as [number, number]
    const [cx, cy] = pts[i] as [number, number]
    const [nx, ny] = pts[i + 1] as [number, number]
    const inLen = Math.hypot(cx - px, cy - py)
    const outLen = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const ax = cx - ((cx - px) / inLen) * r
    const ay = cy - ((cy - py) / inLen) * r
    const bx = cx + ((nx - cx) / outLen) * r
    const by = cy + ((ny - cy) / outLen) * r
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`
  }
  const last = pts[pts.length - 1] as [number, number]
  if (pts.length > 1) d += ` L ${last[0]} ${last[1]}`
  return d
}

export function combPath(sx: number, sy: number, tx: number, ty: number, r: EdgeRoute): string {
  const points: [number, number][] =
    r.laneK === null
      ? [
          [sx, sy],
          [r.lane0, sy],
          [r.lane0, ty],
          [tx, ty],
        ]
      : [
          [sx, sy],
          [r.lane0, sy],
          [r.lane0, r.busY],
          [r.laneK, r.busY],
          [r.laneK, ty],
          [tx, ty],
        ]
  return roundedPath(points)
}

function sessionTree(s: SessionView, opts: GraphOptions, lookup: Map<string, Selection>): Item {
  const ids = new Set(s.agents.map((a) => a.id))
  const byParent = new Map<string | null, AgentView[]>()
  for (const a of s.agents) {
    const parent = a.parentId !== null && ids.has(a.parentId) ? a.parentId : null
    const list = byParent.get(parent)
    if (list) list.push(a)
    else byParent.set(parent, [a])
  }

  const childrenOf = (parentId: string | null): Item[] => {
    const list = byParent.get(parentId) ?? []
    const groupKey = `${s.key}|${parentId ?? 'main'}`
    const expanded = opts.expanded.has(groupKey)
    const { shown, hidden } = collapse(list, expanded)
    const items: Item[] = shown.map((agent) => {
      const id = agentNodeId(s.key, agent.id)
      lookup.set(id, { session: s, agent })
      return {
        node: {
          id,
          type: 'agent',
          position: { x: 0, y: 0 },
          data: { agent, sessionKey: s.key, selected: opts.selectedId === id },
          width: SIZE.agentW,
          height: SIZE.agentH,
          zIndex: 3,
        },
        w: SIZE.agentW,
        h: SIZE.agentH,
        children: childrenOf(agent.id),
        edge: agent.status,
      }
    })
    const collapsible = expanded ? collapse(list, false).hidden.length > 0 : hidden.length > 0
    if (collapsible) {
      items.push({
        node: {
          id: moreNodeId(groupKey),
          type: 'more',
          position: { x: 0, y: 0 },
          data: {
            groupKey,
            sessionKey: s.key,
            hidden: countAgents(expanded ? collapse(list, false).hidden : hidden),
            total: list.length,
            expanded,
          },
          width: SIZE.moreW,
          height: SIZE.moreH,
          zIndex: 3,
        },
        w: SIZE.moreW,
        h: SIZE.moreH,
        children: [],
        edge: 'more',
      })
    }
    return items
  }

  const id = mainNodeId(s.key)
  lookup.set(id, { session: s })
  return {
    node: {
      id,
      type: 'main',
      position: { x: 0, y: 0 },
      data: { session: s, counts: countAgents(s.agents), selected: opts.selectedId === id },
      width: SIZE.mainW,
      height: SIZE.mainH,
      zIndex: 3,
    },
    w: SIZE.mainW,
    h: SIZE.mainH,
    children: childrenOf(null),
  }
}

/** As sessões à mostra: as abertas e as encerradas dentro da janela escolhida (0: nenhuma encerrada). */
export function sessoesVisiveis(snapshot: Snapshot, endedWindowMs: number): SessionView[] {
  return snapshot.sessions.filter(
    (s) => s.status !== 'ended' || (endedWindowMs > 0 && snapshot.generatedAt - s.updatedAt <= endedWindowMs),
  )
}

/** Monta os nós e as ligações: uma caixa por sessão, com a árvore de agentes dentro. */
export function buildGraph(snapshot: Snapshot, opts: GraphOptions): Graph {
  const sessions = sessoesVisiveis(snapshot, opts.endedWindowMs)
  const org = opts.organizacao ?? VAZIA
  const multiConfig = new Set(sessions.map((s) => s.configDir)).size > 1
  const lookup = new Map<string, Selection>()

  const boxes: Box[] = sessions.map((s) => {
    const tree = sessionTree(s, opts, lookup)
    const memo = new Map<Item, Measure>()
    const m = measure(tree, memo)
    const w = Math.max(SIZE.minSessionW, m.w + 2 * SIZE.pad)
    const h = SIZE.head + m.h + SIZE.pad
    return { s, tree, memo, w, h, ended: s.status === 'ended' }
  })

  // A largura das prateleiras: perto da proporção da tela, para o enquadramento não ficar minúsculo.
  const area = boxes.reduce((sum, b) => sum + (b.w + SIZE.gapSession) * (b.h + SIZE.gapSession), 0)
  const widest = boxes.reduce((max, b) => Math.max(max, b.w), 0)
  const rowLimit = Math.max(widest, Math.sqrt(area * 1.9), SIZE.minSessionW * 2 + SIZE.gapSession)
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const areas: AreaDoGrupo[] = []
  const caixas = new Map<string, CaixaDaSessao>()
  const origens = new Map<string, { x: number; y: number }>()
  const manuais = new Set<string>()
  const porSessao = new Map<string, { nodes: string[]; edges: string[] }>()

  const sessionNode = (box: Box, grupo: string, x: number, y: number) => {
    const id = sessionNodeId(box.s.key)
    lookup.set(id, { session: box.s })
    const n0 = nodes.length
    const e0 = edges.length
    nodes.push({
      id,
      type: 'session',
      position: { x, y },
      data: { session: box.s, nome: nomeDaSessao(org, box.s), selected: opts.selectedId === id, multiConfig, cor: corDaSessao(org, box.s.key) },
      width: box.w,
      height: box.h,
      zIndex: 1,
    })
    place(box.tree, x + SIZE.pad, y + SIZE.head, box.memo, nodes, edges)
    caixas.set(box.s.key, { grupo, x, y, w: box.w, h: box.h })
    porSessao.set(box.s.key, { nodes: nodes.slice(n0).map((n) => n.id), edges: edges.slice(e0).map((e) => e.id) })
  }

  let totalW: number
  let totalH: number
  if (org.grupos.length === 0) {
    // Sem grupos: as sessões direto no canvas, sem faixa nenhuma (e as posições contam do 0,0).
    const arranjo = arranjar(boxes, (s) => posicaoDaSessao(org, s), rowLimit)
    for (const { box, x, y } of arranjo.placed) sessionNode(box, SEM_GRUPO, x, y)
    origens.set(SEM_GRUPO, { x: 0, y: 0 })
    if (arranjo.manual) manuais.add(SEM_GRUPO)
    totalW = arranjo.maxX - arranjo.minX
    totalH = arranjo.maxY - arranjo.minY
  } else {
    const porGrupo = new Map<string, Box[]>()
    for (const box of boxes) {
      const id = grupoDaSessao(org, box.s) ?? SEM_GRUPO
      const lista = porGrupo.get(id)
      if (lista) lista.push(box)
      else porGrupo.set(id, [box])
    }
    // Dentro de uma faixa, nada fica antes do canto do miolo (por cima do cabeçalho ou fora dela).
    const naFaixa = (s: SessionView) => {
      const p = posicaoDaSessao(org, s)
      return p && { x: Math.max(0, p.x), y: Math.max(0, p.y) }
    }
    const faixas = [...org.grupos, null].map((grupo: Grupo | null) => {
      const id = grupo?.id ?? SEM_GRUPO
      const doGrupo = porGrupo.get(id) ?? []
      const arranjo = grupo?.recolhido || doGrupo.length === 0 ? null : arranjar(doGrupo, naFaixa, rowLimit)
      return { grupo, id, doGrupo, arranjo }
    })
    const laneW = Math.max(rowLimit, ...faixas.map((f) => f.arranjo?.maxX ?? 0)) + 2 * SIZE.lanePad
    let y = 0
    faixas.forEach(({ grupo, id, doGrupo, arranjo }, i) => {
      const contagem: StatusCounts = { waiting: 0, running: 0, idle: 0, ended: 0 }
      for (const b of doGrupo) contagem[b.s.status]++
      const origem = { x: SIZE.lanePad, y: y + SIZE.laneHead }
      if (!grupo?.recolhido) origens.set(id, origem)
      let miolo: number
      if (grupo?.recolhido) miolo = 0
      else if (!arranjo) miolo = SIZE.laneEmpty
      else {
        for (const p of arranjo.placed) sessionNode(p.box, id, origem.x + p.x, origem.y + p.y)
        if (arranjo.manual) manuais.add(id)
        miolo = arranjo.maxY + SIZE.lanePad
      }
      const h = SIZE.laneHead + miolo
      nodes.push({
        id: laneNodeId(id),
        type: 'lane',
        position: { x: 0, y },
        data: {
          grupo,
          contagem,
          total: doGrupo.length,
          alvo: false,
          editando: grupo !== null && opts.editandoGrupo === grupo.id,
          primeiro: i === 0,
          ultimo: i === org.grupos.length - 1,
        },
        width: laneW,
        height: h,
        zIndex: 0,
      })
      areas.push({ id, x: 0, y, w: laneW, h })
      y += h + SIZE.laneGap
    })
    totalW = laneW
    totalH = y - SIZE.laneGap
  }

  // Todo nó tem largura e altura fixas, então já nasce medido. Sem isso, o React Flow trata cada nó novo
  // (o mapa é refeito a cada retrato, e a cada quadro do arraste) como nunca medido: esquece onde ficam
  // os pontos de ligação, as ligações somem até ele medir de novo e não dá para animá-las.
  for (const n of nodes) n.measured = { width: n.width, height: n.height }

  // A ordem da lista é a ordem no DOM, e tem de ser estável: o React move o elemento de um nó que mudou
  // de posição na lista, e o navegador não anima um elemento movido (o card que troca de grupo pularia
  // para o lugar novo, em vez de deslizar, e as ligações dele junto). Então as faixas vão primeiro (o
  // minimapa desenha na ordem da lista, sem olhar o zIndex) e depois os nós e as ligações de cada sessão,
  // as sessões pela chave, que não muda quando a sessão troca de grupo ou de lugar.
  const ordem = new Map<string, string>()
  for (const n of nodes) if (n.type === 'lane') ordem.set(n.id, `0${n.id}`)
  for (const [chave, dela] of porSessao) for (const id of [...dela.nodes, ...dela.edges]) ordem.set(id, `1${chave}\u0000${id}`)
  const naOrdem = (a: { id: string }, b: { id: string }) => {
    const x = ordem.get(a.id) ?? a.id
    const y = ordem.get(b.id) ?? b.id
    return x < y ? -1 : x > y ? 1 : 0
  }

  return {
    nodes: nodes.sort(naOrdem),
    edges: edges.sort(naOrdem),
    sessions,
    boundsKey: `${sessions.map((s) => s.key).join(',')}|${org.grupos.map((g) => g.id).join(',')}|${Math.round(totalW)}x${Math.round(totalH)}`,
    lookup,
    areas,
    caixas,
    origens,
    manuais,
    porSessao,
  }
}

/**
 * Acende o grupo onde a sessão arrastada cairia agora (`alvo`: o id do grupo, ou SEM_GRUPO). Fica fora
 * do buildGraph porque o alvo muda no meio do arraste: só as faixas que acendem ou apagam viram objetos
 * novos, e o resto do desenho não é refeito.
 */
export function marcarAlvo(graph: Graph, alvo: string | null): Graph {
  const faixa = alvo === null ? null : laneNodeId(alvo)
  let mudou = false
  const nodes = graph.nodes.map((n) => {
    if (n.type !== 'lane' || n.data.alvo === (n.id === faixa)) return n
    mudou = true
    return { ...n, data: { ...n.data, alvo: n.id === faixa } }
  })
  return mudou ? { ...graph, nodes } : graph
}

/**
 * O card da sessão `chave` com o canto em (x, y), enquanto você o arrasta: os nós e as ligações dele
 * andam juntos e ficam por cima dos outros; o resto do desenho continua igual (os mesmos objetos).
 * A classe is-arrastando tira a transição deles: o card fica colado no ponteiro.
 */
export function deslocarSessao(graph: Graph, chave: string, x: number, y: number): Graph {
  const caixa = graph.caixas.get(chave)
  const dela = graph.porSessao.get(chave)
  if (!caixa || !dela) return graph
  const dx = x - caixa.x
  const dy = y - caixa.y
  const nos = new Set(dela.nodes)
  const ligacoes = new Set(dela.edges)
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      nos.has(n.id)
        ? ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy }, zIndex: (n.zIndex ?? 0) + 10, className: 'is-arrastando' } as FlowNode)
        : n,
    ),
    edges: graph.edges.map((e) => {
      if (!ligacoes.has(e.id)) return e
      const r = e.data?.route
      const data = e.data && r ? { ...e.data, route: { lane0: r.lane0 + dx, busY: r.busY + dy, laneK: r.laneK === null ? null : r.laneK + dx } } : e.data
      return { ...e, data, zIndex: (e.zIndex ?? 0) + 10, className: 'is-arrastando' }
    }),
  }
}

interface Colocada {
  box: Box
  x: number
  y: number
}

interface Arranjo {
  placed: Colocada[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Algum card tem lugar marcado. */
  manual: boolean
}

/**
 * Os cards de uma faixa (ou do canvas todo, sem grupos). Sem nenhum lugar marcado, as prateleiras
 * automáticas. Com lugares marcados, cada card no seu; os que ainda não têm lugar (sessões novas) numa
 * prateleira abaixo de todos; e um card que cresceu, ou caiu por cima de outro, é empurrado.
 */
function arranjar(boxes: Box[], posicaoDe: (s: SessionView) => { x: number; y: number } | null, limite: number): Arranjo {
  const marcadas: Colocada[] = []
  const novas: Box[] = []
  for (const box of boxes) {
    const p = posicaoDe(box.s)
    if (p) marcadas.push({ box, x: p.x, y: p.y })
    else novas.push(box)
  }
  if (marcadas.length === 0) {
    const shelf = packShelves(boxes, limite)
    return { placed: shelf.placed, minX: 0, minY: 0, maxX: shelf.w, maxY: shelf.h, manual: false }
  }
  const placed = afastar(marcadas)
  if (novas.length > 0) {
    const x0 = Math.min(...placed.map((p) => p.x))
    const y0 = Math.max(...placed.map((p) => p.y + p.box.h)) + SIZE.gapSession
    for (const p of packShelves(novas, limite).placed) placed.push({ box: p.box, x: x0 + p.x, y: y0 + p.y })
  }
  return {
    placed,
    minX: Math.min(...placed.map((p) => p.x)),
    minY: Math.min(...placed.map((p) => p.y)),
    maxX: Math.max(...placed.map((p) => p.x + p.box.w)),
    maxY: Math.max(...placed.map((p) => p.y + p.box.h)),
    manual: true,
  }
}

/**
 * Tira as sobreposições sem mudar a ordem: de cima para baixo, o card que encosta num dos anteriores anda
 * para o lado (se estava mais à direita dele do que abaixo) ou para baixo. Assim o card que cresce empurra
 * o vizinho de baixo, ou o do lado, e o card solto por cima de outro se encaixa ao lado ou embaixo dele.
 */
export function afastar<T extends { x: number; y: number; box: { w: number; h: number } }>(cards: T[]): T[] {
  const ordem = cards.map((c) => ({ ...c })).sort((a, b) => a.y - b.y || a.x - b.x)
  const prontos: T[] = []
  for (const c of ordem) {
    for (let volta = 0; volta < 500; volta++) {
      const o = prontos.find((p) => c.x < p.x + p.box.w && p.x < c.x + c.box.w && c.y < p.y + p.box.h && p.y < c.y + c.box.h)
      if (!o) break
      if (c.x - o.x > c.y - o.y) c.x = o.x + o.box.w + SIZE.folga
      else c.y = o.y + o.box.h + SIZE.folga
    }
    prontos.push(c)
  }
  return prontos
}

interface Box {
  s: SessionView
  tree: Item
  memo: Map<Item, Measure>
  w: number
  h: number
  ended: boolean
}

/** Prateleiras: da esquerda para a direita até `limite`; as encerradas começam numa linha só delas. */
function packShelves(boxes: Box[], limite: number): { placed: { box: Box; x: number; y: number }[]; w: number; h: number } {
  const placed: { box: Box; x: number; y: number }[] = []
  let x = 0
  let y = 0
  let rowH = 0
  let w = 0
  let previousEnded = false
  for (const box of boxes) {
    const breakForEnded = box.ended && !previousEnded && x > 0
    if (x > 0 && (x + box.w > limite || breakForEnded)) {
      x = 0
      y += rowH + SIZE.gapSession
      rowH = 0
    }
    placed.push({ box, x, y })
    x += box.w + SIZE.gapSession
    w = Math.max(w, x - SIZE.gapSession)
    rowH = Math.max(rowH, box.h)
    previousEnded = box.ended
  }
  return { placed, w, h: y + rowH }
}

/** O grupo (ou SEM_GRUPO) cuja faixa contém o ponto do canvas. */
export function areaNoPonto(areas: AreaDoGrupo[], x: number, y: number): string | null {
  for (const a of areas) if (x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) return a.id
  return null
}
