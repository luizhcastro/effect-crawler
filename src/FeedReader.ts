import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import Parser from "rss-parser"
import { FEEDS } from "./feeds"
import { isRecent, type Post, stripHtml, truncate } from "./newsletter"

export class FeedReadError extends Schema.TaggedError<FeedReadError>()("FeedReadError", {
  feed: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Falha ao ler o feed ${this.feed}.`
  }
}

export interface Collected {
  readonly posts: ReadonlyArray<Post>
  readonly failedFeeds: ReadonlyArray<string>
}

export class FeedReader extends Context.Service<
  FeedReader,
  {
    readonly collect: (now: DateTime.Utc, lookbackDays: number) => Effect.Effect<Collected>
  }
>()("FeedReader") {}

type Feed = (typeof FEEDS)[number]

const parseDate = (value: string | undefined): Option.Option<DateTime.Utc> =>
  value === undefined ? Option.none() : DateTime.make(value)

export const make = Effect.gen(function* () {
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const parser = new Parser()

  const fetchFeed = Effect.fn("fetchFeed")(function* (feed: Feed, now: DateTime.Utc, lookbackDays: number) {
    const response = yield* http
      .get(feed.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; effect-crawler)" } })
      .pipe(Effect.timeout("20 seconds"))
    const xml = yield* response.text
    const parsed = yield* Effect.tryPromise(() => parser.parseString(xml))
    return parsed.items
      .map((item, i): [Post, number] => [
        {
          id: 0,
          source: feed.name,
          title: item.title?.trim() ?? "(sem título)",
          link: item.link ?? feed.url,
          summary: truncate(stripHtml(item.contentSnippet ?? item.summary ?? item.content ?? "")),
          publishedAt: parseDate(item.isoDate ?? item.pubDate),
        },
        i,
      ])
      .filter(([post, i]) => isRecent(post, i, now, lookbackDays))
      .map(([post]) => post)
  })

  const fetchFeedSafe = (feed: Feed, now: DateTime.Utc, lookbackDays: number) =>
    fetchFeed(feed, now, lookbackDays).pipe(
      Effect.mapError((cause) => new FeedReadError({ feed: feed.name, cause })),
      Effect.result,
    )

  const collect = Effect.fn("collect")(function* (now: DateTime.Utc, lookbackDays: number) {
    const results = yield* Effect.forEach(FEEDS, (feed) => fetchFeedSafe(feed, now, lookbackDays), {
      concurrency: 5,
    })
    const failedFeeds: Array<string> = []
    const posts: Array<Post> = []
    for (const result of results) {
      if (Result.isFailure(result)) {
        yield* Effect.logWarning(result.failure.message, result.failure.cause)
        failedFeeds.push(result.failure.feed)
      } else {
        posts.push(...result.success)
      }
    }
    return { posts: posts.map((p, id) => ({ ...p, id })), failedFeeds }
  })

  return { collect }
})

export const layer = Layer.effect(FeedReader, make)
