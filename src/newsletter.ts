import * as DateTime from "effect/DateTime"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export interface Post {
  readonly id: number
  readonly source: string
  readonly title: string
  readonly link: string
  readonly summary: string
  readonly publishedAt: Option.Option<DateTime.Utc>
}

export const MIN_SCORE = 7
const UNDATED_TOP_N = 5
const SUMMARY_MAX_CHARS = 600

/**
 * Whether a post belongs in this edition. A feed that publishes no dates gets
 * its first few entries treated as new, which is wrong sometimes and better
 * than dropping the feed entirely.
 */
export const isRecent = (post: Post, positionInFeed: number, now: DateTime.Utc, lookbackDays: number): boolean =>
  Option.match(post.publishedAt, {
    onNone: () => positionInFeed < UNDATED_TOP_N,
    onSome: (publishedAt) =>
      DateTime.between(publishedAt, { minimum: DateTime.subtract(now, { days: lookbackDays }), maximum: now }),
  })

export const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()

export const truncate = (text: string, max = SUMMARY_MAX_CHARS): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`

export const Score = Schema.Struct({
  id: Schema.Int,
  score: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
  reason: Schema.String,
})
export const Scores = Schema.Struct({ scores: Schema.Array(Score) })
export type Score = typeof Score.Type

export const scoringPrompt = (profile: string, posts: ReadonlyArray<Post>): string =>
  `
You are the curator of one reader's personal tech-blog newsletter.

Reader profile:
${profile}

For each post below, give a score from 0 to 10 for how much it is worth this
reader's time, and a one-sentence reason. 10 means required reading for this
profile; 0 means irrelevant. Be strict: most posts should land below 7.
Write the reason in the same language the reader wrote their profile in.
Return exactly one item per post, reusing the same id.

Posts:
${posts.map((p) => `[id=${p.id}] (${p.source}) ${p.title}\n${p.summary}`).join("\n\n")}
`.trim()

export interface ScoredPost extends Post {
  readonly score: number
  readonly reason: string
}

export const pickRelevant = (posts: ReadonlyArray<Post>, scores: ReadonlyArray<Score>): Array<ScoredPost> => {
  const byId = new Map(scores.map((s) => [s.id, s]))
  return posts
    .flatMap((p) => {
      const s = byId.get(p.id)
      return s && s.score >= MIN_SCORE ? [{ ...p, score: s.score, reason: s.reason }] : []
    })
    .sort((a, b) => b.score - a.score)
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export interface EditionLinks {
  /** Where the reader edits their profile and blog list. */
  readonly account: string
  /** One-click unsubscribe. Required in every edition. */
  readonly unsubscribe: string
}

export const editionSubject = (date: DateTime.Utc, count: number): string =>
  count === 0
    ? `Radar · nothing worth your time this round`
    : `Radar · ${count} post${count === 1 ? "" : "s"} · ${DateTime.formatIsoDate(date)}`

export const renderHtml = (
  posts: ReadonlyArray<ScoredPost>,
  failedFeeds: ReadonlyArray<string>,
  totalScanned: number,
  links: EditionLinks,
): string => {
  const items =
    posts.length === 0
      ? `<p style="color:#333;font-size:14px">Nothing cleared the bar this time (${totalScanned} posts read).</p>`
      : posts
          .map(
            (p) => `
<li style="margin-bottom:20px">
  <a href="${escapeHtml(p.link)}" style="font-size:17px;font-weight:600;color:#1a1a1a;text-decoration:none">${escapeHtml(p.title)}</a>
  <div style="color:#666;font-size:13px;margin-top:2px">${escapeHtml(p.source)} · ${p.score}/10</div>
  <div style="color:#333;font-size:14px;margin-top:6px">${escapeHtml(p.reason)}</div>
</li>`,
          )
          .join("")
  const failures =
    failedFeeds.length === 0
      ? ""
      : `<p style="color:#999;font-size:12px;margin-top:32px">Could not read: ${failedFeeds.map(escapeHtml).join(", ")}</p>`
  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <h1 style="font-size:22px;margin-bottom:4px">Radar</h1>
  <p style="color:#666;font-size:13px;margin-top:0">${posts.length} of ${totalScanned} posts cleared the bar.</p>
  <ul style="list-style:none;padding:0">${items}</ul>
  ${failures}
  <p style="color:#999;font-size:12px;margin-top:40px;border-top:1px solid #eee;padding-top:16px">
    <a href="${escapeHtml(links.account)}" style="color:#999">Edit your profile and blogs</a>
    &nbsp;·&nbsp;
    <a href="${escapeHtml(links.unsubscribe)}" style="color:#999">Unsubscribe</a>
  </p>
</div>`.trim()
}
