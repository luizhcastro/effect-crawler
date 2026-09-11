# Plano

Decisões tomadas em 2026-09-10. Cada item tem a decisão e por quê. No fim, o que ficou pra depois.

## Decisões

**Público: só eu, por enquanto.** Destinatários vêm da env var `NEWSLETTER_TO`, que aceita um ou vários emails separados por vírgula. Sem inscrição, descadastro ou gestão de lista no MVP. Quando virar newsletter com cadastro, a fonte da lista troca de env var pra banco, e o resto do fluxo não muda.

**Fontes: lista fixa de feeds RSS/Atom.** Praticamente todo tech blog tem feed, então não precisa de crawler de HTML (que quebra toda hora). Lista inicial (URLs validadas em 2026-09-10, estão em `src/feeds.ts`):

- Empresas: Stripe Engineering, Cloudflare, Netflix TechBlog, Discord Engineering, Figma, Vercel, Shopify Engineering, GitHub Blog (engineering), Meta Engineering. Uber ficou de fora: o feed bloqueia clientes que não são browser (HTTP 406).
- Pessoas: Dan Abramov (overreacted), Kent C. Dodds, Julia Evans, Martin Fowler, Simon Willison, Matt Pocock
- Ecossistema: Effect, Bun, TypeScript (devblogs)

**Relevância: modelo de linguagem pontua cada post.** Uma chamada só, em batch, com título + resumo de todos os posts da semana e o `profile.md`. Devolve JSON com nota 0 a 10 e justificativa de uma linha por post, validado com `Schema`. Corte: nota ≥ 7, sem limite de quantidade, ordenado por nota. Filtro por palavra-chave foi descartado porque derruba coisa boa por acidente.

**Provider: OpenRouter, via `@effect/ai-openrouter`** (publicado no npm em rc.113, mesma versão do `effect` instalado). Modelo default `deepseek/deepseek-v4.1-flash`, configurável. Custo estimado da classificação semanal (~15k tokens de entrada, ~2k de saída): menos de US$ 0,01 por edição em qualquer modelo flash, então preço não decide; DeepSeek V4.1 Flash foi escolhido por ser o mais barato entre os que suportam `structured_outputs` e por benchmarks de raciocínio no nível dos modelos grandes. Risco: lançado em 2026-09-10, pode ter instabilidade de provider no começo; OpenRouter aceita lista de fallback (`models`), então o segundo da lista é `openai/gpt-5.6-luna`. Se o pacote der problema, fallback é `HttpClient` direto na API compatível com OpenAI, sem dependência nova.

**Perfil de interesses: `profile.md` em texto puro.** Edita sem tocar em código. Conteúdo inicial: engenheiro backend/fullstack em TypeScript; interesses em Effect, arquitetura, TypeScript avançado, infra e escalabilidade, produto em fintech, tooling (Bun). Pouco interesse em mobile, frontend puramente visual, notícia corporativa, anúncio de produto sem conteúdo técnico.

**Frequência e execução: semanal, segunda às 10h de Brasília, GitHub Actions cron (`0 13 * * 1`, UTC).** Zero infra, e não depende da minha máquina estar ligada. Diário geraria emails de 2 ou 3 posts. Também tem `workflow_dispatch` com input `LOOKBACK_DAYS` pra rodar na mão quando uma semana falhar.

**Envio: Resend.** É um POST HTTP com HTML no body, feito com `HttpClient` do Effect. MVP usa o domínio de teste (`onboarding@resend.dev`), que só entrega pro email da própria conta Resend.

**Estado: nenhum.** "Novo" é tudo com data de publicação nos últimos 7 dias. Item sem data conta como novo se está entre os 5 primeiros do feed. Um post publicado perto da hora do job pode entrar duas vezes ou ficar de fora; aceito.

**Conteúdo: título + resumo do feed.** Sem baixar o artigo. O email mostra título, blog, nota, justificativa do modelo e link. Resumos são truncados antes de ir pro modelo, porque alguns feeds mandam o artigo inteiro em HTML.

**Falhas.** Feed quebrado: pula, loga, vai pro rodapé do email. OpenRouter ou Resend: retry 3x com backoff exponencial; se ainda falhar, o job falha e o Actions avisa. Não manda email sem curadoria.

**Teste local: `DRY_RUN=1`** troca o `Mailer` do Resend por um que grava `out/newsletter.html`, e nesse modo as configs do Resend não são exigidas. `bun test` cobre a janela de datas, o parse da resposta do modelo e o `Scorer` com modelo falso.

**Organização: serviços do Effect.** `FeedReader`, `Scorer`, `Mailer` e `Uuid` são `Context.Service` com `make` e `layer`; `main.ts` só compõe. Lógica pura fica em `newsletter.ts`. Erros tipados por serviço (`FeedReadError`, `ScoreError`, `MailSendError`) com `cause` preservado. Arquivo, relógio e UUID vêm de `FileSystem`, `DateTime.now` e um serviço `Uuid`, então nenhum teste toca disco, rede ou relógio real. Convenções copiadas do exemplo oficial `Effect-TS/examples/http-server` e do doc de convenções do t3code. Biome pra lint e formatação, CI roda `bun run check` em PR e push na main.

**Fora do Effect, de propósito:** `rss-parser` (Effect não tem parser de XML) e o HTML do email em template string (o `Template` do Effect é pra resposta HTTP em streaming).

**Envio idempotente.** O POST do Resend leva um `Idempotency-Key` gerado por execução, então o retry não duplica o email.

**Stack: Bun + Effect 4 (rc.113).** O repo do Effect está vendorizado em `.vendor/effect` como referência de API, porque a doc online ainda é majoritariamente v3. Única dependência nova além do ecossistema Effect: `rss-parser`.

## Premissas não confirmadas explicitamente

- Effect 4 RC é a versão alvo (inferido de já estar instalado e vendorizado)
- Destinatário é o mesmo email da conta Resend (limitação do domínio de teste)

## Depois

- Resumo próprio por artigo (baixar o texto completo)
- "Editorial" no topo conectando os temas da semana
- Cadastro de inscritos (formulário, descadastro), lista saindo de banco em vez de env var
- Multi-usuário: perfil e lista de feeds por pessoa
- Domínio próprio no Resend
- Hacker News / Lobsters como fonte adicional (têm feed)
- Guardar posts já enviados, se repetição virar incômodo
