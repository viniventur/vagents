Duas correções: o vAgents travava ao clicar várias vezes seguidas no "Testar" dos avisos (ou com vários avisos chegando de uma vez), e o seletor de cor saía do quadro com nomes longos.

**O que mudou desde a 0.2.0**

- **Sem travar com muitos avisos:** a partir do 4º popup seguido, o vAgents travava inteiro, a janela e os popups ("Não está respondendo"). O defeito vinha desde a 0.1.0 e ficou fácil de disparar com os botões "Testar" da 0.2.0. Agora o mais antigo sai, o novo entra e o canto nunca passa de 3 popups.
- **Sai o mais antigo de verdade:** sem lugar no canto, sai o popup mais antigo. Antes saía sempre o de baixo, que depois da primeira troca já era o mais novo.
- **O seletor de cor com nome longo:** num card ou grupo de nome comprido, o gradiente, as cores e o botão "Pronto" passavam da borda do quadro. Agora o título termina em "…", e o nome inteiro aparece ao passar o mouse.

**Instalar:** baixe o `vAgents_0.2.1_x64-setup.exe` abaixo e abra. Ele instala só para você, sem pedir administrador. Se uma versão anterior já estiver instalada, instale por cima: os seus grupos, nomes, cores e preferências ficam. O instalador ainda não tem assinatura de código: se o Windows avisar, clique em **Mais informações → Executar assim mesmo**.

**Precisa de:** Windows 10 ou 11 (64 bits) e o Claude Code 2.1 ou mais novo (testado no 2.1.322).
