// O tema na página: o data-tema do <html> (que o index.css lê) e o espelho no localStorage, que o
// script do <head> do index.html lê antes da primeira pintura. A fonte é o preferencias.json (pela casca).

import type { Tema } from './api.ts'

export type TemaAplicado = 'claro' | 'escuro'

/** A chave do espelho. O script do <head> do index.html a repete. */
export const CHAVE_DO_TEMA = 'vagents.tema'

/** "sistema" segue o Windows. */
export function resolverTema(tema: Tema, sistemaEscuro: boolean): TemaAplicado {
  if (tema === 'sistema') return sistemaEscuro ? 'escuro' : 'claro'
  return tema
}

export function aplicarTema(escolhido: Tema, aplicado: TemaAplicado): void {
  document.documentElement.dataset.tema = aplicado
  try {
    localStorage.setItem(CHAVE_DO_TEMA, escolhido)
  } catch {
    // Sem o espelho: a próxima abertura pode piscar no tema do Windows antes de trocar.
  }
}
