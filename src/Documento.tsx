import type { CSSProperties, ReactNode } from 'react'
import { Marca } from './Marca.tsx'
import {
  agoraNoDocumento,
  dataEHora,
  desdeQuando,
  passoDoAgente,
  resumoDaContagem,
  resumoDosSubagentes,
  tempoDoAgente,
  type Documento as DadosDoDocumento,
  type SessaoNoDocumento,
} from './lib/exportar.ts'
import { Selo, cls } from './nodes.tsx'
import { DEPOIS_DO_SHELL, ESPERANDO_SHELL, clock, modelLabel, plural, relTime, resumeCommand, waitingReason } from './text.ts'

/**
 * O documento do "Salvar como" (PNG e PDF) e do "Imprimir": as sessões com tudo o que o painel mostra e a
 * árvore inteira dos subagentes, no tema de agora. Fica fora da tela (index.css, "O documento"); na
 * impressão, só ele aparece. A tabela repete o respiro de cima e de baixo em cada página impressa (o
 * <thead> e o <tfoot> se repetem), já que a página não tem margem: assim o fundo do tema vai até a borda.
 */
export function Documento({ doc }: { doc: DadosDoDocumento }) {
  const unica = doc.sessao !== null
  // As cores do tema de agora, para o logo sair certo também no PNG (Marca.tsx).
  const tema = getComputedStyle(document.documentElement)
  const cores = { ciano: tema.getPropertyValue('--color-ciano').trim(), texto: tema.getPropertyValue('--color-texto').trim() }
  return (
    <div className="documento">
      <table className="documento-folha">
        <thead>
          <tr>
            <td>
              <div className="documento-margem" />
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td>
              <div className="documento-margem" />
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="documento-miolo">
              <header className="documento-cabeca">
                <span className="documento-marca">
                  <Marca tamanho={22} cores={cores} />
                  vAgents
                </span>
                <span>
                  {unica ? 'Uma sessão do Claude Code' : resumoDaContagem(doc)} · {dataEHora(doc.geradoEm)}
                </span>
              </header>
              {!unica && <h1 className="documento-titulo">Sessões do Claude Code</h1>}
              {doc.total === 0 && <p className="documento-nada">Nenhuma sessão à mostra agora.</p>}
              {doc.secoes.map((secao) => (
                <section
                  key={secao.grupo?.id ?? 'sem-grupo'}
                  className={cls('documento-grupo', doc.temGrupos && 'com-cabeca', secao.grupo?.cor && 'tem-cor')}
                  style={secao.grupo?.cor ? ({ '--cor-grupo': secao.grupo.cor } as CSSProperties) : undefined}
                >
                  {doc.temGrupos && (
                    <h2 className="documento-grupo-nome">
                      {secao.grupo?.nome ?? 'Sem grupo'}
                      <span>{plural(secao.sessoes.length, 'sessão', 'sessões')}</span>
                    </h2>
                  )}
                  {secao.sessoes.map((item) => (
                    <SessaoNoDocumentoView key={item.sessao.key} item={item} doc={doc} />
                  ))}
                </section>
              ))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function SessaoNoDocumentoView({ item, doc }: { item: SessaoNoDocumento; doc: DadosDoDocumento }) {
  const s = item.sessao
  const agora = doc.geradoEm
  const desde = desdeQuando(s)
  const ramo = s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : null
  const rodando = s.status === 'running' || s.status === 'waiting'
  return (
    <article
      className={cls('doc-sessao', `is-${s.status}`, item.cor && 'tem-cor')}
      style={item.cor ? ({ '--cor-cartao': item.cor } as CSSProperties) : undefined}
    >
      <div className="doc-sessao-cabeca">
        {/* Nada encolhe em "vag…": sem espaço, o que não cabe desce para a linha de baixo. */}
        <div className="doc-meta">
          <Selo status={s.status} />
          {desde && <span>{relTime(desde, agora)}</span>}
          {s.project && <span className="doc-projeto">{s.project}</span>}
          {ramo && <span className="sessao-rotulo doc-rotulo">{ramo}</span>}
          {(doc.multiConfig || doc.sessao) && <span className="sessao-rotulo doc-rotulo">{s.account}</span>}
        </div>
        <h3 className="doc-titulo">{item.nome}</h3>
        {item.nome !== s.title && <p className="doc-nota">Título do Claude: {s.title}</p>}
        {s.status === 'waiting' && (
          <p className="detalhes-alerta">Esperando {waitingReason(s.waitingFor)}. Responda no terminal dessa sessão.</p>
        )}
        {s.status === 'shell' && (
          <p className="detalhes-alerta is-shell">
            {ESPERANDO_SHELL}. {DEPOIS_DO_SHELL}
          </p>
        )}
      </div>

      <div className="doc-textos">
        <div className="doc-bloco">
          <h6>Seu último pedido</h6>
          {s.lastPrompt ? <p className="doc-texto">{s.lastPrompt}</p> : <p className="doc-nota">Nenhum registrado.</p>}
        </div>
        <div className="doc-bloco">
          <h6>{rodando ? 'Agora' : 'Último passo'}</h6>
          <p className={cls('doc-texto', s.status === 'waiting' && 'is-forte')}>{agoraNoDocumento(s)}</p>
          {s.activityAt && s.status !== 'waiting' && <p className="doc-nota">{relTime(s.activityAt, agora)}</p>}
        </div>
      </div>

      <dl className="detalhes-grade doc-grade">
        <Linha rotulo="Pasta">{s.cwd ? <span className="codigo">{s.cwd}</span> : '—'}</Linha>
        {doc.sessao && item.grupo && <Linha rotulo="Grupo">{item.grupo.nome}</Linha>}
        {s.model && <Linha rotulo="Modelo">{modelLabel(s.model)}</Linha>}
        {s.permissionMode && <Linha rotulo="Permissões">{s.permissionMode}</Linha>}
        {s.startedAt && <Linha rotulo="Aberta em">{clock(s.startedAt)}</Linha>}
        {s.pid && <Linha rotulo="Processo">{s.pid}</Linha>}
        <Linha rotulo="Conta">
          {s.account} <span className="codigo text-neutro-600">({s.configDir})</span>
        </Linha>
        <Linha rotulo="Sessão">
          <span className="codigo">{s.sessionId}</span>
        </Linha>
      </dl>

      {s.status === 'ended' && (
        <div className="doc-bloco">
          <h6>Para retomar (PowerShell)</h6>
          <code className="copiar-texto doc-comando">{resumeCommand(s)}</code>
        </div>
      )}

      <div className="doc-bloco">
        <h6>
          Subagentes <span className="doc-h6-resumo">{resumoDosSubagentes(item.contagem)}</span>
        </h6>
        {item.agentes.length > 0 && (
          <ul className="doc-agentes">
            {item.agentes.map(({ agente: a, nivel }) => {
              const tempo = tempoDoAgente(a, agora)
              return (
                <li
                  key={a.id}
                  className={cls('doc-agente', `is-${a.status}`)}
                  style={{ '--nivel': nivel } as CSSProperties}
                >
                  <span className="ponto" aria-hidden />
                  <div className="doc-agente-corpo">
                    <div className="doc-agente-topo">
                      <span className="doc-agente-tipo">{a.name ?? a.agentType}</span>
                      <span className="doc-agente-desc">{a.description}</span>
                    </div>
                    <div className="doc-agente-passo">
                      {[passoDoAgente(a, agora), tempo, a.model ? modelLabel(a.model) : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </article>
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
