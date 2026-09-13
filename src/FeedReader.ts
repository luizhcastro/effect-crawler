import * as Context from "effect/Context"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import Parser from "rss-parser"
import { isRecent, type Post, stripHtml, truncate } from "./newsletter"
import * as SafeHttp from "./SafeHttp"

export class FeedReadError extends Schema.TaggedError<FeedReadError>()("FeedReadError", {
  feed: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not read the feed ${this.feed}.`
  }
}

/** The minimum a feed needs for us to poll it. */
export interface Source {
  readonly name: string
  readonly url: string
}

export interface Collected {
  readonly posts: ReadonlyArray<Post>
  /** Names of the feeds that failed, so the edition can say so and the feed can be flagged. */
  readonly failed: ReadonlyArray<Source>
}

export class FeedReader extends Context.Service<
  FeedReader,
  {
    readonly collect: (
      sources: ReadonlyArray<Source>,
      now: DateTime.Utc,
      lookbackDays: number,
    ) => Effect.Effect<Collected>
  }
>()("FeedReader") {}

const parseDate = (value: string | undefined): Option.Option<DateTime.Utc> =>
  value === undefined ? Option.none() : DateTime.make(value)

export const make = Effect.gen(function* () {
  // Subscribers choose their own feeds, so even reading a feed goes through the
  // hardened client: these URLs are not ours.
  const http = SafeHttp.harden(yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const parser = new Parser()

  const fetchFeed = Effect.fn("fetchFeed")(function* (source: Source, now: DateTime.Utc, lookbackDays: number) {
    const response = yield* http.get(source.url)
    const xml = yield* SafeHttp.boundedText(source.url, response)
    const parsed = yield* Effect.tryPromise(() => parser.parseString(xml))
    return parsed.items
      .map((item, i): [Post, number] => [
        {
          id: 0,
          source: source.name,
          title: item.title?.trim() ?? "(untitled)",
          link: item.link ?? source.url,
          summary: truncate(stripHtml(item.contentSnippet ?? item.summary ?? item.content ?? "")),
          publishedAt: parseDate(item.isoDate ?? item.pubDate),
        },
        i,
      ])
      .filter(([post, i]) => isRecent(post, i, now, lookbackDays))
      .map(([post]) => post)
  })

  const fetchFeedSafe = (source: Source, now: DateTime.Utc, lookbackDays: number) =>
    fetchFeed(source, now, lookbackDays).pipe(
      Effect.mapError((cause) => new FeedReadError({ feed: source.name, cause })),
      Effect.result,
    )

  const collect = Effect.fn("collect")(function* (
    sources: ReadonlyArray<Source>,
    now: DateTime.Utc,
    lookbackDays: number,
  ) {
    const results = yield* Effect.forEach(sources, (source) => fetchFeedSafe(source, now, lookbackDays), {
      concurrency: 5,
    })
    const failed: Array<Source> = []
    const posts: Array<Post> = []
    results.forEach((result, index) => {
      if (Result.isFailure(result)) {
        failed.push(sources[index]!)
      } else {
        posts.push(...result.success)
      }
    })
    for (const result of results) {
      if (Result.isFailure(result)) yield* Effect.logWarning(result.failure.message, result.failure.cause)
    }
    return { posts: posts.map((p, id) => ({ ...p, id })), failed }
  })

  return { collect }
})

export const layer = Layer.effect(FeedReader, make)
