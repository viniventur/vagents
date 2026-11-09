# Mudanças

## 0.1.1 — 2026-11-09

- **Os mais recentes em cima:** entre os subagentes de um mesmo pai, os que estão rodando vêm
  primeiro, depois os que terminaram, do mais recente ao mais antigo (no mapa e na lista).
- **O agente principal rodando:** uma luz dá a volta no card dele, como os pontos que correm nas
  ligações dos subagentes.
- **A paleta:** sem cor escolhida, o botão de cor do grupo e do card mostra o ícone da paleta (antes,
  um quadrado tracejado que não dizia para que servia).

## 0.1.0 — 2026-11-09

A primeira versão.

- **As sessões do Claude Code, ao vivo:** uma caixa por sessão, com o tema, o seu último pedido e o
  estado (rodando, esperando você, parada, encerrada), de todas as contas (`~/.claude` e `~/.claude-*`).
- **A árvore dos subagentes:** do agente principal aos subagentes e aos que eles criaram, com o passo
  atual de cada um; os concluídos antigos num "+N".
- **O aviso de "esperando você":** um popup pequeno no canto, com um toque curto, que não rouba o foco
  e respeita apresentações e tela cheia; o clique abre a sessão.
- **No mapa ou numa lista:** a lista em árvore (grupos, sessões e subagentes, com colunas), com
  recolher e expandir cada item ou tudo de uma vez, e o teclado para andar por ela.
- **Organizar na hora:** grupos com nome, arrastar sessões entre grupos, regra por pasta, renomear
  sessões; no mapa, cada card fica onde você o solta, e "Reorganizar" volta ao automático.
- **Cores:** cada grupo e cada card pode ter a sua cor (qualquer uma, ou o hex), escolhida num seletor
  de cor; sem escolha, tudo fica como sempre, e a faixa do estado no alto do card não muda.
- **Contas do Claude Code:** acha sozinho todas as pastas de configuração; nos Ajustes, cada uma ganha
  um nome e o comando que abre o Claude nela.
- **Leve:** fechar a janela deixa o app na bandeja, com uns 8 MB; abrir com o Windows (opcional).
- **Temas claro e escuro**, no visual da família de apps da marca.
