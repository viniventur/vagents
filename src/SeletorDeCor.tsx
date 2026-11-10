import { Check } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { CORES_PRONTAS, hexParaHsv, hsvParaHex, normalizarHex, type Hsv } from './lib/cor.ts'
import { cls } from './nodes.tsx'

/** O retângulo (na tela) do botão que abriu o seletor: ele aparece logo abaixo, ou acima se não couber. */
export interface Ancora {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  titulo: string
  /** A cor de agora (null: a de sempre). */
  cor: string | null
  ancora: Ancora
  /** O botão que abriu: clicar nele de novo fecha (em vez de reabrir), e o foco volta para ele. */
  botao: HTMLElement | null
  /** Abriu pelo teclado: o foco entra no seletor, no campo do hex. Pelo mouse, o foco fica onde estava. */
  peloTeclado: boolean
  aoMudar: (cor: string | null) => void
  aoFechar: () => void
}

/** De onde a área começa quando ainda não há cor escolhida: o ciano da marca. */
const INICIAL = '#0088b0'
const MARGEM = 8

const limitar = (x: number) => Math.min(1, Math.max(0, x))

/**
 * O "quadro cromático": a área de saturação e brilho, a faixa de matiz, o hex e as cores prontas. A cor
 * vai para a tela enquanto você mexe (no máximo uma vez por quadro); "Usar o padrão" volta à de sempre.
 */
export function SeletorDeCor({ titulo, cor, ancora, botao, peloTeclado, aoMudar, aoFechar }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexParaHsv(cor ?? INICIAL))
  const [texto, setTexto] = useState(cor ?? '')
  const [escolhida, setEscolhida] = useState<string | null>(cor)
  const [posicao, setPosicao] = useState<{ left: number; top: number } | null>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement>(null)
  const faixa = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLInputElement>(null)
  const hsvAgora = useRef(hsv)
  const aoMudarAgora = useRef(aoMudar)
  aoMudarAgora.current = aoMudar
  const aoFecharAgora = useRef(aoFechar)
  aoFecharAgora.current = aoFechar

  // A cor vai para a organização no máximo uma vez por quadro: arrastar na área muda a cada movimento.
  const pendente = useRef<{ cor: string | null } | null>(null)
  const quadro = useRef(0)
  const enviar = () => {
    cancelAnimationFrame(quadro.current)
    quadro.current = 0
    const p = pendente.current
    pendente.current = null
    if (p) aoMudarAgora.current(p.cor)
  }
  const aplicar = (nova: string | null, agora = false) => {
    setEscolhida(nova)
    pendente.current = { cor: nova }
    if (agora) enviar()
    else if (!quadro.current) quadro.current = requestAnimationFrame(enviar)
  }
  const mudarHsv = (novo: Hsv, agora = false) => {
    hsvAgora.current = novo
    setHsv(novo)
    const hex = hsvParaHex(novo)
    setTexto(hex)
    aplicar(hex, agora)
  }
  /** Uma cor pronta ou o hex digitado. No digitado, o campo fica como você escreveu (`manterTexto`). */
  const usarHex = (hex: string, manterTexto = false) => {
    const novo = hexParaHsv(hex)
    hsvAgora.current = novo
    setHsv(novo)
    if (!manterTexto) setTexto(hex)
    aplicar(hex, true)
  }
  /** O hex do campo vale ao sair dele (ou no Enter): aí até o curto, como #abc. Inválido volta ao de agora. */
  const confirmarTexto = () => {
    const valido = normalizarHex(texto)
    if (valido && valido !== escolhida) usarHex(valido)
    else setTexto(valido ?? escolhida ?? '')
  }

  // Logo abaixo do botão, sem sair da janela (acima dele, se embaixo não couber).
  useLayoutEffect(() => {
    const el = caixa.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.min(Math.max(MARGEM, ancora.x), window.innerWidth - width - MARGEM)
    let top = ancora.y + ancora.h + 6
    if (top + height > window.innerHeight - MARGEM) top = Math.max(MARGEM, ancora.y - height - 6)
    setPosicao({ left, top })
  }, [ancora])

  // Ao fechar, o foco, se estava aqui dentro, volta para o botão. (No layout effect: a limpeza dele roda
  // antes de o seletor sair da página; a do useEffect, depois, quando o foco já se perdeu.)
  useLayoutEffect(() => {
    const el = caixa.current
    return () => {
      if (el?.contains(document.activeElement) && botao?.isConnected) botao.focus()
    }
  }, [botao])

  // Fecha com Esc ou com um clique fora (o clique no próprio botão fica com ele, que fecha). Ao fechar,
  // o que estava pendente vai para a tela.
  useEffect(() => {
    if (peloTeclado) requestAnimationFrame(() => campo.current?.focus())
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node
      if (caixa.current?.contains(alvo) || botao?.contains(alvo)) return
      aoFecharAgora.current()
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      aoFecharAgora.current()
    }
    document.addEventListener('pointerdown', fora, true)
    document.addEventListener('keydown', tecla, true)
    return () => {
      document.removeEventListener('pointerdown', fora, true)
      document.removeEventListener('keydown', tecla, true)
      enviar()
    }
    // Só ao abrir e ao fechar (o resto vem pelas refs).
  }, [])

  const naArea = (e: ReactPointerEvent) => {
    const r = area.current?.getBoundingClientRect()
    if (!r) return
    mudarHsv({ ...hsvAgora.current, s: limitar((e.clientX - r.left) / r.width), v: 1 - limitar((e.clientY - r.top) / r.height) })
  }
  const naFaixa = (e: ReactPointerEvent) => {
    const r = faixa.current?.getBoundingClientRect()
    if (!r) return
    mudarHsv({ ...hsvAgora.current, h: limitar((e.clientX - r.left) / r.width) * 359.9 })
  }
  const arrastar = (mover: (e: ReactPointerEvent) => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      mover(e)
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) mover(e)
    },
    onPointerUp: enviar,
  })
  const teclaNaArea = (e: ReactKeyboardEvent) => {
    const passo = e.shiftKey ? 0.1 : 0.01
    const { h, s, v } = hsvAgora.current
    const mudancas: Record<string, Hsv> = {
      ArrowLeft: { h, s: limitar(s - passo), v },
      ArrowRight: { h, s: limitar(s + passo), v },
      ArrowUp: { h, s, v: limitar(v + passo) },
      ArrowDown: { h, s, v: limitar(v - passo) },
    }
    const novo = mudancas[e.key]
    if (!novo) return
    e.preventDefault()
    mudarHsv(novo, true)
  }
  const teclaNaFaixa = (e: ReactKeyboardEvent) => {
    const passo = e.shiftKey ? 10 : 1
    const { h } = hsvAgora.current
    const mudancas: Record<string, number> = {
      ArrowLeft: h - passo,
      ArrowDown: h - passo,
      ArrowRight: h + passo,
      ArrowUp: h + passo,
      Home: 0,
      End: 359.9,
    }
    const novo = mudancas[e.key]
    if (novo === undefined) return
    e.preventDefault()
    mudarHsv({ ...hsvAgora.current, h: Math.min(359.9, Math.max(0, novo)) }, true)
  }

  const hex = escolhida ?? hsvParaHex(hsv)
  return (
    <div
      ref={caixa}
      className="seletor-cor"
      role="dialog"
      aria-label={titulo}
      style={posicao ?? { visibility: 'hidden', left: 0, top: 0 }}
      onContextMenu={(e) => e.preventDefault()}
      // O mouse não tira o foco de onde ele está (o nome do grupo que você está digitando segue em edição
      // enquanto escolhe a cor); só o campo do hex, que precisa do teclado, fica com o foco.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest('input')) e.preventDefault()
      }}
    >
      <div className="seletor-topo">
        <span className="seletor-titulo" title={titulo}>
          {titulo}
        </span>
        <span className={cls('seletor-amostra', !escolhida && 'is-padrao')} style={escolhida ? { background: escolhida } : undefined} aria-hidden />
      </div>
      <div
        ref={area}
        className="seletor-area"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        role="slider"
        tabIndex={0}
        aria-label="Saturação (setas para os lados) e brilho (setas para cima e para baixo)"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
        onKeyDown={teclaNaArea}
        {...arrastar(naArea)}
      >
        <span className="seletor-alvo" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div
        ref={faixa}
        className="seletor-matiz"
        role="slider"
        tabIndex={0}
        aria-label="Matiz"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={teclaNaFaixa}
        {...arrastar(naFaixa)}
      >
        <span className="seletor-alvo" style={{ left: `${(hsv.h / 360) * 100}%`, top: '50%', background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <label className="seletor-hex">
        <span>Hex</span>
        <input
          ref={campo}
          className="campo"
          value={texto}
          placeholder={INICIAL}
          spellCheck={false}
          maxLength={7}
          aria-label="A cor em hexadecimal, como #0088b0"
          onChange={(e) => {
            setTexto(e.target.value)
            // Enquanto você digita, só o hex completo (6 dígitos) muda a cor: o "#2e9" do meio do caminho
            // não vira #22ee99.
            if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) usarHex(normalizarHex(e.target.value) as string, true)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            confirmarTexto()
            aoFechar()
          }}
          onBlur={confirmarTexto}
        />
      </label>
      <div className="seletor-prontas" role="group" aria-label="Cores prontas">
        {CORES_PRONTAS.map((c) => (
          <button
            key={c.hex}
            type="button"
            className={cls('seletor-pronta', escolhida === c.hex && 'is-escolhida')}
            style={{ '--cor': c.hex } as CSSProperties}
            aria-label={c.nome}
            aria-pressed={escolhida === c.hex}
            title={`${c.nome} (${c.hex})`}
            onClick={() => usarHex(c.hex)}
          />
        ))}
      </div>
      <div className="seletor-pe">
        <button
          type="button"
          className="btn btn-pequeno btn-secundario"
          disabled={escolhida === null}
          onClick={() => {
            aplicar(null, true)
            setTexto('')
            aoFechar()
          }}
        >
          Usar o padrão
        </button>
        <button type="button" className="btn btn-pequeno btn-primario" onClick={aoFechar}>
          <Check /> Pronto
        </button>
      </div>
    </div>
  )
}
