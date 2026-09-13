# Plano v2 — de script pessoal a produto web

O MVP (`docs/PLAN.md`) é um script: uma pessoa, uma lista fixa de feeds, um cron no
GitHub Actions, zero estado. Este documento descreve o salto para um produto
multi-usuário hospedado num subdomínio, e a ordem em que ele deve ser construído.

## 1. O que o produto é

Três coisas, em ordem de quem chega no site:

1. **Diretório público de curadoria.** Página única listando os blogs que nós
   recomendamos, sem login. É o cartão de visita e o argumento de inscrição.
2. **Inscrição por email.** Qualquer pessoa entra na newsletter da curadoria
   padrão com um clique.
3. **Curadoria própria.** Quem se inscreve pode editar dois arquivos: um
   `profile.md` (interesses, usado para pontuar relevância) e uma lista de
   blogs próprios. Escolhe a frequência: diária, semanal ou mensal.

A lista de blogs do usuário chega fora de padrão — nome de empresa, URL do site,
URL do post, às vezes só o nome do blog. O sistema precisa resolver isso para um
feed RSS/Atom canônico e re-verificar com o tempo.

## 2. O que muda em relação ao MVP

| Dimensão | MVP | v2 |
|---|---|---|
| Usuários | 1, via `NEWSLETTER_TO` | N, via banco |
| Perfil | `profile.md` no repo | um por usuário, editado no site |
| Feeds | `src/feeds.ts` fixo | curadoria padrão + lista por usuário |
| Entrada de feed | URL válida, escrita à mão | texto livre, normalizado pelo sistema |
| Frequência | semanal, fixa | diária / semanal / mensal, por usuário |
| Execução | cron do GitHub Actions | servidor HTTP + scheduler próprio |
| Estado | nenhum | banco (usuários, feeds, envios) |
| Email | domínio de teste do Resend | domínio próprio, double opt-in, descadastro |
| Custo de LLM | ~US$ 0,01/semana | × usuários × frequência |

O núcleo não muda: ler feeds, pontuar com modelo contra um perfil, montar HTML,
enviar. `FeedReader`, `Scorer`, `Mailer` e `newsletter.ts` são reaproveitados —
o que entra por volta deles é que muda.

## 3. Nome / subdomínio

Sugestões, da mais descritiva para a mais interessante:

- `newsletter.luizcastro.dev` — óbvio, sem personalidade, funciona
- `digest.luizcastro.dev` — descreve o formato
- `blogroll.luizcastro.dev` — termo da web antiga para lista curada de blogs; é
  exatamente o que a home é, e tem carga nostálgica boa para o público
- `radar.luizcastro.dev` — "o que está no radar"; curto, memorável
- `signal.luizcastro.dev` — sinal contra ruído, que é a tese do produto

Recomendação: **`blogroll`** se o diretório público é o coração, **`radar`** se a
newsletter é. Decidir antes da Fase 1, porque o domínio entra no DNS do Resend.

## 4. Design

**Home: minimalista.** Uma coluna, tipografia grande, sem ilustração. Lista de
blogs agrupada por categoria (empresas / pessoas / ecossistema), cada item com
nome, uma linha de descrição e link. Um campo de email no fim. Modo claro e
escuro.

**Áreas de input: editor de código, estética Zed.** JetBrains Mono, fundo sólido
sem gradiente, gutter discreto, cursor em bloco, paleta do tema One do Zed. Dois
editores:

- **Perfil** — Markdown, pré-preenchido com um exemplo comentado que a pessoa
  edita por cima. O exemplo é o argumento didático: mostra que "backend em
  TypeScript, pouco interesse em mobile" é o que faz a pontuação funcionar.
- **Feeds** — array JSON, validado ao vivo, com marcação de erro na linha.
  Cada item aceita `"https://..."` ou `{ "name": "...", "url": "..." }`.

Mecanicamente: CodeMirror 6 com tema próprio, montado como ilha numa página
renderizada no servidor. Uma ressalva de escopo — um `<textarea>` com
JetBrains Mono e moldura entrega a estética por ~0 KB; o CodeMirror só se paga
pelo destaque de sintaxe e pelo erro de JSON inline. Vale confirmar que esses
dois recursos são desejados antes de carregar a dependência.

## 5. Fases

Cada fase termina em algo que funciona e pode ir pro ar. Nenhuma depende de
código da seguinte.

### Fase 0 — Decisões (sem código)
Resolver as questões abertas da seção 6. Sem hospedagem e banco definidos, a
Fase 2 trava.

### Fase 1 — Diretório público
- Servidor HTTP (`@effect/platform-bun`) servindo uma página renderizada.
- Curadoria padrão sai de `src/feeds.ts` para um arquivo de dados com categoria
  e descrição por blog.
- Incorporar `blogs-exemple.md`: 20 blogs de empresa, sem URL de feed, em formato
  livre. É o primeiro caso de teste do normalizador (Fase 4) — resolver à mão
  agora e guardar os casos difíceis.
- Deploy no subdomínio, TLS, sem banco ainda.
- *Pronto quando:* a página está no ar e lista a curadoria inteira.

### Fase 2 — Inscritos
- Banco e migrações.
- Inscrição com double opt-in: email → link de confirmação → registro ativo.
- Descadastro por link em toda edição (obrigatório, não é opcional).
- O envio semanal passa a iterar sobre os inscritos em vez de `NEWSLETTER_TO`.
- Domínio verificado no Resend (SPF/DKIM/DMARC).
- *Pronto quando:* outra pessoa se inscreve e recebe a edição padrão.

### Fase 3 — Sessão e editores
- Autenticação por link mágico (sem senha; reusa o Resend).
- Página de conta com os dois editores e o seletor de frequência.
- Perfil e lista salvos por usuário; a curadoria padrão vira o valor inicial.
- *Pronto quando:* a pessoa edita o perfil e a edição seguinte muda de conteúdo.

### Fase 4 — Normalização de feeds
- Resolver entrada livre para feed canônico: URL de feed direto → usa; URL de
  página → busca `<link rel="alternate">` no HTML; falhou → tenta `/feed`,
  `/rss`, `/atom.xml`, `/index.xml`; falhou → devolve erro legível pro usuário
  no editor.
- Guardar o feed resolvido, revalidar periodicamente, marcar feed morto.
- **Proteção contra SSRF** — o servidor passa a buscar URLs que estranhos
  escrevem. Só `http`/`https`, bloquear IP privado e loopback, limitar redirect,
  timeout e tamanho de resposta. Não é item de polimento.
- *Pronto quando:* os 20 blogs do `blogs-exemple.md` resolvem sozinhos.

### Fase 5 — Frequência por usuário
- Scheduler roda de hora em hora e seleciona quem está vencido, em vez de um
  cron semanal único.
- Janela de lookback derivada da frequência (1 / 7 / 30 dias).
- Registro de envio por usuário: quando foi, quais posts, para não repetir.
- *Pronto quando:* diário, semanal e mensal convivem sem envio duplicado.

### Fase 6 — Operação
- Custo de LLM por usuário e limites.
- Métricas de entrega, bounce e reclamação vindas do webhook do Resend.
- Reprocessar edição que falhou.
- Retenção e exclusão de dados a pedido.

## 6. Questões abertas

Decidir na Fase 0. Cada uma muda código de fases posteriores.

**Hospedagem** — o GitHub Actions não serve HTTP. Máquina persistente
(Fly.io, Railway, VPS) ou serverless? A resposta escolhe o banco.

**Banco** — SQLite via `bun:sqlite` numa máquina com volume é o caminho de menor
código; Postgres gerenciado é obrigatório se a hospedagem for serverless.

**Custo por usuário** — pontuar é uma chamada de LLM por usuário por edição.
Cem usuários diários é 3.000 chamadas/mês. Tem teto? Fila de espera? Cobrança?
Ou dá para pontuar uma vez por post e reusar entre usuários com perfil parecido?

**Escopo de quem é o dono da curadoria** — "recomendação direta dos
mantenedores": quem são os mantenedores, e como se adiciona um blog à lista
padrão? Pull request no repo, ou tela de administração?

**Frequência diária vs. volume** — o MVP descartou o diário porque gerava email
de dois ou três posts. Se o usuário escolhe diário e não tem nada com nota ≥ 7,
manda email vazio, pula o dia, ou acumula para o próximo?

**Feed morto** — feed do usuário quebra. Avisa por email, marca no editor em
silêncio, ou remove depois de N falhas?

**Limite por usuário** — quantos feeds cada um pode cadastrar? Sem limite, uma
pessoa com 500 feeds domina o custo de scraping.

**Migração do próprio autor** — o perfil e os feeds de hoje viram o primeiro
registro do banco, ou o autor continua no caminho de env var?

## 7. Fora de escopo por ora

Aplicativo móvel, comentários, feed social, recomendação entre usuários,
importação de OPML, integração com leitor de RSS existente.
