import { CornersOut, Desktop, GearSix, Moon, Plus, Sun } from '@phosphor-icons/react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Node,
  type Viewport,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { SessionStatus, SessionView } from '../shared/model.ts'
import { Details, type AcoesDoPainel } from './Details.tsx'
import { edgeTypes } from './FlowEdge.tsx'
import { NowContext, useOrganizacao, usePreferencias, useRetrato, useStoredNumber, useTemaAplicado, useTicker } from './hooks.ts'
import { SEM_GRUPO, areaNoPonto, buildGraph, sessionNodeId, type FlowNode, type Graph, type MoreNodeData } from './layout.ts'
import { api, type Tema } from './lib/api.ts'
import {
  alternarRecolhido,
  apagarGrupo,
  criarGrupo,
  definirRegraDePasta,
  grupoDaSessao,
  moverGrupo,
  moverSessao,
  nomeDaSessao,
  novoIdDeGrupo,
  renomearGrupo,
  renomearSessao,
} from './lib/organizacao.ts'
import { ContasDoClaude } from './ContasDoClaude.tsx'
import { Credito } from './Credito.tsx'
import { Marca } from './Marca.tsx'
import { AcoesContext, nodeTypes, type Acoes } from './nodes.tsx'
import { SESSION_STATUS } from './text.ts'

const HORA = 3_600_000
const JANELAS_DAS_ENCERRADAS = [
  { valor: 0, rotulo: 'não mostrar' },
  { valor: 1 * HORA, rotulo: 'da última hora' },
  { valor: 3 * HORA, rotulo: 'das últimas 3 h' },
  { valor: 24 * HORA, rotulo: 'das últimas 24 h' },
]
const ORDEM: SessionStatus[] = ['waiting', 'running', 'idle', 'ended']
/**
 * O enquadramento inicial, num objeto fixo: o React Flow copia esta prop para o estado dele sempre que ela
 * muda, e um objeto novo a cada render apagava as opções de um fitView pedido (enquadrar uma sessão)
 * antes de ele rodar, no quadro seguinte.
 */
const ENQUADRAMENTO = { padding: 0.06 }
/** O alvo "criar um grupo novo" do arraste (a área que aparece na barra). */
const NOVO_GRUPO = '__novo-grupo__'
const TEMAS: { tema: Tema; rotulo: string; icone: ReactNode }[] = [
  { tema: 'claro', rotulo: 'Claro', icone: <Sun /> },
  { tema: 'escuro', rotulo: 'Escuro', icone: <Moon /> },
  { tema: 'sistema', rotulo: 'Como o Windows', icone: <Desktop /> },
]

export function App() {
  return (
    <ReactFlowProvider>
      <Tela />
    </ReactFlowProvider>
  )
}

interface Arrastando {
  chave: string
  nome: string
  projeto: string
  x: number
  y: number
}

function Tela() {
  const { retrato, noApp } = useRetrato()
  const [org, mudarOrg] = useOrganizacao()
  const [prefs, definirPrefs] = usePreferencias()
  const temaAplicado = useTemaAplicado(prefs.tema)
  const now = useTicker(1000)
  const [expandidos, setExpandidos] = useState<ReadonlySet<string>>(() => new Set())
  const [janelaEncerradas, setJanelaEncerradas] = useStoredNumber('vagents:encerradas', 3 * HORA)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState<Arrastando | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)
  const [acompanhar, setAcompanhar] = useState(true)
  const [enquadrarSessao, setEnquadrarSessao] = useState<string | null>(null)
  const [ajustes, setAjustes] = useState(false)
  const [contasAbertas, setContasAbertas] = useState(false)
  const inicioDoMovimento = useRef<Viewport | null>(null)
  const fantasma = useRef<HTMLDivElement>(null)
  const ultimoArraste = useRef(0)
  const rf = useReactFlow()

  const graph = useMemo<Graph | null>(
    () =>
      retrato
        ? buildGraph(retrato, {
            expanded: expandidos,
            endedWindowMs: janelaEncerradas,
            selectedId: selecionado,
            organizacao: org,
            editandoGrupo,
            alvo,
          })
        : null,
    [retrato, expandidos, janelaEncerradas, selecionado, org, editandoGrupo, alvo],
  )
  const graphRef = useRef(graph)
  graphRef.current = graph
  const selecao = selecionado ? graph?.lookup.get(selecionado) : undefined

  // A janela nasce escondida: aparece quando a tela já tem o que mostrar.
  useEffect(() => {
    if (noApp) void api.janelaPronta().catch(() => undefined)
  }, [noApp])

  // Enquanto você não mexe no canvas, ele acompanha: entra sessão, sai sessão, tudo segue enquadrado.
  useEffect(() => {
    // Com uma sessão no meio do arraste, a tela não se mexe (o alvo ficaria fora do lugar).
    if (!graph || graph.nodes.length === 0 || arrastando) return
    if (enquadrarSessao) {
      setEnquadrarSessao(null)
      void rf.fitView({ nodes: [{ id: sessionNodeId(enquadrarSessao) }], padding: 0.06, duration: 400 })
      return
    }
    if (acompanhar) void rf.fitView({ padding: 0.06, duration: 300 })
  }, [acompanhar, enquadrarSessao, graph?.boundsKey, rf, arrastando === null])

  // Links externos (o do React Flow, por exemplo) abrem no navegador, não dentro da janela.
  useEffect(() => {
    if (!noApp) return
    const aoClicar = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[href^="https://"]') as HTMLAnchorElement | null
      if (!link) return
      e.preventDefault()
      void api.abrirLink(link.href).catch(() => undefined)
    }
    document.addEventListener('click', aoClicar, true)
    return () => document.removeEventListener('click', aoClicar, true)
  }, [noApp])

  // A janela nasce escondida e muda de tamanho (maximizar, arrastar a borda): no modo acompanhar, o
  // desenho se reenquadra sempre que o espaço do canvas muda.
  const canvas = useRef<HTMLElement>(null)
  const acompanharRef = useRef(acompanhar)
  acompanharRef.current = acompanhar
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let quadro = 0
    const observador = new ResizeObserver(() => {
      cancelAnimationFrame(quadro)
      quadro = requestAnimationFrame(() => {
        if (acompanharRef.current && el.clientWidth > 0 && el.clientHeight > 0) void rf.fitView({ padding: 0.06 })
      })
    })
    observador.observe(el)
    // A janela nasce escondida e aparece com o foco: aí o tamanho já é o final, então reenquadra.
    const aoMostrar = () => {
      if (!document.hidden && acompanharRef.current) void rf.fitView({ padding: 0.06 })
    }
    document.addEventListener('visibilitychange', aoMostrar)
    window.addEventListener('focus', aoMostrar)
    return () => {
      cancelAnimationFrame(quadro)
      observador.disconnect()
      document.removeEventListener('visibilitychange', aoMostrar)
      window.removeEventListener('focus', aoMostrar)
    }
  }, [rf])

  // Quando o React Flow termina de medir os nós (ao abrir, ou quando entram nós novos), reenquadra.
  const nosMedidos = useNodesInitialized()
  useEffect(() => {
    if (nosMedidos && acompanharRef.current) void rf.fitView({ padding: 0.06 })
  }, [nosMedidos, rf])

  const enquadrar = useCallback(
    (sessoes: SessionView[]) => {
      if (sessoes.length === 0) return
      setAcompanhar(false)
      void rf.fitView({ nodes: sessoes.map((s) => ({ id: sessionNodeId(s.key) })), padding: 0.15, duration: 450 })
    },
    [rf],
  )

  // O clique num popup de aviso abre a sessão dele: pelo evento (janela já aberta) ou pelo pedido
  // guardado na casca (janela recriada agora).
  const [sessaoPedida, setSessaoPedida] = useState<string | null>(null)
  useEffect(() => {
    if (!noApp) return
    void api.sessaoPendente().then((chave) => chave && setSessaoPedida(chave), () => undefined)
    const parar = api.aoFocarSessao((chave) => {
      setSessaoPedida(chave)
      void api.sessaoPendente().catch(() => undefined)
    })
    return () => void parar.then((f) => f())
  }, [noApp])
  useEffect(() => {
    if (!sessaoPedida || !graph) return
    const sessao = graph.sessions.find((s) => s.key === sessaoPedida)
    if (!sessao) return
    setSessaoPedida(null)
    setSelecionado(sessionNodeId(sessao.key))
    enquadrar([sessao])
  }, [sessaoPedida, graph, enquadrar])

  const criarGrupoCom = useCallback(
    (sessao: SessionView | null) => {
      const id = novoIdDeGrupo()
      mudarOrg((o) => {
        const criado = criarGrupo(o, undefined, id).org
        return sessao ? moverSessao(criado, sessao.key, id) : criado
      })
      setEditandoGrupo(id)
      setAcompanhar(true)
    },
    [mudarOrg],
  )

  /** Começa a arrastar uma sessão pelo cabeçalho; só vira arraste depois de 6 px (antes é clique). */
  const iniciarArraste = useCallback(
    (sessao: SessionView, nome: string, e: ReactPointerEvent) => {
      const x0 = e.clientX
      const y0 = e.clientY
      let ativo = false
      let alvoAtual: string | null = null
      const mover = (ev: PointerEvent) => {
        if (!ativo) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
          ativo = true
          setArrastando({ chave: sessao.key, nome, projeto: sessao.project, x: ev.clientX, y: ev.clientY })
        }
        if (fantasma.current) {
          fantasma.current.style.left = `${ev.clientX}px`
          fantasma.current.style.top = `${ev.clientY}px`
        }
        const sob = document.elementFromPoint(ev.clientX, ev.clientY)
        let novo: string | null
        if (sob?.closest('[data-soltar-novo]')) novo = NOVO_GRUPO
        else {
          const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
          novo = areaNoPonto(graphRef.current?.areas ?? [], p.x, p.y)
        }
        if (novo !== alvoAtual) {
          alvoAtual = novo
          setAlvo(novo)
        }
      }
      const terminar = (soltou: boolean) => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', aoSoltar)
        window.removeEventListener('keydown', aoTeclar)
        setArrastando(null)
        setAlvo(null)
        if (!ativo) return
        ultimoArraste.current = Date.now()
        if (!soltou || alvoAtual === null) return
        if (alvoAtual === NOVO_GRUPO) {
          criarGrupoCom(sessao)
          return
        }
        const destino = alvoAtual === SEM_GRUPO ? null : alvoAtual
        mudarOrg((o) => (grupoDaSessao(o, sessao) === destino ? o : moverSessao(o, sessao.key, destino)))
      }
      const aoSoltar = () => terminar(true)
      const aoTeclar = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') terminar(false)
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', aoSoltar)
      window.addEventListener('keydown', aoTeclar)
    },
    [rf, criarGrupoCom, mudarOrg],
  )

  const acoes = useMemo<Acoes>(
    () => ({
      iniciarArraste,
      renomearSessao: (chave, nome) => mudarOrg((o) => renomearSessao(o, chave, nome)),
      editarGrupo: setEditandoGrupo,
      renomearGrupo: (id, nome) => mudarOrg((o) => renomearGrupo(o, id, nome)),
      recolherGrupo: (id) => mudarOrg((o) => alternarRecolhido(o, id)),
      moverGrupo: (id, direcao) => mudarOrg((o) => moverGrupo(o, id, direcao)),
      apagarGrupo: (id) => mudarOrg((o) => apagarGrupo(o, id)),
    }),
    [iniciarArraste, mudarOrg],
  )

  const acoesDoPainel = useMemo<AcoesDoPainel>(
    () => ({
      renomearSessao: (chave, nome) => mudarOrg((o) => renomearSessao(o, chave, nome)),
      moverSessao: (chave, grupo) => mudarOrg((o) => moverSessao(o, chave, grupo)),
      criarGrupoCom,
      definirRegra: (pasta, grupo) => mudarOrg((o) => definirRegraDePasta(o, pasta, grupo)),
    }),
    [mudarOrg, criarGrupoCom],
  )

  // O clique abre o painel só depois de 220 ms: se vier o segundo clique (renomear), o painel não abre
  // por cima do título.
  const selecaoPendente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const cancelar = () => clearTimeout(selecaoPendente.current)
    window.addEventListener('dblclick', cancelar, true)
    return () => window.removeEventListener('dblclick', cancelar, true)
  }, [])

  const aoClicarNo = useCallback((_: unknown, node: Node) => {
    if (Date.now() - ultimoArraste.current < 250) return
    const n = node as FlowNode
    if (n.type === 'lane') return
    if (n.type === 'more') {
      const { groupKey, sessionKey } = n.data as MoreNodeData
      setExpandidos((antes) => {
        const depois = new Set(antes)
        if (depois.has(groupKey)) depois.delete(groupKey)
        else depois.add(groupKey)
        return depois
      })
      setAcompanhar(false)
      setEnquadrarSessao(sessionKey)
      return
    }
    clearTimeout(selecaoPendente.current)
    selecaoPendente.current = setTimeout(() => setSelecionado((antes) => (antes === n.id ? null : n.id)), 220)
  }, [])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelecionado(null)
        setAjustes(false)
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [])

  const contagem = { waiting: 0, running: 0, idle: 0, ended: 0 } as Record<SessionStatus, number>
  for (const s of graph?.sessions ?? []) contagem[s.status]++
  const esperando = graph?.sessions.filter((s) => s.status === 'waiting') ?? []

  return (
    <NowContext.Provider value={now}>
      <div className="grid h-full grid-rows-[auto_1fr]">
        <header className="barra">
          <div className="flex items-center gap-2.5">
            <Marca />
            <span className="marca-nome">vAgents</span>
          </div>

          <nav className="flex flex-wrap gap-1.5" aria-label="Sessões por estado">
            {ORDEM.map((status) => (
              <button
                key={status}
                type="button"
                className={`contador is-${status}`}
                disabled={contagem[status] === 0}
                onClick={() => enquadrar(graph?.sessions.filter((s) => s.status === status) ?? [])}
                title={contagem[status] ? 'Enquadrar essas sessões' : undefined}
              >
                <span className="ponto" aria-hidden />
                <span className="contador-n">{contagem[status]}</span>
                {SESSION_STATUS[status]}
              </button>
            ))}
          </nav>

          {esperando.length > 0 && (
            <div className="flex min-w-0 flex-wrap gap-1.5" aria-label="Esperando você">
              {esperando.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="tag tag-magenta esperando-item"
                  onClick={() => enquadrar([s])}
                  title={s.lastPrompt}
                >
                  {nomeDaSessao(org, s)}
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="btn btn-secundario btn-pequeno" onClick={() => criarGrupoCom(null)}>
              <Plus /> Novo grupo
            </button>
            <button
              type="button"
              className="btn btn-icone btn-secundario"
              aria-label={temaAplicado === 'escuro' ? 'Tema escuro: clique para o claro' : 'Tema claro: clique para o escuro'}
              title={temaAplicado === 'escuro' ? 'Tema escuro: clique para o claro' : 'Tema claro: clique para o escuro'}
              onClick={() => definirPrefs({ ...prefs, tema: temaAplicado === 'escuro' ? 'claro' : 'escuro' })}
            >
              {temaAplicado === 'escuro' ? <Moon /> : <Sun />}
            </button>
            <button
              type="button"
              className="btn btn-icone"
              aria-label="Enquadrar tudo"
              title="Enquadrar tudo"
              onClick={() => {
                setAcompanhar(true)
                void rf.fitView({ padding: 0.06, duration: 300 })
              }}
            >
              <CornersOut />
            </button>
            <Ajustes
              aberto={ajustes}
              alternar={() => setAjustes((a) => !a)}
              fechar={() => setAjustes(false)}
              tema={prefs.tema}
              definirTema={(tema) => definirPrefs({ ...prefs, tema })}
              avisar={prefs.avisar}
              som={prefs.som}
              iniciar={prefs.iniciarComWindows}
              janela={janelaEncerradas}
              definirAvisar={(avisar) => definirPrefs({ ...prefs, avisar })}
              definirSom={(som) => definirPrefs({ ...prefs, som })}
              abrirContas={() => {
                setAjustes(false)
                setContasAbertas(true)
              }}
              definirIniciar={(iniciarComWindows) => definirPrefs({ ...prefs, iniciarComWindows })}
              definirJanela={setJanelaEncerradas}
            />
          </div>
        </header>

        <main className="canvas" ref={canvas}>
          {arrastando && (
            <div data-soltar-novo className={`soltar-novo ${alvo === NOVO_GRUPO ? 'is-alvo' : ''}`}>
              Solte aqui para criar um grupo com ela
            </div>
          )}
          {graph && graph.nodes.length > 0 ? (
            <AcoesContext.Provider value={acoes}>
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={aoClicarNo}
                onPaneClick={() => setSelecionado(null)}
                onMoveStart={(event, viewport) => {
                  inicioDoMovimento.current = event ? viewport : null
                }}
                onMoveEnd={(event, viewport) => {
                  // Um clique também dispara o "move"; só um arrasto ou zoom de verdade tira do modo acompanhar.
                  const inicio = inicioDoMovimento.current
                  inicioDoMovimento.current = null
                  if (event && inicio && (inicio.x !== viewport.x || inicio.y !== viewport.y || inicio.zoom !== viewport.zoom)) {
                    setAcompanhar(false)
                  }
                }}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnDoubleClick={false}
                minZoom={0.05}
                maxZoom={1.75}
                fitView
                fitViewOptions={ENQUADRAMENTO}
                colorMode={temaAplicado === 'escuro' ? 'dark' : 'light'}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap pannable zoomable position="bottom-right" nodeClassName={classeNoMinimapa} />
              </ReactFlow>
            </AcoesContext.Provider>
          ) : (
            <Vazio noApp={noApp} carregado={retrato !== null} pastas={retrato?.configDirs ?? []} />
          )}
          {selecao && (
            <Details
              selecao={selecao}
              org={org}
              acoes={acoesDoPainel}
              aoFechar={() => setSelecionado(null)}
              aoEscolherSessao={(s) => setSelecionado(sessionNodeId(s.key))}
            />
          )}
        </main>
      </div>

      {contasAbertas && <ContasDoClaude aoFechar={() => setContasAbertas(false)} />}

      {arrastando && (
        <div ref={fantasma} className="fantasma" style={{ left: arrastando.x, top: arrastando.y }}>
          {arrastando.nome}
          <small>{arrastando.projeto} · solte num grupo</small>
        </div>
      )}
    </NowContext.Provider>
  )
}

function Ajustes(props: {
  aberto: boolean
  alternar: () => void
  fechar: () => void
  tema: Tema
  definirTema: (tema: Tema) => void
  avisar: boolean
  som: boolean
  iniciar: boolean
  janela: number
  definirAvisar: (v: boolean) => void
  definirSom: (v: boolean) => void
  abrirContas: () => void
  definirIniciar: (v: boolean) => void
  definirJanela: (v: number) => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const { aberto, fechar } = props
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as globalThis.Node)) fechar()
    }
    window.addEventListener('pointerdown', fora)
    return () => window.removeEventListener('pointerdown', fora)
  }, [aberto, fechar])
  return (
    <div className="relative" ref={caixa}>
      <button type="button" className="btn btn-icone" aria-label="Ajustes" title="Ajustes" aria-expanded={aberto} onClick={props.alternar}>
        <GearSix />
      </button>
      {aberto && (
        <div className="popover" role="dialog" aria-label="Ajustes">
          <h6 className="text-neutro-600">Ajustes</h6>
          <div className="flex flex-col gap-1.5">
            <span>Tema</span>
            <div className="seg self-start" role="group" aria-label="Tema">
              {TEMAS.map((t) => (
                <button
                  key={t.tema}
                  type="button"
                  className="seg-opcao"
                  aria-pressed={props.tema === t.tema}
                  onClick={() => props.definirTema(t.tema)}
                >
                  {t.icone}
                  {t.rotulo}
                </button>
              ))}
            </div>
          </div>
          <label className="checar">
            <input type="checkbox" checked={props.avisar} onChange={(e) => props.definirAvisar(e.target.checked)} />
            <span>Avisar com um popup no canto da tela quando uma sessão começar a esperar por mim</span>
          </label>
          <div className={`ml-6 flex items-center justify-between gap-3 ${props.avisar ? '' : 'opacity-50'}`}>
            <label className="checar">
              <input type="checkbox" disabled={!props.avisar} checked={props.som} onChange={(e) => props.definirSom(e.target.checked)} />
              <span>Com um som curto</span>
            </label>
            <button type="button" className="btn btn-fantasma btn-pequeno" onClick={() => void api.testarAviso().catch(() => undefined)}>
              Testar o aviso
            </button>
          </div>
          <label className="checar">
            <input type="checkbox" checked={props.iniciar} onChange={(e) => props.definirIniciar(e.target.checked)} />
            <span>Abrir com o Windows, só na bandeja</span>
          </label>
          <button type="button" className="btn btn-secundario btn-pequeno self-start" onClick={props.abrirContas}>
            Contas do Claude Code…
          </button>
          <label className="flex flex-col gap-1.5">
            <span>Mostrar as sessões encerradas</span>
            <select className="campo" value={props.janela} onChange={(e) => props.definirJanela(Number(e.target.value))}>
              {JANELAS_DAS_ENCERRADAS.map((j) => (
                <option key={j.valor} value={j.valor}>
                  {j.rotulo}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[12.5px] leading-snug text-neutro-600">
            Fechar a janela libera a memória dela, e o vAgents continua na bandeja, de olho nas sessões. Para sair de vez,
            use o menu da bandeja.
          </p>
          <Credito />
        </div>
      )}
    </div>
  )
}

function classeNoMinimapa(node: Node): string {
  const n = node as FlowNode
  switch (n.type) {
    case 'lane':
      return 'mm mm-faixa'
    case 'session':
      return `mm mm-sessao is-${n.data.session.status}`
    case 'main':
      return `mm is-${n.data.session.status}`
    case 'agent':
      return `mm is-${n.data.agent.status}`
    default:
      return 'mm'
  }
}

function Vazio({ noApp, carregado, pastas }: { noApp: boolean; carregado: boolean; pastas: string[] }) {
  if (!noApp) {
    return (
      <div className="vazio">
        <h4>Esta é a tela do app vAgents.</h4>
        <p>Aberta num navegador, ela não tem de onde ler as sessões. Abra pelo app (pnpm app).</p>
      </div>
    )
  }
  if (!carregado) return <div className="vazio">Lendo as sessões…</div>
  return (
    <div className="vazio">
      <h4>Nenhuma sessão do Claude Code aberta agora.</h4>
      <p>{pastas.length ? `Observando ${pastas.join(' e ')}.` : 'Nenhuma pasta do Claude Code encontrada.'}</p>
    </div>
  )
}
