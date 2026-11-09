import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react'
import { CaretDown, CaretRight, CaretUp, Check, PencilSimple, Trash, X } from '@phosphor-icons/react'
import { createContext, memo, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { SessionView } from '../shared/model.ts'
import { NowContext } from './hooks.ts'
import type { AgentFlowNode, Counts, LaneFlowNode, MainFlowNode, MoreFlowNode, SessionFlowNode, StatusCounts } from './layout.ts'
import { AGENT_STATUS, SESSION_STATUS, duration, modelLabel, plural, relTime, waitingReason } from './text.ts'

/** O que os nós pedem à tela (o App fornece): arrastar, renomear e mexer nos grupos. */
export interface Acoes {
  iniciarArraste: (sessao: SessionView, nome: string, e: ReactPointerEvent) => void
  renomearSessao: (chave: string, nome: string) => void
  editarGrupo: (id: string | null) => void
  renomearGrupo: (id: string, nome: string) => void
  recolherGrupo: (id: string) => void
  moverGrupo: (id: string, direcao: -1 | 1) => void
  apagarGrupo: (id: string) => void
}

export const AcoesContext = createContext<Acoes | null>(null)

function useAcoes(): Acoes {
  const acoes = useContext(AcoesContext)
  if (!acoes) throw new Error('AcoesContext sem provedor')
  return acoes
}

function cls(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Selo({ status }: { status: SessionView['status'] }) {
  return (
    <span className={cls('selo', `is-${status}`)}>
      <span className="ponto ponto-vivo" aria-hidden />
      {SESSION_STATUS[status]}
    </span>
  )
}

/** Um texto que vira campo: Enter ou sair do campo grava, Esc desiste. */
export function TextoEditavel({
  valor,
  editando,
  aoComecar,
  aoTerminar,
  className,
  titulo,
}: {
  valor: string
  editando: boolean
  aoComecar: () => void
  aoTerminar: (novo: string | null) => void
  className?: string
  titulo?: string
}) {
  const campo = useRef<HTMLInputElement>(null)
  const [texto, setTexto] = useState(valor)
  useEffect(() => {
    if (!editando) return
    setTexto(valor)
    requestAnimationFrame(() => {
      campo.current?.focus()
      campo.current?.select()
    })
  }, [editando, valor])
  if (!editando) {
    return (
      <span className={className} title={titulo ?? 'Duplo clique para renomear'} onDoubleClick={aoComecar}>
        {valor}
      </span>
    )
  }
  return (
    <input
      ref={campo}
      className={cls('editar-nome nodrag nopan nowheel', className)}
      value={texto}
      aria-label="Novo nome"
      onChange={(e) => setTexto(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') aoTerminar(texto)
        if (e.key === 'Escape') aoTerminar(null)
        e.stopPropagation()
      }}
      onBlur={() => aoTerminar(texto)}
    />
  )
}

function idadeDaSessao(s: SessionView, now: number): string {
  if (s.status === 'ended') return `encerrada ${relTime(s.updatedAt, now)}`
  if (s.status === 'waiting' && s.statusSince) return `esperando ${relTime(s.statusSince, now)}`
  return s.startedAt ? `aberta ${relTime(s.startedAt, now)}` : ''
}

const SessionNode = memo(function SessionNode({ data }: NodeProps<SessionFlowNode>) {
  const now = useContext(NowContext)
  const acoes = useAcoes()
  const [editando, setEditando] = useState(false)
  const s = data.session
  return (
    <div className={cls('sessao', `is-${s.status}`, data.selected && 'is-selected')}>
      <header
        className="sessao-cabeca nopan"
        onPointerDown={(e) => {
          if (e.button === 0 && !editando) acoes.iniciarArraste(s, data.nome, e)
        }}
        title="Arraste para outro grupo"
      >
        <div className="sessao-meta">
          <Selo status={s.status} />
          <span className="sessao-projeto" title={s.cwd}>
            {s.project}
          </span>
          {s.gitBranch && s.gitBranch !== 'HEAD' && <span className="sessao-rotulo">{s.gitBranch}</span>}
          {data.multiConfig && <span className="sessao-rotulo">{s.account}</span>}
          <span className="sessao-idade">{idadeDaSessao(s, now)}</span>
        </div>
        <h2 className="sessao-titulo">
          <TextoEditavel
            className="block truncate"
            valor={data.nome}
            editando={editando}
            aoComecar={() => setEditando(true)}
            aoTerminar={(novo) => {
              setEditando(false)
              if (novo !== null && novo.trim() !== data.nome) acoes.renomearSessao(s.key, novo.trim() === s.title ? '' : novo)
            }}
          />
        </h2>
        {s.lastPrompt ? (
          <p className="sessao-desc" title={s.lastPrompt}>
            {s.lastPrompt}
          </p>
        ) : (
          <p className="sessao-desc is-vazia">Sem pedido registrado ainda.</p>
        )}
      </header>
    </div>
  )
})

function textoDosSubagentes(c: Counts): string {
  const partes: string[] = []
  if (c.running) partes.push(plural(c.running, 'rodando', 'rodando'))
  if (c.done) partes.push(plural(c.done, 'concluído', 'concluídos'))
  if (c.interrupted) partes.push(plural(c.interrupted, 'interrompido', 'interrompidos'))
  return partes.length ? `Subagentes: ${partes.join(' · ')}` : 'Sem subagentes'
}

const MainNode = memo(function MainNode({ data }: NodeProps<MainFlowNode>) {
  const now = useContext(NowContext)
  const s = data.session
  const agora =
    s.status === 'waiting' ? `Esperando ${waitingReason(s.waitingFor)}` : (s.activity ?? (s.status === 'ended' ? 'Encerrada' : 'Sem atividade ainda'))
  return (
    <div className={cls('agente', 'agente-principal', `is-${s.status}`, data.selected && 'is-selected')}>
      <div className="agente-topo">
        <span className="ponto" aria-hidden />
        <span className="agente-tipo">Agente principal</span>
        {s.model && <span className="agente-lado">{modelLabel(s.model)}</span>}
      </div>
      <div className={cls('agente-agora', s.status === 'waiting' && 'is-forte')} title={agora}>
        {agora}
      </div>
      <div className="agente-pe">
        <span>{textoDosSubagentes(data.counts)}</span>
        {s.activityAt && s.status !== 'waiting' && <span className="ml-auto">{relTime(s.activityAt, now)}</span>}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})

const AgentNode = memo(function AgentNode({ data }: NodeProps<AgentFlowNode>) {
  const now = useContext(NowContext)
  const a = data.agent
  const rodando = a.status === 'running'
  const tempo = a.startedAt ? (rodando ? now : a.updatedAt) - a.startedAt : undefined
  return (
    <div className={cls('agente', `is-${a.status}`, data.selected && 'is-selected')}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="agente-topo">
        <span className="ponto" aria-hidden />
        <span className="agente-tipo">{a.name ?? a.agentType}</span>
        <span className="agente-lado">{duration(tempo)}</span>
      </div>
      <div className="agente-desc" title={a.description}>
        {a.description}
      </div>
      <div className="agente-agora" title={a.activity}>
        {rodando ? (a.activity ?? 'Começando…') : `${AGENT_STATUS[a.status]} ${relTime(a.updatedAt, now)}`}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})

const MoreNode = memo(function MoreNode({ data }: NodeProps<MoreFlowNode>) {
  const { hidden, expanded } = data
  const n = hidden.done + hidden.interrupted
  let rotulo: string
  if (expanded) rotulo = `Recolher ${plural(n, 'subagente antigo', 'subagentes antigos')}`
  else {
    const partes: string[] = []
    if (hidden.done) partes.push(plural(hidden.done, 'concluído', 'concluídos'))
    if (hidden.interrupted) partes.push(plural(hidden.interrupted, 'interrompido', 'interrompidos'))
    rotulo = `+ ${partes.join(' · ')}`
  }
  return (
    <div className="mais" role="button">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span>{rotulo}</span>
      <span className="mais-acao">{expanded ? 'recolher' : 'mostrar'}</span>
    </div>
  )
})

const ORDEM: SessionView['status'][] = ['waiting', 'running', 'idle', 'ended']

function Contagem({ contagem }: { contagem: StatusCounts }) {
  const itens = ORDEM.filter((s) => contagem[s] > 0)
  if (itens.length === 0) return null
  return (
    <span className="flex items-center gap-3 text-[13px] text-neutro-700">
      {itens.map((s) => (
        <span key={s} className={cls('inline-flex items-center gap-1.5', `is-${s}`)} title={SESSION_STATUS[s]}>
          <span className="ponto" aria-hidden />
          {contagem[s]}
        </span>
      ))}
    </span>
  )
}

const LaneNode = memo(function LaneNode({ data }: NodeProps<LaneFlowNode>) {
  const acoes = useAcoes()
  const [confirmando, setConfirmando] = useState(false)
  const g = data.grupo
  return (
    <div className={cls('faixa', !g && 'is-sem-grupo', data.alvo && 'is-alvo')}>
      <header className="faixa-cabeca nopan">
        {g ? (
          <button
            type="button"
            className="btn btn-icone nodrag"
            onClick={() => acoes.recolherGrupo(g.id)}
            aria-label={g.recolhido ? 'Mostrar as sessões do grupo' : 'Recolher o grupo'}
            title={g.recolhido ? 'Mostrar as sessões' : 'Recolher'}
          >
            {g.recolhido ? <CaretRight /> : <CaretDown />}
          </button>
        ) : null}
        <h3 className="faixa-nome min-w-0">
          {g ? (
            <TextoEditavel
              className="block truncate"
              valor={g.nome}
              editando={data.editando}
              aoComecar={() => acoes.editarGrupo(g.id)}
              aoTerminar={(novo) => {
                acoes.editarGrupo(null)
                if (novo !== null) acoes.renomearGrupo(g.id, novo)
              }}
            />
          ) : (
            'Sem grupo'
          )}
        </h3>
        <span className="text-[13px] text-neutro-600 whitespace-nowrap">{plural(data.total, 'sessão', 'sessões')}</span>
        <Contagem contagem={data.contagem} />
        {g && (
          <div className="faixa-acoes nodrag">
            {confirmando ? (
              <>
                <span className="text-[13px] mr-1">Apagar o grupo? As sessões ficam sem grupo.</span>
                <button type="button" className="btn btn-pequeno btn-secundario btn-perigo" onClick={() => acoes.apagarGrupo(g.id)}>
                  <Check /> Apagar
                </button>
                <button type="button" className="btn btn-icone" onClick={() => setConfirmando(false)} aria-label="Não apagar">
                  <X />
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-icone" onClick={() => acoes.editarGrupo(g.id)} aria-label="Renomear o grupo" title="Renomear">
                  <PencilSimple />
                </button>
                <button
                  type="button"
                  className="btn btn-icone"
                  disabled={data.primeiro}
                  onClick={() => acoes.moverGrupo(g.id, -1)}
                  aria-label="Subir o grupo"
                  title="Subir"
                >
                  <CaretUp />
                </button>
                <button
                  type="button"
                  className="btn btn-icone"
                  disabled={data.ultimo}
                  onClick={() => acoes.moverGrupo(g.id, 1)}
                  aria-label="Descer o grupo"
                  title="Descer"
                >
                  <CaretDown />
                </button>
                <button type="button" className="btn btn-icone" onClick={() => setConfirmando(true)} aria-label="Apagar o grupo" title="Apagar">
                  <Trash />
                </button>
              </>
            )}
          </div>
        )}
      </header>
      {!g?.recolhido && data.total === 0 && (
        <div className="faixa-vazia">{g ? 'Arraste sessões para cá' : 'Arraste para cá para tirar uma sessão do grupo'}</div>
      )}
    </div>
  )
})

export const nodeTypes: NodeTypes = {
  session: SessionNode,
  main: MainNode,
  agent: AgentNode,
  more: MoreNode,
  lane: LaneNode,
}
