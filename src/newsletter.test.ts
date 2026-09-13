import { expect, test } from "bun:test"
import * as DateTime from "effect/DateTime"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { isRecent, type Post, pickRelevant, Scores } from "./newsletter"

const now = DateTime.makeUnsafe("2026-09-14T13:00:00Z")
const post = (publishedAt: string | undefined, id = 0): Post => ({
  id,
  source: "x",
  title: "t",
  link: "l",
  summary: "s",
  publishedAt: publishedAt === undefined ? Option.none() : DateTime.make(publishedAt),
})

test("seven-day window", () => {
  expect(isRecent(post("2026-09-10T00:00:00Z"), 0, now, 7)).toBe(true)
  expect(isRecent(post("2026-09-01T00:00:00Z"), 0, now, 7)).toBe(false)
  expect(isRecent(post("2026-09-20T00:00:00Z"), 0, now, 7)).toBe(false)
})

test("no date (or an unparsable one): only the first five of the feed", () => {
  expect(isRecent(post(undefined), 4, now, 7)).toBe(true)
  expect(isRecent(post(undefined), 5, now, 7)).toBe(false)
  expect(isRecent(post("lixo"), 0, now, 7)).toBe(true)
})

test("model answer: validated, and cut at 7", () => {
  const scores = Schema.decodeUnknownSync(Scores)({
    scores: [
      { id: 0, score: 9, reason: "a" },
      { id: 1, score: 6, reason: "b" },
      { id: 2, score: 7, reason: "c" },
    ],
  }).scores
  const picked = pickRelevant([post(undefined, 0), post(undefined, 1), post(undefined, 2)], scores)
  expect(picked.map((p) => p.id)).toEqual([0, 2])
  expect(() => Schema.decodeUnknownSync(Scores)({ scores: [{ id: 0, score: 11, reason: "" }] })).toThrow()
})
