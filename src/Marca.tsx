/** O logo: o agente principal (o balão da marca, com a ponta para baixo) e os dois subagentes em ciano,
 *  formando um V. As tintas se misturam pelo .tinta (index.css): multiply no claro, screen no escuro. A
 *  mesma figura do ícone do app (src-tauri/icons/fonte.svg). */
export function Marca({ tamanho = 26 }: { tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 120 120" aria-hidden="true" style={{ isolation: 'isolate' }}>
      <g className="tinta">
        <path d="M60 82 L24 28" className="stroke-ciano" strokeWidth={14} strokeLinecap="round" fill="none" />
        <circle cx={24} cy={28} r={15} className="fill-ciano" />
      </g>
      <g className="tinta">
        <path d="M60 82 L96 28" className="stroke-ciano" strokeWidth={14} strokeLinecap="round" fill="none" />
        <circle cx={96} cy={28} r={15} className="fill-ciano" />
      </g>
      <path
        d="M60 65 A17 17 0 0 1 77 82 A17 17 0 0 1 60 99 L43 99 L43 82 A17 17 0 0 1 60 65 Z"
        transform="rotate(-45 60 82)"
        className="tinta fill-texto"
      />
    </svg>
  )
}
