// A ponte com a casca (src-tauri/src/lib.rs): os comandos e os eventos do app.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Snapshot } from '../../shared/model.ts'
import type { Organizacao } from './organizacao.ts'

export type Tema = 'sistema' | 'claro' | 'escuro'

export interface Preferencias {
  tema: Tema
  /** O popup no canto da tela quando uma sessão começa a esperar por você. */
  avisar: boolean
  /** O toque curto junto com o popup. */
  som: boolean
  iniciarComWindows: boolean
}

/** Uma conta do Claude Code: a pasta de configuração, o nome que a tela mostra e o comando que a abre. */
export interface Conta {
  dir: string
  name: string
  command?: string
}

/** A página está dentro do app (e não num navegador comum)? */
export function dentroDoApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export const api = {
  /** null enquanto o primeiro ciclo de leitura não termina. */
  retrato: () => invoke<Snapshot | null>('retrato'),
  aoMudarRetrato: (f: (s: Snapshot) => void): Promise<UnlistenFn> => listen<Snapshot>('retrato', (e) => f(e.payload)),
  lerOrganizacao: () => invoke<unknown>('ler_organizacao'),
  gravarOrganizacao: (organizacao: Organizacao) => invoke<void>('gravar_organizacao', { organizacao }),
  lerPreferencias: () => invoke<Preferencias>('ler_preferencias'),
  definirPreferencias: (preferencias: Preferencias) => invoke<Preferencias>('definir_preferencias', { preferencias }),
  aoMudarPreferencias: (f: (p: Preferencias) => void): Promise<UnlistenFn> =>
    listen<Preferencias>('preferencias', (e) => f(e.payload)),
  janelaPronta: () => invoke<void>('janela_pronta'),
  /** As contas que o app achou, com o nome e o comando de cada uma. */
  lerContas: () => invoke<Conta[]>('ler_contas'),
  /** Grava o nome e o comando de cada conta; a leitura recomeça com eles. */
  salvarContas: (contas: Conta[]) => invoke<void>('salvar_contas', { contas }),
  /** Um link externo, no navegador padrão (a janela do app nunca sai dele). */
  abrirLink: (url: string) => invoke<void>('abrir_link', { url }),
  /** O "Testar o aviso" dos Ajustes. */
  testarAviso: () => invoke<void>('testar_aviso'),
  /** Do popup de aviso: fecha ele. */
  fecharAviso: () => invoke<void>('fechar_aviso'),
  /** Do popup de aviso: fecha ele e abre a janela principal na sessão. */
  abrirSessao: (chave: string) => invoke<void>('abrir_sessao', { chave }),
  /** A sessão que um aviso pediu para abrir (a janela pode ter nascido agora, depois do clique). */
  sessaoPendente: () => invoke<string | null>('sessao_pendente'),
  aoFocarSessao: (f: (chave: string) => void): Promise<UnlistenFn> => listen<string>('focar-sessao', (e) => f(e.payload)),
}
