/** O crédito do autor: o símbolo da marca Vinícius Ventura e o nome, com o link para o site. */

const SITE = 'https://viniciusventura.com.br'

/**
 * O símbolo da marca (do pacote assets/marca do site): o V com o "chapéu" da econometria (o ŷ). O chapéu
 * é sempre o ciano; o V acompanha o texto, tinta no claro e papel no escuro, como pede o manual.
 */
export function SimboloDoAutor({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 58.66 78.68" className={className} aria-hidden="true" focusable="false">
      <polygon points="11.09,18.24 29.33,0 47.57,18.24 39.09,18.24 29.33,8.48 19.57,18.24" className="fill-ciano" />
      <polygon points="0,32.24 10.66,32.24 29.33,61.8 48,32.24 58.66,32.24 29.33,78.68" fill="currentColor" />
    </svg>
  )
}

/** "Desenvolvido por Vinícius Ventura", no fim dos Ajustes. Abre o site no navegador. */
export function Credito() {
  return (
    <a href={SITE} target="_blank" rel="noreferrer" className="credito" title="viniciusventura.com.br">
      <span className="credito-por">Desenvolvido por</span>
      <span className="credito-assinatura">
        <SimboloDoAutor className="credito-simbolo" />
        <span className="credito-nome">Vinícius Ventura</span>
      </span>
    </a>
  )
}
