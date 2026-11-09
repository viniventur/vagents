// A visualização em lista: a mesma informação do mapa, como um explorador de arquivos. Grupos, dentro
// deles as sessões, dentro delas a árvore dos agentes (cada um com os que criou). As regras são as do
// mapa: os concluídos antigos dobram num "+N", as encerradas seguem a janela escolhida.

import type { AgentView, SessionView, Snapshot } from '../../shared/model.ts'
import {
  SEM_GRUPO,
  agentNodeId,
  collapse,
  countAgents,
  laneNodeId,
  mainNodeId,
  sessionNodeId,
  sessoesVisiveis,
  type Counts,
  type Selection,
  type StatusCounts,
} from '../layout.ts'
import { corDaSessao, grupoDaSessao, nomeDaSessao, type Grupo, type Organizacao } from './organizacao.ts'

/** Um nó da árvore de agentes de uma sessão: um agente (com os filhos dele) ou o "+N" de um pai. */
export type NoDaLista =
  | { tipo: 'agente'; id: string; agente: AgentView; filhos: NoDaLista[] }
  | { tipo: 'mais'; id: string; chave: string; escondidos: Counts; aberto: boolean }

export interface SessaoNaLista {
  id: string
  sessao: SessionView
  nome: string
  /** A cor que você deu ao card (null: a de sempre). */
  cor: string | null
  contagem: Counts
  agentes: NoDaLista[]
}

export interface SecaoDaLista {
  /** O id do grupo, ou SEM_GRUPO. */
  id: string
  grupo: Grupo | null
  contagem: StatusCounts
  sessoes: SessaoNaLista[]
}

export interface Lista {
  /** Sem grupos, uma seção só (a "sem grupo"), mostrada sem cabeçalho. */
  temGrupos: boolean
  secoes: SecaoDaLista[]
  sessoes: SessionView[]
  /** Há sessões de mais de uma conta: aí cada uma mostra a sua. */
  multiConfig: boolean
  /** O que cada linha abre no painel de detalhes (pelo mesmo id do mapa). */
  lookup: Map<string, Selection>
}

export interface OpcoesDaLista {
  endedWindowMs: number
  organizacao: Organizacao
  /** Os "+N" abertos (pela chave do pai, a mesma do mapa: `${sessão}|${pai ou "main"}`). */
  abertos: ReadonlySet<string>
}

function arvoreDaSessao(s: SessionView, abertos: ReadonlySet<string>, lookup: Map<string, Selection>): NoDaLista[] {
  const ids = new Set(s.agents.map((a) => a.id))
  const porPai = new Map<string | null, AgentView[]>()
  for (const a of s.agents) {
    const pai = a.parentId !== null && ids.has(a.parentId) ? a.parentId : null
    const lista = porPai.get(pai)
    if (lista) lista.push(a)
    else porPai.set(pai, [a])
  }
  const filhosDe = (pai: string | null): NoDaLista[] => {
    const lista = porPai.get(pai) ?? []
    const chave = `${s.key}|${pai ?? 'main'}`
    const aberto = abertos.has(chave)
    const { shown, hidden } = collapse(lista, aberto)
    const nos: NoDaLista[] = shown.map((agente) => {
      const id = agentNodeId(s.key, agente.id)
      lookup.set(id, { session: s, agent: agente })
      return { tipo: 'agente', id, agente, filhos: filhosDe(agente.id) }
    })
    const dobrados = aberto ? collapse(lista, false).hidden : hidden
    if (dobrados.length > 0) nos.push({ tipo: 'mais', id: `x:${chave}`, chave, escondidos: countAgents(dobrados), aberto })
    return nos
  }
  return filhosDe(null)
}

export function montarLista(snapshot: Snapshot, opts: OpcoesDaLista): Lista {
  const org = opts.organizacao
  const sessoes = sessoesVisiveis(snapshot, opts.endedWindowMs)
  const multiConfig = new Set(sessoes.map((s) => s.configDir)).size > 1
  const lookup = new Map<string, Selection>()
  const naLista = (s: SessionView): SessaoNaLista => {
    const id = sessionNodeId(s.key)
    lookup.set(id, { session: s })
    // O agente principal do mapa (selecionado lá) abre a mesma sessão aqui.
    lookup.set(mainNodeId(s.key), { session: s })
    return {
      id,
      sessao: s,
      nome: nomeDaSessao(org, s),
      cor: corDaSessao(org, s.key),
      contagem: countAgents(s.agents),
      agentes: arvoreDaSessao(s, opts.abertos, lookup),
    }
  }
  const contar = (lista: SessionView[]): StatusCounts => {
    const c: StatusCounts = { waiting: 0, running: 0, idle: 0, ended: 0 }
    for (const s of lista) c[s.status]++
    return c
  }

  if (org.grupos.length === 0) {
    const secoes = [{ id: SEM_GRUPO, grupo: null, contagem: contar(sessoes), sessoes: sessoes.map(naLista) }]
    return { temGrupos: false, sessoes, secoes, multiConfig, lookup }
  }
  const secoes: SecaoDaLista[] = [...org.grupos, null].map((grupo) => {
    const id = grupo?.id ?? SEM_GRUPO
    const doGrupo = sessoes.filter((s) => (grupoDaSessao(org, s) ?? SEM_GRUPO) === id)
    return { id, grupo, contagem: contar(doGrupo), sessoes: doGrupo.map(naLista) }
  })
  return { temGrupos: true, sessoes, secoes, multiConfig, lookup }
}

/**
 * Os ids de tudo o que pode recolher, para o "Recolher tudo": os grupos (quando há grupos), as sessões com
 * agentes e os agentes com filhos.
 */
export function idsRecolhiveis(lista: Lista): string[] {
  const ids: string[] = []
  const percorrer = (nos: NoDaLista[]) => {
    for (const no of nos) {
      if (no.tipo === 'agente' && no.filhos.length > 0) {
        ids.push(no.id)
        percorrer(no.filhos)
      }
    }
  }
  for (const secao of lista.secoes) {
    if (lista.temGrupos) ids.push(laneNodeId(secao.id))
    for (const s of secao.sessoes) {
      if (s.agentes.length > 0) ids.push(s.id)
      percorrer(s.agentes)
    }
  }
  return ids
}

// ---------------------------------------------------------------------------------------------------
// O que está recolhido. Só da lista (o mapa tem o dele): um padrão, tudo aberto ou tudo fechado, e as
// exceções a ele. Assim "Recolher tudo" vale também para o que aparecer depois.

export interface Dobras {
  fechadoPorPadrao: boolean
  /** Os que estão ao contrário do padrão. */
  invertidos: ReadonlySet<string>
}

export const TUDO_ABERTO: Dobras = { fechadoPorPadrao: false, invertidos: new Set() }
export const TUDO_FECHADO: Dobras = { fechadoPorPadrao: true, invertidos: new Set() }

export function estaAberto(d: Dobras, id: string): boolean {
  return d.fechadoPorPadrao === d.invertidos.has(id)
}

export function alternarDobra(d: Dobras, id: string): Dobras {
  const invertidos = new Set(d.invertidos)
  if (invertidos.has(id)) invertidos.delete(id)
  else invertidos.add(id)
  return { fechadoPorPadrao: d.fechadoPorPadrao, invertidos }
}

/** Abre os que estiverem fechados (para mostrar uma sessão pedida). */
export function abrirDobras(d: Dobras, ids: string[]): Dobras {
  const fechados = ids.filter((id) => !estaAberto(d, id))
  if (fechados.length === 0) return d
  const invertidos = new Set(d.invertidos)
  for (const id of fechados) {
    if (d.fechadoPorPadrao) invertidos.add(id)
    else invertidos.delete(id)
  }
  return { fechadoPorPadrao: d.fechadoPorPadrao, invertidos }
}

/**
 * O que o botão "tudo" faz agora. Depois de um "Recolher tudo", ele oferece expandir; depois de um
 * "Expandir tudo" (e no começo), recolher. Se não sobrou nada para isso, oferece o contrário; sem nada
 * que recolha, null.
 */
export function acaoDoTudo(lista: Lista, d: Dobras): 'recolher' | 'expandir' | null {
  const ids = idsRecolhiveis(lista)
  if (ids.length === 0) return null
  const algumAberto = ids.some((id) => estaAberto(d, id))
  const algumFechado = ids.some((id) => !estaAberto(d, id))
  if (d.fechadoPorPadrao) return algumFechado ? 'expandir' : 'recolher'
  return algumAberto ? 'recolher' : 'expandir'
}

/** Uma linha à mostra dentro de uma seção. */
export type Linha =
  | { tipo: 'sessao'; id: string; nivel: number; pai: null; sessao: SessaoNaLista; temFilhos: boolean; aberto: boolean }
  | { tipo: 'agente'; id: string; nivel: number; pai: string; sessao: SessaoNaLista; agente: AgentView; temFilhos: boolean; aberto: boolean }
  | { tipo: 'mais'; id: string; nivel: number; pai: string; sessao: SessaoNaLista; chave: string; escondidos: Counts; aberto: boolean }

/** As linhas de uma seção aberta, na ordem da tela, só as que as dobras deixam à mostra. */
export function linhasDaSecao(secao: SecaoDaLista, d: Dobras): Linha[] {
  const linhas: Linha[] = []
  const descer = (nos: NoDaLista[], nivel: number, pai: string, s: SessaoNaLista) => {
    for (const no of nos) {
      if (no.tipo === 'mais') {
        linhas.push({ tipo: 'mais', id: no.id, nivel, pai, sessao: s, chave: no.chave, escondidos: no.escondidos, aberto: no.aberto })
        continue
      }
      const temFilhos = no.filhos.length > 0
      const aberto = temFilhos && estaAberto(d, no.id)
      linhas.push({ tipo: 'agente', id: no.id, nivel, pai, sessao: s, agente: no.agente, temFilhos, aberto })
      if (aberto) descer(no.filhos, nivel + 1, no.id, s)
    }
  }
  for (const s of secao.sessoes) {
    const temFilhos = s.agentes.length > 0
    const aberto = temFilhos && estaAberto(d, s.id)
    linhas.push({ tipo: 'sessao', id: s.id, nivel: 0, pai: null, sessao: s, temFilhos, aberto })
    if (aberto) descer(s.agentes, 1, s.id, s)
  }
  return linhas
}
