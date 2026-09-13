import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Tokens from "./Tokens"

const run = <A, E>(effect: Effect.Effect<A, E, Tokens.Tokens>, secret = "test-secret-key") =>
  Effect.runPromise(effect.pipe(Effect.provide(Tokens.layerWith(secret))))

const reasonOf = (effect: Effect.Effect<unknown, Tokens.InvalidTokenError, Tokens.Tokens>, secret?: string) =>
  run(
    effect.pipe(
      Effect.flip,
      Effect.map((error) => error.reason),
    ),
    secret,
  )

test("a token it signed, it accepts", async () => {
  const subject = await run(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      const token = yield* tokens.sign("login", "user-1", 60)
      return (yield* tokens.verify("login", token)).subject
    }),
  )
  expect(subject).toBe("user-1")
})

test("a tampered payload is rejected", async () => {
  const reason = await reasonOf(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      const token = yield* tokens.sign("login", "user-1", 60)
      // swap in someone else's id, keep the signature
      const [, , expiry, signature] = token.split(".")
      return yield* tokens.verify("login", `login.user-2.${expiry}.${signature}`)
    }),
  )
  expect(reason).toBe("bad-signature")
})

test("a token signed with another key is rejected", async () => {
  const signed = await run(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      return yield* tokens.sign("session", "user-1", 60)
    }),
    "the-real-key",
  )
  const reason = await reasonOf(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      return yield* tokens.verify("session", signed)
    }),
    "an-attackers-key",
  )
  expect(reason).toBe("bad-signature")
})

test("an unsubscribe token cannot be replayed as a session", async () => {
  const reason = await reasonOf(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      const token = yield* tokens.sign("unsubscribe", "user-1", 60)
      return yield* tokens.verify("session", token)
    }),
  )
  expect(reason).toBe("wrong-purpose")
})

test("an expired token is rejected", async () => {
  const reason = await reasonOf(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      const token = yield* tokens.sign("login", "user-1", -1)
      return yield* tokens.verify("login", token)
    }),
  )
  expect(reason).toBe("expired")
})

test("junk is rejected as malformed rather than crashing", async () => {
  const reason = await reasonOf(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      return yield* tokens.verify("login", "garbage")
    }),
  )
  expect(reason).toBe("malformed")
})

test("subjects with separators survive the round trip", async () => {
  const subject = await run(
    Effect.gen(function* () {
      const tokens = yield* Tokens.Tokens
      const token = yield* tokens.sign("confirm", "a.b.c@example.com", 60)
      return (yield* tokens.verify("confirm", token)).subject
    }),
  )
  expect(subject).toBe("a.b.c@example.com")
})
