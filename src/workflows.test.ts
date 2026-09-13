import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as ClusterWorkflowEngine from "effect/unstable/cluster/ClusterWorkflowEngine"
import * as TestRunner from "effect/unstable/cluster/TestRunner"
import { FeedReader } from "./FeedReader"
import { FeedResolver } from "./FeedResolver"
import type { Mail } from "./Mailer"
import { Mailer } from "./Mailer"
import type { Post } from "./newsletter"
import { Repo } from "./Repo"
import { Scorer } from "./Scorer"
import * as Tokens from "./Tokens"
import * as workflows from "./workflows"

process.env.APP_URL = "https://radar.test"
process.env.MONTHLY_SCORING_CALLS = "100"

const post = (n: number): Post => ({
  id: n,
  source: "Example",
  title: `Post ${n}`,
  link: `https://example.com/${n}`,
  summary: "…",
  publishedAt: Option.none(),
})

/** Everything the workflow touches, held in memory so the test needs no server. */
const harness = () => {
  const sent: Array<Mail> = []
  const recorded: Array<string> = []
  const markedSent: Array<string> = []
  let scoringCalls = 0

  const user = {
    id: "user-1",
    email: "ada@example.com",
    status: "active" as const,
    profile: "backend, typescript",
    frequency: "weekly" as const,
    lastSentAt: null,
  }

  const repo = Layer.succeed(
    Repo,
    Repo.of({
      upsertUser: () => Effect.succeed(user.id),
      findUser: () => Effect.succeed(Option.some(user)),
      findUserByEmail: () => Effect.succeed(Option.some(user)),
      updateProfile: () => Effect.void,
      unsubscribe: () => Effect.void,
      dueUsers: () => Effect.succeed([user]),
      markSent: (userId) => Effect.sync(() => void markedSent.push(userId)),
      feedsOf: () =>
        Effect.succeed([
          {
            id: "feed-1",
            userId: user.id,
            input: "https://example.com",
            name: "Example",
            url: "https://example.com/feed",
            status: "ok" as const,
            error: null,
            failureCount: 0,
          },
        ]),
      replaceFeeds: () => Effect.void,
      unresolvedFeeds: () => Effect.succeed([]),
      feedById: () => Effect.succeed(Option.none()),
      markFeedResolved: () => Effect.void,
      markFeedFailed: () => Effect.void,
      markFeedHealthy: () => Effect.void,
      alreadySent: (_userId, links) => Effect.succeed(new Set(links.filter((link) => recorded.includes(link)))),
      recordSent: (_userId, links) => Effect.sync(() => void recorded.push(...links)),
      scoringCallsThisMonth: () => Effect.succeed(scoringCalls),
      recordScoring: () => Effect.sync(() => void scoringCalls++),
    }),
  )

  const reader = Layer.succeed(FeedReader, {
    collect: () => Effect.succeed({ posts: [post(0), post(1), post(2)], failed: [] }),
  })

  const scorer = Layer.succeed(Scorer, {
    score: (_profile, posts) =>
      Effect.succeed({
        // only the first two clear the cut
        scores: posts.map((p) => ({ id: p.id, score: p.id < 2 ? 9 - p.id : 3, reason: `because ${p.id}` })),
        inputTokens: 10,
        outputTokens: 5,
      }),
  })

  const mailer = Layer.succeed(Mailer, { send: (mail) => Effect.sync(() => void sent.push(mail)) })

  const resolver = Layer.succeed(FeedResolver, { resolve: () => Effect.die("not used") })

  const services = Layer.mergeAll(repo, reader, scorer, mailer, resolver, Tokens.layerWith("test-key"))
  const engine = ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(TestRunner.layer))

  return {
    sent,
    recorded,
    markedSent,
    scoringCalls: () => scoringCalls,
    layer: workflows.layer.pipe(Layer.provideMerge(services), Layer.provideMerge(engine)),
  }
}

const run = <A, E, R>(h: ReturnType<typeof harness>, effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(h.layer)) as Effect.Effect<A, E, never>)

test("an edition mails only the posts that clear the cut, newest score first", async () => {
  const h = harness()
  await run(h, workflows.SendEdition.execute({ userId: "user-1", period: "2026-W37" }))

  expect(h.sent).toHaveLength(1)
  const mail = h.sent[0]!
  expect(mail.to).toBe("ada@example.com")
  expect(mail.subject).toContain("2 posts")
  expect(mail.html).toContain("Post 0")
  expect(mail.html).toContain("Post 1")
  expect(mail.html).not.toContain("Post 2")
  expect(h.recorded).toEqual(["https://example.com/0", "https://example.com/1"])
  expect(h.markedSent).toEqual(["user-1"])
})

test("every edition carries a working unsubscribe link", async () => {
  const h = harness()
  await run(h, workflows.SendEdition.execute({ userId: "user-1", period: "2026-W37" }))

  const token = h.sent[0]!.html.match(/unsubscribe\?token=([^"]+)/)?.[1]
  expect(token).toBeDefined()
  const subject = await Effect.runPromise(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      return (yield* tokens.verify("unsubscribe", decodeURIComponent(token!))).subject
    }).pipe(Effect.provide(Tokens.layerWith("test-key"))),
  )
  expect(subject).toBe("user-1")
})

test("re-running the same period does not send a second time", async () => {
  const h = harness()
  const once = workflows.SendEdition.execute({ userId: "user-1", period: "2026-W37" })
  await run(
    h,
    Effect.gen(function* () {
      yield* once
      yield* once
    }),
  )

  expect(h.sent).toHaveLength(1)
  expect(h.scoringCalls()).toBe(1)
})

test("a round where nothing clears the cut sends nothing but still counts as done", async () => {
  const h = harness()
  // every post was mailed already, so nothing is fresh
  h.recorded.push("https://example.com/0", "https://example.com/1", "https://example.com/2")

  await run(h, workflows.SendEdition.execute({ userId: "user-1", period: "2026-W38" }))

  expect(h.sent).toHaveLength(0)
  expect(h.scoringCalls()).toBe(0)
  expect(h.markedSent).toEqual(["user-1"])
})

test("the send is idempotent at the mail provider too", async () => {
  const h = harness()
  await run(h, workflows.SendEdition.execute({ userId: "user-1", period: "2026-W37" }))
  expect(h.sent[0]!.idempotencyKey).toBe("edition:user-1:2026-W37")
})
