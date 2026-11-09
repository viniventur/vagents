// O que o servidor manda para a tela: as sessões e os subagentes de cada uma.

/** running: trabalhando · waiting: esperando você · idle: parada, pronta para o próximo pedido · ended: processo fechado. */
export type SessionStatus = 'running' | 'waiting' | 'idle' | 'ended'

export type AgentStatus = 'running' | 'done' | 'interrupted'

export interface AgentView {
  /** O id do subagente (o nome do arquivo, sem "agent-"). */
  id: string
  /** O subagente que criou este; null quando foi o agente principal. */
  parentId: string | null
  description: string
  agentType: string
  name?: string
  model?: string
  status: AgentStatus
  startedAt?: number
  /** A última escrita no histórico do subagente (ou o fim, se já terminou). */
  updatedAt: number
  /** O último passo: a ferramenta em uso ou o começo do último texto. */
  activity?: string
  depth: number
}

/** Uma pasta de configuração do Claude Code, que é uma conta (ex.: ~/.claude-trabalho = "Trabalho"). */
export interface Account {
  dir: string
  name: string
  /** O comando que abre o Claude nessa conta (ex.: "claude-trabalho"), para retomar uma sessão. */
  command?: string
}

export interface SessionView {
  /** Único entre as pastas de configuração: pasta + id da sessão. */
  key: string
  sessionId: string
  configDir: string
  /** O nome da conta (da pasta de configuração). */
  account: string
  accountCommand?: string
  pid?: number
  kind?: string
  cwd: string
  project: string
  /** O tema: o nome dado por você ou o título que o Claude gera. */
  title: string
  /** O seu último pedido nessa sessão. */
  lastPrompt?: string
  activity?: string
  activityAt?: number
  model?: string
  gitBranch?: string
  permissionMode?: string
  status: SessionStatus
  /** O motivo da espera, como o Claude Code grava (ex.: "input needed"). */
  waitingFor?: string
  statusSince?: number
  startedAt?: number
  updatedAt: number
  agents: AgentView[]
}

export interface Snapshot {
  generatedAt: number
  configDirs: string[]
  /** Por quanto tempo uma sessão encerrada continua na lista. */
  retentionMs: number
  sessions: SessionView[]
}
