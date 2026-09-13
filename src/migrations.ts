import * as Effect from "effect/Effect"
import * as Migrator from "effect/unstable/sql/Migrator"
import * as SqlClient from "effect/unstable/sql/SqlClient"

/**
 * Schema history. Migrations run once, in id order, inside a transaction, and
 * never change after they have shipped — add a new one instead.
 *
 * The cluster tables (`cluster_messages` and friends) are not here: the cluster
 * SQL storage runs its own migrations when the runner starts.
 */
export const loader = Migrator.fromRecord({
  "0001_initial": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    yield* sql`
      CREATE TABLE users (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email          text NOT NULL,
        status         text NOT NULL DEFAULT 'active',
        profile        text NOT NULL,
        frequency      text NOT NULL DEFAULT 'weekly',
        created_at     timestamptz NOT NULL DEFAULT now(),
        last_sent_at   timestamptz
      )
    `
    // Emails are compared lowercased everywhere, so the uniqueness has to be
    // lowercased too or "Ada@x.com" and "ada@x.com" become two subscribers.
    yield* sql`CREATE UNIQUE INDEX users_email_idx ON users (lower(email))`
    yield* sql`CREATE INDEX users_due_idx ON users (status, last_sent_at)`

    yield* sql`
      CREATE TABLE user_feeds (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        input          text NOT NULL,
        name           text,
        url            text,
        status         text NOT NULL DEFAULT 'pending',
        error          text,
        failure_count  integer NOT NULL DEFAULT 0,
        checked_at     timestamptz,
        UNIQUE (user_id, input)
      )
    `
    yield* sql`CREATE INDEX user_feeds_pending_idx ON user_feeds (status)`

    yield* sql`
      CREATE TABLE sent_posts (
        user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        link     text NOT NULL,
        sent_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, link)
      )
    `
    yield* sql`CREATE INDEX sent_posts_age_idx ON sent_posts (sent_at)`

    yield* sql`
      CREATE TABLE llm_usage (
        month          text PRIMARY KEY,
        calls          integer NOT NULL DEFAULT 0,
        input_tokens   bigint NOT NULL DEFAULT 0,
        output_tokens  bigint NOT NULL DEFAULT 0
      )
    `
  }),
})
