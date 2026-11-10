import { getVersion } from '@tauri-apps/api/app'
import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot } from '../shared/model.ts'
import { api, dentroDoApp, type Preferencias } from './lib/api.ts'
import { organizacaoDeExemplo, retratoDeExemplo } from './demo.ts'
import { aplicarTema, resolverTema, type TemaAplicado } from './lib/aparencia.ts'
import { TUDO_ABERTO, type Dobras } from './lib/lista.ts'
import { VAZIA, normalizar, type Organizacao } from './lib/organizacao.ts'
import { INTERVALO_MS, PAGINA_DAS_VERSOES, ULTIMA_VERSAO_API, lerRelease, maisNova, type VersaoPublicada } from './lib/versao.ts'

/**
 * O retrato das sessões, ao vivo: o atual ao abrir e cada mudança pelo evento "retrato". Num navegador
 * comum (pnpm dev, fora do app), o retrato de exemplo do demo.ts.
 */
export function useRetrato(): { retrato: Snapshot | null; noApp: boolean } {
  const noApp = dentroDoApp()
  const [retrato, setRetrato] = useState<Snapshot | null>(() => (noApp ? null : retratoDeExemplo(Date.now())))
  useEffect(() => {
    if (!noApp) return
    let vivo = true
    // Fica sempre o mais novo: o evento pode chegar antes da resposta do pedido inicial.
    const guardar = (novo: Snapshot) => {
      if (vivo) setRetrato((atual) => (atual && atual.generatedAt > novo.generatedAt ? atual : novo))
    }
    const parar = api.aoMudarRetrato(guardar)
    api.retrato().then((r) => r && guardar(r), () => undefined)
    return () => {
      vivo = false
      void parar.then((f) => f())
    }
  }, [noApp])
  return { retrato, noApp }
}

/** A organização (grupos e nomes): lida do app ao abrir e gravada logo depois de cada mudança. */
export function useOrganizacao(): [Organizacao, (mudar: (org: Organizacao) => Organizacao) => void, boolean] {
  const [org, setOrg] = useState<Organizacao>(() => (dentroDoApp() ? VAZIA : organizacaoDeExemplo()))
  const [carregada, setCarregada] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!dentroDoApp()) {
      setCarregada(true)
      return
    }
    api.lerOrganizacao().then(
      (bruta) => {
        setOrg(normalizar(bruta))
        setCarregada(true)
      },
      () => setCarregada(true),
    )
  }, [])

  const atualizar = useCallback((mudar: (org: Organizacao) => Organizacao) => {
    setOrg((atual) => {
      const nova = mudar(atual)
      if (nova !== atual && dentroDoApp()) {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => void api.gravarOrganizacao(nova).catch(() => undefined), 250)
      }
      return nova
    })
  }, [])

  return [org, atualizar, carregada]
}

const PREFERENCIAS_PADRAO: Preferencias = {
  tema: 'sistema',
  avisar: true,
  som: true,
  toque: 'madeira-dupla',
  avisarTerminou: true,
  somTerminou: true,
  toqueTerminou: 'madeira',
  procurarVersao: true,
  iniciarComWindows: false,
}

/** As preferências do app; mudam pela tela ou pelo menu da bandeja (o evento "preferencias"). */
export function usePreferencias(): [Preferencias, (p: Preferencias) => void] {
  const [prefs, setPrefs] = useState<Preferencias>(() => {
    try {
      const t = localStorage.getItem('vagents.tema')
      if (t === 'claro' || t === 'escuro' || t === 'sistema') return { ...PREFERENCIAS_PADRAO, tema: t }
    } catch {
      // sem espelho
    }
    return PREFERENCIAS_PADRAO
  })
  useEffect(() => {
    if (!dentroDoApp()) return
    api.lerPreferencias().then(setPrefs, () => undefined)
    const parar = api.aoMudarPreferencias(setPrefs)
    return () => void parar.then((f) => f())
  }, [])
  const definir = useCallback((p: Preferencias) => {
    setPrefs(p)
    if (dentroDoApp()) api.definirPreferencias(p).then(setPrefs, () => undefined)
  }, [])
  return [prefs, definir]
}

/** O tema que vale agora ("sistema" acompanha o Windows ao vivo), já aplicado na página. */
export function useTemaAplicado(tema: Preferencias['tema']): TemaAplicado {
  const consulta = '(prefers-color-scheme: dark)'
  const [sistemaEscuro, setSistemaEscuro] = useState(() => matchMedia(consulta).matches)
  useEffect(() => {
    const m = matchMedia(consulta)
    const mudou = () => setSistemaEscuro(m.matches)
    m.addEventListener('change', mudou)
    return () => m.removeEventListener('change', mudou)
  }, [])
  const aplicado = resolverTema(tema, sistemaEscuro)
  useEffect(() => aplicarTema(tema, aplicado), [tema, aplicado])
  return aplicado
}

/** O relógio da tela: os nós leem daqui para os tempos andarem sem refazer o layout. */
export const NowContext = createContext<number>(Date.now())

export function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

/** A última consulta às versões, guardada para a janela recriada não consultar de novo. */
interface ConsultaDeVersao {
  em: number
  publicada: VersaoPublicada | null
}
const CHAVE_DA_CONSULTA = 'vagents.versao'
const CHAVE_DA_DISPENSADA = 'vagents.versao.dispensada'
/** De quanto em quanto tempo ver se a última consulta já venceu (com a janela aberta por dias). */
const REVER_MS = 15 * 60 * 1000

function lerGuardado<T>(chave: string): T | null {
  try {
    const texto = localStorage.getItem(chave)
    return texto ? (JSON.parse(texto) as T) : null
  } catch {
    return null
  }
}

function guardar(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor))
  } catch {
    // sem armazenamento: consulta de novo na próxima vez
  }
}

/**
 * A versão nova do vAgents, se houver uma mais nova que a instalada e você não a tiver dispensado. Consulta
 * a última Release no GitHub no máximo a cada 6 h; sem rede, tenta de novo depois, quieta. Desligada nos
 * Ajustes, não consulta nada. Num navegador comum, "?versao-nova" mostra a pílula de exemplo.
 */
export function useNovaVersao(ligado: boolean): [VersaoPublicada | null, () => void] {
  const [exemplo] = useState(() => !dentroDoApp() && new URLSearchParams(location.search).has('versao-nova'))
  const [instalada, setInstalada] = useState<string | null>(() => (exemplo ? '0.1.1' : null))
  const [publicada, setPublicada] = useState<VersaoPublicada | null>(() =>
    exemplo ? { versao: '0.2.0', url: PAGINA_DAS_VERSOES } : (lerGuardado<ConsultaDeVersao>(CHAVE_DA_CONSULTA)?.publicada ?? null),
  )
  const [dispensada, setDispensada] = useState<string | null>(() => (exemplo ? null : lerGuardado<string>(CHAVE_DA_DISPENSADA)))

  useEffect(() => {
    if (dentroDoApp()) getVersion().then(setInstalada, () => undefined)
  }, [])

  useEffect(() => {
    if (!ligado || !dentroDoApp()) return
    let viva = true
    const consultar = async () => {
      const ultima = lerGuardado<ConsultaDeVersao>(CHAVE_DA_CONSULTA)
      if (ultima && Date.now() - ultima.em < INTERVALO_MS) return
      try {
        const resposta = await fetch(ULTIMA_VERSAO_API, { signal: AbortSignal.timeout(10_000) })
        if (!resposta.ok) return
        const consulta: ConsultaDeVersao = { em: Date.now(), publicada: lerRelease(await resposta.json()) }
        guardar(CHAVE_DA_CONSULTA, consulta)
        if (viva) setPublicada(consulta.publicada)
      } catch {
        // sem rede (ou o GitHub fora do ar): tenta de novo depois
      }
    }
    void consultar()
    const timer = setInterval(() => void consultar(), REVER_MS)
    return () => {
      viva = false
      clearInterval(timer)
    }
  }, [ligado])

  const dispensar = useCallback(() => {
    if (!publicada) return
    if (!exemplo) guardar(CHAVE_DA_DISPENSADA, publicada.versao)
    setDispensada(publicada.versao)
  }, [publicada, exemplo])

  const nova =
    ligado && publicada && instalada && maisNova(publicada.versao, instalada) && publicada.versao !== dispensada ? publicada : null
  return [nova, dispensar]
}

/** Um número guardado no navegador do app (a tela funciona sem ele). */
export function useStoredNumber(key: string, initial: number): [number, (value: number) => void] {
  const [value, setValue] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw === null ? Number.NaN : Number(raw)
      return Number.isFinite(parsed) ? parsed : initial
    } catch {
      return initial
    }
  })
  const update = (next: number) => {
    setValue(next)
    try {
      localStorage.setItem(key, String(next))
    } catch {
      // sem armazenamento: vale só até fechar
    }
  }
  return [value, update]
}

/** Uma escolha guardada no navegador do app, entre os valores aceitos (a tela funciona sem ela). */
export function useStoredChoice<T extends string>(key: string, valores: readonly T[], initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return valores.includes(raw as T) ? (raw as T) : initial
    } catch {
      return initial
    }
  })
  const update = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // sem armazenamento: vale só até fechar
      }
    },
    [key],
  )
  return [value, update]
}

const CHAVE_DAS_DOBRAS = 'vagents:lista-dobras'

/** O que está recolhido na lista, guardado no navegador do app (as exceções mais recentes, até 400). */
export function useDobrasDaLista(): [Dobras, (mudar: (d: Dobras) => Dobras) => void] {
  const [dobras, setDobras] = useState<Dobras>(() => {
    try {
      const bruto = JSON.parse(localStorage.getItem(CHAVE_DAS_DOBRAS) ?? 'null') as { fechadoPorPadrao?: unknown; invertidos?: unknown } | null
      if (bruto && typeof bruto.fechadoPorPadrao === 'boolean' && Array.isArray(bruto.invertidos)) {
        const invertidos = bruto.invertidos.filter((x): x is string => typeof x === 'string')
        return { fechadoPorPadrao: bruto.fechadoPorPadrao, invertidos: new Set(invertidos) }
      }
    } catch {
      // sem armazenamento, ou guardado num formato velho: começa tudo aberto
    }
    return TUDO_ABERTO
  })
  const mudar = useCallback((f: (d: Dobras) => Dobras) => {
    setDobras((atual) => {
      const nova = f(atual)
      if (nova !== atual) {
        try {
          const invertidos = [...nova.invertidos].slice(-400)
          localStorage.setItem(CHAVE_DAS_DOBRAS, JSON.stringify({ fechadoPorPadrao: nova.fechadoPorPadrao, invertidos }))
        } catch {
          // sem armazenamento: vale só até fechar
        }
      }
      return nova
    })
  }, [])
  return [dobras, mudar]
}
