import { Handle, Position, type NodeProps, type NodeTypes } from '@xyflow/react'
import { CaretDown, CaretRight, CaretUp, Check, PencilSimple, Trash, X } from '@phosphor-icons/react'
import { createContext, memo, useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { SessionView } from '../shared/model.ts'
import { NowContext } from './hooks.ts'
import type { AgentFlowNode, Counts, LaneFlowNode, MainFlowNode, MoreFlowNode, SessionFlowNode, StatusCounts } from './layout.ts'
import type { Grupo } from './lib/organizacao.ts'
import { AGENT_STATUS, SESSION_STATUS, duration, modelLabel, plural, relTime, waitingReason } from './text.ts'

/** De quem é a cor que o seletor está mudando: o quadro de um grupo ou o card de uma sessão. */
export type AlvoDaCor = { tipo: 'grupo'; id: string } | { tipo: 'sessao'; chave: string }

/** O que os nós pedem à tela (o App fornece): arrastar, renomear, colorir e mexer nos grupos. */
export interface Acoes {
  iniciarArraste: (sessao: SessionView, nome: string, e: ReactPointerEvent) => void
  renomearSessao: (chave: string, nome: string) => void
  editarGrupo: (id: string | null) => void
  renomearGrupo: (id: string, nome: string) => void
  recolherGrupo: (id: string) => void
  moverGrupo: (id: string, direcao: -1 | 1) => void
  apagarGrupo: (id: string) => void
  /** Abre (ou fecha, se já está aberto para o mesmo alvo) o seletor de cor junto do botão. */
  escolherCor: (alvo: AlvoDaCor, botao: HTMLElement, peloTeclado: boolean) => void
}

export const AcoesContext = createContext<Acoes | null>(null)

export function useAcoes(): Acoes {
  const acoes = useContext(AcoesContext)
  if (!acoes) throw new Error('AcoesContext sem provedor')
  return acoes
}

export function cls(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * O quadradinho da cor de um grupo ou de um card: cheio com a cor escolhida, ou tracejado (a de sempre).
 * O clique abre o seletor e não chega ao que está embaixo (não arrasta o card nem abre o painel); o
 * mouse não tira o foco de onde ele está (o nome do grupo que você está digitando, por exemplo).
 */
export function BotaoDeCor({
  cor,
  rotulo,
  className,
  aoClicar,
}: {
  cor: string | null
  rotulo: string
  className?: string
  aoClicar: (botao: HTMLElement, peloTeclado: boolean) => void
}) {
  return (
    <button
      type="button"
      className={cls('cor-botao nodrag nopan', cor ? 'tem-cor' : 'is-padrao', className)}
      style={cor ? ({ '--cor': cor } as CSSProperties) : undefined}
      aria-label={rotulo}
      title={cor ? `${rotulo}: ${cor}` : `${rotulo}: a de sempre. Clique para escolher outra.`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        aoClicar(e.currentTarget, e.detail === 0)
      }}
    />
  )
}

/**
 * Os nós só leem o `data`: mudar de lugar (no arraste, a cada quadro) não redesenha o conteúdo deles, só
 * o invólucro do React Flow, que é quem posiciona.
 */
function soOData<P extends { data: unknown }>(antes: Readonly<P>, depois: Readonly<P>): boolean {
  return antes.data === depois.data
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

export function idadeDaSessao(s: SessionView, now: number): string {
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
    <div
      className={cls('sessao', `is-${s.status}`, data.selected && 'is-selected', data.cor && 'tem-cor')}
      style={data.cor ? ({ '--cor-cartao': data.cor } as CSSProperties) : undefined}
    >
      <header
        className="sessao-cabeca nopan"
        onPointerDown={(e) => {
          if (e.button === 0 && !editando) acoes.iniciarArraste(s, data.nome, e)
        }}
        title="Arraste para mudar o card de lugar, ou para outro grupo"
      >
        <div className="sessao-meta">
          <Selo status={s.status} />
          <span className="sessao-projeto" title={s.cwd}>
            {s.project}
          </span>
          {s.gitBranch && s.gitBranch !== 'HEAD' && <span className="sessao-rotulo">{s.gitBranch}</span>}
          {data.multiConfig && <span className="sessao-rotulo">{s.account}</span>}
          <span className="sessao-idade">{idadeDaSessao(s, now)}</span>
          <BotaoDeCor
            cor={data.cor}
            rotulo="Cor do card"
            className="cor-botao-cartao"
            aoClicar={(botao, peloTeclado) => acoes.escolherCor({ tipo: 'sessao', chave: s.key }, botao, peloTeclado)}
          />
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
}, soOData)

/** O que o agente principal da sessão está fazendo (ou esperando). */
export function agoraDaSessao(s: SessionView): string {
  if (s.status === 'waiting') return `Esperando ${waitingReason(s.waitingFor)}`
  return s.activity ?? (s.status === 'ended' ? 'Encerrada' : 'Sem atividade ainda')
}

export function textoDosSubagentes(c: Counts): string {
  const partes: string[] = []
  if (c.running) partes.push(plural(c.running, 'rodando', 'rodando'))
  if (c.done) partes.push(plural(c.done, 'concluído', 'concluídos'))
  if (c.interrupted) partes.push(plural(c.interrupted, 'interrompido', 'interrompidos'))
  return partes.length ? `Subagentes: ${partes.join(' · ')}` : 'Sem subagentes'
}

const MainNode = memo(function MainNode({ data }: NodeProps<MainFlowNode>) {
  const now = useContext(NowContext)
  const s = data.session
  const agora = agoraDaSessao(s)
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
}, soOData)

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
}, soOData)

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
}, soOData)

const ORDEM: SessionView['status'][] = ['waiting', 'running', 'idle', 'ended']

export function Contagem({ contagem }: { contagem: StatusCounts }) {
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

/** O cabeçalho de um grupo (ou do "sem grupo"): o nome, as contagens e as ações. No mapa e na lista. */
export function CabecalhoDoGrupo({
  grupo: g,
  total,
  contagem,
  editando,
  primeiro,
  ultimo,
  recolhido,
  aoRecolher,
}: {
  grupo: Grupo | null
  total: number
  contagem: StatusCounts
  editando: boolean
  primeiro: boolean
  ultimo: boolean
  recolhido: boolean
  /** Sem ele, não há o botão de recolher. */
  aoRecolher?: () => void
}) {
  const acoes = useAcoes()
  const [confirmando, setConfirmando] = useState(false)
  return (
    <header className="faixa-cabeca nopan">
      {aoRecolher && (
        <button
          type="button"
          className="btn btn-icone nodrag"
          onClick={aoRecolher}
          aria-expanded={!recolhido}
          aria-label={recolhido ? 'Mostrar as sessões do grupo' : 'Recolher o grupo'}
          title={recolhido ? 'Mostrar as sessões' : 'Recolher'}
        >
          {recolhido ? <CaretRight /> : <CaretDown />}
        </button>
      )}
      {g && (
        <BotaoDeCor
          cor={g.cor ?? null}
          rotulo={`Cor do grupo ${g.nome}`}
          aoClicar={(botao, peloTeclado) => acoes.escolherCor({ tipo: 'grupo', id: g.id }, botao, peloTeclado)}
        />
      )}
      <h3 className="faixa-nome min-w-0">
        {g ? (
          <TextoEditavel
            className="block truncate"
            valor={g.nome}
            editando={editando}
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
      <span className="faixa-total">{plural(total, 'sessão', 'sessões')}</span>
      <Contagem contagem={contagem} />
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
                disabled={primeiro}
                onClick={() => acoes.moverGrupo(g.id, -1)}
                aria-label="Subir o grupo"
                title="Subir"
              >
                <CaretUp />
              </button>
              <button
                type="button"
                className="btn btn-icone"
                disabled={ultimo}
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
  )
}

const LaneNode = memo(function LaneNode({ data }: NodeProps<LaneFlowNode>) {
  const acoes = useAcoes()
  const g = data.grupo
  return (
    <div
      className={cls('faixa', !g && 'is-sem-grupo', g?.cor && 'tem-cor', data.alvo && 'is-alvo')}
      style={g?.cor ? ({ '--cor-grupo': g.cor } as CSSProperties) : undefined}
    >
      <CabecalhoDoGrupo
        grupo={g}
        total={data.total}
        contagem={data.contagem}
        editando={data.editando}
        primeiro={data.primeiro}
        ultimo={data.ultimo}
        recolhido={g?.recolhido === true}
        aoRecolher={g ? () => acoes.recolherGrupo(g.id) : undefined}
      />
      {!g?.recolhido && data.total === 0 && (
        <div className="faixa-vazia">{g ? 'Arraste sessões para cá' : 'Arraste para cá para tirar uma sessão do grupo'}</div>
      )}
    </div>
  )
}, soOData)

export const nodeTypes: NodeTypes = {
  session: SessionNode,
  main: MainNode,
  agent: AgentNode,
  more: MoreNode,
  lane: LaneNode,
}
