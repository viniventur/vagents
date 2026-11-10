// As versões novas do vAgents: a tela consulta a última Release do repositório no GitHub (a API pública,
// sem mandar nada seu), no máximo a cada 6 h, e mostra uma pílula na barra quando ela é mais nova que a
// instalada. Aqui fica o que é puro (comparar, ler a resposta); a consulta está em hooks.ts (useNovaVersao).

export const REPOSITORIO = 'viniventur/vagents'
export const PAGINA_DAS_VERSOES = `https://github.com/${REPOSITORIO}/releases/latest`
export const ULTIMA_VERSAO_API = `https://api.github.com/repos/${REPOSITORIO}/releases/latest`
/** De quanto em quanto tempo consultar. */
export const INTERVALO_MS = 6 * 60 * 60 * 1000

export interface VersaoPublicada {
  /** Sem o "v": "0.1.2". */
  versao: string
  /** A página da Release, com as novidades e o instalador. */
  url: string
}

/** "v0.1.2" → [0, 1, 2]; null se não for uma versão. */
export function partes(versao: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(versao.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** A publicada é mais nova que a instalada? */
export function maisNova(publicada: string, instalada: string): boolean {
  const a = partes(publicada)
  const b = partes(instalada)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** A Release como a API do GitHub responde: a versão (a tag, sem o "v") e a página dela, que só vale se
 *  for deste repositório. */
export function lerRelease(json: unknown): VersaoPublicada | null {
  if (typeof json !== 'object' || json === null) return null
  const { tag_name: tag, html_url: url } = json as Record<string, unknown>
  if (typeof tag !== 'string' || !partes(tag)) return null
  const doRepositorio = typeof url === 'string' && url.startsWith(`https://github.com/${REPOSITORIO}/releases/`)
  return { versao: tag.trim().replace(/^v/, ''), url: doRepositorio ? url : PAGINA_DAS_VERSOES }
}
