// Copiar um texto para a área de transferência (o painel e o menu do botão direito).

/** Copia pelo navegador; se ele recusar, pelo jeito antigo (um campo escondido e o "copiar"). */
export async function copiarTexto(texto: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto)
    return
  } catch {
    const campo = document.createElement('textarea')
    campo.value = texto
    campo.style.position = 'fixed'
    campo.style.opacity = '0'
    document.body.appendChild(campo)
    campo.select()
    document.execCommand('copy')
    campo.remove()
  }
}
