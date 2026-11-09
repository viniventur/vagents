import { CaretDown, CaretRight, DotsSixVertical } from '@phosphor-icons/react'
import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NowContext } from './hooks.ts'
import { laneNodeId, mainNodeId, type Counts } from './layout.ts'
import { estaAberto, linhasDaSecao, type Dobras, type Linha, type Lista, type SecaoDaLista } from './lib/lista.ts'
import { BotaoDeCor, CabecalhoDoGrupo, Selo, TextoEditavel, agoraDaSessao, cls, idadeDaSessao, useAcoes } from './nodes.tsx'
import { AGENT_STATUS, duration, modelLabel, plural, relTime } from './text.ts'

/** Sessões para mostrar na lista (rolar até elas e piscar); `vez` muda a cada pedido, até para as mesmas. */
export interface Destaque {
  chaves: string[]
  vez: number
}

interface Props {
  lista: Lista
  dobras: Dobras
  selecionado: string | null
  /** O grupo (ou SEM_GRUPO) para onde vai a sessão arrastada. */
  alvo: string | null
  editandoGrupo: string | null
  destaque: Destaque | null
  /** O painel de detalhes está aberto (a lista abre espaço para ele, se couber). */
  comPainel: boolean
  aoAlternar: (id: string) => void
  aoAlternarMais: (chave: string) => void
  /** Clique numa linha: abre os detalhes (depois do tempo de um duplo clique). */
  aoClicar: (id: string) => void
  /** Enter numa linha: abre os detalhes na hora. */
  aoEscolher: (id: string) => void
}

/** As sessões numa lista, cada uma com a árvore dos agentes, agrupadas como no mapa. */
export function VistaEmLista(props: Props) {
  const { lista, dobras, destaque } = props
  const raiz = useRef<HTMLDivElement>(null)
  const [focado, setFocado] = useState<string | null>(null)

  const secoes = useMemo(
    () =>
      lista.secoes.map((secao) => {
        const aberta = !lista.temGrupos || estaAberto(dobras, laneNodeId(secao.id))
        return { secao, aberta, linhas: aberta ? linhasDaSecao(secao, dobras) : [] }
      }),
    [lista, dobras],
  )
  const ids = secoes.flatMap((s) => s.linhas.map((l) => l.id))
  // Uma linha só entra no Tab (a última com foco, ou a primeira); as setas andam entre elas.
  const comTab = focado !== null && ids.includes(focado) ? focado : (ids[0] ?? null)
  const grupos = lista.secoes.filter((s) => s.grupo).length

  // Rola até as sessões pedidas (pelo contador, pelo chip, pelo aviso) e as faz piscar.
  useEffect(() => {
    const el = raiz.current
    if (!destaque || !el) return
    const linhas = destaque.chaves
      .map((chave) => el.querySelector<HTMLElement>(`[data-sessao="${CSS.escape(chave)}"]`))
      .filter((x): x is HTMLElement => x !== null)
    linhas[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    for (const linha of linhas) {
      linha.classList.remove('is-destaque')
      void linha.offsetWidth
      linha.classList.add('is-destaque')
    }
  }, [destaque])

  const aoTeclar = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const atual = e.target as HTMLElement
    const id = atual.dataset.linha
    if (!id || !raiz.current) return
    const todas = [...raiz.current.querySelectorAll<HTMLElement>('[data-linha]')]
    const i = todas.indexOf(atual)
    const expandida = atual.getAttribute('aria-expanded')
    switch (e.key) {
      case 'ArrowDown':
        todas[i + 1]?.focus()
        break
      case 'ArrowUp':
        todas[i - 1]?.focus()
        break
      case 'Home':
        todas[0]?.focus()
        break
      case 'End':
        todas[todas.length - 1]?.focus()
        break
      case 'ArrowRight':
        if (expandida === 'false') props.aoAlternar(id)
        else if (expandida === 'true') todas[i + 1]?.focus()
        break
      case 'ArrowLeft': {
        const pai = atual.dataset.pai
        if (expandida === 'true') props.aoAlternar(id)
        else if (pai) raiz.current.querySelector<HTMLElement>(`[data-linha="${CSS.escape(pai)}"]`)?.focus()
        break
      }
      case 'Enter':
      case ' ':
        if (atual.dataset.tipo === 'mais') props.aoAlternarMais(atual.dataset.chave ?? '')
        else props.aoEscolher(id)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div className={cls('lista-area', props.comPainel && 'com-painel')}>
      <div ref={raiz} className="lista" role="tree" aria-label="Sessões e agentes" onKeyDown={aoTeclar}>
        <div className="lista-colunas" aria-hidden>
          <span>Sessão</span>
          <span className="col-projeto">Projeto</span>
          <span>Estado</span>
          <span className="col-agora">Agora</span>
          <span className="text-right">Tempo</span>
        </div>
        {secoes.map(({ secao, aberta, linhas }, indice) => (
          <Secao
            key={secao.id}
            secao={secao}
            aberta={aberta}
            linhas={linhas}
            temGrupos={lista.temGrupos}
            multiConfig={lista.multiConfig}
            primeira={indice === 0}
            ultimaDosGrupos={indice === grupos - 1}
            comTab={comTab}
            aoFocar={setFocado}
            {...props}
          />
        ))}
      </div>
    </div>
  )
}

function Secao({
  secao,
  aberta,
  linhas,
  temGrupos,
  multiConfig,
  primeira,
  ultimaDosGrupos,
  comTab,
  aoFocar,
  ...props
}: Props & {
  secao: SecaoDaLista
  aberta: boolean
  linhas: Linha[]
  temGrupos: boolean
  multiConfig: boolean
  primeira: boolean
  ultimaDosGrupos: boolean
  comTab: string | null
  aoFocar: (id: string) => void
}) {
  const g = secao.grupo
  const nivelBase = temGrupos ? 2 : 1
  return (
    <section
      className={cls('lista-secao', temGrupos ? !g && 'is-sem-grupo' : 'is-unica', g?.cor && 'tem-cor', props.alvo === secao.id && 'is-alvo')}
      style={g?.cor ? ({ '--cor-grupo': g.cor } as CSSProperties) : undefined}
      data-alvo-grupo={secao.id}
      role="group"
      aria-label={g ? g.nome : 'Sem grupo'}
    >
      {temGrupos && (
        <CabecalhoDoGrupo
          grupo={g}
          total={secao.sessoes.length}
          contagem={secao.contagem}
          editando={g !== null && props.editandoGrupo === g.id}
          primeiro={primeira}
          ultimo={ultimaDosGrupos}
          recolhido={!aberta}
          aoRecolher={() => props.aoAlternar(laneNodeId(secao.id))}
        />
      )}
      {temGrupos && aberta && secao.sessoes.length === 0 && (
        <div className="lista-vazia">{g ? 'Arraste sessões para cá' : 'Arraste para cá para tirar uma sessão do grupo'}</div>
      )}
      {linhas.length > 0 && (
        <div className="lista-linhas">
          {linhas.map((linha) => {
            const comum = {
              focavel: comTab === linha.id,
              nivelAria: nivelBase + linha.nivel,
              aoFocar,
              aoAlternar: props.aoAlternar,
            }
            if (linha.tipo === 'sessao') {
              const s = linha.sessao.sessao
              const selecionada = props.selecionado === linha.id || props.selecionado === mainNodeId(s.key)
              return (
                <LinhaDaSessao key={linha.id} linha={linha} selecionada={selecionada} multiConfig={multiConfig} aoClicar={props.aoClicar} {...comum} />
              )
            }
            if (linha.tipo === 'agente') {
              return <LinhaDoAgente key={linha.id} linha={linha} selecionada={props.selecionado === linha.id} aoClicar={props.aoClicar} {...comum} />
            }
            return <LinhaMais key={linha.id} linha={linha} aoAlternarMais={props.aoAlternarMais} {...comum} />
          })}
        </div>
      )}
    </section>
  )
}

interface Comum {
  focavel: boolean
  nivelAria: number
  aoFocar: (id: string) => void
  aoAlternar: (id: string) => void
}

/** O recuo de cada nível, com a linha-guia vertical. */
function Guias({ nivel }: { nivel: number }) {
  return (
    <>
      {Array.from({ length: nivel }, (_, i) => (
        <span key={i} className="linha-guia" aria-hidden />
      ))}
    </>
  )
}

/** A seta de recolher/expandir (ou o espaço dela, para o texto ficar alinhado). */
function Seta({ id, temFilhos, aberto, aoAlternar }: { id: string; temFilhos: boolean; aberto: boolean; aoAlternar: (id: string) => void }) {
  if (!temFilhos) return <span className="linha-seta" aria-hidden />
  return (
    <button
      type="button"
      tabIndex={-1}
      className="linha-seta is-botao"
      aria-label={aberto ? 'Recolher' : 'Expandir'}
      title={aberto ? 'Recolher' : 'Expandir'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        aoAlternar(id)
      }}
    >
      {aberto ? <CaretDown weight="bold" /> : <CaretRight weight="bold" />}
    </button>
  )
}

function resumoDosAgentes(c: Counts): string {
  const partes: string[] = []
  if (c.running) partes.push(plural(c.running, 'subagente rodando', 'subagentes rodando'))
  const fim = c.done + c.interrupted
  if (fim) partes.push(plural(fim, 'concluído', 'concluídos'))
  return partes.join(' · ')
}

/** Clicar no que é de dentro da linha (a seta, o campo do nome) não conta como clicar na linha. */
const deDentro = (alvo: EventTarget) => (alvo as Element).closest?.('button, input') !== null

function LinhaDaSessao({
  linha,
  selecionada,
  multiConfig,
  focavel,
  nivelAria,
  aoFocar,
  aoAlternar,
  aoClicar,
}: Comum & { linha: Extract<Linha, { tipo: 'sessao' }>; selecionada: boolean; multiConfig: boolean; aoClicar: (id: string) => void }) {
  const now = useContext(NowContext)
  const acoes = useAcoes()
  const [editando, setEditando] = useState(false)
  const { sessao: s, nome, cor, contagem } = linha.sessao
  const agora = agoraDaSessao(s)
  const ramo = s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : null
  return (
    <div
      role="treeitem"
      aria-level={nivelAria}
      aria-expanded={linha.temFilhos ? linha.aberto : undefined}
      aria-selected={selecionada}
      tabIndex={focavel ? 0 : -1}
      data-linha={linha.id}
      data-sessao={s.key}
      data-tipo="sessao"
      className={cls('linha linha-sessao', `is-${s.status}`, selecionada && 'is-selecionada', cor && 'tem-cor')}
      style={cor ? ({ '--cor-cartao': cor } as CSSProperties) : undefined}
      title="Clique para ver os detalhes; arraste para outro grupo"
      onFocus={(e) => e.target === e.currentTarget && aoFocar(linha.id)}
      onPointerDown={(e) => {
        if (e.button === 0 && !editando && !deDentro(e.target)) acoes.iniciarArraste(s, nome, e)
      }}
      onClick={(e) => !deDentro(e.target) && aoClicar(linha.id)}
    >
      <div className="linha-nome">
        <span className="linha-alca" aria-hidden>
          <DotsSixVertical weight="bold" />
        </span>
        <Seta id={linha.id} temFilhos={linha.temFilhos} aberto={linha.aberto} aoAlternar={aoAlternar} />
        <div className="min-w-0 flex-1">
          <div className="linha-titulo">
            <BotaoDeCor
              cor={cor}
              rotulo="Cor do card"
              className="cor-botao-linha"
              aoClicar={(botao, peloTeclado) => acoes.escolherCor({ tipo: 'sessao', chave: s.key }, botao, peloTeclado)}
            />
            <TextoEditavel
              className="truncate"
              valor={nome}
              editando={editando}
              aoComecar={() => setEditando(true)}
              aoTerminar={(novo) => {
                setEditando(false)
                if (novo !== null && novo.trim() !== nome) acoes.renomearSessao(s.key, novo.trim() === s.title ? '' : novo)
              }}
            />
            {!editando && <span className="linha-projeto-junto">{s.project}</span>}
            {!editando && linha.temFilhos && !linha.aberto && <span className="linha-resumo">{resumoDosAgentes(contagem)}</span>}
          </div>
          <p className={cls('linha-desc', !s.lastPrompt && 'is-vazia')} title={s.lastPrompt}>
            {s.lastPrompt ?? 'Sem pedido registrado ainda.'}
          </p>
        </div>
      </div>
      <div className="linha-projeto">
        <span className="linha-projeto-nome" title={s.cwd}>
          {s.project}
        </span>
        {(ramo || multiConfig) && (
          <span className="linha-rotulos">
            {ramo && <span className="sessao-rotulo">{ramo}</span>}
            {multiConfig && <span className="sessao-rotulo">{s.account}</span>}
          </span>
        )}
      </div>
      <div className="linha-estado">
        <Selo status={s.status} />
      </div>
      <div className={cls('linha-agora', s.status === 'waiting' && 'is-forte')} title={agora}>
        <span className="linha-agora-texto">{agora}</span>
        {s.model && <span className="linha-modelo">{modelLabel(s.model)}</span>}
      </div>
      <div className="linha-tempo">{idadeDaSessao(s, now)}</div>
    </div>
  )
}

function LinhaDoAgente({
  linha,
  selecionada,
  focavel,
  nivelAria,
  aoFocar,
  aoAlternar,
  aoClicar,
}: Comum & { linha: Extract<Linha, { tipo: 'agente' }>; selecionada: boolean; aoClicar: (id: string) => void }) {
  const now = useContext(NowContext)
  const a = linha.agente
  const rodando = a.status === 'running'
  const tempo = a.startedAt ? (rodando ? now : a.updatedAt) - a.startedAt : undefined
  const agora = rodando ? (a.activity ?? 'Começando…') : `Terminou ${relTime(a.updatedAt, now)}`
  const filhos = linha.temFilhos && !linha.aberto ? linha.sessao.sessao.agents.filter((x) => x.parentId === a.id) : []
  return (
    <div
      role="treeitem"
      aria-level={nivelAria}
      aria-expanded={linha.temFilhos ? linha.aberto : undefined}
      aria-selected={selecionada}
      tabIndex={focavel ? 0 : -1}
      data-linha={linha.id}
      data-pai={linha.pai}
      data-tipo="agente"
      className={cls('linha linha-agente', `is-${a.status}`, selecionada && 'is-selecionada')}
      onFocus={(e) => e.target === e.currentTarget && aoFocar(linha.id)}
      onClick={(e) => !deDentro(e.target) && aoClicar(linha.id)}
    >
      <div className="linha-nome">
        <span className="linha-alca" aria-hidden />
        <Guias nivel={linha.nivel} />
        <Seta id={linha.id} temFilhos={linha.temFilhos} aberto={linha.aberto} aoAlternar={aoAlternar} />
        <span className="linha-tipo">{a.name ?? a.agentType}</span>
        <span className="linha-agente-desc" title={a.description}>
          {a.description}
        </span>
        {filhos.length > 0 && <span className="linha-resumo">{plural(filhos.length, 'subagente', 'subagentes')}</span>}
      </div>
      <div className="linha-projeto" />
      <div className="linha-estado">
        <span className="linha-status">
          <span className="ponto ponto-vivo" aria-hidden />
          {AGENT_STATUS[a.status]}
        </span>
      </div>
      <div className="linha-agora" title={rodando ? a.activity : undefined}>
        <span className="linha-agora-texto">{agora}</span>
      </div>
      <div className="linha-tempo">{duration(tempo)}</div>
    </div>
  )
}

function LinhaMais({
  linha,
  focavel,
  nivelAria,
  aoFocar,
  aoAlternarMais,
}: Comum & { linha: Extract<Linha, { tipo: 'mais' }>; aoAlternarMais: (chave: string) => void }) {
  const { escondidos, aberto } = linha
  const n = escondidos.done + escondidos.interrupted
  let rotulo: string
  if (aberto) rotulo = `Recolher ${plural(n, 'subagente antigo', 'subagentes antigos')}`
  else {
    const partes: string[] = []
    if (escondidos.done) partes.push(plural(escondidos.done, 'concluído', 'concluídos'))
    if (escondidos.interrupted) partes.push(plural(escondidos.interrupted, 'interrompido', 'interrompidos'))
    rotulo = `+ ${partes.join(' · ')}`
  }
  return (
    <div
      role="treeitem"
      aria-level={nivelAria}
      tabIndex={focavel ? 0 : -1}
      data-linha={linha.id}
      data-pai={linha.pai}
      data-tipo="mais"
      data-chave={linha.chave}
      className="linha linha-mais"
      onFocus={(e) => e.target === e.currentTarget && aoFocar(linha.id)}
      onClick={() => aoAlternarMais(linha.chave)}
    >
      <div className="linha-nome">
        <span className="linha-alca" aria-hidden />
        <Guias nivel={linha.nivel} />
        <span className="linha-seta" aria-hidden />
        <span className="linha-mais-texto">{rotulo}</span>
        <span className="mais-acao">{aberto ? 'recolher' : 'mostrar'}</span>
      </div>
    </div>
  )
}
