import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as SqlSchema from "effect/unstable/sql/SqlSchema"
import { CURATION } from "./curation"
import { type Frequency, MAX_FEEDS_PER_USER, User, UserFeed } from "./domain"

/**
 * Every query the application makes. Errors from the database are defects, not
 * typed failures: if Postgres is unreachable there is no sensible fallback at
 * the call site, and the job runtime retries the whole step anyway.
 */

export class FeedLimitError extends Schema.TaggedError<FeedLimitError>()("FeedLimitError", {
  limit: Schema.Int,
}) {
  override get message(): string {
    return `A list can hold at most ${this.limit} blogs.`
  }
}

const Row = {
  user: Schema.Struct({
    id: Schema.String,
    email: Schema.String,
    status: User.fields.status,
    profile: Schema.String,
    frequency: User.fields.frequency,
    last_sent_at: Schema.NullOr(Schema.Date),
  }),
  feed: Schema.Struct({
    id: Schema.String,
    user_id: Schema.String,
    input: Schema.String,
    name: Schema.NullOr(Schema.String),
    url: Schema.NullOr(Schema.String),
    status: UserFeed.fields.status,
    error: Schema.NullOr(Schema.String),
    failure_count: Schema.Int,
  }),
}

type UserRow = typeof Row.user.Type
type FeedRow = typeof Row.feed.Type

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  status: row.status,
  profile: row.profile,
  frequency: row.frequency,
  lastSentAt: row.last_sent_at,
})

const toFeed = (row: FeedRow): UserFeed => ({
  id: row.id,
  userId: row.user_id,
  input: row.input,
  name: row.name,
  url: row.url,
  status: row.status,
  error: row.error,
  failureCount: row.failure_count,
})

export class Repo extends Context.Service<
  Repo,
  {
    /** Creates the subscriber if new, reactivates them if they had left. Returns the id. */
    readonly upsertUser: (email: string, profile: string) => Effect.Effect<string>
    readonly findUser: (id: string) => Effect.Effect<Option.Option<User>>
    readonly findUserByEmail: (email: string) => Effect.Effect<Option.Option<User>>
    readonly updateProfile: (userId: string, profile: string, frequency: Frequency) => Effect.Effect<void>
    readonly unsubscribe: (userId: string) => Effect.Effect<void>
    /** Subscribers whose next edition is due, oldest first. */
    readonly dueUsers: (limit: number) => Effect.Effect<ReadonlyArray<User>>
    readonly markSent: (userId: string) => Effect.Effect<void>

    readonly feedsOf: (userId: string) => Effect.Effect<ReadonlyArray<UserFeed>>
    /** Replaces a user's whole list with what they typed, keeping rows that did not change. */
    readonly replaceFeeds: (userId: string, inputs: ReadonlyArray<string>) => Effect.Effect<void, FeedLimitError>
    readonly unresolvedFeeds: (limit: number) => Effect.Effect<ReadonlyArray<UserFeed>>
    readonly feedById: (feedId: string) => Effect.Effect<Option.Option<UserFeed>>
    readonly markFeedResolved: (feedId: string, name: string, url: string) => Effect.Effect<void>
    /** Records a failed fetch; past `deadAfter` consecutive failures the feed is retired. */
    readonly markFeedFailed: (feedId: string, reason: string, deadAfter: number) => Effect.Effect<void>
    readonly markFeedHealthy: (feedId: string) => Effect.Effect<void>

    /** Links already mailed to this user, out of the ones about to be mailed. */
    readonly alreadySent: (userId: string, links: ReadonlyArray<string>) => Effect.Effect<ReadonlySet<string>>
    readonly recordSent: (userId: string, links: ReadonlyArray<string>) => Effect.Effect<void>

    readonly scoringCallsThisMonth: (month: string) => Effect.Effect<number>
    readonly recordScoring: (month: string, inputTokens: number, outputTokens: number) => Effect.Effect<void>
  }
>()("Repo") {}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findUsers = SqlSchema.findAll({
    Request: Schema.String,
    Result: Row.user,
    execute: (id) => sql`SELECT * FROM users WHERE id = ${id}::uuid`,
  })

  const findByEmail = SqlSchema.findAll({
    Request: Schema.String,
    Result: Row.user,
    execute: (email) => sql`SELECT * FROM users WHERE lower(email) = lower(${email})`,
  })

  const selectDue = SqlSchema.findAll({
    Request: Schema.Int,
    Result: Row.user,
    execute: (limit) => sql`
      SELECT * FROM users
      WHERE status = 'active'
        AND (
          last_sent_at IS NULL
          OR last_sent_at < now() - (
            CASE frequency
              WHEN 'daily'   THEN interval '1 day'
              WHEN 'weekly'  THEN interval '7 days'
              ELSE                interval '30 days'
            END
          )
        )
      ORDER BY last_sent_at NULLS FIRST
      LIMIT ${limit}
    `,
  })

  const selectFeeds = SqlSchema.findAll({
    Request: Schema.String,
    Result: Row.feed,
    execute: (userId) => sql`SELECT * FROM user_feeds WHERE user_id = ${userId}::uuid ORDER BY input`,
  })

  const selectFeedById = SqlSchema.findAll({
    Request: Schema.String,
    Result: Row.feed,
    execute: (feedId) => sql`SELECT * FROM user_feeds WHERE id = ${feedId}::uuid`,
  })

  const selectUnresolved = SqlSchema.findAll({
    Request: Schema.Int,
    Result: Row.feed,
    execute: (limit) => sql`SELECT * FROM user_feeds WHERE status = 'pending' LIMIT ${limit}`,
  })

  const one = <A>(rows: ReadonlyArray<A>): Option.Option<A> =>
    rows.length === 0 ? Option.none() : Option.some(rows[0]!)

  const upsertUser = Effect.fn("Repo.upsertUser")(function* (email: string, profile: string) {
    const rows = yield* sql<{ id: string }>`
      INSERT INTO users (email, profile)
      VALUES (${email}, ${profile})
      ON CONFLICT (lower(email)) DO UPDATE SET status = 'active'
      RETURNING id
    `
    const userId = rows[0]!.id
    // A brand-new subscriber starts from the blogroll; someone coming back
    // keeps whatever list they had.
    yield* sql`
      INSERT INTO user_feeds (user_id, input, name, url, status)
      SELECT ${userId}::uuid, f.input, f.name, f.url, 'ok'
      FROM (VALUES ${sql.csv(CURATION.map((feed) => sql`(${feed.site}, ${feed.name}, ${feed.url})`))})
        AS f (input, name, url)
      ON CONFLICT (user_id, input) DO NOTHING
    `
    return userId
  }, Effect.orDie)

  const replaceFeeds = Effect.fn("Repo.replaceFeeds")(
    function* (userId: string, inputs: ReadonlyArray<string>) {
      const wanted = [...new Set(inputs.map((input) => input.trim()).filter((input) => input.length > 0))]
      if (wanted.length > MAX_FEEDS_PER_USER) return yield* new FeedLimitError({ limit: MAX_FEEDS_PER_USER })
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* wanted.length === 0
            ? sql`DELETE FROM user_feeds WHERE user_id = ${userId}::uuid`
            : sql`DELETE FROM user_feeds WHERE user_id = ${userId}::uuid AND input NOT IN ${sql.in(wanted)}`
          if (wanted.length > 0) {
            // Rows that survived keep their resolved URL and health; only the new
            // lines come in as pending and get queued for resolution.
            yield* sql`
            INSERT INTO user_feeds ${sql.insert(wanted.map((input) => ({ user_id: userId, input })))}
            ON CONFLICT (user_id, input) DO NOTHING
          `
          }
        }),
      )
    },
    Effect.catchTag("SqlError", Effect.die),
  )

  return Repo.of({
    upsertUser,
    findUser: Effect.fn("Repo.findUser")((id: string) =>
      findUsers(id).pipe(Effect.map(one), Effect.map(Option.map(toUser)), Effect.orDie),
    ),
    findUserByEmail: Effect.fn("Repo.findUserByEmail")((email: string) =>
      findByEmail(email).pipe(Effect.map(one), Effect.map(Option.map(toUser)), Effect.orDie),
    ),
    updateProfile: Effect.fn("Repo.updateProfile")(
      (userId: string, profile: string, frequency: Frequency) =>
        sql`UPDATE users SET profile = ${profile}, frequency = ${frequency} WHERE id = ${userId}::uuid`,
      Effect.asVoid,
      Effect.orDie,
    ),
    unsubscribe: Effect.fn("Repo.unsubscribe")(
      (userId: string) => sql`UPDATE users SET status = 'unsubscribed' WHERE id = ${userId}::uuid`,
      Effect.asVoid,
      Effect.orDie,
    ),
    dueUsers: Effect.fn("Repo.dueUsers")((limit: number) =>
      selectDue(limit).pipe(
        Effect.map((rows) => rows.map(toUser)),
        Effect.orDie,
      ),
    ),
    markSent: Effect.fn("Repo.markSent")(
      (userId: string) => sql`UPDATE users SET last_sent_at = now() WHERE id = ${userId}::uuid`,
      Effect.asVoid,
      Effect.orDie,
    ),

    feedsOf: Effect.fn("Repo.feedsOf")((userId: string) =>
      selectFeeds(userId).pipe(
        Effect.map((rows) => rows.map(toFeed)),
        Effect.orDie,
      ),
    ),
    replaceFeeds,
    unresolvedFeeds: Effect.fn("Repo.unresolvedFeeds")((limit: number) =>
      selectUnresolved(limit).pipe(
        Effect.map((rows) => rows.map(toFeed)),
        Effect.orDie,
      ),
    ),
    feedById: Effect.fn("Repo.feedById")((feedId: string) =>
      selectFeedById(feedId).pipe(Effect.map(one), Effect.map(Option.map(toFeed)), Effect.orDie),
    ),
    markFeedResolved: Effect.fn("Repo.markFeedResolved")(
      (feedId: string, name: string, url: string) => sql`
        UPDATE user_feeds
        SET name = ${name}, url = ${url}, status = 'ok', error = NULL, failure_count = 0, checked_at = now()
        WHERE id = ${feedId}::uuid
      `,
      Effect.asVoid,
      Effect.orDie,
    ),
    markFeedFailed: Effect.fn("Repo.markFeedFailed")(
      (feedId: string, reason: string, deadAfter: number) => sql`
        UPDATE user_feeds
        SET failure_count = failure_count + 1,
            error = ${reason},
            checked_at = now(),
            status = CASE WHEN failure_count + 1 >= ${deadAfter} THEN 'dead' ELSE 'failing' END
        WHERE id = ${feedId}::uuid
      `,
      Effect.asVoid,
      Effect.orDie,
    ),
    markFeedHealthy: Effect.fn("Repo.markFeedHealthy")(
      (feedId: string) => sql`
        UPDATE user_feeds SET status = 'ok', error = NULL, failure_count = 0, checked_at = now()
        WHERE id = ${feedId}::uuid AND status <> 'ok'
      `,
      Effect.asVoid,
      Effect.orDie,
    ),

    alreadySent: Effect.fn("Repo.alreadySent")((userId: string, links: ReadonlyArray<string>) =>
      links.length === 0
        ? Effect.succeed(new Set<string>())
        : sql<{ link: string }>`
            SELECT link FROM sent_posts WHERE user_id = ${userId}::uuid AND link IN ${sql.in(links)}
          `.pipe(
            Effect.map((rows) => new Set(rows.map((row) => row.link))),
            Effect.orDie,
          ),
    ),
    recordSent: Effect.fn("Repo.recordSent")(function* (userId: string, links: ReadonlyArray<string>) {
      if (links.length === 0) return
      yield* sql`
          INSERT INTO sent_posts ${sql.insert(links.map((link) => ({ user_id: userId, link })))}
          ON CONFLICT DO NOTHING
        `
    }, Effect.orDie),

    scoringCallsThisMonth: Effect.fn("Repo.scoringCallsThisMonth")((month: string) =>
      sql<{ calls: number }>`SELECT calls FROM llm_usage WHERE month = ${month}`.pipe(
        Effect.map((rows) => rows[0]?.calls ?? 0),
        Effect.orDie,
      ),
    ),
    recordScoring: Effect.fn("Repo.recordScoring")(
      (month: string, inputTokens: number, outputTokens: number) => sql`
        INSERT INTO llm_usage (month, calls, input_tokens, output_tokens)
        VALUES (${month}, 1, ${inputTokens}, ${outputTokens})
        ON CONFLICT (month) DO UPDATE SET
          calls = llm_usage.calls + 1,
          input_tokens = llm_usage.input_tokens + ${inputTokens},
          output_tokens = llm_usage.output_tokens + ${outputTokens}
      `,
      Effect.asVoid,
      Effect.orDie,
    ),
  })
})

export const layer = Layer.effect(Repo, make)
