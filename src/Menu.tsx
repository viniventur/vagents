import { CaretRight } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cls } from './nodes.tsx'

/** Um item do menu: uma ação, um submenu, um divisor ou um título (que só explica). */
export type ItemDoMenu =
  | { tipo: 'acao'; rotulo: string; dica?: string; atalho?: string; icone?: ReactNode; desativado?: boolean; aoEscolher: () => void }
  | { tipo: 'sub'; rotulo: string; icone?: ReactNode; desativado?: boolean; itens: ItemDoMenu[] }
  | { tipo: 'divisor' }
  | { tipo: 'titulo'; rotulo: string }

/** Onde o menu abre: no ponto do clique (o botão direito) ou embaixo de um botão (os três pontinhos). */
export type LugarDoMenu = { tipo: 'ponto'; x: number; y: number } | { tipo: 'botao'; rect: DOMRect }

type Lugar = LugarDoMenu | { tipo: 'sub'; rect: DOMRect }

const MARGEM = 6
/** O tempo de passar o mouse antes de abrir (ou trocar) um submenu: dá para ir na diagonal até ele. */
const DEMORA_MS = 140

/**
 * O menu do app, no lugar do menu do navegador: o do botão direito e o dos três pontinhos do painel. Fecha
 * com Esc, com um clique fora, ao escolher, ao rolar ou ao sair da janela. Pelo teclado: setas, Home, End,
 * Enter; a seta para a direita abre o submenu, a da esquerda volta.
 */
export function Menu({
  itens,
  lugar,
  rotulo,
  peloTeclado = false,
  gatilho,
  aoFechar,
}: {
  itens: ItemDoMenu[]
  lugar: LugarDoMenu
  rotulo: string
  /** O botão que abriu o menu: o clique nele não conta como "fora" (ele mesmo fecha o menu). */
  gatilho?: HTMLElement
  /** Aberto pelo teclado: o foco já vai para o primeiro item. */
  peloTeclado?: boolean
  aoFechar: () => void
}) {
  const fechar = useRef(aoFechar)
  fechar.current = aoFechar
  const botao = useRef(gatilho)
  botao.current = gatilho

  useEffect(() => {
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fora = (e: PointerEvent) => {
      if (e.target instanceof Node && botao.current?.contains(e.target)) return
      if (!(e.target instanceof Element) || !e.target.closest('[data-menu]')) fechar.current()
    }
    const sair = () => fechar.current()
    const rolar = (e: Event) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-menu]')) fechar.current()
    }
    window.addEventListener('pointerdown', fora, true)
    window.addEventListener('blur', sair)
    window.addEventListener('resize', sair)
    window.addEventListener('wheel', rolar, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('blur', sair)
      window.removeEventListener('resize', sair)
      window.removeEventListener('wheel', rolar, true)
      // O foco volta para onde estava (o botão dos três pontinhos, por exemplo), se ninguém o pegou.
      if (antes?.isConnected && (document.activeElement === document.body || document.activeElement === null)) {
        antes.focus({ preventScroll: true })
      }
    }
  }, [])

  return createPortal(
    <Painel itens={itens} lugar={lugar} rotulo={rotulo} focarPrimeiro={peloTeclado} aoFechar={() => fechar.current()} />,
    document.body,
  )
}

function itensFocaveis(caixa: HTMLElement | null): HTMLElement[] {
  if (!caixa) return []
  return [...caixa.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([aria-disabled="true"])')]
}

function Painel({
  itens,
  lugar,
  rotulo,
  focarPrimeiro,
  aoFechar,
  aoVoltar,
  aoEntrar,
}: {
  itens: ItemDoMenu[]
  lugar: Lugar
  rotulo: string
  focarPrimeiro: boolean
  aoFechar: () => void
  /** Só no submenu: fecha ele e devolve o foco ao item que o abriu. */
  aoVoltar?: () => void
  /** Só no submenu: o mouse chegou nele (o menu de cima não o fecha mais). */
  aoEntrar?: () => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [sub, setSub] = useState<{ indice: number; rect: DOMRect; focar: boolean } | null>(null)
  const espera = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Mede e cabe na janela: vira para a esquerda ou para cima quando não há espaço.
  useLayoutEffect(() => {
    const el = caixa.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left: number
    let top: number
    if (lugar.tipo === 'ponto') {
      left = lugar.x + w > vw - MARGEM ? lugar.x - w : lugar.x
      top = lugar.y + h > vh - MARGEM ? vh - MARGEM - h : lugar.y
    } else if (lugar.tipo === 'botao') {
      left = lugar.rect.right - w
      top = lugar.rect.bottom + 4
      if (top + h > vh - MARGEM) top = lugar.rect.top - 4 - h
    } else {
      left = lugar.rect.right - 3
      top = lugar.rect.top - 5
      if (left + w > vw - MARGEM) left = lugar.rect.left - w + 3
      if (top + h > vh - MARGEM) top = vh - MARGEM - h
    }
    setPos({ left: Math.max(MARGEM, Math.min(left, vw - MARGEM - w)), top: Math.max(MARGEM, top) })
  }, [lugar])

  const posicionado = pos !== null
  useEffect(() => {
    if (!posicionado) return
    if (focarPrimeiro) itensFocaveis(caixa.current)[0]?.focus({ preventScroll: true })
    else caixa.current?.focus({ preventScroll: true })
  }, [posicionado, focarPrimeiro])

  useEffect(() => () => clearTimeout(espera.current), [])

  const abrirSub = (indice: number, botao: HTMLElement, focar: boolean) => {
    clearTimeout(espera.current)
    setSub({ indice, rect: botao.getBoundingClientRect(), focar })
  }

  const aoTeclar = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // As teclas do submenu param nele (o painel de fora é o pai no DOM).
    if (e.target instanceof Node && !caixa.current?.contains(e.target)) return
    const focaveis = itensFocaveis(caixa.current)
    const atual = focaveis.indexOf(document.activeElement as HTMLElement)
    const ir = (i: number) => focaveis[(i + focaveis.length) % focaveis.length]?.focus({ preventScroll: true })
    const item = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let tratou = true
    switch (e.key) {
      case 'ArrowDown':
        ir(atual < 0 ? 0 : atual + 1)
        break
      case 'ArrowUp':
        ir(atual < 0 ? focaveis.length - 1 : atual - 1)
        break
      case 'Home':
        ir(0)
        break
      case 'End':
        ir(focaveis.length - 1)
        break
      case 'ArrowRight':
        if (item?.dataset.indice && item.getAttribute('aria-haspopup')) abrirSub(Number(item.dataset.indice), item, true)
        break
      case 'ArrowLeft':
        if (aoVoltar) aoVoltar()
        break
      case 'Escape':
        if (aoVoltar) aoVoltar()
        else aoFechar()
        break
      case 'Tab':
        aoFechar()
        break
      default:
        tratou = false
    }
    if (tratou) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const itemDoSub = sub ? itens[sub.indice] : undefined

  return (
    <div
      ref={caixa}
      data-menu
      role="menu"
      aria-label={rotulo}
      tabIndex={-1}
      className="menu"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
      onKeyDown={aoTeclar}
      onContextMenu={(e) => e.preventDefault()}
      onPointerEnter={() => aoEntrar?.()}
    >
      {itens.map((item, i) => {
        if (item.tipo === 'divisor') return <div key={i} role="separator" className="menu-divisor" />
        if (item.tipo === 'titulo')
          return (
            <div key={i} className="menu-titulo">
              {item.rotulo}
            </div>
          )
        const ehSub = item.tipo === 'sub'
        const aberto = ehSub && sub?.indice === i
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-indice={i}
            className={cls('menu-item', aberto && 'is-aberto')}
            aria-disabled={item.desativado || undefined}
            aria-haspopup={ehSub ? 'menu' : undefined}
            aria-expanded={ehSub ? aberto : undefined}
            onPointerEnter={(e) => {
              const botao = e.currentTarget
              if (!item.desativado && document.activeElement !== botao) botao.focus({ preventScroll: true })
              clearTimeout(espera.current)
              if (aberto) return
              espera.current = setTimeout(() => {
                if (ehSub && !item.desativado) setSub({ indice: i, rect: botao.getBoundingClientRect(), focar: false })
                else setSub(null)
              }, DEMORA_MS)
            }}
            onClick={(e) => {
              if (item.desativado) return
              if (item.tipo === 'sub') {
                abrirSub(i, e.currentTarget, e.detail === 0)
                return
              }
              aoFechar()
              item.aoEscolher()
            }}
          >
            <span className="menu-icone" aria-hidden>
              {item.icone}
            </span>
            <span className="menu-rotulo">
              {item.rotulo}
              {item.tipo === 'acao' && item.dica && <small>{item.dica}</small>}
            </span>
            {item.tipo === 'acao' && item.atalho && <kbd className="menu-atalho">{item.atalho}</kbd>}
            {ehSub && <CaretRight className="menu-seta" weight="bold" size={13} aria-hidden />}
          </button>
        )
      })}
      {sub && itemDoSub?.tipo === 'sub' && (
        <Painel
          itens={itemDoSub.itens}
          lugar={{ tipo: 'sub', rect: sub.rect }}
          rotulo={itemDoSub.rotulo}
          focarPrimeiro={sub.focar}
          aoFechar={aoFechar}
          aoEntrar={() => clearTimeout(espera.current)}
          aoVoltar={() => {
            const indice = sub.indice
            setSub(null)
            caixa.current?.querySelector<HTMLElement>(`:scope > [data-indice="${indice}"]`)?.focus({ preventScroll: true })
          }}
        />
      )}
    </div>
  )
}
