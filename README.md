# Radar

Engineering blogs worth reading, and an email with only the posts that match
what you actually work on.

Live at **radar.luizcastro.dev**.

## The problem

Following twenty engineering blogs means either opening twenty tabs or
subscribing to everything and drowning. Radar reads the feeds, asks a language
model to score each post against a profile you wrote in your own words, and
mails you only what clears the bar — daily, weekly or monthly, your choice.

## How it works

1. Every hour, a durable cron asks the database who is overdue.
2. For each of them, a workflow reads their feeds, drops anything they were
   already sent, and caps the batch at 150 posts.
3. Title and summary of all of them go to the model in one call, together with
   the reader's profile. It returns a 0–10 score and one line of reasoning per
   post.
4. Posts scoring 7 or higher become the email, ordered by score. A round where
   nothing clears the bar sends nothing.
5. The email goes out through Resend.

Each of those steps is a workflow activity, so a crash halfway through resumes
after the last completed step instead of paying for the model twice or sending
the same edition again.

## Running it

```sh
bun install
cp .env.example .env        # fill in SECRET_KEY and OPENROUTER_API_KEY
docker compose up -d        # Postgres on 5432
bun run dev                 # http://localhost:3000, emails written to out/
```

`bun run dev` sets `DRY_RUN=1`, so editions land in `out/` as HTML instead of
being sent, and the Resend configuration is not required.

| Command | What it does |
|---|---|
| `bun run check` | typecheck, lint, tests |
| `bun run feeds:check` | fetches every curated feed; CI gate for the blogroll |
| `bun run feeds:resolve "<name> <url>"` | resolves an address to a feed URL |
| `bun run scripts/send-now.ts` | runs the hourly dispatch immediately |

## Layout

```
src/
  main.ts          the entrypoint: launch the composed layers
  layers.ts        how the process is wired together
  config.ts        environment variables
  domain.ts        frequency, feed health, period keys, the caps
  curation.ts      the blogroll, and why some blogs are not on it
  migrations.ts    schema history

  web.ts           HTTP routes
  pages.ts         the pages and the transactional emails
  html.ts          escaping-by-default templates and the stylesheet

  workflows.ts     sending an edition, resolving a feed, the hourly cron
  Repo.ts          every database query
  Tokens.ts        signed confirm / sign-in / unsubscribe links

  FeedReader.ts    reads and parses feeds
  FeedResolver.ts  free text to a canonical feed URL
  SafeHttp.ts      the guard around fetching URLs strangers typed
  Scorer.ts        scores posts through OpenRouter
  Mailer.ts        sends through Resend, or writes to out/
  newsletter.ts    pure logic: date window, cut, prompt, email HTML
```

A capitalised file is an Effect service (`Context.Service` with `make` and
`layer`). Lowercase is an entrypoint, configuration, or pure functions.

Conventions, following the official Effect example and the t3code notes:

- Namespace and subpath imports: `import * as Effect from "effect/Effect"`.
- One module per service, in this order: imports, errors, the service tag with
  its interface inline, `make`, `layer`.
- Errors are `Schema.TaggedError` with structured fields and the original cause
  kept in `cause`.
- Anything environmental — the filesystem, the clock, HTTP, UUIDs — arrives as
  a service, never from a global. That is why the tests touch no disk, no
  network and no real clock.

## Architecture

One Bun process on Railway, alongside Railway Postgres. It serves the site,
runs the scheduler, and runs the workers, all sharing a connection pool and a
shutdown. Durability comes from `effect/unstable/workflow` on a single-node
cluster (`SingleRunner`), so workflow state lives in Postgres and survives a
restart or a deploy.

Migrations run at startup: ours from `src/migrations.ts`, and the cluster's own
from the SQL message storage.

The reasoning behind each of these choices is in [docs/DECISIONS.md](docs/DECISIONS.md).

## Configuration

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SECRET_KEY` | signs every confirmation, sign-in and unsubscribe link |
| `OPENROUTER_API_KEY` | OpenRouter key |
| `OPENROUTER_MODEL` | scoring model. Default: `deepseek/deepseek-v4.1-flash` |
| `RESEND_API_KEY` | Resend key |
| `MAIL_FROM` | sender address on the verified domain |
| `APP_URL` | public base URL, used to build the links inside emails |
| `PORT` | HTTP port. Default: 3000 |
| `MONTHLY_SCORING_CALLS` | ceiling on model calls per month; past it nothing is sent |
| `ALERT_TO` | who hears about it when the ceiling is hit |
| `DRY_RUN` | `1` writes editions to `out/` and sends nothing |

## Contributing to the blogroll

The curated list is [`src/curation.ts`](src/curation.ts). Adding a blog is a
pull request: run `bun run feeds:resolve "Name https://theblog.example"` to get
the entry, add a one-line description saying what makes it worth reading, and
open the PR. CI fetches every feed in the list before it can merge.

`src/curation.ts` also records the blogs that were deliberately left out, and
why — check there before re-adding one.

## License

MIT. See [LICENSE](LICENSE).
