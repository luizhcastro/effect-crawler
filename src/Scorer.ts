import * as OpenRouterLanguageModel from "@effect/ai-openrouter/OpenRouterLanguageModel"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import * as AppConfig from "./config"
import { type Post, type Score, Scores, scoringPrompt } from "./newsletter"

const FALLBACK_MODEL = "openai/gpt-5.6-luna"
const PROFILE_PATH = new URL("../profile.md", import.meta.url).pathname

export class ScoreError extends Schema.TaggedError<ScoreError>()("ScoreError", {
  postCount: Schema.Int,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Falha ao pontuar ${this.postCount} posts.`
  }
}

export class Scorer extends Context.Service<
  Scorer,
  {
    readonly score: (posts: ReadonlyArray<Post>) => Effect.Effect<ReadonlyArray<Score>, ScoreError>
  }
>()("Scorer") {}

const defaultRetry = { times: 3, schedule: Schedule.exponential("1 second") }

export const make = (
  retry: { readonly times: number; readonly schedule?: Schedule.Schedule<unknown> } = defaultRetry,
) =>
  Effect.gen(function* () {
    const languageModel = yield* LanguageModel.LanguageModel
    const fs = yield* FileSystem.FileSystem
    const profile = yield* fs.readFileString(PROFILE_PATH)

    const score = Effect.fn("score")(function* (posts: ReadonlyArray<Post>) {
      if (posts.length === 0) return []
      const response = yield* languageModel
        .generateObject({ prompt: scoringPrompt(profile, posts), schema: Scores, objectName: "scores" })
        .pipe(
          Effect.retry(retry),
          Effect.mapError((cause) => new ScoreError({ postCount: posts.length, cause })),
        )
      return response.value.scores
    })

    return { score }
  })

export const layer = Layer.effect(Scorer, make())

export const OpenRouterModel = Layer.unwrap(
  Effect.map(AppConfig.model, (model) =>
    OpenRouterLanguageModel.layer({
      model,
      // strictJsonSchema precisa ser true: sem ele o OpenRouter ignora o schema e devolve markdown
      config: { models: [model, FALLBACK_MODEL], strictJsonSchema: true, temperature: 0 },
    }),
  ),
)
