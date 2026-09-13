/**
 * Resolves a list of blog addresses into canonical feed URLs and prints them as
 * a `curation.ts` entry. Run it when adding a blog to the curated list:
 *
 *   bun run scripts/resolve-feeds.ts "Stripe Engineering https://stripe.com/blog"
 *   bun run scripts/resolve-feeds.ts --file seeds.txt
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as FeedResolver from "../src/FeedResolver"

const args = process.argv.slice(2)
const inputs =
  args[0] === "--file"
    ? (await Bun.file(args[1]!).text())
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
    : args

const program = Effect.gen(function* () {
  const resolver = yield* FeedResolver.FeedResolver
  const results = yield* Effect.forEach(
    inputs,
    (input) =>
      resolver.resolve(input).pipe(
        Effect.map((feed) => ({ input, feed })),
        Effect.catch((error) => Effect.succeed({ input, error: error.message })),
      ),
    { concurrency: 4 },
  )
  for (const result of results) {
    if ("feed" in result) {
      console.log(`  { name: ${JSON.stringify(result.feed.name)}, url: ${JSON.stringify(result.feed.url)} },`)
    } else {
      console.log(`  // UNRESOLVED ${result.input} -> ${result.error}`)
    }
  }
})

BunRuntime.runMain(program.pipe(Effect.provide(FeedResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)))))
