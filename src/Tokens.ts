import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as AppConfig from "./config"

/**
 * Every link we email — confirm, sign in, unsubscribe — is a signed string
 * rather than a row in a table. The signature carries who it is for, what it
 * permits, and when it stops working, so there is no pending-signup table to
 * keep tidy and no session store to expire.
 */

export const Purpose = Schema.Literals(["confirm", "login", "unsubscribe", "session"])
export type Purpose = typeof Purpose.Type

export class InvalidTokenError extends Schema.TaggedError<InvalidTokenError>()("InvalidTokenError", {
  reason: Schema.Literals(["malformed", "bad-signature", "expired", "wrong-purpose"]),
}) {
  override get message(): string {
    return this.reason === "expired" ? "That link has expired." : "That link is not valid."
  }
}

export interface Token {
  readonly purpose: Purpose
  readonly subject: string
  readonly expiresAt: number
}

export class Tokens extends Context.Service<
  Tokens,
  {
    readonly sign: (purpose: Purpose, subject: string, ttlSeconds: number) => Effect.Effect<string>
    readonly verify: (purpose: Purpose, token: string) => Effect.Effect<Token, InvalidTokenError>
  }
>()("Tokens") {}

export const DAY = 86400
export const TTL = {
  confirm: 2 * DAY,
  login: 900,
  session: 30 * DAY,
  /** Unsubscribe links sit in old emails forever, so they never expire. */
  unsubscribe: 3650 * DAY,
} as const

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const encoder = new TextEncoder()

/**
 * Subjects are email addresses and uuids, and both contain the character we
 * split on. Encoding them keeps the token exactly four fields no matter what
 * the subject holds.
 */
const encodeSubject = (subject: string): string => base64url(encoder.encode(subject))

const decodeSubject = (encoded: string): string => {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/")
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))
}

/** The service, built from a plain key — the shape tests use. */
export const makeWith = (secret: string) =>
  Effect.gen(function* () {
    const key = yield* Effect.promise(() =>
      crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
      ]),
    )

    const mac = (payload: string) =>
      Effect.promise(() =>
        crypto.subtle.sign("HMAC", key, encoder.encode(payload)).then((b) => base64url(new Uint8Array(b))),
      )

    const sign = Effect.fn("sign")(function* (purpose: Purpose, subject: string, ttlSeconds: number) {
      const expiresAt = Math.floor((yield* Effect.clockWith((clock) => clock.currentTimeMillis)) / 1000) + ttlSeconds
      const payload = `${purpose}.${encodeSubject(subject)}.${expiresAt}`
      return `${payload}.${yield* mac(payload)}`
    })

    const verify = Effect.fn("verify")(function* (purpose: Purpose, token: string) {
      const parts = token.split(".")
      if (parts.length !== 4) return yield* new InvalidTokenError({ reason: "malformed" })
      const [tokenPurpose, encodedSubject, expiry, signature] = parts as [string, string, string, string]
      const expected = yield* mac(`${tokenPurpose}.${encodedSubject}.${expiry}`)
      // Compare full-length: a short-circuiting compare leaks the signature one
      // byte at a time to anyone willing to time the responses.
      if (!timingSafeEqual(signature, expected)) return yield* new InvalidTokenError({ reason: "bad-signature" })
      if (tokenPurpose !== purpose) return yield* new InvalidTokenError({ reason: "wrong-purpose" })
      const expiresAt = Number(expiry)
      const now = Math.floor((yield* Effect.clockWith((clock) => clock.currentTimeMillis)) / 1000)
      if (!Number.isFinite(expiresAt) || expiresAt < now) return yield* new InvalidTokenError({ reason: "expired" })
      return { purpose, subject: decodeSubject(encodedSubject), expiresAt }
    })

    return { sign, verify }
  })

export const make = Effect.flatMap(AppConfig.secretKey, (secret) => makeWith(Redacted.value(secret)))

export const layer = Layer.effect(Tokens, make)

export const layerWith = (secret: string) => Layer.effect(Tokens, makeWith(secret))

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
