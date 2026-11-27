import { describe, expect, it } from 'vitest'
import type { AgentView, SessionView, Snapshot } from '../shared/model.ts'
import {
  arvoreCompleta,
  codigoMd,
  escaparMd,
  lesma,
  montarDocumento,
  nomeDoArquivo,
  paraJson,
  paraMarkdown,
} from '../src/lib/exportar.ts'
import { VAZIA, criarGrupo, moverSessao, renomearSessao } from '../src/lib/organizacao.ts'

const AGORA = 1_000_000_000

const agente = (id: string, status: AgentView['status'], quando: number, pai: string | null = null): AgentView => ({
  id,
  parentId: pai,
  description: `faz ${id}`,
  agentType: 'general-purpose',
  status,
  startedAt: quando - 10_000,
  updatedAt: quando,
  depth: pai ? 2 : 1,
})

const sessao = (key: string, status: SessionView['status'], agents: AgentView[] = [], extra: Partial<SessionView> = {}): SessionView => ({
  key,
  sessionId: `id-${key}`,
  configDir: 'C:\\u\\.claude',
  account: 'Pessoal',
  cwd: `D:\\${key}`,
  project: key,
  title: `Sessão ${key}`,
  status,
  updatedAt: AGORA - 60_000,
  agents,
  ...extra,
})

const retrato = (sessions: SessionView[]): Snapshot => ({ generatedAt: AGORA, configDirs: ['C:\\u\\.claude'], retentionMs: 0, sessions })
const janela = { endedWindowMs: 3_600_000 }

describe('o documento', () => {
  it('traz a árvore inteira, sem "+N", cada pai seguido dos filhos', () => {
    // Seis concluídos sob o principal: o mapa dobraria os antigos num "+N"; o documento não.
    const filhos = [1, 2, 3, 4, 5, 6].map((n) => agente(`c${n}`, 'done', AGORA - n * 1000))
    const neto = agente('neto', 'running', AGORA, 'c1')
    const arvore = arvoreCompleta([...filhos, neto])
    expect(arvore.map((a) => `${a.agente.id}:${a.nivel}`)).toEqual(['c1:0', 'neto:1', 'c2:0', 'c3:0', 'c4:0', 'c5:0', 'c6:0'])
  })

  it('um filho de um pai que sumiu do histórico fica na raiz', () => {
    const arvore = arvoreCompleta([agente('orfao', 'done', AGORA, 'sumiu')])
    expect(arvore).toEqual([{ agente: expect.objectContaining({ id: 'orfao' }), nivel: 0 }])
  })

  it('segue a janela das encerradas, como a tela', () => {
    const velha = sessao('velha', 'ended', [], { updatedAt: AGORA - 5 * 3_600_000 })
    const doc = montarDocumento(retrato([sessao('a', 'running'), velha]), VAZIA, janela)
    expect(doc?.total).toBe(1)
    expect(doc?.contagem.running).toBe(1)
  })

  it('com grupos, só as seções com sessões, na ordem dos grupos e o "sem grupo" no fim', () => {
    let org = criarGrupo(VAZIA, 'Trabalho', 'g1').org
    org = criarGrupo(org, 'Vazio', 'g2').org
    org = moverSessao(org, 'b', 'g1')
    const doc = montarDocumento(retrato([sessao('a', 'idle'), sessao('b', 'running')]), org, janela)
    expect(doc?.temGrupos).toBe(true)
    expect(doc?.secoes.map((s) => [s.grupo?.nome ?? null, s.sessoes.map((x) => x.sessao.key)])).toEqual([
      ['Trabalho', ['b']],
      [null, ['a']],
    ])
  })

  it('de uma sessão só, mesmo encerrada fora da janela; sem ela no retrato, null', () => {
    const velha = sessao('velha', 'ended', [], { updatedAt: AGORA - 5 * 3_600_000 })
    const doc = montarDocumento(retrato([sessao('a', 'running'), velha]), VAZIA, { ...janela, sessao: 'velha' })
    expect(doc?.total).toBe(1)
    expect(doc?.temGrupos).toBe(false)
    expect(montarDocumento(retrato([]), VAZIA, { ...janela, sessao: 'nenhuma' })).toBeNull()
  })
})

describe('o Markdown', () => {
  it('escapa o que viraria formatação', () => {
    expect(escaparMd('a *b* _c_ [d](e) <f>')).toBe('a \\*b\\* \\_c\\_ \\[d\\](e) \\<f\\>')
    expect(escaparMd('# não é título')).toBe('\\# não é título')
    expect(escaparMd('1. nem lista')).toBe('1\\. nem lista')
  })

  it('o código com crase não fecha antes da hora', () => {
    expect(codigoMd('D:\\a')).toBe('`D:\\a`')
    expect(codigoMd('a`b')).toBe('``a`b``')
    expect(codigoMd('`x')).toBe('`` `x ``')
  })

  it('tem o nome que você deu, o pedido em citação, os subagentes recuados e o comando das encerradas', () => {
    const org = renomearSessao(VAZIA, 'a', 'Checkout *Pix*')
    const s = sessao('a', 'ended', [agente('pai', 'done', AGORA - 2000), agente('filho', 'interrupted', AGORA - 3000, 'pai')], {
      lastPrompt: 'primeira linha\nsegunda linha',
      gitBranch: 'main',
    })
    const md = paraMarkdown(montarDocumento(retrato([s]), org, janela)!)
    expect(md).toContain('## Checkout \\*Pix\\*')
    expect(md).toContain('- **Título do Claude:** Sessão a')
    expect(md).toContain('- **Branch:** `main`')
    expect(md).toContain('> primeira linha\n> segunda linha')
    expect(md).toContain('- Concluído · **general-purpose** · faz pai')
    expect(md).toContain('  - Interrompido · **general-purpose** · faz filho')
    expect(md).toContain('claude --resume id-a')
  })

  it('a sessão com um shell em segundo plano diz o que espera e conta à parte da parada', () => {
    const doc = montarDocumento(retrato([sessao('a', 'shell', [], { activity: 'Testes rodando.' }), sessao('b', 'idle')]), VAZIA, janela)!
    const md = paraMarkdown(doc)
    expect(md).toContain('2 sessões: 1 shell rodando · 1 parada')
    expect(md).toContain('**Esperando um shell em segundo plano.** Quando ele acabar, o Claude volta a trabalhar nesta sessão.')
    expect(md).toContain('**Último passo:** Testes rodando.')
  })

  it('sem sessões, diz que não há nenhuma', () => {
    const md = paraMarkdown(montarDocumento(retrato([]), VAZIA, janela)!)
    expect(md).toContain('_Nenhuma sessão à mostra._')
  })
})

describe('o JSON', () => {
  it('traz os campos do retrato, as datas em ISO e o que é do vAgents', () => {
    let org = criarGrupo(VAZIA, 'Trabalho', 'g1').org
    org = moverSessao(org, 'a', 'g1')
    const s = sessao('a', 'running', [agente('x', 'running', AGORA)], { startedAt: AGORA - 600_000 })
    const dados = JSON.parse(paraJson(montarDocumento(retrato([s]), org, janela)!, '0.3.0'))
    expect(dados.formato).toBe('vagents.sessoes')
    expect(dados.app).toEqual({ nome: 'vAgents', versao: '0.3.0' })
    expect(dados.escopo).toBe('todas')
    expect(dados.grupos).toEqual([{ id: 'g1', nome: 'Trabalho', cor: null }])
    const [primeira] = dados.sessoes
    expect(primeira.nome).toBe('Sessão a')
    expect(primeira.grupo).toEqual({ id: 'g1', nome: 'Trabalho' })
    expect(primeira.sessionId).toBe('id-a')
    expect(primeira.startedAt).toBe(new Date(AGORA - 600_000).toISOString())
    expect(primeira.agents[0].updatedAt).toBe(new Date(AGORA).toISOString())
    expect(primeira.comandoParaRetomar).toContain('--resume id-a')
  })
})

describe('o nome do arquivo', () => {
  it('a lesma tira acento e símbolo', () => {
    expect(lesma('Sessão do plano: execução!')).toBe('sessao-do-plano-execucao')
    expect(lesma('***')).toBe('')
  })

  it('leva a data e, numa sessão só, o nome dela', () => {
    const todas = montarDocumento(retrato([sessao('a', 'idle')]), VAZIA, janela)!
    expect(nomeDoArquivo(todas, 'png')).toMatch(/^vagents-\d{4}-\d{2}-\d{2}-\d{4}\.png$/)
    const uma = montarDocumento(retrato([sessao('a', 'idle')]), VAZIA, { ...janela, sessao: 'a' })!
    expect(nomeDoArquivo(uma, 'md')).toMatch(/^vagents-sessao-a-\d{4}-\d{2}-\d{2}-\d{4}\.md$/)
  })
})
