import * as Cron from "effect/Cron"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as ClusterCron from "effect/unstable/cluster/ClusterCron"
import * as Activity from "effect/unstable/workflow/Activity"
import * as Workflow from "effect/unstable/workflow/Workflow"
import * as AppConfig from "./config"
import { DEAD_AFTER_FAILURES, LOOKBACK_DAYS, MAX_POSTS_PER_EDITION, periodKey } from "./domain"
import { FeedReader, type Source } from "./FeedReader"
import { FeedResolver } from "./FeedResolver"
import * as Mailer from "./Mailer"
import { editionSubject, pickRelevant, renderHtml } from "./newsletter"
import { Repo } from "./Repo"
import { Scorer } from "./Scorer"
import * as Tokens from "./Tokens"

/**
 * The two pieces of work that take time and must not be lost halfway: sending
 * one person's edition, and turning one typed line into a feed URL.
 *
 * They are workflows rather than plain effects because each step is an
 * `Activity` — once a step has completed, a restart resumes after it instead of
 * redoing it. That is what keeps a crash between "scored" and "sent" from
 * costing a second model call, and a crash after "sent" from sending twice.
 */

// -- one edition, one subscriber ---------------------------------------------

export const SendEdition = Workflow.make("SendEdition", {
  payload: { userId: Schema.String, period: Schema.String },
  // Same user, same period, same execution. Two ticks in one window cannot
  // become two emails.
  idempotencyKey: ({ userId, period }) => `${userId}:${period}`,
})

const SendEditionLive = SendEdition.toLayer(
  Effect.fn("SendEdition")(function* ({ userId, period }) {
    const repo = yield* Repo
    const user = yield* repo.findUser(userId)
    if (Option.isNone(user) || user.value.status !== "active") return
    const profile = user.value.profile
    const lookbackDays = LOOKBACK_DAYS[user.value.frequency]

    const feeds = yield* repo.feedsOf(userId)
    // Pair each usable feed with its source in one pass, so the resolved URL is
    // carried along rather than re-asserted at every use.
    const live = feeds.flatMap((feed) =>
      feed.url !== null && feed.status !== "dead"
        ? [{ id: feed.id, source: { name: feed.name ?? feed.input, url: feed.url } satisfies Source }]
        : [],
    )
    if (live.length === 0) {
      yield* Effect.logInfo(`${userId}: no readable feeds, skipping ${period}`)
      yield* repo.markSent(userId)
      return
    }

    // 1. Read the feeds. Also the health check: a feed that fails here gets a
    //    strike, and enough strikes retire it.
    const collected = yield* Activity.make({
      name: "collect",
      success: Schema.Struct({
        posts: Schema.Array(
          Schema.Struct({
            id: Schema.Int,
            source: Schema.String,
            title: Schema.String,
            link: Schema.String,
            summary: Schema.String,
            publishedAt: Schema.NullOr(Schema.String),
          }),
        ),
        failed: Schema.Array(Schema.String),
      }),
      execute: Effect.gen(function* () {
        const reader = yield* FeedReader
        const now = yield* DateTime.now
        const result = yield* reader.collect(
          live.map((feed) => feed.source),
          now,
          lookbackDays,
        )
        const failedUrls = new Set(result.failed.map((source) => source.url))
        yield* Effect.forEach(
          live,
          (feed) =>
            failedUrls.has(feed.source.url)
              ? repo.markFeedFailed(feed.id, "The feed did not answer.", DEAD_AFTER_FAILURES)
              : repo.markFeedHealthy(feed.id),
          { discard: true },
        )
        return {
          posts: result.posts.map((post) => ({
            id: post.id,
            source: post.source,
            title: post.title,
            link: post.link,
            summary: post.summary,
            publishedAt: Option.match(post.publishedAt, {
              onNone: () => null,
              onSome: (value) => DateTime.formatIso(value),
            }),
          })),
          failed: result.failed.map((source) => source.name),
        }
      }),
    })

    // 2. Drop anything this reader has already been sent, then cap the batch.
    //    The cap is what bounds the prompt, and so the bill.
    const seen = yield* repo.alreadySent(
      userId,
      collected.posts.map((post) => post.link),
    )
    const fresh = collected.posts.filter((post) => !seen.has(post.link)).slice(0, MAX_POSTS_PER_EDITION)
    if (fresh.length === 0) {
      yield* Effect.logInfo(`${userId}: nothing new for ${period}`)
      yield* repo.markSent(userId)
      return
    }

    // 3. Score. The one paid step, so it is its own activity: a crash after it
    //    resumes with the scores instead of buying them twice.
    const scores = yield* Activity.make({
      name: "score",
      success: Schema.Array(Schema.Struct({ id: Schema.Int, score: Schema.Int, reason: Schema.String })),
      execute: Effect.gen(function* () {
        const scorer = yield* Scorer
        const cap = yield* AppConfig.monthlyScoringCalls
        const month = period.slice(0, 7)
        const used = yield* repo.scoringCallsThisMonth(month)
        if (used >= cap) {
          yield* Effect.logError(`scoring cap reached: ${used}/${cap} calls in ${month}; not sending`)
          return []
        }
        const result = yield* scorer.score(
          profile,
          fresh.map((post) => ({ ...post, publishedAt: Option.none() })),
        )
        yield* repo.recordScoring(month, result.inputTokens, result.outputTokens)
        return result.scores
      }).pipe(Activity.retry({ times: 2 }), Effect.orDie),
    })

    const relevant = pickRelevant(
      fresh.map((post) => ({ ...post, publishedAt: Option.none() })),
      scores,
    )

    // A round with nothing above the bar sends no email. Better an inbox that
    // stays quiet than a habit of ignoring us.
    if (relevant.length === 0) {
      yield* Effect.logInfo(`${userId}: nothing cleared the bar for ${period}`)
      yield* repo.markSent(userId)
      return
    }

    // 4. Send, then record. Resend's idempotency key is derived from the
    //    execution, so even a retry inside this activity cannot double-send.
    yield* Activity.make({
      name: "send",
      execute: Effect.gen(function* () {
        const mailer = yield* Mailer.Mailer
        const tokens = yield* Tokens.Tokens
        const baseUrl = yield* AppConfig.appUrl
        const unsubscribeToken = yield* tokens.sign("unsubscribe", userId, Tokens.TTL.unsubscribe)
        const now = yield* DateTime.now
        yield* mailer.send({
          to: user.value.email,
          subject: editionSubject(now, relevant.length),
          html: renderHtml(relevant, collected.failed, fresh.length, {
            account: `${baseUrl}/account`,
            unsubscribe: `${baseUrl}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
          }),
          idempotencyKey: `edition:${userId}:${period}`,
        })
        yield* repo.recordSent(
          userId,
          relevant.map((post) => post.link),
        )
        yield* repo.markSent(userId)
      }).pipe(Activity.retry({ times: 2 }), Effect.orDie),
    })
  }),
)

// -- resolving one typed line into a feed ------------------------------------

export const ResolveFeed = Workflow.make("ResolveFeed", {
  payload: { feedId: Schema.String },
  idempotencyKey: ({ feedId }) => feedId,
})

const ResolveFeedLive = ResolveFeed.toLayer(
  Effect.fn("ResolveFeed")(function* ({ feedId }) {
    const repo = yield* Repo
    const feed = yield* repo.feedById(feedId)
    if (Option.isNone(feed) || feed.value.status !== "pending") return
    yield* Activity.make({
      name: "resolve",
      execute: Effect.gen(function* () {
        const resolver = yield* FeedResolver
        const resolved = yield* resolver.resolve(feed.value.input).pipe(Effect.option)
        yield* Option.match(resolved, {
          onNone: () => repo.markFeedFailed(feedId, "We could not find a feed at that address.", 1),
          onSome: (found) => repo.markFeedResolved(feedId, found.name, found.url),
        })
      }),
    })
  }),
)

// -- the clock ---------------------------------------------------------------

const BATCH = 200

/** Starts an execution for every subscriber whose next edition is due. */
export const dispatchDueEditions = Effect.gen(function* () {
  const repo = yield* Repo
  const due = yield* repo.dueUsers(BATCH)
  if (due.length === 0) return
  const now = yield* DateTime.now
  const at = DateTime.toDateUtc(now)
  yield* Effect.logInfo(`${due.length} subscribers due`)
  yield* Effect.forEach(
    due,
    (user) =>
      SendEdition.execute({ userId: user.id, period: periodKey(user.frequency, at) }, { discard: true }).pipe(
        Effect.catchCause((cause) => Effect.logError(`could not start an edition for ${user.id}`, cause)),
      ),
    { concurrency: 8, discard: true },
  )
})

/** Starts an execution for every feed line nobody has resolved yet. */
export const kickResolvePending = Effect.gen(function* () {
  const repo = yield* Repo
  const pending = yield* repo.unresolvedFeeds(BATCH)
  yield* Effect.forEach(
    pending,
    (feed) =>
      ResolveFeed.execute({ feedId: feed.id }, { discard: true }).pipe(
        Effect.catchCause((cause) => Effect.logError(`could not start resolution for ${feed.id}`, cause)),
      ),
    { concurrency: 8, discard: true },
  )
})

/**
 * Hourly, on the hour. The scheduler does not decide who gets what — it asks
 * the database who is overdue, so a restart, a deploy, or an hour of downtime
 * changes nothing except when the catch-up happens.
 */
const HourlyTick = ClusterCron.make({
  name: "radar-hourly",
  cron: Cron.parseUnsafe("0 * * * *", "UTC"),
  execute: Effect.gen(function* () {
    yield* dispatchDueEditions
    yield* kickResolvePending
  }),
  skipIfOlderThan: "2 hours",
})

export const layer = Layer.mergeAll(SendEditionLive, ResolveFeedLive, HourlyTick)
