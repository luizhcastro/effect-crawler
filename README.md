# effect-crawler

Newsletter semanal, pessoal, com os posts de tech blogs que valem a pena ler.

## Que problema resolve

Acompanhar 20 blogs de engenharia dá trabalho: ou você abre cada um, ou assina tudo e afoga em post irrelevante. Este projeto lê os feeds RSS dos blogs que eu escolhi, pede pra um modelo de linguagem pontuar cada post contra o meu perfil de interesses, e me manda por email só o que passou do corte. Uma vez por semana, sem eu fazer nada.

## Como funciona

1. Toda segunda, um job no GitHub Actions roda o script.
2. O script lê os feeds listados em `feeds.ts` e pega os posts dos últimos 7 dias.
3. Manda título e resumo de todos os posts, de uma vez, pro modelo (via OpenRouter) junto com o `profile.md`. O modelo devolve nota de 0 a 10 e uma linha de justificativa por post.
4. Posts com nota 7 ou mais entram no email, ordenados por nota. Feeds que falharam aparecem num rodapé.
5. O email sai pelo Resend.

Detalhes e decisões em [docs/PLAN.md](docs/PLAN.md).

## Rodando local

```sh
bun install
cp .env.example .env   # preencher OPENROUTER_API_KEY, RESEND_API_KEY, NEWSLETTER_TO
DRY_RUN=1 bun run src/main.ts   # gera out/newsletter.html em vez de enviar
bun test
```

Sem `DRY_RUN`, envia de verdade. `LOOKBACK_DAYS=14` amplia a janela (útil se uma semana falhou).

## Configuração

| Variável | O que é |
|---|---|
| `OPENROUTER_API_KEY` | chave do OpenRouter |
| `OPENROUTER_MODEL` | modelo usado pra pontuar. Default: `deepseek/deepseek-v4.1-flash` |
| `RESEND_API_KEY` | chave do Resend |
| `NEWSLETTER_TO` | destinatários, um ou vários separados por vírgula |
| `LOOKBACK_DAYS` | janela de posts, em dias. Default: 7 |
| `DRY_RUN` | se `1`, grava HTML em `out/` e não envia |

No GitHub Actions, as três chaves ficam em Secrets do repo.

## Ajustando o que chega

- Adicionar ou remover blog: `feeds.ts`
- Mudar o que conta como relevante: `profile.md`
