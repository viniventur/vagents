import '@fontsource-variable/source-serif-4/wght.css'
import '@fontsource-variable/source-serif-4/wght-italic.css'
import '@xyflow/react/dist/style.css'
import './styles/index.css'
import { IconContext } from '@phosphor-icons/react'
import { StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { Aviso, type DadosDoAviso } from './Aviso.tsx'
import { dentroDoApp } from './lib/api.ts'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Faltou o <div id="raiz"> no index.html')

// A mesma página serve a janela principal e os popups de aviso: a casca põe os dados do aviso aqui.
// Num navegador comum, "?aviso" mostra um popup de exemplo (para mexer no visual e para as capturas);
// "?aviso=terminou", o de uma sessão que terminou.
const pedido = new URLSearchParams(location.search).get('aviso')
const exemplo: DadosDoAviso =
  pedido === 'terminou'
    ? { tipo: 'terminou', titulo: 'Checkout com Pix', motivo: 'Terminou em 4 min', projeto: 'loja-web', chave: '' }
    : { tipo: 'esperando', titulo: 'Checkout com Pix', motivo: 'Esperando uma resposta sua', projeto: 'loja-web', chave: '' }
const aviso =
  (window as unknown as { __AVISO__?: DadosDoAviso }).__AVISO__ ?? (!dentroDoApp() && pedido !== null ? exemplo : undefined)
if (aviso) document.documentElement.dataset.janela = 'aviso'

/** No exemplo, "&atraso=600" faz o popup entrar depois de 600 ms (para gravar a entrada). */
function Atrasado({ ms, children }: { ms: number; children: ReactNode }) {
  const [visivel, setVisivel] = useState(ms <= 0)
  useEffect(() => {
    const timer = setTimeout(() => setVisivel(true), ms)
    return () => clearTimeout(timer)
  }, [ms])
  return visivel ? children : null
}
const atraso = Number(new URLSearchParams(location.search).get('atraso')) || 0

createRoot(raiz).render(
  <StrictMode>
    <IconContext.Provider value={{ weight: 'duotone', size: 18 }}>
      {aviso ? (
        <Atrasado ms={atraso}>
          <Aviso dados={aviso} />
        </Atrasado>
      ) : (
        <App />
      )}
    </IconContext.Provider>
  </StrictMode>,
)
