# Decisions

Running log from the v2 design review. Each entry: the decision, and why.
Open questions live at the bottom until they are answered.

> Project language: **everything in this repository is written in English** —
> docs, README, code comments, commit messages, UI copy.

## Decided

**Project is open source, single instance.** The repository is public so people
can read the scoring logic and open pull requests against the curated list.
Running your own copy is not a supported goal, so vendor coupling is allowed
and installation docs are out of scope.

**Hosting: one Railway service.** HTTP and the job worker share a single Bun
process, alongside Railway Postgres. Marginal cost is ~zero on top of the
US$5/month plan already being paid, and it is the exact runtime the existing
code targets (`@effect/platform-bun`). Serverless was evaluated and rejected:
the worker needs a live process for lease heartbeats, graceful shutdown and
durable cron. Cloudflare was evaluated too — its I/O wait does not count
against CPU time, so timeouts are not the blocker there, but the queue store
still requires an external Postgres, and Effect 4 RC on workerd is untested.
If the public directory ever needs global speed, its static HTML can move to
Cloudflare Pages without touching anything else.

**Database: Railway Postgres, through `effect/unstable/sql`.** Automatic
backups are the deciding factor — the database holds other people's email
addresses. `@effect/sql-pg@4.0.0-rc.113` provides the connection; one pool
serves the application, the workflow state and the cluster mailbox. Queries are
written as SQL with `SqlSchema` decoding the rows, and migrations are effects in
`src/migrations.ts`. An ORM was considered and dropped once the queue that
needed one was dropped: four tables of our own do not pay for a query builder.

**Durable execution: `effect/unstable/workflow`, on a single-node cluster.**
Sending an edition is a workflow whose steps are activities, so a crash between
"scored" and "sent" resumes after the scoring instead of buying it again, and a
crash after the send does not send twice. The hourly scheduler is
`ClusterCron`, whose ticks are exactly-once across workers. Workflow state,
mailbox and replies live in Postgres through `SingleRunner.layer`, which runs
its own migrations.

This reverses an earlier entry in this log. That entry rejected
`@effect/workflow` on the grounds that it had no Effect 4 RC build — true of the
standalone package, and wrong about the library: in Effect 4 it ships inside
`effect` as `effect/unstable/workflow`, the same namespace this project already
depends on for `http` and `ai`. `unstable` there means the API is not frozen,
not that the code is experimental.

What it replaces: the in-process scheduler, a `deliveries` state machine, the
GitHub Actions cron, and the three dependencies the queue route wanted
(`effect-mq`, `drizzle-orm`, `drizzle-kit`). Queries use `effect/unstable/sql`
against `@effect/sql-pg`, which the cluster storage needs anyway — so the only
dependency the whole durability story costs is the Postgres driver.

Rejected alternatives: `effect-mq` (a good fit for the shape of the work, but
three dependencies — one of them three weeks old — sitting in the critical path
of delivery, to buy retry semantics the activities already provide); a
hand-rolled state machine over a `deliveries` table (viable, and the closest
call — `SELECT ... FOR UPDATE SKIP LOCKED` on an hourly tick is about 120 lines
— but it re-implements the resume-after-crash guarantee by hand); event
sourcing (twice the code for a five-state flow); Redis (a second source of
truth about the same delivery, and not needed at this throughput).

**LLM cost: one call per user per edition, with a global spend cap.** Keeps the
existing `Scorer` untouched. Monthly spend accumulates in the database; hitting
the cap stops sending and raises an alert. Shared scoring across users
(embedding-based) is the right optimisation later, when there is real data
about which profiles cost the most.

**Limits: 50 feeds per user, 150 posts per edition.** The second number is the
one that protects the architecture: it bounds prompt size, so cost per edition
has a known ceiling regardless of how noisy a user's feeds are. The editor
shows the count while typing.

**Curated list: a versioned data file, changed by pull request.** "Maintainer"
means commit access — no admin role, no admin screen, no privileged auth. CI
validates the feed before merge, and review history comes from GitHub. This
also matches the culture of the thing: a blogroll is a signed opinion, not a
directory listing.

**Subdomain: `radar.luizcastro.dev`.** Short, works in both Portuguese and
English, and describes the recurring product. It becomes the Resend sender
domain, so DNS (SPF/DKIM/DMARC) must be set up before Phase 2 ships.

**License: MIT.** The permissive end, chosen for the same reason the repo is
public: the value here is the curated list and the scoring approach, not the
plumbing. A hosted clone is allowed; nobody is stopped from running one, and
nobody is obliged to contribute back.

**Authentication: signed links, no session table.** Sign-in is a link emailed
to the address on file, good for fifteen minutes. The session is the same
mechanism with a longer life, kept in an `HttpOnly` cookie. Confirmation and
unsubscribe links are the same primitive with a different purpose field, which
is checked — an unsubscribe link cannot be replayed as a session.

Two things fall out of this, both good. Nothing is written to the database until
a confirmation link is clicked, so an address typed by a stranger leaves no
trace. And `SECRET_KEY` becomes the single revocation switch: changing it signs
everyone out and voids every outstanding link.

**Rendering: server-rendered HTML from a tagged template that escapes by
default.** No framework owns the server, which is what keeps the workers in the
same process. `html\`...\`` escapes every interpolation and `raw()` is the loud
exception, so the cross-site-scripting case is the one you have to ask for
rather than the one you forget.

**The editors are textareas.** JetBrains Mono, the Zed One palette, a gutter
painted as a background gradient rather than an element — the look, for zero
kilobytes. CodeMirror was in the plan to buy syntax highlighting and inline JSON
errors; the feed list stopped being JSON (it is one address per line), which
took the JSON error with it, and there is no syntax to highlight in a Markdown
profile. Nothing left to pay for.

**A round with nothing above the cut sends nothing.** No empty email, no
carry-over. An inbox that stays quiet keeps its credibility; a weekly "nothing
this week" trains people to ignore us, and carrying posts forward means a daily
reader eventually gets a weekly digest they did not ask for. The reader's
`last_sent_at` still moves, so the window does not pile up.

**A failing feed gets five strikes.** Each failed fetch increments a counter and
records the reason; five consecutive failures retire it, and one success resets
it to zero. Retired feeds are shown in the account page with their error,
alongside a line saying what that means. No email about it: a blog being down
is not news worth interrupting someone for, and the place they would fix it is
the page they are already on.

**The author subscribes like everyone else.** No migration, no seed, no
env-var path kept alive alongside the database. `src/feeds.ts` became
`src/curation.ts`, which every new subscriber starts from — including the
author. One code path is worth more than one saved signup.

## Open

- Resend webhooks: delivery, bounce and complaint handling is not built yet.
- Data retention: `sent_posts` grows without bound; nothing prunes it.
- Deleting an account on request — unsubscribing keeps the profile on purpose,
  but there is no way to ask for erasure yet.
