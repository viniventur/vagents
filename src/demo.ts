// Os dados de exemplo: a tela aberta num navegador comum (pnpm dev), fora do app, mostra estas sessões
// fictícias. Servem para mexer no visual sem o Claude Code e para as capturas do README.

import type { AgentView, SessionView, Snapshot } from '../shared/model.ts'
import type { Organizacao } from './lib/organizacao.ts'

const MIN = 60_000
const CONFIG = 'C:\\Users\\voce\\.claude'

function agente(id: string, descricao: string, tipo: string, status: AgentView['status'], comecou: number, fim: number, atividade?: string, pai: string | null = null): AgentView {
  return { id, parentId: pai, description: descricao, agentType: tipo, model: 'claude-sonnet-5-5', status, startedAt: comecou, updatedAt: fim, activity: atividade, depth: pai ? 2 : 1 }
}

function sessao(id: string, dados: Omit<SessionView, 'key' | 'sessionId' | 'configDir' | 'account'>): SessionView {
  return { key: `${CONFIG}|${id}`, sessionId: id, configDir: CONFIG, account: 'padrão', ...dados }
}

export function retratoDeExemplo(agora: number): Snapshot {
  const ha = (minutos: number) => agora - minutos * MIN
  return {
    generatedAt: agora,
    configDirs: [CONFIG],
    retentionMs: 24 * 60 * MIN,
    sessions: [
      sessao('checkout-pix', {
        cwd: 'D:\\projetos\\loja-web',
        project: 'loja-web',
        title: 'Checkout com Pix',
        lastPrompt: 'Integra o Pix no checkout e me pergunta antes de mexer no banco de produção.',
        activity: 'Fazendo uma pergunta para você',
        activityAt: ha(1),
        model: 'claude-opus-5-5',
        gitBranch: 'feat/pix',
        permissionMode: 'default',
        status: 'waiting',
        waitingFor: 'input needed',
        statusSince: ha(1),
        startedAt: ha(48),
        updatedAt: ha(1),
        agents: [
          agente('a0', 'Levantar os requisitos do Pix', 'general-purpose', 'done', ha(48), ha(47), 'Lista de requisitos pronta.'),
          agente('a00', 'Ler o código do carrinho', 'Explore', 'done', ha(48), ha(46), 'O carrinho fecha o pedido em 2 passos.'),
          agente('a1', 'Mapear o checkout atual', 'Explore', 'done', ha(46), ha(41), 'Achei 3 telas e 2 rotas de pagamento.'),
          agente('a2', 'Ler a documentação do Pix', 'general-purpose', 'done', ha(45), ha(38), 'Resumo pronto: QR dinâmico e webhook.'),
          agente('a3', 'Comparar os gateways', 'general-purpose', 'done', ha(44), ha(30), 'Tabela com taxas e prazos.'),
          agente('a4', 'Revisar o fluxo de pagamento', 'Explore', 'running', ha(12), ha(0), 'Grep: createPayment'),
          agente('a5', 'Escrever os testes do Pix', 'general-purpose', 'running', ha(9), ha(0), 'Bash: pnpm test checkout'),
        ],
      }),
      sessao('pedidos', {
        cwd: 'D:\\projetos\\loja-api',
        project: 'loja-api',
        title: 'Migração dos pedidos',
        lastPrompt: 'Migra a tabela de pedidos para o schema novo sem derrubar a API.',
        activity: 'Subagente: Migrar a tabela de pedidos',
        activityAt: ha(6),
        model: 'claude-opus-5-5',
        gitBranch: 'main',
        status: 'running',
        statusSince: ha(20),
        startedAt: ha(25),
        updatedAt: ha(0),
        agents: [
          agente('b1', 'Mapear as dependências da tabela', 'Explore', 'done', ha(22), ha(15), '4 views e 2 triggers.'),
          agente('b2', 'Migrar a tabela de pedidos', 'general-purpose', 'running', ha(14), ha(0), 'Bash: Copia o lote 37 de 52'),
          agente('b3', 'Validar as contagens', 'general-purpose', 'running', ha(5), ha(0), 'Read: checagem.sql', 'b2'),
        ],
      }),
      sessao('blog', {
        cwd: 'D:\\projetos\\blog',
        project: 'blog',
        title: 'Tema escuro do blog',
        lastPrompt: 'Ajusta o tema escuro do blog e confere o contraste dos links.',
        activity: 'Pronto: os links passam de 4,5:1 nos dois temas.',
        activityAt: ha(14),
        model: 'claude-sonnet-5-5',
        gitBranch: 'tema-escuro',
        status: 'idle',
        statusSince: ha(14),
        startedAt: ha(70),
        updatedAt: ha(14),
        agents: [],
      }),
      sessao('relatorio', {
        cwd: 'D:\\projetos\\financas',
        project: 'financas',
        title: 'Relatório de outubro',
        lastPrompt: 'Fecha o relatório de outubro com os gráficos por categoria.',
        activity: 'Relatório salvo em relatorios/2026-10.pdf.',
        activityAt: ha(55),
        model: 'claude-sonnet-5-5',
        status: 'ended',
        startedAt: ha(120),
        updatedAt: ha(55),
        agents: [
          agente('c1', 'Somar as despesas por categoria', 'general-purpose', 'done', ha(110), ha(95), 'Planilha conferida.'),
          agente('c2', 'Montar os gráficos', 'general-purpose', 'done', ha(94), ha(70), 'Gráficos em SVG.'),
        ],
      }),
    ],
  }
}

export function organizacaoDeExemplo(): Organizacao {
  return {
    versao: 1,
    grupos: [
      { id: 'g-loja', nome: 'Loja online' },
      { id: 'g-pessoal', nome: 'Pessoal' },
    ],
    sessoes: {},
    pastas: { 'D:\\projetos\\loja-web': 'g-loja', 'D:\\projetos\\loja-api': 'g-loja', 'D:\\projetos\\blog': 'g-pessoal', 'D:\\projetos\\financas': 'g-pessoal' },
  }
}
