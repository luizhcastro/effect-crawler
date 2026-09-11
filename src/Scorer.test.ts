import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
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

const fakeFs = FileSystem.layerNoop({ readFileString: () => Effect.succeed("perfil de teste") })

const post: Post = { id: 0, source: "x", title: "t", link: "l", summary: "s", publishedAt: Option.none() }

const scoreWith = (modelText: string, posts: ReadonlyArray<Post>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scorer = yield* Scorer.Scorer
      return yield* scorer.score(posts)
    }).pipe(
      Effect.provide(
        Layer.effect(Scorer.Scorer, Scorer.make({ times: 0 })).pipe(Layer.provide([fakeModel(modelText), fakeFs])),
      ),
    ),
  )

test("Scorer devolve as notas do modelo", async () => {
  expect(await scoreWith('{"scores":[{"id":0,"score":8,"reason":"ok"}]}', [post])).toEqual([
    { id: 0, score: 8, reason: "ok" },
  ])
})

test("Scorer pula o modelo quando não há posts", async () => {
  expect(await scoreWith("nao é json", [])).toEqual([])
})

test("Scorer falha com ScoreError quando o modelo não devolve JSON válido", async () => {
  await expect(scoreWith("nao é json", [post])).rejects.toThrow("Falha ao pontuar 1 posts")
})
