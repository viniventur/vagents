import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot } from '../shared/model.ts'
import { api, dentroDoApp, type Preferencias } from './lib/api.ts'
import { organizacaoDeExemplo, retratoDeExemplo } from './demo.ts'
import { aplicarTema, resolverTema, type TemaAplicado } from './lib/aparencia.ts'
import { VAZIA, normalizar, type Organizacao } from './lib/organizacao.ts'

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

const PREFERENCIAS_PADRAO: Preferencias = { tema: 'sistema', avisar: true, som: true, iniciarComWindows: false }

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
