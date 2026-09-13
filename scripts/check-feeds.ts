/**
 * Fetches every feed in the curated list and fails if one of them is broken.
 * CI runs this on pull requests, so a blog cannot be added to the blogroll
 * without a feed that actually answers.
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import { CURATION } from "../src/curation"
import * as FeedReader from "../src/FeedReader"

const program = Effect.gen(function* () {
  const reader = yield* FeedReader.FeedReader
  const now = yield* DateTime.now
  const urls = new Set<string>()
  for (const feed of CURATION) {
    if (urls.has(feed.url)) return yield* Effect.die(`duplicate feed url: ${feed.url}`)
    urls.add(feed.url)
  }

  // A wide window: a blog that has been quiet for a month is fine, a feed that
  // does not answer is not.
  const { posts, failed } = yield* reader.collect(CURATION, now, 90)
  console.log(`${CURATION.length} feeds, ${posts.length} posts in the last 90 days`)
  if (failed.length > 0) {
    for (const source of failed) console.error(`FAILED  ${source.name}  ${source.url}`)
    return yield* Effect.die(`${failed.length} of ${CURATION.length} feeds did not answer`)
  }
  console.log("all feeds answered")
})

BunRuntime.runMain(program.pipe(Effect.provide(FeedReader.layer.pipe(Layer.provide(FetchHttpClient.layer)))))
