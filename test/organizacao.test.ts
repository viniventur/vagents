import { describe, expect, it } from 'vitest'
import {
  VAZIA,
  apagarGrupo,
  alternarRecolhido,
  criarGrupo,
  definirRegraDePasta,
  grupoDaSessao,
  moverGrupo,
  moverSessao,
  nomeDaSessao,
  normalizar,
  proximoNome,
  renomearGrupo,
  renomearSessao,
} from '../src/lib/organizacao.ts'

const sessao = (key: string, cwd = 'D:\\projetos\\app', title = 'Título do Claude') => ({ key, cwd, title })

describe('organização', () => {
  it('cria grupos com nomes que não se repetem e renomeia', () => {
    const a = criarGrupo(VAZIA, undefined, 'g1')
    const b = criarGrupo(a.org, undefined, 'g2')
    expect(b.org.grupos.map((g) => g.nome)).toEqual(['Grupo 1', 'Grupo 2'])
    expect(proximoNome(renomearGrupo(b.org, 'g1', 'Grupo 3'))).toBe('Grupo 1')
    expect(renomearGrupo(b.org, 'g1', '   ').grupos[0]?.nome).toBe('Grupo 1')
  })

  it('a escolha da sessão vale mais que a regra da pasta; "sem grupo" também é escolha', () => {
    let org = criarGrupo(VAZIA, 'Loja', 'gov').org
    org = criarGrupo(org, 'Pessoal', 'pes').org
    org = definirRegraDePasta(org, 'D:\\loja', 'gov')
    expect(grupoDaSessao(org, sessao('s1', 'D:\\loja\\api'))).toBe('gov')
    expect(grupoDaSessao(org, sessao('s1', 'D:\\LOJA'))).toBe('gov')
    expect(grupoDaSessao(org, sessao('s1', 'D:\\loja-velha'))).toBeNull()
    expect(grupoDaSessao(moverSessao(org, 's1', 'pes'), sessao('s1', 'D:\\loja\\x'))).toBe('pes')
    expect(grupoDaSessao(moverSessao(org, 's1', null), sessao('s1', 'D:\\loja\\x'))).toBeNull()
  })

  it('a regra da pasta mais específica ganha, e trocar a regra de uma pasta substitui a anterior', () => {
    let org = criarGrupo(VAZIA, 'A', 'a').org
    org = criarGrupo(org, 'B', 'b').org
    org = definirRegraDePasta(org, 'D:\\projetos', 'a')
    org = definirRegraDePasta(org, 'D:\\projetos\\app', 'b')
    expect(grupoDaSessao(org, sessao('s', 'D:\\projetos\\app\\web'))).toBe('b')
    expect(grupoDaSessao(org, sessao('s', 'D:\\projetos\\outro'))).toBe('a')
    org = definirRegraDePasta(org, 'd:/projetos/app/', 'a')
    expect(Object.keys(org.pastas)).toHaveLength(2)
    expect(definirRegraDePasta(org, 'D:\\projetos', null).pastas).toEqual({ 'd:/projetos/app/': 'a' })
  })

  it('apagar um grupo devolve as sessões para "sem grupo" e tira as regras dele', () => {
    let org = criarGrupo(VAZIA, 'A', 'a').org
    org = moverSessao(org, 's1', 'a')
    org = renomearSessao(org, 's1', 'Minha sessão')
    org = definirRegraDePasta(org, 'D:\\x', 'a')
    const sem = apagarGrupo(org, 'a')
    expect(sem.grupos).toEqual([])
    expect(sem.pastas).toEqual({})
    expect(sem.sessoes).toEqual({ s1: { nome: 'Minha sessão' } })
  })

  it('o nome dado vale; apagar o nome volta ao título do Claude', () => {
    let org = renomearSessao(VAZIA, 's1', '  Migração  ')
    expect(nomeDaSessao(org, sessao('s1'))).toBe('Migração')
    org = renomearSessao(org, 's1', '')
    expect(nomeDaSessao(org, sessao('s1'))).toBe('Título do Claude')
    expect(org.sessoes).toEqual({})
  })

  it('reordena e recolhe', () => {
    let org = criarGrupo(VAZIA, 'A', 'a').org
    org = criarGrupo(org, 'B', 'b').org
    expect(moverGrupo(org, 'b', -1).grupos.map((g) => g.id)).toEqual(['b', 'a'])
    expect(moverGrupo(org, 'a', -1)).toBe(org)
    expect(alternarRecolhido(org, 'a').grupos[0]).toEqual({ id: 'a', nome: 'A', recolhido: true })
    expect(alternarRecolhido(alternarRecolhido(org, 'a'), 'a').grupos[0]).toEqual({ id: 'a', nome: 'A' })
  })

  it('lê o arquivo sem confiar nele', () => {
    expect(normalizar(null)).toEqual(VAZIA)
    const lido = normalizar({
      grupos: [{ id: 'a', nome: 'A' }, { id: 3 }],
      sessoes: { s1: { grupo: 'a', nome: 'x' }, s2: { grupo: 'sumiu' }, s3: { grupo: '' } },
      pastas: { 'D:\\x': 'a', 'D:\\y': 'sumiu' },
    })
    expect(lido).toEqual({
      versao: 1,
      grupos: [{ id: 'a', nome: 'A' }],
      sessoes: { s1: { grupo: 'a', nome: 'x' }, s3: { grupo: '' } },
      pastas: { 'D:\\x': 'a' },
    })
  })
})
