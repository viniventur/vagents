import { BracketsCurly, CheckCircle, FileMd, FilePdf, FilePng, FloppyDisk, FolderOpen, Printer, SpinnerGap, WarningCircle, X } from '@phosphor-icons/react'
import { getVersion } from '@tauri-apps/api/app'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { Snapshot } from '../shared/model.ts'
import { Documento } from './Documento.tsx'
import { api, dentroDoApp } from './lib/api.ts'
import {
  FORMATOS,
  montarDocumento,
  nomeDoArquivo,
  paraJson,
  paraMarkdown,
  type Documento as DadosDoDocumento,
  type Formato,
} from './lib/exportar.ts'
import type { Organizacao } from './lib/organizacao.ts'
import type { ItemDoMenu } from './Menu.tsx'

/** O que salvar ou imprimir: todas as sessões à mostra (sessao null) ou uma só. */
export interface PedidoDeSaida {
  acao: Formato | 'imprimir'
  sessao: string | null
}

const ICONES: Record<Formato, ReactNode> = {
  png: <FilePng />,
  pdf: <FilePdf />,
  md: <FileMd />,
  json: <BracketsCurly />,
}

/**
 * O "Salvar como" (com os quatro formatos) e o "Imprimir", para o menu do botão direito (todas as sessões
 * à mostra) e para o dos três pontinhos do painel (só aquela sessão).
 */
export function itensDeSaida(executar: (pedido: PedidoDeSaida) => void, sessao: string | null, desativado = false): ItemDoMenu[] {
  return [
    {
      tipo: 'sub',
      rotulo: 'Salvar como',
      icone: <FloppyDisk />,
      desativado,
      itens: [
        { tipo: 'titulo', rotulo: sessao ? 'Só esta sessão' : 'Todas as sessões à mostra' },
        ...FORMATOS.map(
          (f): ItemDoMenu => ({
            tipo: 'acao',
            rotulo: f.rotulo,
            dica: f.dica,
            icone: ICONES[f.formato],
            aoEscolher: () => executar({ acao: f.formato, sessao }),
          }),
        ),
      ],
    },
    {
      tipo: 'acao',
      rotulo: 'Imprimir',
      atalho: sessao ? undefined : 'Ctrl+P',
      icone: <Printer />,
      desativado,
      aoEscolher: () => executar({ acao: 'imprimir', sessao }),
    },
  ]
}

interface Recado {
  tipo: 'trabalhando' | 'pronto' | 'erro'
  texto: string
  /** O "Mostrar na pasta" (só no app, depois de salvar). */
  naPasta?: boolean
}

const GERANDO: Record<Formato, string> = {
  png: 'Gerando a imagem…',
  pdf: 'Gerando o PDF…',
  md: 'Salvando o Markdown…',
  json: 'Salvando o JSON…',
}

const TIPO: Record<'png' | 'md' | 'json', string> = {
  png: 'image/png',
  md: 'text/markdown;charset=utf-8',
  json: 'application/json',
}

/** A maior altura (em pixels) que a imagem pode ter: o canvas do WebView2 não passa de 16 384. */
const ALTURA_MAXIMA = 16_000

/**
 * O "Salvar como" e o "Imprimir". Monta o documento das sessões (de todas à mostra ou de uma) e:
 * - Markdown e JSON: texto, direto para o arquivo;
 * - PNG: desenha o documento fora da tela e o transforma em imagem (html-to-image);
 * - PDF: o documento como sai na impressão (o PrintToPdf do WebView2, pela casca);
 * - Imprimir: o diálogo de impressão, só com o documento.
 * O Ctrl+P (e o "Imprimir" do sistema) também imprime o documento, de todas as sessões.
 * Num navegador comum (pnpm dev), os arquivos vão para os downloads e o PDF abre a impressão.
 */
export function useSaida(fonte: { retrato: Snapshot | null; org: Organizacao; endedWindowMs: number }): {
  executar: (pedido: PedidoDeSaida) => void
  elementos: ReactNode
} {
  const fonteRef = useRef(fonte)
  fonteRef.current = fonte
  const [doc, setDoc] = useState<DadosDoDocumento | null>(null)
  /** Por que o documento está montado: a impressão (sai no afterprint) ou um arquivo (sai ao terminar). */
  const motivo = useRef<'imprimir' | 'arquivo' | null>(null)
  const ocupado = useRef(false)
  const [recado, setRecado] = useState<Recado | null>(null)

  const montar = useCallback((sessao: string | null) => {
    const { retrato, org, endedWindowMs } = fonteRef.current
    return retrato ? montarDocumento(retrato, org, { endedWindowMs, sessao }) : null
  }, [])

  /** Põe o documento na página já, antes de imprimir ou medir. */
  const mostrarDocumento = useCallback((d: DadosDoDocumento, por: 'imprimir' | 'arquivo') => {
    motivo.current = por
    flushSync(() => setDoc(d))
  }, [])

  const tirarDocumento = useCallback(() => {
    motivo.current = null
    setDoc(null)
  }, [])

  // O Ctrl+P e o "Imprimir" de fora do menu: imprime o documento de todas as sessões, não a tela.
  useEffect(() => {
    const antes = () => {
      if (motivo.current) return
      const d = montar(null)
      if (d) mostrarDocumento(d, 'imprimir')
    }
    const depois = () => {
      if (motivo.current === 'imprimir') tirarDocumento()
    }
    window.addEventListener('beforeprint', antes)
    window.addEventListener('afterprint', depois)
    return () => {
      window.removeEventListener('beforeprint', antes)
      window.removeEventListener('afterprint', depois)
    }
  }, [montar, mostrarDocumento, tirarDocumento])

  // O recado de salvo (ou do erro) sai sozinho; o de "gerando" fica até o fim.
  useEffect(() => {
    if (!recado || recado.tipo === 'trabalhando') return
    const timer = setTimeout(() => setRecado(null), recado.tipo === 'erro' ? 9000 : 6000)
    return () => clearTimeout(timer)
  }, [recado])

  const executar = useCallback(
    async ({ acao, sessao }: PedidoDeSaida) => {
      if (ocupado.current) return
      const d = montar(sessao)
      if (!d) return
      const noApp = dentroDoApp()

      // Imprimir (e o PDF fora do app, pela impressão): o diálogo do WebView2, só com o documento.
      if (acao === 'imprimir' || (acao === 'pdf' && !noApp)) {
        mostrarDocumento(d, 'imprimir')
        window.print()
        return
      }

      ocupado.current = true
      try {
        const nome = nomeDoArquivo(d, acao)
        if (noApp && !(await api.escolherDestino(nome, acao))) return
        setRecado({ tipo: 'trabalhando', texto: GERANDO[acao] })
        let caminho: string
        if (acao === 'pdf') {
          mostrarDocumento(d, 'arquivo')
          await documentoPronto()
          caminho = await api.gravarPdf()
        } else {
          let bytes: Uint8Array
          if (acao === 'png') {
            mostrarDocumento(d, 'arquivo')
            await documentoPronto()
            bytes = await gerarPng()
          } else {
            const versao = noApp ? await getVersion().catch(() => null) : null
            bytes = new TextEncoder().encode(acao === 'md' ? paraMarkdown(d) : paraJson(d, versao))
          }
          caminho = noApp ? await api.gravarDestino(bytes) : baixar(bytes, nome, TIPO[acao])
        }
        setRecado({ tipo: 'pronto', texto: `Salvo: ${caminho.split(/[\\/]/).pop() ?? caminho}`, naPasta: noApp })
      } catch (erro) {
        setRecado({ tipo: 'erro', texto: `Não deu para salvar. ${mensagem(erro)}` })
      } finally {
        if (motivo.current === 'arquivo') tirarDocumento()
        ocupado.current = false
      }
    },
    [montar, mostrarDocumento, tirarDocumento],
  )

  const elementos = (
    <>
      {doc &&
        createPortal(
          <div className="documento-raiz" aria-hidden>
            <Documento doc={doc} />
          </div>,
          document.body,
        )}
      {recado &&
        createPortal(
          <div className={`recado is-${recado.tipo}`} role={recado.tipo === 'erro' ? 'alert' : 'status'}>
            {recado.tipo === 'trabalhando' ? (
              <SpinnerGap className="recado-girando" weight="bold" />
            ) : recado.tipo === 'pronto' ? (
              <CheckCircle weight="fill" />
            ) : (
              <WarningCircle weight="fill" />
            )}
            <span className="recado-texto">{recado.texto}</span>
            {recado.naPasta && (
              <button type="button" className="btn btn-fantasma btn-pequeno" onClick={() => void api.mostrarSalvo().catch(() => undefined)}>
                <FolderOpen /> Mostrar na pasta
              </button>
            )}
            {recado.tipo !== 'trabalhando' && (
              <button type="button" className="btn btn-icone recado-fechar" aria-label="Fechar o recado" onClick={() => setRecado(null)}>
                <X size={14} />
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  )

  const semEsperar = useCallback((pedido: PedidoDeSaida) => void executar(pedido), [executar])
  return { executar: semEsperar, elementos }
}

function mensagem(erro: unknown): string {
  if (typeof erro === 'string') return erro
  if (erro instanceof Error) return erro.message
  return ''
}

/** O documento pintado, com as fontes carregadas. */
async function documentoPronto(): Promise<void> {
  await document.fonts.ready
  await new Promise<void>((pronto) => requestAnimationFrame(() => requestAnimationFrame(() => pronto())))
}

/**
 * A fonte do documento embutida na imagem (só o alfabeto latino, que cobre o português): sem ela, o
 * desenho sairia com a serifa do sistema. Carregada só quando alguém salva um PNG.
 */
async function fontesDaImagem(): Promise<string> {
  const [normal, italico] = await Promise.all([
    import('@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?inline'),
    import('@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-italic.woff2?inline'),
  ])
  const face = (url: string, estilo: string) =>
    `@font-face{font-family:'Source Serif 4 Variable';font-style:${estilo};font-weight:200 900;src:url(${url}) format('woff2');}`
  return face(normal.default, 'normal') + face(italico.default, 'italic')
}

/** O documento montado fora da tela, como PNG: em dobro (nítido), menos quando ele é comprido demais. */
async function gerarPng(): Promise<Uint8Array> {
  const no = document.querySelector<HTMLElement>('.documento-raiz > .documento')
  if (!no) throw new Error('O documento não ficou pronto.')
  const [{ toBlob }, fontEmbedCSS] = await Promise.all([import('html-to-image'), fontesDaImagem()])
  const largura = no.offsetWidth
  const altura = no.offsetHeight
  const blob = await toBlob(no, {
    width: largura,
    height: altura,
    pixelRatio: Math.max(0.25, Math.min(2, ALTURA_MAXIMA / altura)),
    backgroundColor: getComputedStyle(no).backgroundColor,
    fontEmbedCSS,
  })
  if (!blob) throw new Error('A imagem saiu vazia.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Fora do app: o arquivo vai para os downloads do navegador. */
function baixar(bytes: Uint8Array, nome: string, tipo: string): string {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }))
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return nome
}
