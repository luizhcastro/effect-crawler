import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as Uuid from "./Uuid"

export class MailSendError extends Schema.TaggedError<MailSendError>()("MailSendError", {
  recipients: Schema.Int,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Falha ao enviar o email pra ${this.recipients} destinatário(s).`
  }
}

export class Mailer extends Context.Service<
  Mailer,
  {
    readonly send: (subject: string, html: string) => Effect.Effect<void, MailSendError>
  }
>()("Mailer") {}

export const makeResend = Effect.gen(function* () {
  const apiKey = yield* Config.Redacted("RESEND_API_KEY")
  const to = yield* Config.Array(Schema.NonEmptyString, "NEWSLETTER_TO")
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
  const uuid = yield* Uuid.Uuid

  const send = Effect.fn("send")(function* (subject: string, html: string) {
    const idempotencyKey = yield* uuid.generate
    const request = HttpClientRequest.post("https://api.resend.com/emails").pipe(
      HttpClientRequest.bearerToken(apiKey),
      HttpClientRequest.setHeader("Idempotency-Key", idempotencyKey),
      HttpClientRequest.bodyJsonUnsafe({ from: "Tech Blogs <onboarding@resend.dev>", to, subject, html }),
    )
    yield* http.execute(request).pipe(
      Effect.retry({ times: 3, schedule: Schedule.exponential("1 second") }),
      Effect.mapError((cause) => new MailSendError({ recipients: to.length, cause })),
    )
    yield* Effect.logInfo(`enviado pra ${to.join(", ")}`)
  })

  return { send }
})

export const layerResend = Layer.effect(Mailer, makeResend)

const OUT_PATH = "out/newsletter.html"

export const makeFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const send = Effect.fn("send")(
    function* (_subject: string, html: string) {
      yield* fs.makeDirectory("out", { recursive: true })
      yield* fs.writeFileString(OUT_PATH, html)
      yield* Effect.logInfo(`DRY_RUN: escrito em ${OUT_PATH}`)
    },
    Effect.mapError((cause) => new MailSendError({ recipients: 0, cause })),
  )
  return { send }
})

export const layerFile = Layer.effect(Mailer, makeFile)
