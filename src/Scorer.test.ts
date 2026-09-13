import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import type { Post } from "./newsletter"
import * as Scorer from "./Scorer"

const fakeModel = (text: string) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () =>
        Effect.succeed([
          { type: "text", text },
          {
            type: "finish",
            reason: "stop",
            usage: {
              inputTokens: { uncached: 1, total: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: undefined, reasoning: undefined },
            },
            response: undefined,
          },
        ]),
      streamText: () => Stream.empty,
    }),
  )

const post: Post = { id: 0, source: "x", title: "t", link: "l", summary: "s", publishedAt: Option.none() }

const scoreWith = (modelText: string, posts: ReadonlyArray<Post>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scorer = yield* Scorer.Scorer
      return yield* scorer.score("test profile", posts)
    }).pipe(
      Effect.provide(Layer.effect(Scorer.Scorer, Scorer.make({ times: 0 })).pipe(Layer.provide(fakeModel(modelText)))),
    ),
  )

test("returns the model's scores", async () => {
  const result = await scoreWith('{"scores":[{"id":0,"score":8,"reason":"ok"}]}', [post])
  expect(result.scores).toEqual([{ id: 0, score: 8, reason: "ok" }])
})

test("skips the model entirely when there is nothing to score", async () => {
  const result = await scoreWith("not json", [])
  expect(result.scores).toEqual([])
})

test("fails with ScoreError when the model does not return valid JSON", async () => {
  await expect(scoreWith("not json", [post])).rejects.toThrow("Could not score 1 posts")
})
