# effect-crawler

Newsletter semanal, pessoal, com os posts de tech blogs que valem a pena ler.

## Que problema resolve

Acompanhar 20 blogs de engenharia dá trabalho: ou você abre cada um, ou assina tudo e afoga em post irrelevante. Este projeto lê os feeds RSS dos blogs que eu escolhi, pede pra um modelo de linguagem pontuar cada post contra o meu perfil de interesses, e me manda por email só o que passou do corte. Uma vez por semana, sem eu fazer nada.

## Como funciona

1. Toda segunda, um job no GitHub Actions roda o script.
2. O script lê os feeds listados em `src/feeds.ts` e pega os posts dos últimos 7 dias.
3. Manda título e resumo de todos os posts, de uma vez, pro modelo (via OpenRouter) junto com o `profile.md`. O modelo devolve nota de 0 a 10 e uma linha de justificativa por post.
4. Posts com nota 7 ou mais entram no email, ordenados por nota. Feeds que falharam aparecem num rodapé.
5. O email sai pelo Resend.

Detalhes e decisões em [docs/PLAN.md](docs/PLAN.md).

## Rodando local

```sh
bun install
cp .env.example .env   # preencher OPENROUTER_API_KEY (Resend só é preciso pra enviar de verdade)
bun run dev            # gera out/newsletter.html em vez de enviar
bun run send           # envia de verdade
bun run check          # typecheck + lint + testes
```

`LOOKBACK_DAYS=14` amplia a janela (útil se uma semana falhou).

## Estrutura

```
src/
  main.ts          compõe os serviços e roda
  config.ts        variáveis de ambiente
  feeds.ts         lista de blogs
  newsletter.ts    lógica pura: janela de datas, corte, prompt, HTML
  FeedReader.ts    lê e parseia os feeds
  Scorer.ts        pontua os posts via OpenRouter
  Mailer.ts        envia (Resend) ou grava em out/ (dry-run)
  Uuid.ts          gera a chave de idempotência do envio
```

Arquivo com inicial maiúscula é um serviço do Effect (`Context.Service` com `make` e `layer`). Minúscula é entrypoint, config ou função pura. Convenções seguidas (as mesmas do exemplo oficial da Effect e do t3code):

- Imports por namespace e subpath: `import * as Effect from "effect/Effect"`.
- Um módulo por serviço, nesta ordem: imports, erros, tag do serviço com a interface inline, `make`, `layer`.
- Erros são `Schema.TaggedError` com atributos estruturados e o erro original em `cause`.
- Dependências de ambiente (arquivo, relógio, HTTP, UUID) vêm de serviços do Effect, nunca de global. Por isso os testes rodam sem disco e sem rede.

## Configuração

| Variável | O que é |
|---|---|
| `OPENROUTER_API_KEY` | chave do OpenRouter |
| `OPENROUTER_MODEL` | modelo usado pra pontuar. Default: `deepseek/deepseek-v4.1-flash` |
| `RESEND_API_KEY` | chave do Resend |
| `NEWSLETTER_TO` | destinatários, um ou vários separados por vírgula |
| `LOOKBACK_DAYS` | janela de posts, em dias. Default: 7 |
| `DRY_RUN` | se `1`, grava HTML em `out/` e não envia. Nesse modo `RESEND_API_KEY` e `NEWSLETTER_TO` não são exigidas |

No GitHub Actions, as três chaves ficam em Secrets do repo.

## Ajustando o que chega

- Adicionar ou remover blog: `src/feeds.ts`
- Mudar o que conta como relevante: `profile.md`
