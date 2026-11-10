import { X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { api, type TipoDeAviso } from './lib/api.ts'
import { Marca } from './Marca.tsx'

/** O que a casca manda para o popup (src-tauri/src/aviso.rs, em window.__AVISO__). */
export interface DadosDoAviso {
  tipo?: TipoDeAviso
  titulo: string
  motivo: string
  projeto: string
  chave: string
}

/** Quanto tempo o popup fica, sem contar o tempo com o mouse em cima. */
const DURACAO = 9000

/** O popup de "esperando você" ou de "terminou": pequeno, no canto, sem roubar o foco. Some sozinho; o clique abre a sessão. */
export function Aviso({ dados }: { dados: DadosDoAviso }) {
  const [saindo, setSaindo] = useState(false)
  const [parado, setParado] = useState(false)
  const restante = useRef(DURACAO)

  const fechar = () => {
    setSaindo(true)
    setTimeout(() => void api.fecharAviso().catch(() => undefined), 180)
  }

  // O relógio só anda sem o mouse em cima: dá tempo de ler.
  useEffect(() => {
    if (parado || saindo) return
    const inicio = Date.now()
    const timer = setTimeout(fechar, restante.current)
    return () => {
      clearTimeout(timer)
      restante.current = Math.max(800, restante.current - (Date.now() - inicio))
    }
  }, [parado, saindo])

  return (
    <div
      className={`aviso ${dados.tipo === 'terminou' ? 'is-terminou' : ''} ${saindo ? 'is-saindo' : ''}`}
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      role="status"
    >
      <button type="button" className="aviso-corpo" onClick={() => void api.abrirSessao(dados.chave)} title="Abrir no vAgents">
        <Marca tamanho={28} />
        <span className="aviso-texto">
          <span className="aviso-motivo">
            <span className="ponto ponto-vivo" aria-hidden />
            {dados.motivo}
          </span>
          <strong className="aviso-titulo">{dados.titulo}</strong>
          <span className="aviso-projeto">{dados.projeto} · clique para abrir</span>
        </span>
      </button>
      <button type="button" className="aviso-fechar" aria-label="Fechar o aviso" onClick={fechar}>
        <X size={14} weight="bold" />
      </button>
      <span
        className="aviso-tempo"
        aria-hidden
        style={{ animationDuration: `${DURACAO}ms`, animationPlayState: parado || saindo ? 'paused' : 'running' }}
      />
    </div>
  )
}
