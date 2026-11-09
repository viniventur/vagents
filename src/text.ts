import type { AgentStatus, SessionStatus, SessionView } from '../shared/model.ts'

export const SESSION_STATUS: Record<SessionStatus, string> = {
  running: 'Rodando',
  waiting: 'Esperando você',
  idle: 'Parada',
  ended: 'Encerrada',
}

export const AGENT_STATUS: Record<AgentStatus, string> = {
  running: 'Rodando',
  done: 'Concluído',
  interrupted: 'Interrompido',
}

const WAITING: Record<string, string> = {
  'input needed': 'uma resposta sua',
  'dialog open': 'uma janela aberta no terminal',
  'goal proposal': 'você aprovar um objetivo',
  'sandbox request': 'uma permissão do sandbox',
  'worker request': 'um pedido de outro agente',
  permission: 'uma permissão',
}

/** O motivo da espera em português ("Esperando " + isto). */
export function waitingReason(raw: string | undefined): string {
  if (!raw) return 'você'
  return WAITING[raw] ?? raw
}

export function relTime(at: number | undefined, now: number): string {
  if (!at) return ''
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 10) return 'agora'
  if (s < 60) return `há ${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

export function duration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`
  const h = Math.floor(m / 60)
  return `${h} h ${String(m % 60).padStart(2, '0')} min`
}

export function clock(at: number | undefined): string {
  if (!at) return ''
  return new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** "claude-opus-5-5" → "Opus 5.5"; "opus" → "Opus". */
export function modelLabel(model: string | undefined): string {
  if (!model) return ''
  const full = /(opus|sonnet|haiku|fable)-(\d+)-(\d+)/i.exec(model)
  if (full) return `${cap(full[1] as string)} ${full[2]}.${full[3]}`
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)
  if (family) return cap(family[1] as string)
  return model
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * O comando (PowerShell) para voltar a uma sessão: com o comando da conta, se houver
 * (ex.: "claude-trabalho"); senão, apontando o CLAUDE_CONFIG_DIR para a pasta dela.
 */
export function resumeCommand(s: SessionView): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
  const parts: string[] = []
  const folder = s.configDir.split(/[\\/]/).filter(Boolean).pop()
  if (!s.accountCommand && folder !== '.claude') parts.push(`$env:CLAUDE_CONFIG_DIR = ${quote(s.configDir)}`)
  if (s.cwd) parts.push(`Set-Location ${quote(s.cwd)}`)
  parts.push(`${s.accountCommand ?? 'claude'} --resume ${s.sessionId}`)
  return parts.join('; ')
}
