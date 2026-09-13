import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as AppConfig from "./config"

export class MailSendError extends Schema.TaggedError<MailSendError>()("MailSendError", {
  to: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Could not send the email to ${this.to}.`
  }
}

export interface Mail {
  readonly to: string
  readonly subject: string
  readonly html: string
  /**
   * Stable key for this exact message. A retry with the same key is dropped by
   * Resend instead of sending twice — the last line of defence against a
   * duplicate edition.
   */
  readonly idempotencyKey: string
}

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly send: (mail: Mail) => Effect.Effect<void, MailSendError>
  }
>()("Mailer") {}

export const makeResend = Effect.gen(function* () {
  const apiKey = yield* AppConfig.resendKey
  const from = yield* AppConfig.mailFrom
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)

  const send = Effect.fn("send")(function* (mail: Mail) {
    const request = HttpClientRequest.post("https://api.resend.com/emails").pipe(
      HttpClientRequest.bearerToken(apiKey),
      HttpClientRequest.setHeader("Idempotency-Key", mail.idempotencyKey),
      HttpClientRequest.bodyJsonUnsafe({ from, to: mail.to, subject: mail.subject, html: mail.html }),
    )
    yield* http.execute(request).pipe(
      Effect.retry({ times: 3, schedule: Schedule.exponential("1 second") }),
      Effect.mapError((cause) => new MailSendError({ to: mail.to, cause })),
    )
    yield* Effect.logInfo(`sent to ${mail.to}`)
  })

  return { send }
})

export const layerResend = Layer.effect(Mailer, makeResend)

/** Dry-run mailer: writes what would have been sent, one file per recipient. */
export const makeFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const send = Effect.fn("send")(
    function* (mail: Mail) {
      const path = `out/${mail.to.replace(/[^a-z0-9]+/gi, "-")}.html`
      yield* fs.makeDirectory("out", { recursive: true })
      yield* fs.writeFileString(path, mail.html)
      yield* Effect.logInfo(`DRY_RUN: wrote ${path} (${mail.subject})`)
    },
    Effect.mapError((cause) => new MailSendError({ to: "out/", cause })),
  )
  return { send }
})

export const layerFile = Layer.effect(Mailer, makeFile)
