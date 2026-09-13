import * as Schema from "effect/Schema"

/** How often a subscriber gets an edition, and the lookback window it implies. */
export const Frequency = Schema.Literals(["daily", "weekly", "monthly"])
export type Frequency = typeof Frequency.Type

export const LOOKBACK_DAYS: Record<Frequency, number> = { daily: 1, weekly: 7, monthly: 30 }

export const UserStatus = Schema.Literals(["active", "unsubscribed"])

/**
 * A feed's health. `pending` has not been resolved yet, `failing` has missed a
 * fetch but is still tried, `dead` has missed enough in a row that we stopped.
 */
export const FeedStatus = Schema.Literals(["pending", "ok", "failing", "dead"])
export type FeedStatus = typeof FeedStatus.Type

/** Consecutive failures before a feed stops being fetched. */
export const DEAD_AFTER_FAILURES = 5

/** Caps from the design review: they bound both scraping and prompt size. */
export const MAX_FEEDS_PER_USER = 50
export const MAX_POSTS_PER_EDITION = 150

export const User = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  status: UserStatus,
  profile: Schema.String,
  frequency: Frequency,
  lastSentAt: Schema.NullOr(Schema.Date),
})
export type User = typeof User.Type

export const UserFeed = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  input: Schema.String,
  name: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  status: FeedStatus,
  error: Schema.NullOr(Schema.String),
  failureCount: Schema.Int,
})
export type UserFeed = typeof UserFeed.Type

/**
 * The slot an edition covers, derived from the send time and the frequency.
 * It is the workflow's idempotency key, so two ticks in the same slot are the
 * same execution rather than two emails.
 */
export const periodKey = (frequency: Frequency, now: Date): string => {
  const iso = now.toISOString()
  if (frequency === "daily") return iso.slice(0, 10)
  if (frequency === "monthly") return iso.slice(0, 7)
  return `${isoWeekYear(now)}-W${String(isoWeek(now)).padStart(2, "0")}`
}

const isoWeekThursday = (date: Date): Date => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // ISO weeks are pinned to the Thursday of the week: shift there, then the
  // year and week number both read off that one date.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  return d
}

const isoWeekYear = (date: Date): number => isoWeekThursday(date).getUTCFullYear()

const isoWeek = (date: Date): number => {
  const thursday = isoWeekThursday(date)
  const firstDay = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  return Math.ceil(((thursday.getTime() - firstDay.getTime()) / 86400000 + 1) / 7)
}
