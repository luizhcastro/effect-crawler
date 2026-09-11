import * as OpenRouterClient from "@effect/ai-openrouter/OpenRouterClient"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import type * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as AppConfig from "./config"
import * as FeedReader from "./FeedReader"
import * as Mailer from "./Mailer"
import { pickRelevant, renderHtml } from "./newsletter"
import * as Scorer from "./Scorer"
import * as Uuid from "./Uuid"

const program = Effect.gen(function* () {
  const lookbackDays = yield* AppConfig.lookbackDays
  const feedReader = yield* FeedReader.FeedReader
  const scorer = yield* Scorer.Scorer
  const mailer = yield* Mailer.Mailer
  const now = yield* DateTime.now

  const { posts, failedFeeds } = yield* feedReader.collect(now, lookbackDays)
  yield* Effect.logInfo(`${posts.length} posts nos últimos ${lookbackDays} dias, ${failedFeeds.length} feeds com erro`)

  const relevant = pickRelevant(posts, yield* scorer.score(posts))
  yield* Effect.logInfo(`${relevant.length} posts passaram do corte`)

  const subject = `Tech blogs da semana · ${DateTime.formatIsoDate(now)}`
  yield* mailer.send(subject, renderHtml(relevant, failedFeeds, posts.length))
})

type MailerLayer = Layer.Layer<
  Mailer.Mailer,
  Config.ConfigError,
  FileSystem.FileSystem | HttpClient.HttpClient | Uuid.Uuid
>

const MailerLive = Layer.unwrap(
  Effect.map(AppConfig.dryRun, (dryRun): MailerLayer => (dryRun ? Mailer.layerFile : Mailer.layerResend)),
)

const ScorerLive = Scorer.layer.pipe(
  Layer.provide(Scorer.OpenRouterModel),
  Layer.provide(OpenRouterClient.layerConfig({ apiKey: AppConfig.openRouterKey })),
)

const AppLive = Layer.mergeAll(FeedReader.layer, ScorerLive, MailerLive).pipe(
  Layer.provide([FetchHttpClient.layer, BunFileSystem.layer, Uuid.layer]),
)

BunRuntime.runMain(program.pipe(Effect.provide(AppLive)))
