A sessão que espera um shell em segundo plano não aparece mais como parada.

**O que mudou desde a 0.3.0**

- **Shell rodando:** quando o Claude termina a vez mas deixa um shell rodando em segundo plano (o "1 shell still running" do terminal), a sessão aparecia como **Parada**, igual a uma que acabou de verdade. Agora ela tem um estado só dela, **Shell rodando**, com um azul acinzentado e o ponto vazado, no card, na lista, na barra de cima, no painel, no documento e na dica da bandeja. O agente principal diz "Esperando um shell em segundo plano": quando o shell acabar, o Claude volta a trabalhar nessa sessão.
- **O aviso de "terminou"** espera o shell em segundo plano acabar, como já esperava os subagentes. O popup vem quando a sessão para de verdade, com o tempo todo de trabalho.

**Instalar:** baixe o `vAgents_0.3.1_x64-setup.exe` abaixo e abra. Ele instala só para você, sem pedir administrador. Se uma versão anterior já estiver instalada, instale por cima: os seus grupos, nomes, cores e preferências ficam. O instalador ainda não tem assinatura de código: se o Windows avisar, clique em **Mais informações → Executar assim mesmo**.

**Precisa de:** Windows 10 ou 11 (64 bits) e o Claude Code 2.1 ou mais novo (testado no 2.1.332).
