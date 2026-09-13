import * as OpenRouterLanguageModel from "@effect/ai-openrouter/OpenRouterLanguageModel"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import * as AppConfig from "./config"
import { type Post, type Score, Scores, scoringPrompt } from "./newsletter"

const FALLBACK_MODEL = "openai/gpt-5.6-luna"

export class ScoreError extends Schema.TaggedError<ScoreError>()("ScoreError", {
  postCount: Schema.Int,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not score ${this.postCount} posts.`
  }
}

export interface Scored {
  readonly scores: ReadonlyArray<Score>
  readonly inputTokens: number
  readonly outputTokens: number
}

export class Scorer extends Context.Service<
  Scorer,
  {
    readonly score: (profile: string, posts: ReadonlyArray<Post>) => Effect.Effect<Scored, ScoreError>
  }
>()("Scorer") {}

const defaultRetry = { times: 3, schedule: Schedule.exponential("1 second") }

const EMPTY: Scored = { scores: [], inputTokens: 0, outputTokens: 0 }

export const make = (
  retry: { readonly times: number; readonly schedule?: Schedule.Schedule<unknown> } = defaultRetry,
) =>
  Effect.gen(function* () {
    const languageModel = yield* LanguageModel.LanguageModel

    const score = Effect.fn("score")(function* (profile: string, posts: ReadonlyArray<Post>) {
      if (posts.length === 0) return EMPTY
      const response = yield* languageModel
        .generateObject({ prompt: scoringPrompt(profile, posts), schema: Scores, objectName: "scores" })
        .pipe(
          Effect.retry(retry),
          Effect.mapError((cause) => new ScoreError({ postCount: posts.length, cause })),
        )
      return {
        scores: response.value.scores,
        inputTokens: response.usage?.inputTokens?.total ?? 0,
        outputTokens: response.usage?.outputTokens?.total ?? 0,
      }
    })

    return { score }
  })

export const layer = Layer.effect(Scorer, make())

export const OpenRouterModel = Layer.unwrap(
  Effect.map(AppConfig.model, (model) =>
    OpenRouterLanguageModel.layer({
      model,
      // strictJsonSchema has to be true: without it OpenRouter ignores the
      // schema and answers in markdown.
      config: { models: [model, FALLBACK_MODEL], strictJsonSchema: true, temperature: 0 },
    }),
  ),
)
