import { X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { api, dentroDoApp, type Conta } from './lib/api.ts'

/** Fora do app (pnpm dev), duas contas de exemplo. */
const EXEMPLO: Conta[] = [
  { dir: 'C:\\Users\\voce\\.claude', name: 'padrão' },
  { dir: 'C:\\Users\\voce\\.claude-trabalho', name: 'trabalho' },
]

/** O nome que vale sem configurar: o da pasta (".claude" é "padrão"; ".claude-x" é "x"). */
function nomePadrao(dir: string): string {
  const pasta = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
  return pasta === '.claude' ? 'padrão' : pasta.replace(/^\.claude-/, '')
}

/**
 * As contas do Claude Code: cada pasta de configuração que o app achou, com o nome que a tela mostra e o
 * comando que abre o Claude nela (o do "copiar o comando para retomar"). Em branco, vale o padrão.
 */
export function ContasDoClaude({ aoFechar }: { aoFechar: () => void }) {
  const [contas, setContas] = useState<Conta[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!dentroDoApp()) {
      setContas(EXEMPLO)
      return
    }
    api.lerContas().then(
      (lidas) => setContas(lidas.map((c) => ({ ...c, name: c.name === nomePadrao(c.dir) ? '' : c.name }))),
      (e) => setErro(String(e)),
    )
  }, [])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aoFechar])

  const mudar = (i: number, campo: 'name' | 'command', valor: string) =>
    setContas((atuais) => atuais?.map((c, j) => (j === i ? { ...c, [campo]: valor } : c)) ?? null)

  const salvar = async () => {
    if (!contas) return
    if (!dentroDoApp()) return aoFechar()
    setSalvando(true)
    try {
      await api.salvarContas(contas)
      aoFechar()
    } catch (e) {
      setErro(String(e))
      setSalvando(false)
    }
  }

  return (
    <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-labelledby="contas-titulo">
        <div className="flex items-start gap-2">
          <h3 id="contas-titulo" className="flex-1 text-[22px]">
            Contas do Claude Code
          </h3>
          <button type="button" className="btn btn-icone -mt-1 -mr-2" onClick={aoFechar} aria-label="Fechar">
            <X />
          </button>
        </div>
        <p className="text-[14px] leading-relaxed text-neutro-700">
          Cada pasta de configuração do Claude Code é uma conta. Dê a ela um nome, que aparece nas sessões quando há mais
          de uma conta, e o comando que abre o Claude nela, usado no "copiar o comando para retomar". Em branco, vale o
          padrão.
        </p>

        {erro && <p className="detalhes-alerta">Não deu: {erro}</p>}
        {!contas && !erro && <p className="text-neutro-600">Lendo as contas…</p>}
        {contas?.length === 0 && <p className="text-neutro-600">Nenhuma pasta do Claude Code encontrada.</p>}

        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {contas?.map((c, i) => (
            <li key={c.dir} className="conta">
              <span className="codigo truncate text-neutro-600" title={c.dir}>
                {c.dir}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[13px]">
                  Nome
                  <input className="campo" value={c.name} placeholder={nomePadrao(c.dir)} onChange={(e) => mudar(i, 'name', e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  Comando que abre o Claude
                  <input
                    className="campo codigo"
                    value={c.command ?? ''}
                    placeholder="claude"
                    spellCheck={false}
                    onChange={(e) => mudar(i, 'command', e.target.value)}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>

        <p className="text-[12.5px] leading-snug text-neutro-600">
          O vAgents acha sozinho a CLAUDE_CONFIG_DIR e as pastas .claude e .claude-* da sua pasta de usuário. Outras pastas
          entram pelo vagents.config.json (veja o README).
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secundario btn-pequeno" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primario btn-pequeno" disabled={!contas || salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
