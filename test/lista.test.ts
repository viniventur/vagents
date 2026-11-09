import { describe, expect, it } from 'vitest'
import type { AgentView, SessionView, Snapshot } from '../shared/model.ts'
import { SEM_GRUPO } from '../src/layout.ts'
import {
  TUDO_ABERTO,
  TUDO_FECHADO,
  abrirDobras,
  acaoDoTudo,
  alternarDobra,
  estaAberto,
  idsRecolhiveis,
  linhasDaSecao,
  montarLista,
  type Dobras,
  type NoDaLista,
} from '../src/lib/lista.ts'
import { VAZIA, criarGrupo, moverSessao } from '../src/lib/organizacao.ts'

const agente = (id: string, status: AgentView['status'], quando: number, pai: string | null = null): AgentView => ({
  id,
  parentId: pai,
  description: id,
  agentType: 'general-purpose',
  status,
  startedAt: quando - 10,
  updatedAt: quando,
  depth: pai ? 2 : 1,
})

const sessao = (key: string, status: SessionView['status'], agents: AgentView[] = []): SessionView => ({
  key,
  sessionId: key,
  configDir: 'cfg',
  account: 'padrão',
  cwd: `D:\\${key}`,
  project: key,
  title: `Sessão ${key}`,
  status,
  updatedAt: 1_000_000,
  agents,
})

const retrato = (sessions: SessionView[]): Snapshot => ({ generatedAt: 1_000_000, configDirs: ['cfg'], retentionMs: 0, sessions })
const opcoes = { endedWindowMs: 3_600_000, organizacao: VAZIA, abertos: new Set<string>() }
const ids = (nos: NoDaLista[]) => nos.map((n) => (n.tipo === 'agente' ? n.agente.id : `+${n.escondidos.done}`))

describe('a lista', () => {
  it('sem grupos, uma seção só, sem cabeçalho', () => {
    const lista = montarLista(retrato([sessao('a', 'running'), sessao('b', 'idle')]), opcoes)
    expect(lista.temGrupos).toBe(false)
    expect(lista.secoes).toHaveLength(1)
    expect(lista.secoes[0]?.sessoes.map((s) => s.nome)).toEqual(['Sessão a', 'Sessão b'])
  })

  it('com grupos, cada sessão na seção do seu grupo, e a "sem grupo" no fim', () => {
    let org = criarGrupo(VAZIA, 'Loja', 'loja').org
    org = moverSessao(org, 'b', 'loja')
    const lista = montarLista(retrato([sessao('a', 'running'), sessao('b', 'waiting')]), { ...opcoes, organizacao: org })
    expect(lista.secoes.map((s) => [s.id, s.sessoes.map((x) => x.sessao.key)])).toEqual([
      ['loja', ['b']],
      [SEM_GRUPO, ['a']],
    ])
    expect(lista.secoes[0]?.contagem).toEqual({ waiting: 1, running: 0, idle: 0, ended: 0 })
  })

  it('a árvore dos agentes: o neto dentro do pai, e os concluídos antigos dobrados num "+N"', () => {
    const agentes = [
      agente('r', 'running', 50),
      agente('neto', 'running', 51, 'r'),
      ...Array.from({ length: 6 }, (_, i) => agente(`d${i}`, 'done', i)),
    ]
    const s = montarLista(retrato([sessao('a', 'running', agentes)]), opcoes).secoes[0]!.sessoes[0]!
    expect(ids(s.agentes)).toEqual(['r', 'd3', 'd4', 'd5', '+3'])
    const r = s.agentes[0]
    expect(r?.tipo === 'agente' && ids(r.filhos)).toEqual(['neto'])

    const aberta = montarLista(retrato([sessao('a', 'running', agentes)]), { ...opcoes, abertos: new Set(['a|main']) })
    expect(ids(aberta.secoes[0]!.sessoes[0]!.agentes)).toEqual(['r', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', '+3'])
  })

  it('"Recolher tudo" pega as sessões com agentes e os agentes com filhos', () => {
    const lista = montarLista(
      retrato([sessao('a', 'running', [agente('r', 'running', 5), agente('neto', 'running', 6, 'r')]), sessao('b', 'idle')]),
      opcoes,
    )
    expect(idsRecolhiveis(lista)).toEqual(['s:a', 'a:a:r'])
  })

  it('as encerradas fora da janela não entram', () => {
    const velha = { ...sessao('v', 'ended'), updatedAt: 1_000_000 - 7_200_000 }
    expect(montarLista(retrato([velha]), opcoes).sessoes).toEqual([])
  })
})

describe('as dobras da lista', () => {
  const agentes = [agente('r', 'running', 5), agente('neto', 'running', 6, 'r'), agente('solto', 'running', 7)]
  const lista = () => {
    const org = moverSessao(criarGrupo(VAZIA, 'Loja', 'loja').org, 'a', 'loja')
    return montarLista(retrato([sessao('a', 'running', agentes), sessao('b', 'idle')]), { ...opcoes, organizacao: org })
  }
  const visiveis = (l: ReturnType<typeof lista>, d: Dobras) => l.secoes.flatMap((s) => linhasDaSecao(s, d).map((x) => x.id))

  it('tudo aberto: a sessão, o pai, o neto (recuado) e o irmão', () => {
    const l = lista()
    const linhas = linhasDaSecao(l.secoes[0]!, TUDO_ABERTO)
    expect(linhas.map((x) => [x.id, x.nivel])).toEqual([
      ['s:a', 0],
      ['a:a:r', 1],
      ['a:a:neto', 2],
      ['a:a:solto', 1],
    ])
    expect(linhas[2]?.pai).toBe('a:a:r')
    // O clique numa linha acha o que abrir no painel.
    expect(l.lookup.get('a:a:neto')?.agent?.id).toBe('neto')
    expect(l.lookup.get('m:a')?.session.key).toBe('a')
  })

  it('recolher um item esconde só o que está dentro dele', () => {
    const l = lista()
    expect(visiveis(l, alternarDobra(TUDO_ABERTO, 'a:a:r'))).toEqual(['s:a', 'a:a:r', 'a:a:solto', 's:b'])
    expect(visiveis(l, alternarDobra(TUDO_ABERTO, 's:a'))).toEqual(['s:a', 's:b'])
  })

  it('"Recolher tudo" fecha também o que aparecer depois; abrir um item é a exceção', () => {
    const l = lista()
    expect(idsRecolhiveis(l)).toEqual(['g:loja', 's:a', 'a:a:r', `g:${SEM_GRUPO}`])
    expect(estaAberto(TUDO_FECHADO, 's:qualquer-uma-nova')).toBe(false)
    const umAberto = alternarDobra(TUDO_FECHADO, 'g:loja')
    expect(estaAberto(umAberto, 'g:loja')).toBe(true)
    expect(estaAberto(umAberto, 's:a')).toBe(false)
    expect(abrirDobras(umAberto, ['g:loja'])).toBe(umAberto)
    expect(estaAberto(abrirDobras(umAberto, [`g:${SEM_GRUPO}`]), `g:${SEM_GRUPO}`)).toBe(true)
  })

  it('o botão de tudo: recolher depois de expandir, expandir depois de recolher, e o contrário quando não sobra nada', () => {
    const l = lista()
    expect(acaoDoTudo(l, TUDO_ABERTO)).toBe('recolher')
    expect(acaoDoTudo(l, TUDO_FECHADO)).toBe('expandir')
    // Com um aberto à mão, depois do "Recolher tudo", o botão ainda oferece expandir o resto.
    expect(acaoDoTudo(l, alternarDobra(TUDO_FECHADO, 'g:loja'))).toBe('expandir')
    // Recolheu um por um até não sobrar nada aberto: oferece expandir.
    const todos = idsRecolhiveis(l).reduce((d, id) => alternarDobra(d, id), TUDO_ABERTO)
    expect(acaoDoTudo(l, todos)).toBe('expandir')
    // Sem nada que recolha, não há botão.
    expect(acaoDoTudo(montarLista(retrato([sessao('b', 'idle')]), opcoes), TUDO_ABERTO)).toBeNull()
  })
})
