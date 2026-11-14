// O "Salvar como" e o "Imprimir": as sessões à mostra (ou uma só, pelo menu do painel) como documento.
// Daqui saem o Markdown e o JSON; o PNG, o PDF e a impressão desenham o mesmo documento (Documento.tsx).
// Tudo aqui é puro. Ao contrário do mapa e da lista, o documento traz todos os subagentes, sem "+N".

import type { AgentView, SessionView, Snapshot } from '../../shared/model.ts'
import { countAgents, porRecencia, sessoesVisiveis, type Counts, type StatusCounts } from '../layout.ts'
import { AGENT_STATUS, SESSION_STATUS, clock, duration, modelLabel, plural, relTime, resumeCommand, waitingReason } from '../text.ts'
import { corDaSessao, grupoDaSessao, nomeDaSessao, type Grupo, type Organizacao } from './organizacao.ts'

export type Formato = 'png' | 'pdf' | 'md' | 'json'

export const FORMATOS: { formato: Formato; rotulo: string; dica: string }[] = [
  { formato: 'png', rotulo: 'Imagem (PNG)', dica: 'Uma imagem só, com o tema de agora' },
  { formato: 'pdf', rotulo: 'PDF', dica: 'Páginas A4, com o tema de agora' },
  { formato: 'md', rotulo: 'Markdown (.md)', dica: 'Texto, para colar ou guardar' },
  { formato: 'json', rotulo: 'JSON', dica: 'Todos os dados, para outro programa' },
]

/** Um subagente na árvore do documento, já na ordem da tela (cada pai seguido dos filhos dele). */
export interface AgenteNoDocumento {
  agente: AgentView
  /** 0: criado pelo agente principal; 1: por um subagente; e assim por diante. */
  nivel: number
}

export interface SessaoNoDocumento {
  sessao: SessionView
  nome: string
  cor: string | null
  grupo: Grupo | null
  contagem: Counts
  agentes: AgenteNoDocumento[]
}

export interface SecaoNoDocumento {
  grupo: Grupo | null
  sessoes: SessaoNoDocumento[]
}

export interface Documento {
  geradoEm: number
  /** A chave da sessão, quando o documento é de uma sessão só. */
  sessao: string | null
  /** Há grupos: as sessões aparecem dentro deles (só no documento de todas). */
  temGrupos: boolean
  /** Há sessões de mais de uma conta: aí cada uma mostra a sua. */
  multiConfig: boolean
  total: number
  contagem: StatusCounts
  /** Só as seções com sessões. */
  secoes: SecaoNoDocumento[]
  configDirs: string[]
}

export interface OpcoesDoDocumento {
  /** A janela das encerradas, a mesma da tela. */
  endedWindowMs: number
  /** Uma sessão só (a chave dela); sem ela, todas as sessões à mostra. */
  sessao?: string | null
}

/** A árvore inteira dos subagentes, achatada: cada pai, logo depois os filhos dele, por recência. */
export function arvoreCompleta(agentes: AgentView[]): AgenteNoDocumento[] {
  const ids = new Set(agentes.map((a) => a.id))
  const porPai = new Map<string | null, AgentView[]>()
  for (const a of agentes) {
    const pai = a.parentId !== null && ids.has(a.parentId) ? a.parentId : null
    const lista = porPai.get(pai)
    if (lista) lista.push(a)
    else porPai.set(pai, [a])
  }
  const saida: AgenteNoDocumento[] = []
  const vistos = new Set<string>()
  const descer = (pai: string | null, nivel: number) => {
    for (const agente of porRecencia(porPai.get(pai) ?? [])) {
      if (vistos.has(agente.id)) continue // um ciclo no histórico não trava o documento
      vistos.add(agente.id)
      saida.push({ agente, nivel })
      descer(agente.id, nivel + 1)
    }
  }
  descer(null, 0)
  return saida
}

/** O documento das sessões à mostra (ou de uma só). null se a sessão pedida não está no retrato. */
export function montarDocumento(retrato: Snapshot, org: Organizacao, opts: OpcoesDoDocumento): Documento | null {
  const sessoes = opts.sessao
    ? retrato.sessions.filter((s) => s.key === opts.sessao)
    : sessoesVisiveis(retrato, opts.endedWindowMs)
  if (opts.sessao && sessoes.length === 0) return null

  const porId = new Map(org.grupos.map((g) => [g.id, g]))
  const noDocumento = (s: SessionView): SessaoNoDocumento => {
    const id = grupoDaSessao(org, s)
    return {
      sessao: s,
      nome: nomeDaSessao(org, s),
      cor: corDaSessao(org, s.key),
      grupo: id ? (porId.get(id) ?? null) : null,
      contagem: countAgents(s.agents),
      agentes: arvoreCompleta(s.agents),
    }
  }
  const contagem: StatusCounts = { waiting: 0, running: 0, idle: 0, ended: 0 }
  for (const s of sessoes) contagem[s.status]++

  const temGrupos = !opts.sessao && org.grupos.length > 0
  const secoes: SecaoNoDocumento[] = temGrupos
    ? [...org.grupos, null]
        .map((grupo) => ({
          grupo,
          sessoes: sessoes.filter((s) => (grupoDaSessao(org, s) ?? null) === (grupo?.id ?? null)).map(noDocumento),
        }))
        .filter((secao) => secao.sessoes.length > 0)
    : sessoes.length > 0
      ? [{ grupo: null, sessoes: sessoes.map(noDocumento) }]
      : []

  return {
    geradoEm: retrato.generatedAt,
    sessao: opts.sessao ?? null,
    temGrupos,
    multiConfig: new Set(sessoes.map((s) => s.configDir)).size > 1,
    total: sessoes.length,
    contagem,
    secoes,
    configDirs: retrato.configDirs,
  }
}

// ---------------------------------------------------------------------------------------------------
// Os textos que o documento desenhado e o Markdown dividem.

const ORDEM: SessionView['status'][] = ['waiting', 'running', 'idle', 'ended']

/** "3 sessões: 1 rodando · 1 parada · 1 encerrada". */
export function resumoDaContagem(doc: Documento): string {
  if (doc.total === 0) return 'Nenhuma sessão à mostra'
  const partes = ORDEM.filter((s) => doc.contagem[s] > 0).map((s) => `${doc.contagem[s]} ${SESSION_STATUS[s].toLowerCase()}`)
  return `${plural(doc.total, 'sessão', 'sessões')}: ${partes.join(' · ')}`
}

/** "Subagentes: 2 rodando · 3 concluídos" (ou "Sem subagentes"). */
export function resumoDosSubagentes(c: Counts): string {
  const partes: string[] = []
  if (c.running) partes.push(plural(c.running, 'rodando', 'rodando'))
  if (c.done) partes.push(plural(c.done, 'concluído', 'concluídos'))
  if (c.interrupted) partes.push(plural(c.interrupted, 'interrompido', 'interrompidos'))
  return partes.length ? partes.join(' · ') : 'nenhum'
}

/** Desde quando ela está no estado de agora (como no painel). */
export function desdeQuando(s: SessionView): number | undefined {
  return s.statusSince ?? (s.status === 'ended' ? s.updatedAt : undefined)
}

/** O que o agente principal está fazendo (ou fez por último). */
export function agoraNoDocumento(s: SessionView): string {
  if (s.status === 'waiting') return `Esperando ${waitingReason(s.waitingFor)}`
  return s.activity ?? (s.status === 'ended' ? 'Encerrada' : 'Sem atividade ainda')
}

/** O tempo de um subagente: até agora se roda, até o fim se terminou. */
export function tempoDoAgente(a: AgentView, agora: number): string {
  if (!a.startedAt) return ''
  return duration((a.status === 'running' ? agora : a.updatedAt) - a.startedAt)
}

/** O que um subagente faz agora ou como terminou ("Concluído há 3 min"). */
export function passoDoAgente(a: AgentView, agora: number): string {
  if (a.status === 'running') return a.activity ?? 'Começando…'
  const quando = relTime(a.updatedAt, agora)
  return quando ? `${AGENT_STATUS[a.status]} ${quando}` : AGENT_STATUS[a.status]
}

/** "14/11/2026, 15:36". */
export function dataEHora(at: number): string {
  return new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// ---------------------------------------------------------------------------------------------------
// O Markdown.

/** O texto livre (títulos, pedidos) sem virar formatação: escapa o que o Markdown leria como marca. */
export function escaparMd(texto: string): string {
  return texto
    .replace(/[\\`*_[\]<>|~]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([#+-])(?=\s|$)/gm, '$1\\$2')
    // "1." no começo da linha vira lista; o escape vai no ponto ("1\.").
    .replace(/^(\s*\d+)([.)])(?=\s|$)/gm, '$1\\$2')
}

/** Um trecho em código, com crases que não fecham antes da hora. */
export function codigoMd(texto: string): string {
  const maior = Math.max(0, ...[...texto.matchAll(/`+/g)].map((m) => m[0].length))
  const cerca = '`'.repeat(maior + 1)
  const folga = texto.startsWith('`') || texto.endsWith('`') ? ' ' : ''
  return `${cerca}${folga}${texto}${folga}${cerca}`
}

/** Um texto de várias linhas como citação. */
function citacaoMd(texto: string): string {
  return texto
    .trim()
    .split(/\r?\n/)
    .map((linha) => (linha.trim() ? `> ${escaparMd(linha)}` : '>'))
    .join('\n')
}

function sessaoEmMd(item: SessaoNoDocumento, doc: Documento, nivel: number): string {
  const s = item.sessao
  const agora = doc.geradoEm
  const h = '#'.repeat(nivel)
  const linhas: string[] = [`${h} ${escaparMd(item.nome)}`, '']
  const desde = desdeQuando(s)
  const estado = desde ? `${SESSION_STATUS[s.status]}, ${relTime(desde, agora)}` : SESSION_STATUS[s.status]

  const campos: [string, string | undefined][] = [
    ['Estado', estado],
    ['Título do Claude', item.nome !== s.title ? escaparMd(s.title) : undefined],
    ['Projeto', s.project ? escaparMd(s.project) : undefined],
    ['Pasta', s.cwd ? codigoMd(s.cwd) : undefined],
    ['Branch', s.gitBranch && s.gitBranch !== 'HEAD' ? codigoMd(s.gitBranch) : undefined],
    ['Grupo', doc.sessao && item.grupo ? escaparMd(item.grupo.nome) : undefined],
    ['Conta', `${escaparMd(s.account)} (${codigoMd(s.configDir)})`],
    ['Modelo', s.model ? modelLabel(s.model) : undefined],
    ['Permissões', s.permissionMode ? codigoMd(s.permissionMode) : undefined],
    ['Aberta em', s.startedAt ? clock(s.startedAt) : undefined],
    ['Processo', s.pid ? String(s.pid) : undefined],
    ['Sessão', codigoMd(s.sessionId)],
    ['Cor do card', item.cor ?? undefined],
  ]
  for (const [rotulo, valor] of campos) if (valor) linhas.push(`- **${rotulo}:** ${valor}`)
  linhas.push('')

  if (s.status === 'waiting') linhas.push(`**Esperando ${escaparMd(waitingReason(s.waitingFor))}.** Responda no terminal dessa sessão.`, '')
  linhas.push('**Seu último pedido**', '', s.lastPrompt ? citacaoMd(s.lastPrompt) : '_Nenhum registrado._', '')
  const rotuloDoAgora = s.status === 'running' || s.status === 'waiting' ? 'Agora' : 'Último passo'
  const quando = s.activityAt && s.status !== 'waiting' ? ` (${relTime(s.activityAt, agora)})` : ''
  linhas.push(`**${rotuloDoAgora}:** ${escaparMd(agoraNoDocumento(s))}${quando}`, '')

  if (item.agentes.length > 0) {
    linhas.push(`**Subagentes:** ${resumoDosSubagentes(item.contagem)}`, '')
    for (const { agente: a, nivel: n } of item.agentes) {
      const partes = [
        `${AGENT_STATUS[a.status]}`,
        `**${escaparMd(a.name ?? a.agentType)}**`,
        escaparMd(a.description),
        a.status === 'running' ? escaparMd(passoDoAgente(a, agora)) : undefined,
        tempoDoAgente(a, agora) || undefined,
        a.model ? modelLabel(a.model) : undefined,
      ].filter(Boolean)
      linhas.push(`${'  '.repeat(n)}- ${partes.join(' · ')}`)
    }
    linhas.push('')
  } else {
    linhas.push('**Subagentes:** nenhum', '')
  }

  if (s.status === 'ended') linhas.push('Para retomar (PowerShell):', '', '```powershell', resumeCommand(s), '```', '')
  return linhas.join('\n')
}

export function paraMarkdown(doc: Documento): string {
  const partes: string[] = []
  const unica = doc.sessao ? doc.secoes[0]?.sessoes[0] : undefined
  if (unica) {
    partes.push(`<!-- vAgents: uma sessão do Claude Code, ${dataEHora(doc.geradoEm)} -->`, '')
    partes.push(sessaoEmMd(unica, doc, 1))
    return `${partes.join('\n').trimEnd()}\n`
  }
  partes.push('# Sessões do Claude Code', '', `Gerado pelo vAgents em ${dataEHora(doc.geradoEm)}. ${resumoDaContagem(doc)}.`, '')
  if (doc.total === 0) partes.push('_Nenhuma sessão à mostra._', '')
  for (const secao of doc.secoes) {
    if (doc.temGrupos) {
      partes.push(`## ${escaparMd(secao.grupo?.nome ?? 'Sem grupo')}`, '', `_${plural(secao.sessoes.length, 'sessão', 'sessões')}_`, '')
    }
    for (const item of secao.sessoes) partes.push(sessaoEmMd(item, doc, doc.temGrupos ? 3 : 2))
  }
  return `${partes.join('\n').trimEnd()}\n`
}

// ---------------------------------------------------------------------------------------------------
// O JSON: os campos do retrato como o app os lê (em inglês, como o Claude Code), as datas em ISO, e o que
// é do vAgents (o nome que você deu, o grupo, a cor, o comando para retomar) junto.

const iso = (at: number | undefined) => (at ? new Date(at).toISOString() : undefined)

function agenteEmJson(a: AgentView) {
  return { ...a, startedAt: iso(a.startedAt), updatedAt: iso(a.updatedAt) }
}

function sessaoEmJson(item: SessaoNoDocumento) {
  const s = item.sessao
  return {
    nome: item.nome,
    grupo: item.grupo ? { id: item.grupo.id, nome: item.grupo.nome } : null,
    cor: item.cor,
    ...s,
    statusSince: iso(s.statusSince),
    activityAt: iso(s.activityAt),
    startedAt: iso(s.startedAt),
    updatedAt: iso(s.updatedAt),
    comandoParaRetomar: resumeCommand(s),
    agents: item.agentes.map(({ agente }) => agenteEmJson(agente)),
  }
}

export function paraJson(doc: Documento, versaoDoApp: string | null): string {
  const grupos = doc.secoes.flatMap((secao) => (secao.grupo ? [{ id: secao.grupo.id, nome: secao.grupo.nome, cor: secao.grupo.cor ?? null }] : []))
  const dados = {
    formato: 'vagents.sessoes',
    versao: 1,
    app: { nome: 'vAgents', versao: versaoDoApp },
    geradoEm: iso(doc.geradoEm),
    escopo: doc.sessao ? 'sessao' : 'todas',
    pastasObservadas: doc.configDirs,
    contagem: doc.contagem,
    grupos,
    sessoes: doc.secoes.flatMap((secao) => secao.sessoes.map(sessaoEmJson)),
  }
  return `${JSON.stringify(dados, null, 2)}\n`
}

// ---------------------------------------------------------------------------------------------------
// O nome sugerido para o arquivo.

/** Um pedaço de nome de arquivo: minúsculas, sem acento, só letras, números e hífens. */
export function lesma(texto: string, maximo = 40): string {
  const limpo = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return limpo.slice(0, maximo).replace(/-+$/g, '')
}

/** "vagents-2026-11-14-1536.png", ou "vagents-checkout-com-pix-2026-11-14-1536.png" para uma sessão. */
export function nomeDoArquivo(doc: Documento, formato: Formato): string {
  const d = new Date(doc.geradoEm)
  const p = (n: number) => String(n).padStart(2, '0')
  const quando = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  const unica = doc.sessao ? doc.secoes[0]?.sessoes[0] : undefined
  const meio = unica ? lesma(unica.nome) || 'sessao' : ''
  return `${['vagents', meio, quando].filter(Boolean).join('-')}.${formato}`
}
