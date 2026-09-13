import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as UrlParams from "effect/unstable/http/UrlParams"
import * as AppConfig from "./config"
import { type Frequency, MAX_FEEDS_PER_USER } from "./domain"
import * as Mailer from "./Mailer"
import * as pages from "./pages"
import { Repo } from "./Repo"
import * as Tokens from "./Tokens"
import * as Uuid from "./Uuid"
import * as workflows from "./workflows"

const SESSION_COOKIE = "radar_session"

const body = (request: HttpServerRequest.HttpServerRequest) =>
  request.urlParamsBody.pipe(Effect.map(UrlParams.toRecord), Effect.orDie)

const field = (form: Record<string, string | ReadonlyArray<string>>, name: string): string => {
  const value = form[name]
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

const htmlResponse = (markup: string, status = 200) =>
  HttpServerResponse.html(markup).pipe(HttpServerResponse.setStatus(status))

/** Normalised so "Ada@Example.com " and "ada@example.com" are the same person. */
const normaliseEmail = (raw: string): string => raw.trim().toLowerCase()

const looksLikeEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)

export const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.html(pages.directory())),

  HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok")),

  // -- subscribing ----------------------------------------------------------

  HttpRouter.add(
    "POST",
    "/subscribe",
    Effect.fn("POST /subscribe")(function* (request: HttpServerRequest.HttpServerRequest) {
      const email = normaliseEmail(field(yield* body(request), "email"))
      if (!looksLikeEmail(email)) {
        return htmlResponse(pages.directory("That does not look like an email address."), 400)
      }
      const tokens = yield* Tokens.Tokens
      const mailer = yield* Mailer.Mailer
      const uuid = yield* Uuid.Uuid
      const baseUrl = yield* AppConfig.appUrl

      const token = yield* tokens.sign("confirm", email, Tokens.TTL.confirm)
      const mail = pages.confirmEmail(`${baseUrl}/confirm?token=${encodeURIComponent(token)}`)
      // Nothing is written to the database yet: the row appears when the link
      // is clicked, so an address typed by someone else leaves no trace.
      yield* mailer
        .send({ to: email, subject: mail.subject, html: mail.html, idempotencyKey: yield* uuid.generate })
        .pipe(Effect.catchCause((cause) => Effect.logError("confirmation email failed", cause)))

      return htmlResponse(
        pages.message("Check your email", `We sent a confirmation link to ${email}. It is good for two days.`),
      )
    }),
  ),

  HttpRouter.add(
    "GET",
    "/confirm",
    Effect.fn("GET /confirm")(function* (request: HttpServerRequest.HttpServerRequest) {
      const token = new URL(request.url, "http://localhost").searchParams.get("token") ?? ""
      const tokens = yield* Tokens.Tokens
      const verified = yield* tokens.verify("confirm", token).pipe(Effect.option)
      if (Option.isNone(verified)) {
        return htmlResponse(pages.message("Link expired", "Ask for a new confirmation email.", true), 400)
      }
      const repo = yield* Repo
      const userId = yield* repo.upsertUser(verified.value.subject, "")
      return yield* setSession(userId, HttpServerResponse.redirect("/account", { status: 303 }))
    }),
  ),

  // -- signing in -----------------------------------------------------------

  HttpRouter.add("GET", "/signin", HttpServerResponse.html(pages.signIn())),

  HttpRouter.add(
    "POST",
    "/signin",
    Effect.fn("POST /signin")(function* (request: HttpServerRequest.HttpServerRequest) {
      const email = normaliseEmail(field(yield* body(request), "email"))
      const repo = yield* Repo
      const user = yield* repo.findUserByEmail(email)
      if (Option.isSome(user) && user.value.status === "active") {
        const tokens = yield* Tokens.Tokens
        const mailer = yield* Mailer.Mailer
        const uuid = yield* Uuid.Uuid
        const baseUrl = yield* AppConfig.appUrl
        const token = yield* tokens.sign("login", user.value.id, Tokens.TTL.login)
        const mail = pages.loginEmail(`${baseUrl}/session?token=${encodeURIComponent(token)}`)
        yield* mailer
          .send({ to: email, subject: mail.subject, html: mail.html, idempotencyKey: yield* uuid.generate })
          .pipe(Effect.catchCause((cause) => Effect.logError("sign-in email failed", cause)))
      }
      // Same answer either way: whether an address is subscribed is not
      // something a stranger gets to probe for.
      return htmlResponse(pages.message("Check your email", `If ${email} is subscribed, a sign-in link is on its way.`))
    }),
  ),

  HttpRouter.add(
    "GET",
    "/session",
    Effect.fn("GET /session")(function* (request: HttpServerRequest.HttpServerRequest) {
      const token = new URL(request.url, "http://localhost").searchParams.get("token") ?? ""
      const tokens = yield* Tokens.Tokens
      const verified = yield* tokens.verify("login", token).pipe(Effect.option)
      if (Option.isNone(verified)) {
        return htmlResponse(
          pages.message("Link expired", "Sign-in links last 15 minutes. Ask for a new one.", true),
          400,
        )
      }
      return yield* setSession(verified.value.subject, HttpServerResponse.redirect("/account", { status: 303 }))
    }),
  ),

  HttpRouter.add(
    "GET",
    "/signout",
    HttpServerResponse.redirect("/", { status: 303 }).pipe(
      HttpServerResponse.expireCookie(SESSION_COOKIE, { path: "/" }),
    ),
  ),

  // -- the account area -----------------------------------------------------

  HttpRouter.add(
    "GET",
    "/account",
    Effect.fn("GET /account")(function* (request: HttpServerRequest.HttpServerRequest) {
      const session = yield* currentUser(request)
      if (Option.isNone(session)) return HttpServerResponse.redirect("/signin", { status: 303 })
      const repo = yield* Repo
      const feeds = yield* repo.feedsOf(session.value.id)
      return htmlResponse(
        pages.accountPage({
          email: session.value.email,
          profile: session.value.profile,
          frequency: session.value.frequency,
          feeds,
        }),
      )
    }),
  ),

  HttpRouter.add(
    "POST",
    "/account",
    Effect.fn("POST /account")(function* (request: HttpServerRequest.HttpServerRequest) {
      const session = yield* currentUser(request)
      if (Option.isNone(session)) return HttpServerResponse.redirect("/signin", { status: 303 })
      const user = session.value
      const form = yield* body(request)
      const profile = field(form, "profile").trim()
      const frequency = parseFrequency(field(form, "frequency"))
      const inputs = field(form, "feeds")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      const repo = yield* Repo
      const result = yield* repo.replaceFeeds(user.id, inputs).pipe(Effect.option)
      if (Option.isNone(result)) {
        const feeds = yield* repo.feedsOf(user.id)
        return htmlResponse(
          pages.accountPage({
            email: user.email,
            profile,
            frequency,
            feeds,
            error: `A list can hold at most ${MAX_FEEDS_PER_USER} blogs; you have ${inputs.length}. Trim it and save again.`,
          }),
          400,
        )
      }
      yield* repo.updateProfile(user.id, profile, frequency)
      // New lines arrive as `pending`; resolving them is slow and lives in a
      // workflow, so saving stays instant.
      yield* workflows.kickResolvePending
      const feeds = yield* repo.feedsOf(user.id)
      return htmlResponse(pages.accountPage({ email: user.email, profile, frequency, feeds, notice: "Saved." }))
    }),
  ),

  // -- leaving --------------------------------------------------------------

  HttpRouter.add(
    "GET",
    "/unsubscribe",
    Effect.fn("GET /unsubscribe")(function* (request: HttpServerRequest.HttpServerRequest) {
      const token = new URL(request.url, "http://localhost").searchParams.get("token") ?? ""
      const tokens = yield* Tokens.Tokens
      const verified = yield* tokens.verify("unsubscribe", token).pipe(Effect.option)
      if (Option.isNone(verified)) {
        return htmlResponse(pages.message("Link not valid", "That unsubscribe link did not check out.", true), 400)
      }
      const repo = yield* Repo
      yield* repo.unsubscribe(verified.value.subject)
      return htmlResponse(
        pages.message("Unsubscribed", "You will not get another edition. Your profile is kept in case you come back."),
      )
    }),
  ),

  HttpRouter.add(
    "GET",
    "/unsubscribe-confirm",
    Effect.fn("GET /unsubscribe-confirm")(function* (request: HttpServerRequest.HttpServerRequest) {
      const session = yield* currentUser(request)
      if (Option.isNone(session)) return HttpServerResponse.redirect("/signin", { status: 303 })
      const repo = yield* Repo
      yield* repo.unsubscribe(session.value.id)
      return htmlResponse(pages.message("Unsubscribed", "That is done. Nothing else will arrive."))
    }),
  ),
)

const parseFrequency = (value: string): Frequency => (value === "daily" || value === "monthly" ? value : "weekly")

const setSession = Effect.fn("setSession")(function* (userId: string, response: HttpServerResponse.HttpServerResponse) {
  const tokens = yield* Tokens.Tokens
  const token = yield* tokens.sign("session", userId, Tokens.TTL.session)
  const secure = (yield* AppConfig.appUrl).startsWith("https://")
  return yield* HttpServerResponse.setCookie(response, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: Tokens.TTL.session,
  }).pipe(Effect.orDie)
})

/** The signed-in user, or none. The cookie carries the id; the row is the truth. */
const currentUser = Effect.fn("currentUser")(function* (request: HttpServerRequest.HttpServerRequest) {
  const token = request.cookies[SESSION_COOKIE]
  if (token === undefined) return Option.none()
  const tokens = yield* Tokens.Tokens
  const verified = yield* tokens.verify("session", token).pipe(Effect.option)
  if (Option.isNone(verified)) return Option.none()
  const repo = yield* Repo
  const user = yield* repo.findUser(verified.value.subject)
  return Option.filter(user, (found) => found.status === "active")
})
