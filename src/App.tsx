import {
  ArrowsInLineVertical,
  ArrowsOutLineVertical,
  CornersOut,
  Desktop,
  GearSix,
  MagicWand,
  Moon,
  Plus,
  Sun,
  TreeStructure,
  TreeView,
} from '@phosphor-icons/react'
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
import { flushSync } from 'react-dom'
import type { SessionStatus, SessionView } from '../shared/model.ts'
import { Details, type AcoesDoPainel } from './Details.tsx'
import { edgeTypes } from './FlowEdge.tsx'
import {
  NowContext,
  useDobrasDaLista,
  useOrganizacao,
  usePreferencias,
  useRetrato,
  useStoredChoice,
  useStoredNumber,
  useTemaAplicado,
  useTicker,
} from './hooks.ts'
import {
  SEM_GRUPO,
  areaNoPonto,
  buildGraph,
  deslocarSessao,
  laneNodeId,
  marcarAlvo,
  sessionNodeId,
  type FlowNode,
  type Graph,
  type MoreNodeData,
} from './layout.ts'
import { api, type Tema } from './lib/api.ts'
import { TUDO_ABERTO, TUDO_FECHADO, abrirDobras, acaoDoTudo, alternarDobra, montarLista, type Lista } from './lib/lista.ts'
import {
  alternarRecolhido,
  apagarGrupo,
  corDaSessao,
  criarGrupo,
  definirCorDaSessao,
  definirCorDoGrupo,
  definirRegraDePasta,
  grupoDaSessao,
  moverGrupo,
  moverSessao,
  nomeDaSessao,
  novoIdDeGrupo,
  posicionarSessoes,
  renomearGrupo,
  renomearSessao,
  reorganizar,
  temPosicoes,
} from './lib/organizacao.ts'
import { ContasDoClaude } from './ContasDoClaude.tsx'
import { Credito } from './Credito.tsx'
import { VistaEmLista, type Destaque } from './Lista.tsx'
import { Marca } from './Marca.tsx'
import { AcoesContext, nodeTypes, type Acoes, type AlvoDaCor } from './nodes.tsx'
import { SeletorDeCor, type Ancora } from './SeletorDeCor.tsx'
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
type Vista = 'mapa' | 'lista'
const VISTAS: readonly Vista[] = ['mapa', 'lista']
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
  /** No mapa o próprio card anda com o ponteiro; na lista, um fantasma. */
  noMapa: boolean
}

/** O canto do card arrastado no mapa, em coordenadas do canvas. */
interface CardArrastado {
  chave: string
  x: number
  y: number
}

/** O seletor de cor aberto: para quem, junto de que botão e se veio do teclado. */
interface SeletorAberto {
  alvo: AlvoDaCor
  ancora: Ancora
  botao: HTMLElement
  peloTeclado: boolean
}

const mesmoAlvo = (a: AlvoDaCor, b: AlvoDaCor) =>
  a.tipo === 'grupo' ? b.tipo === 'grupo' && a.id === b.id : b.tipo === 'sessao' && a.chave === b.chave

function Tela() {
  const { retrato, noApp } = useRetrato()
  const [org, mudarOrg] = useOrganizacao()
  const [prefs, definirPrefs] = usePreferencias()
  const temaAplicado = useTemaAplicado(prefs.tema)
  const now = useTicker(1000)
  const [vista, setVista] = useStoredChoice<Vista>('vagents:vista', VISTAS, 'mapa')
  const [dobras, mudarDobras] = useDobrasDaLista()
  const [expandidos, setExpandidos] = useState<ReadonlySet<string>>(() => new Set())
  const [janelaEncerradas, setJanelaEncerradas] = useStoredNumber('vagents:encerradas', 3 * HORA)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState<Arrastando | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)
  const [cardArrastado, setCardArrastado] = useState<CardArrastado | null>(null)
  const [acompanhar, setAcompanhar] = useState(true)
  const [enquadrarSessao, setEnquadrarSessao] = useState<string | null>(null)
  const [destaque, setDestaque] = useState<Destaque | null>(null)
  const [seletor, setSeletor] = useState<SeletorAberto | null>(null)
  const [ajustes, setAjustes] = useState(false)
  const [contasAbertas, setContasAbertas] = useState(false)
  const inicioDoMovimento = useRef<Viewport | null>(null)
  const fantasma = useRef<HTMLDivElement>(null)
  const ultimoArraste = useRef(0)
  const rf = useReactFlow()

  const noMapa = vista === 'mapa'
  const graphBase = useMemo<Graph | null>(
    () =>
      retrato && noMapa
        ? buildGraph(retrato, {
            expanded: expandidos,
            endedWindowMs: janelaEncerradas,
            selectedId: selecionado,
            organizacao: org,
            editandoGrupo,
          })
        : null,
    [retrato, noMapa, expandidos, janelaEncerradas, selecionado, org, editandoGrupo],
  )
  // Durante o arraste, só o grupo sob o ponteiro acende e só o card arrastado muda de lugar: o resto do
  // desenho são os mesmos objetos, e o React Flow não redesenha o que não mudou.
  const graphComAlvo = useMemo(() => graphBase && marcarAlvo(graphBase, alvo), [graphBase, alvo])
  const graph = useMemo(
    () =>
      graphComAlvo && cardArrastado ? deslocarSessao(graphComAlvo, cardArrastado.chave, cardArrastado.x, cardArrastado.y) : graphComAlvo,
    [graphComAlvo, cardArrastado],
  )
  const graphRef = useRef(graphBase)
  graphRef.current = graphBase
  const lista = useMemo<Lista | null>(
    () => (retrato && !noMapa ? montarLista(retrato, { endedWindowMs: janelaEncerradas, organizacao: org, abertos: expandidos }) : null),
    [retrato, noMapa, janelaEncerradas, org, expandidos],
  )
  const sessoes = useMemo(() => graph?.sessions ?? lista?.sessoes ?? [], [graph, lista])
  const selecao = selecionado ? (graph?.lookup ?? lista?.lookup)?.get(selecionado) : undefined
  const vistaRef = useRef(vista)
  vistaRef.current = vista
  const orgRef = useRef(org)
  orgRef.current = org

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
        if (vistaRef.current === 'mapa' && acompanharRef.current && el.clientWidth > 0 && el.clientHeight > 0) void rf.fitView({ padding: 0.06 })
      })
    })
    observador.observe(el)
    // A janela nasce escondida e aparece com o foco: aí o tamanho já é o final, então reenquadra.
    const aoMostrar = () => {
      if (!document.hidden && vistaRef.current === 'mapa' && acompanharRef.current) void rf.fitView({ padding: 0.06 })
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

  /** Leva às sessões: no mapa, enquadra; na lista, abre o grupo delas, rola até lá e as faz piscar. */
  const mostrar = useCallback(
    (alvos: SessionView[]) => {
      if (alvos.length === 0) return
      if (vistaRef.current === 'lista') {
        const o = orgRef.current
        if (o.grupos.length > 0) mudarDobras((d) => abrirDobras(d, alvos.map((s) => laneNodeId(grupoDaSessao(o, s) ?? SEM_GRUPO))))
        setDestaque((antes) => ({ chaves: alvos.map((s) => s.key), vez: (antes?.vez ?? 0) + 1 }))
        return
      }
      setAcompanhar(false)
      void rf.fitView({ nodes: alvos.map((s) => ({ id: sessionNodeId(s.key) })), padding: 0.15, duration: 450 })
    },
    [rf, mudarDobras],
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
    if (!sessaoPedida) return
    const sessao = sessoes.find((s) => s.key === sessaoPedida)
    if (!sessao) return
    setSessaoPedida(null)
    setSelecionado(sessionNodeId(sessao.key))
    mostrar([sessao])
  }, [sessaoPedida, sessoes, mostrar])

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

  /** Grava onde o card caiu no mapa (veja o iniciarArraste). Só lê refs e o mudarOrg. */
  const soltarNoMapa = useCallback(
    (chave: string, daqui: string, destino: string, topo: { x: number; y: number }) => {
      const g = graphRef.current
      if (!g) return
      const origem = g.origens.get(destino)
      const mudouDeGrupo = destino !== daqui
      mudarOrg((o) => {
        const nova = mudouDeGrupo ? moverSessao(o, chave, destino === SEM_GRUPO ? null : destino) : o
        // Grupo recolhido, ou um grupo que segue o automático: o card entra no fim dele, sem lugar marcado.
        if (!origem || (mudouDeGrupo && !g.manuais.has(destino))) return nova
        const comGrupos = o.grupos.length > 0
        const relativo = (x: number, y: number) =>
          comGrupos ? { x: Math.max(0, x - origem.x), y: Math.max(0, y - origem.y) } : { x: x - origem.x, y: y - origem.y }
        const marca = destino === SEM_GRUPO ? '' : destino
        // O grupo seguia o automático: os outros cards ficam onde estão, para nada pular de lugar.
        const fixar = g.manuais.has(destino)
          ? []
          : [...g.caixas].filter(([k, c]) => c.grupo === destino && k !== chave).map(([k, c]) => ({ chave: k, ...relativo(c.x, c.y), grupo: marca }))
        return posicionarSessoes(nova, [...fixar, { chave, ...relativo(topo.x, topo.y), grupo: marca }])
      })
    },
    [mudarOrg],
  )

  /**
   * Começa a arrastar uma sessão (pelo cabeçalho do card, ou pela linha na lista); só vira arraste depois
   * de 6 px (antes é clique). No mapa, o card anda com o ponteiro: solto no grupo dele, fica onde você o
   * deixou; num grupo arrumado à mão, entra onde caiu; num grupo automático, vai para o fim dele. Na lista
   * (e na área "solte aqui", nas duas), só muda de grupo.
   */
  const iniciarArraste = useCallback(
    (sessao: SessionView, nome: string, e: ReactPointerEvent) => {
      const x0 = e.clientX
      const y0 = e.clientY
      const base = vistaRef.current === 'mapa' ? graphRef.current?.caixas.get(sessao.key) : undefined
      const p0 = base ? rf.screenToFlowPosition({ x: x0, y: y0 }) : null
      const daqui = base?.grupo ?? grupoDaSessao(orgRef.current, sessao) ?? SEM_GRUPO
      let ativo = false
      /** O que está sob o ponteiro: um grupo, SEM_GRUPO, NOVO_GRUPO ou nada. */
      let sob: string | null = null
      let topo = base ? { x: base.x, y: base.y } : null
      let quadro = 0
      const mover = (ev: PointerEvent) => {
        if (!ativo) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return
          ativo = true
          // Arrastar não seleciona o texto por onde o ponteiro passa (nem o que os primeiros 6 px já pegaram).
          window.getSelection()?.removeAllRanges()
          document.documentElement.classList.add('arrastando')
          setArrastando({ chave: sessao.key, nome, projeto: sessao.project, x: ev.clientX, y: ev.clientY, noMapa: base !== undefined })
        }
        if (fantasma.current) {
          fantasma.current.style.left = `${ev.clientX}px`
          fantasma.current.style.top = `${ev.clientY}px`
        }
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        let agora: string | null
        if (el?.closest('[data-soltar-novo]')) agora = NOVO_GRUPO
        else if (!base) agora = el?.closest<HTMLElement>('[data-alvo-grupo]')?.dataset.alvoGrupo ?? null
        else {
          const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
          agora = areaNoPonto(graphRef.current?.areas ?? [], p.x, p.y)
        }
        if (agora !== sob) {
          sob = agora
          // O grupo de onde a sessão saiu não acende: mexer dentro dele é só mudar o card de lugar.
          setAlvo(agora === daqui ? null : agora)
        }
        if (base && p0) {
          const p = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
          const novo = { x: base.x + p.x - p0.x, y: base.y + p.y - p0.y }
          topo = novo
          cancelAnimationFrame(quadro)
          // Desenha ainda neste quadro: sem o flushSync, o React só atualizaria a tela depois da pintura,
          // e o card andaria um quadro atrás do ponteiro.
          quadro = requestAnimationFrame(() => flushSync(() => setCardArrastado({ chave: sessao.key, ...novo })))
        }
      }
      const terminar = (soltou: boolean) => {
        window.removeEventListener('pointermove', mover)
        window.removeEventListener('pointerup', aoSoltar)
        window.removeEventListener('keydown', aoTeclar)
        cancelAnimationFrame(quadro)
        document.documentElement.classList.remove('arrastando')
        setArrastando(null)
        setAlvo(null)
        setCardArrastado(null)
        if (!ativo) return
        ultimoArraste.current = Date.now()
        if (!soltou) return
        if (sob === NOVO_GRUPO) {
          criarGrupoCom(sessao)
          return
        }
        if (!base || !topo) {
          const destino = sob
          if (destino !== null && destino !== daqui) mudarOrg((o) => moverSessao(o, sessao.key, destino === SEM_GRUPO ? null : destino))
          return
        }
        // Você arrumou o mapa à mão: a tela para de se reenquadrar sozinha ("Enquadrar tudo" volta).
        setAcompanhar(false)
        soltarNoMapa(sessao.key, daqui, sob ?? daqui, topo)
      }
      const aoSoltar = () => terminar(true)
      const aoTeclar = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') terminar(false)
      }
      window.addEventListener('pointermove', mover)
      window.addEventListener('pointerup', aoSoltar)
      window.addEventListener('keydown', aoTeclar)
    },
    [rf, criarGrupoCom, mudarOrg, soltarNoMapa],
  )

  /** Abre o seletor de cor junto do botão (ou fecha, se já estava aberto para o mesmo grupo ou card). */
  const escolherCor = useCallback((alvo: AlvoDaCor, botao: HTMLElement, peloTeclado: boolean) => {
    const r = botao.getBoundingClientRect()
    setSeletor((aberto) => (aberto && mesmoAlvo(aberto.alvo, alvo) ? null : { alvo, ancora: { x: r.x, y: r.y, w: r.width, h: r.height }, botao, peloTeclado }))
  }, [])
  const mudarCor = useCallback(
    (alvo: AlvoDaCor, cor: string | null) =>
      mudarOrg((o) => (alvo.tipo === 'grupo' ? definirCorDoGrupo(o, alvo.id, cor) : definirCorDaSessao(o, alvo.chave, cor))),
    [mudarOrg],
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
      escolherCor,
    }),
    [iniciarArraste, mudarOrg, escolherCor],
  )

  const acoesDoPainel = useMemo<AcoesDoPainel>(
    () => ({
      renomearSessao: (chave, nome) => mudarOrg((o) => renomearSessao(o, chave, nome)),
      moverSessao: (chave, grupo) => mudarOrg((o) => moverSessao(o, chave, grupo)),
      criarGrupoCom,
      definirRegra: (pasta, grupo) => mudarOrg((o) => definirRegraDePasta(o, pasta, grupo)),
      escolherCor,
      definirCorDaSessao: (chave, cor) => mudarCor({ tipo: 'sessao', chave }, cor),
    }),
    [mudarOrg, criarGrupoCom, escolherCor, mudarCor],
  )

  // O que o seletor de cor mostra: o nome e a cor de agora do grupo ou do card. Se o grupo foi apagado,
  // ou a sessão saiu da tela, ou você trocou de vista, ele fecha.
  const noSeletor = useMemo(() => {
    if (!seletor) return null
    const a = seletor.alvo
    if (a.tipo === 'grupo') {
      const g = org.grupos.find((x) => x.id === a.id)
      return g ? { titulo: `Cor do grupo “${g.nome}”`, cor: g.cor ?? null } : null
    }
    const s = sessoes.find((x) => x.key === a.chave)
    return s ? { titulo: `Cor do card “${nomeDaSessao(org, s)}”`, cor: corDaSessao(org, a.chave) } : null
  }, [seletor, org, sessoes])
  useEffect(() => {
    if (seletor && !noSeletor) setSeletor(null)
  }, [seletor, noSeletor])
  useEffect(() => setSeletor(null), [vista])

  // O clique abre o painel só depois de 220 ms: se vier o segundo clique (renomear), o painel não abre
  // por cima do título.
  const selecaoPendente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const cancelar = () => clearTimeout(selecaoPendente.current)
    window.addEventListener('dblclick', cancelar, true)
    return () => window.removeEventListener('dblclick', cancelar, true)
  }, [])

  /** Abre ou fecha um "+N" (os subagentes antigos de um pai); vale para o mapa e para a lista. */
  const alternarMais = useCallback((chave: string) => {
    setExpandidos((antes) => {
      const depois = new Set(antes)
      if (depois.has(chave)) depois.delete(chave)
      else depois.add(chave)
      return depois
    })
  }, [])

  /** O clique que seleciona: espera o tempo de um duplo clique (renomear) antes de abrir o painel. */
  const clicarParaSelecionar = useCallback((id: string) => {
    if (Date.now() - ultimoArraste.current < 250) return
    clearTimeout(selecaoPendente.current)
    selecaoPendente.current = setTimeout(() => setSelecionado((antes) => (antes === id ? null : id)), 220)
  }, [])

  const aoClicarNo = useCallback(
    (_: unknown, node: Node) => {
      if (Date.now() - ultimoArraste.current < 250) return
      const n = node as FlowNode
      if (n.type === 'lane') return
      if (n.type === 'more') {
        const { groupKey, sessionKey } = n.data as MoreNodeData
        alternarMais(groupKey)
        setAcompanhar(false)
        setEnquadrarSessao(sessionKey)
        return
      }
      clicarParaSelecionar(n.id)
    },
    [alternarMais, clicarParaSelecionar],
  )

  const alternarNaLista = useCallback((id: string) => mudarDobras((d) => alternarDobra(d, id)), [mudarDobras])
  const escolherNaLista = useCallback((id: string) => setSelecionado((antes) => (antes === id ? null : id)), [])
  const acaoDaLista = lista ? acaoDoTudo(lista, dobras) : null
  const arrumadoAMao = temPosicoes(org)

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
  for (const s of sessoes) contagem[s.status]++
  const esperando = sessoes.filter((s) => s.status === 'waiting')
  const temConteudo = noMapa ? (graph?.nodes.length ?? 0) > 0 : lista !== null && (lista.sessoes.length > 0 || lista.temGrupos)

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
                onClick={() => mostrar(sessoes.filter((s) => s.status === status))}
                title={contagem[status] ? (noMapa ? 'Enquadrar essas sessões' : 'Mostrar essas sessões') : undefined}
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
                  onClick={() => mostrar([s])}
                  title={s.lastPrompt}
                >
                  {nomeDaSessao(org, s)}
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <div className="seg" role="group" aria-label="Visualização">
              <button
                type="button"
                className="seg-opcao"
                aria-pressed={noMapa}
                onClick={() => setVista('mapa')}
                title="As sessões num mapa, com a árvore dos agentes"
              >
                <TreeStructure /> Mapa
              </button>
              <button
                type="button"
                className="seg-opcao"
                aria-pressed={!noMapa}
                onClick={() => setVista('lista')}
                title="As sessões numa lista, com a árvore dos agentes"
              >
                <TreeView /> Lista
              </button>
            </div>
            <button type="button" className="btn btn-secundario btn-pequeno" onClick={() => criarGrupoCom(null)}>
              <Plus /> Novo grupo
            </button>
            {noMapa ? (
              <>
                <button
                  type="button"
                  className="btn btn-secundario btn-pequeno"
                  disabled={!arrumadoAMao}
                  onClick={() => {
                    mudarOrg(reorganizar)
                    setAcompanhar(true)
                  }}
                  title={
                    arrumadoAMao
                      ? 'Volta todos os cards para a organização automática'
                      : 'Os cards já estão na organização automática. Arraste um card pelo cabeçalho para mudá-lo de lugar.'
                  }
                >
                  <MagicWand /> Reorganizar
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
              </>
            ) : (
              <button
                type="button"
                className="btn btn-secundario btn-pequeno"
                disabled={acaoDaLista === null}
                onClick={() => mudarDobras(() => (acaoDaLista === 'expandir' ? TUDO_ABERTO : TUDO_FECHADO))}
                title={acaoDaLista === 'expandir' ? 'Abre os grupos, as sessões e os agentes' : 'Fecha os grupos, as sessões e os agentes'}
              >
                {acaoDaLista === 'expandir' ? <ArrowsOutLineVertical /> : <ArrowsInLineVertical />}
                {acaoDaLista === 'expandir' ? 'Expandir tudo' : 'Recolher tudo'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-icone btn-secundario"
              aria-label={temaAplicado === 'escuro' ? 'Tema escuro: clique para o claro' : 'Tema claro: clique para o escuro'}
              title={temaAplicado === 'escuro' ? 'Tema escuro: clique para o claro' : 'Tema claro: clique para o escuro'}
              onClick={() => definirPrefs({ ...prefs, tema: temaAplicado === 'escuro' ? 'claro' : 'escuro' })}
            >
              {temaAplicado === 'escuro' ? <Moon /> : <Sun />}
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
          {temConteudo ? (
            <AcoesContext.Provider value={acoes}>
              {graph && noMapa ? (
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
                <MiniMap pannable zoomable position="bottom-right" nodeClassName={classeNoMinimapa} nodeColor={corNoMinimapa} />
              </ReactFlow>
              ) : lista ? (
                <VistaEmLista
                  lista={lista}
                  dobras={dobras}
                  selecionado={selecionado}
                  alvo={alvo}
                  editandoGrupo={editandoGrupo}
                  destaque={destaque}
                  comPainel={selecao !== undefined}
                  aoAlternar={alternarNaLista}
                  aoAlternarMais={alternarMais}
                  aoClicar={clicarParaSelecionar}
                  aoEscolher={escolherNaLista}
                />
              ) : null}
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

      {seletor && noSeletor && (
        <SeletorDeCor
          key={seletor.alvo.tipo === 'grupo' ? `g:${seletor.alvo.id}` : `s:${seletor.alvo.chave}`}
          titulo={noSeletor.titulo}
          cor={noSeletor.cor}
          ancora={seletor.ancora}
          botao={seletor.botao}
          peloTeclado={seletor.peloTeclado}
          aoMudar={(cor) => mudarCor(seletor.alvo, cor)}
          aoFechar={() => setSeletor(null)}
        />
      )}

      {arrastando && !arrastando.noMapa && (
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

/** No minimapa, o grupo e o card com cor escolhida aparecem com ela (os outros ficam com a do CSS). */
function corNoMinimapa(node: Node): string {
  const n = node as FlowNode
  if (n.type === 'lane' && n.data.grupo?.cor) return `color-mix(in oklab, ${n.data.grupo.cor} 22%, var(--faixa))`
  if (n.type === 'session' && n.data.cor) return `color-mix(in oklab, ${n.data.cor} 30%, var(--sessao))`
  return ''
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
