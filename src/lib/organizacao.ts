// A organização que você faz na tela: grupos com nome, o grupo e o nome de cada sessão, e as regras
// por pasta ("as sessões abertas nesta pasta vão para este grupo"). Fica no organizacao.json da pasta
// de configuração do app (src-tauri/src/preferencias.rs). Tudo aqui é puro: cada função devolve uma
// organização nova.

export interface Grupo {
  id: string
  nome: string
  recolhido?: boolean
}

export interface AjusteDaSessao {
  /** O grupo escolhido; "" quer dizer "sem grupo" de propósito (vale mais que a regra da pasta). */
  grupo?: string
  /** O nome que você deu; sem ele, vale o título que o Claude gera. */
  nome?: string
}

export interface Organizacao {
  versao: 1
  grupos: Grupo[]
  /** Pela chave da sessão no retrato (pasta de configuração + id da sessão). */
  sessoes: Record<string, AjusteDaSessao>
  /** Pasta → grupo: vale para as sessões abertas nela ou numa subpasta (a regra mais específica ganha). */
  pastas: Record<string, string>
}

export const VAZIA: Organizacao = { versao: 1, grupos: [], sessoes: {}, pastas: {} }

/** O que veio do arquivo, sem confiar no formato: o que não se reconhece fica de fora. */
export function normalizar(bruto: unknown): Organizacao {
  if (!bruto || typeof bruto !== 'object') return VAZIA
  const o = bruto as Record<string, unknown>
  const grupos: Grupo[] = []
  if (Array.isArray(o.grupos)) {
    for (const g of o.grupos as Record<string, unknown>[]) {
      if (typeof g?.id !== 'string' || typeof g.nome !== 'string') continue
      grupos.push({ id: g.id, nome: g.nome, ...(g.recolhido === true && { recolhido: true }) })
    }
  }
  const ids = new Set(grupos.map((g) => g.id))
  const sessoes: Record<string, AjusteDaSessao> = {}
  if (o.sessoes && typeof o.sessoes === 'object') {
    for (const [chave, v] of Object.entries(o.sessoes as Record<string, Record<string, unknown>>)) {
      const ajuste: AjusteDaSessao = {}
      if (typeof v?.grupo === 'string' && (v.grupo === '' || ids.has(v.grupo))) ajuste.grupo = v.grupo
      if (typeof v?.nome === 'string' && v.nome.trim()) ajuste.nome = v.nome.trim()
      if (Object.keys(ajuste).length) sessoes[chave] = ajuste
    }
  }
  const pastas: Record<string, string> = {}
  if (o.pastas && typeof o.pastas === 'object') {
    for (const [pasta, id] of Object.entries(o.pastas as Record<string, unknown>)) {
      if (typeof id === 'string' && ids.has(id)) pastas[pasta] = id
    }
  }
  return { versao: 1, grupos, sessoes, pastas }
}

export function novoIdDeGrupo(): string {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Um nome que ainda não existe: "Grupo 1", "Grupo 2"... */
export function proximoNome(org: Organizacao): string {
  const usados = new Set(org.grupos.map((g) => g.nome.toLowerCase()))
  for (let n = 1; ; n++) if (!usados.has(`grupo ${n}`)) return `Grupo ${n}`
}

export function criarGrupo(org: Organizacao, nome = proximoNome(org), id = novoIdDeGrupo()): { org: Organizacao; id: string } {
  return { org: { ...org, grupos: [...org.grupos, { id, nome: nome.trim() || proximoNome(org) }] }, id }
}

export function renomearGrupo(org: Organizacao, id: string, nome: string): Organizacao {
  const limpo = nome.trim()
  if (!limpo) return org
  return { ...org, grupos: org.grupos.map((g) => (g.id === id ? { ...g, nome: limpo } : g)) }
}

export function alternarRecolhido(org: Organizacao, id: string): Organizacao {
  return {
    ...org,
    grupos: org.grupos.map((g) => {
      if (g.id !== id) return g
      if (g.recolhido) return { id: g.id, nome: g.nome }
      return { ...g, recolhido: true }
    }),
  }
}

/** Some com o grupo; as sessões dele voltam para "sem grupo" e as regras de pasta dele somem. */
export function apagarGrupo(org: Organizacao, id: string): Organizacao {
  const sessoes: Record<string, AjusteDaSessao> = {}
  for (const [chave, ajuste] of Object.entries(org.sessoes)) {
    const { grupo, ...resto } = ajuste
    const novo = grupo === id ? resto : ajuste
    if (Object.keys(novo).length) sessoes[chave] = novo
  }
  const pastas = Object.fromEntries(Object.entries(org.pastas).filter(([, g]) => g !== id))
  return { ...org, grupos: org.grupos.filter((g) => g.id !== id), sessoes, pastas }
}

/** Troca um grupo de lugar com o vizinho (-1: para cima, 1: para baixo). */
export function moverGrupo(org: Organizacao, id: string, direcao: -1 | 1): Organizacao {
  const i = org.grupos.findIndex((g) => g.id === id)
  const j = i + direcao
  if (i < 0 || j < 0 || j >= org.grupos.length) return org
  const grupos = [...org.grupos]
  ;[grupos[i], grupos[j]] = [grupos[j] as Grupo, grupos[i] as Grupo]
  return { ...org, grupos }
}

/** Põe a sessão num grupo (null: sem grupo, mesmo que a pasta dela tenha regra). */
export function moverSessao(org: Organizacao, chave: string, grupo: string | null): Organizacao {
  const atual = org.sessoes[chave] ?? {}
  return { ...org, sessoes: { ...org.sessoes, [chave]: { ...atual, grupo: grupo ?? '' } } }
}

/** O nome que você deu à sessão; vazio volta ao título do Claude. */
export function renomearSessao(org: Organizacao, chave: string, nome: string): Organizacao {
  const { nome: _antigo, ...resto } = org.sessoes[chave] ?? {}
  const limpo = nome.trim()
  const novo: AjusteDaSessao = limpo ? { ...resto, nome: limpo } : resto
  const sessoes = { ...org.sessoes }
  if (Object.keys(novo).length) sessoes[chave] = novo
  else delete sessoes[chave]
  return { ...org, sessoes }
}

/** Liga (grupo) ou desliga (null) a regra da pasta. */
export function definirRegraDePasta(org: Organizacao, pasta: string, grupo: string | null): Organizacao {
  const pastas = { ...org.pastas }
  for (const p of Object.keys(pastas)) if (mesmaPasta(p, pasta)) delete pastas[p]
  if (grupo) pastas[pasta] = grupo
  return { ...org, pastas }
}

function normal(pasta: string): string {
  return pasta.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
}

function mesmaPasta(a: string, b: string): boolean {
  return normal(a) === normal(b)
}

/** A regra que vale para a pasta: a da própria pasta ou a da pasta-mãe mais próxima. */
export function regraDaPasta(org: Organizacao, cwd: string): { pasta: string; grupo: string } | null {
  const alvo = normal(cwd)
  let melhor: { pasta: string; grupo: string } | null = null
  for (const [pasta, grupo] of Object.entries(org.pastas)) {
    const p = normal(pasta)
    if (alvo !== p && !alvo.startsWith(`${p}\\`)) continue
    if (!melhor || p.length > normal(melhor.pasta).length) melhor = { pasta, grupo }
  }
  return melhor
}

/** Em que grupo a sessão aparece: a escolha dela, senão a regra da pasta, senão nenhum. */
export function grupoDaSessao(org: Organizacao, sessao: { key: string; cwd: string }): string | null {
  const escolhido = org.sessoes[sessao.key]?.grupo
  if (escolhido !== undefined) return escolhido && org.grupos.some((g) => g.id === escolhido) ? escolhido : null
  return regraDaPasta(org, sessao.cwd)?.grupo ?? null
}

/** O nome que a tela mostra: o seu, senão o título do Claude. */
export function nomeDaSessao(org: Organizacao, sessao: { key: string; title: string }): string {
  return org.sessoes[sessao.key]?.nome ?? sessao.title
}
