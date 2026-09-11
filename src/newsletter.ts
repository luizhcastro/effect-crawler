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
Você é o curador de uma newsletter semanal pessoal de tech blogs.

Perfil do leitor:
${profile}

Para cada post abaixo, dê uma nota de 0 a 10 de quanto vale a pena o leitor abrir esse post, e uma justificativa de uma frase curta em português.
10 = leitura obrigatória pra esse perfil. 0 = irrelevante. Seja rigoroso: a maioria dos posts deve ficar abaixo de 7.
Devolva exatamente um item por post, usando o mesmo id.

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

export const renderHtml = (
  posts: ReadonlyArray<ScoredPost>,
  failedFeeds: ReadonlyArray<string>,
  totalScanned: number,
): string => {
  const items =
    posts.length === 0
      ? `<p>Nada passou do corte essa semana (${totalScanned} posts avaliados).</p>`
      : posts
          .map(
            (p) => `
<li style="margin-bottom:20px">
  <a href="${escapeHtml(p.link)}" style="font-size:17px;font-weight:600;color:#1a1a1a;text-decoration:none">${escapeHtml(p.title)}</a>
  <div style="color:#666;font-size:13px;margin-top:2px">${escapeHtml(p.source)} · nota ${p.score}</div>
  <div style="color:#333;font-size:14px;margin-top:6px">${escapeHtml(p.reason)}</div>
</li>`,
          )
          .join("")
  const footer =
    failedFeeds.length === 0
      ? ""
      : `<p style="color:#999;font-size:12px;margin-top:32px">Não consegui ler: ${failedFeeds.map(escapeHtml).join(", ")}</p>`
  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <h1 style="font-size:22px;margin-bottom:4px">Tech blogs da semana</h1>
  <p style="color:#666;font-size:13px;margin-top:0">${posts.length} de ${totalScanned} posts passaram do corte.</p>
  <ul style="list-style:none;padding:0">${items}</ul>
  ${footer}
</div>`.trim()
}
