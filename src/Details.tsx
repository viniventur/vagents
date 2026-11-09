import { CopySimple, PencilSimple, X } from '@phosphor-icons/react'
import { useContext, useState, type ReactNode } from 'react'
import type { AgentView, SessionView } from '../shared/model.ts'
import { NowContext } from './hooks.ts'
import { countAgents, type Selection } from './layout.ts'
import { grupoDaSessao, nomeDaSessao, regraDaPasta, type Organizacao } from './lib/organizacao.ts'
import { Selo, TextoEditavel } from './nodes.tsx'
import { AGENT_STATUS, clock, duration, modelLabel, plural, relTime, resumeCommand, waitingReason } from './text.ts'

const NOVO_GRUPO = '__novo__'
const SEM_GRUPO = ''

export interface AcoesDoPainel {
  renomearSessao: (chave: string, nome: string) => void
  moverSessao: (chave: string, grupo: string | null) => void
  criarGrupoCom: (sessao: SessionView) => void
  definirRegra: (pasta: string, grupo: string | null) => void
}

interface Props {
  selecao: Selection
  org: Organizacao
  acoes: AcoesDoPainel
  aoFechar: () => void
  aoEscolherSessao: (sessao: SessionView) => void
}

/** O painel lateral com tudo de uma sessão ou de um subagente. */
export function Details({ selecao, org, acoes, aoFechar, aoEscolherSessao }: Props) {
  return (
    <aside className="detalhes" aria-label="Detalhes">
      <button type="button" className="btn btn-icone absolute top-2.5 right-2.5" onClick={aoFechar} aria-label="Fechar">
        <X />
      </button>
      {selecao.agent ? (
        <DetalhesDoAgente agente={selecao.agent} sessao={selecao.session} org={org} aoEscolherSessao={aoEscolherSessao} />
      ) : (
        <DetalhesDaSessao sessao={selecao.session} org={org} acoes={acoes} />
      )}
    </aside>
  )
}

function DetalhesDaSessao({ sessao: s, org, acoes }: { sessao: SessionView; org: Organizacao; acoes: AcoesDoPainel }) {
  const now = useContext(NowContext)
  const [editando, setEditando] = useState(false)
  const contagem = countAgents(s.agents)
  const desde = s.statusSince ?? (s.status === 'ended' ? s.updatedAt : undefined)
  const nome = nomeDaSessao(org, s)
  const grupo = grupoDaSessao(org, s)
  const regra = regraDaPasta(org, s.cwd)
  const regraAqui = grupo !== null && regra?.grupo === grupo

  return (
    <>
      <div className="flex items-center gap-2.5 text-[13px]">
        <Selo status={s.status} />
        {desde && <span className="text-neutro-600">{relTime(desde, now)}</span>}
      </div>
      <div className="flex items-start gap-1">
        <h2 className="detalhes-titulo min-w-0 flex-1">
          <TextoEditavel
            valor={nome}
            editando={editando}
            aoComecar={() => setEditando(true)}
            aoTerminar={(novo) => {
              setEditando(false)
              if (novo !== null && novo.trim() !== nome) acoes.renomearSessao(s.key, novo.trim() === s.title ? '' : novo)
            }}
          />
        </h2>
        {!editando && (
          <button type="button" className="btn btn-icone shrink-0" onClick={() => setEditando(true)} aria-label="Renomear a sessão" title="Renomear">
            <PencilSimple />
          </button>
        )}
      </div>
      {nome !== s.title && <p className="-mt-2.5 text-[13px] text-neutro-600">Título do Claude: {s.title}</p>}
      {s.status === 'waiting' && (
        <p className="detalhes-alerta">Esperando {waitingReason(s.waitingFor)}. Responda no terminal dessa sessão.</p>
      )}

      <Secao titulo="Grupo">
        <select
          className="campo"
          value={grupo ?? SEM_GRUPO}
          onChange={(e) => {
            const v = e.target.value
            if (v === NOVO_GRUPO) acoes.criarGrupoCom(s)
            else acoes.moverSessao(s.key, v === SEM_GRUPO ? null : v)
          }}
        >
          <option value={SEM_GRUPO}>Sem grupo</option>
          {org.grupos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nome}
            </option>
          ))}
          <option value={NOVO_GRUPO}>Novo grupo…</option>
        </select>
        {s.cwd && (
          <label className="checar mt-2.5 text-[13.5px]">
            <input
              type="checkbox"
              disabled={grupo === null}
              checked={regraAqui}
              onChange={(e) => acoes.definirRegra(regraAqui && regra ? regra.pasta : s.cwd, e.target.checked ? grupo : null)}
            />
            <span>
              Sempre pôr neste grupo as sessões abertas em <span className="codigo">{regraAqui && regra ? regra.pasta : s.cwd}</span>
            </span>
          </label>
        )}
      </Secao>

      <Secao titulo="Seu último pedido">
        {s.lastPrompt ? <p className="detalhes-texto">{s.lastPrompt}</p> : <p className="text-neutro-600">Nenhum registrado.</p>}
      </Secao>
      <Secao titulo={s.status === 'running' || s.status === 'waiting' ? 'Agora' : 'Último passo'}>
        <p className="detalhes-texto">{s.activity ?? '—'}</p>
        {s.activityAt && <p className="text-[12.5px] text-neutro-600">{relTime(s.activityAt, now)}</p>}
      </Secao>

      <dl className="detalhes-grade">
        <Linha rotulo="Pasta">{s.cwd || '—'}</Linha>
        {s.gitBranch && <Linha rotulo="Branch">{s.gitBranch}</Linha>}
        {s.model && <Linha rotulo="Modelo">{modelLabel(s.model)}</Linha>}
        {s.permissionMode && <Linha rotulo="Permissões">{s.permissionMode}</Linha>}
        {s.startedAt && <Linha rotulo="Aberta em">{clock(s.startedAt)}</Linha>}
        {s.pid && <Linha rotulo="Processo">{s.pid}</Linha>}
        <Linha rotulo="Subagentes">
          {s.agents.length === 0
            ? 'nenhum'
            : [
                contagem.running && plural(contagem.running, 'rodando', 'rodando'),
                contagem.done && plural(contagem.done, 'concluído', 'concluídos'),
                contagem.interrupted && plural(contagem.interrupted, 'interrompido', 'interrompidos'),
              ]
                .filter(Boolean)
                .join(' · ')}
        </Linha>
        <Linha rotulo="Sessão">
          <span className="codigo">{s.sessionId}</span>
        </Linha>
        <Linha rotulo="Conta">
          {s.account} <span className="text-neutro-600">({s.configDir})</span>
        </Linha>
      </dl>

      {s.status === 'ended' ? (
        <Copiar texto={resumeCommand(s)} rotulo="Copiar o comando para retomar" />
      ) : (
        <p className="text-[13px] text-neutro-600">Aberta num terminal{s.pid ? ` (processo ${s.pid})` : ''}: é lá que ela continua.</p>
      )}
    </>
  )
}

function DetalhesDoAgente({
  agente: a,
  sessao,
  org,
  aoEscolherSessao,
}: {
  agente: AgentView
  sessao: SessionView
  org: Organizacao
  aoEscolherSessao: (sessao: SessionView) => void
}) {
  const now = useContext(NowContext)
  const rodando = a.status === 'running'
  const tempo = a.startedAt ? (rodando ? now : a.updatedAt) - a.startedAt : undefined
  const pai = a.parentId ? sessao.agents.find((x) => x.id === a.parentId) : undefined
  return (
    <>
      <div className="flex items-center gap-2.5 text-[13px]">
        <span className={`selo is-${a.status}`}>
          <span className="ponto ponto-vivo" aria-hidden />
          {AGENT_STATUS[a.status]}
        </span>
        {tempo !== undefined && <span className="text-neutro-600">{duration(tempo)}</span>}
      </div>
      <h2 className="detalhes-titulo">{a.description}</h2>

      <Secao titulo={rodando ? 'Agora' : 'Último passo'}>
        <p className="detalhes-texto">{a.activity ?? '—'}</p>
      </Secao>

      <dl className="detalhes-grade">
        <Linha rotulo="Tipo">{a.agentType}</Linha>
        {a.name && <Linha rotulo="Nome">{a.name}</Linha>}
        {a.model && <Linha rotulo="Modelo">{modelLabel(a.model)}</Linha>}
        {a.startedAt && <Linha rotulo="Começou">{clock(a.startedAt)}</Linha>}
        <Linha rotulo={rodando ? 'Última escrita' : 'Terminou'}>{relTime(a.updatedAt, now)}</Linha>
        <Linha rotulo="Criado por">{pai ? pai.description : 'Agente principal'}</Linha>
        <Linha rotulo="Id">
          <span className="codigo">{a.id}</span>
        </Linha>
      </dl>

      <button type="button" className="btn btn-fantasma self-start" onClick={() => aoEscolherSessao(sessao)}>
        Sessão: {nomeDaSessao(org, sessao)}
      </button>
    </>
  )
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="detalhes-secao">
      <h6>{titulo}</h6>
      {children}
    </section>
  )
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <>
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </>
  )
}

/** Copia pelo navegador; se ele recusar, pelo jeito antigo (um campo escondido e o "copiar"). */
async function copiarTexto(texto: string): Promise<void> {
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

function Copiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="btn btn-secundario btn-pequeno self-start"
        onClick={() =>
          void copiarTexto(texto).then(() => {
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1600)
          })
        }
      >
        <CopySimple /> {copiado ? 'Copiado' : rotulo}
      </button>
      <code className="copiar-texto">{texto}</code>
    </div>
  )
}
