import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import Parser from "rss-parser"
import * as SafeHttp from "./SafeHttp"

/**
 * Turns what a person typed into a feed we can actually poll.
 *
 * The input is whatever was in the box: a feed URL, a blog's home page, a link
 * to one post. Order of attempts: use it directly if it parses as a feed, look
 * for a feed declared in the page's HTML, then guess the handful of paths that
 * blogging engines use.
 */

export class FeedResolveError extends Schema.TaggedError<FeedResolveError>()("FeedResolveError", {
  input: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

export interface ResolvedFeed {
  readonly url: string
  readonly name: string
}

export class FeedResolver extends Context.Service<
  FeedResolver,
  {
    readonly resolve: (input: string) => Effect.Effect<ResolvedFeed, FeedResolveError>
  }
>()("FeedResolver") {}

/** Filenames that cover almost every blogging engine, in order of how common they are. */
const GUESSES = ["feed", "rss", "feed.xml", "rss.xml", "atom.xml", "index.xml", "feed/"]

/**
 * Where a feed might live, given a starting address. A blog often lives in a
 * section of a bigger site, so the section's own directory is tried before the
 * site root — `plaid.com/blog/rss.xml` exists while `plaid.com/rss.xml` does not.
 */
export const guessUrls = (start: string): Array<string> => {
  const url = new URL(start)
  const directory = url.pathname.replace(/[^/]*$/, "")
  const bases = directory === "/" ? [`${url.origin}/`] : [`${url.origin}${directory}`, `${url.origin}/`]
  return bases.flatMap((base) => GUESSES.map((guess) => `${base}${guess}`))
}

const FEED_LINK = /<link\b[^>]*>/gi
const attr = (tag: string, name: string): string | undefined =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1]

/** Reads `<link rel="alternate" type="application/rss+xml">` out of a page's HTML. */
export const feedLinksInHtml = (html: string, baseUrl: string): Array<string> => {
  const found: Array<string> = []
  for (const tag of html.matchAll(FEED_LINK)) {
    const rel = attr(tag[0], "rel")?.toLowerCase()
    const type = attr(tag[0], "type")?.toLowerCase()
    const href = attr(tag[0], "href")
    if (href === undefined || rel !== "alternate") continue
    if (type !== "application/rss+xml" && type !== "application/atom+xml" && type !== "application/feed+json") continue
    // WordPress declares a comments feed next to the posts feed, and release
    // notes are not the blog. Both are alternates; neither is what was asked for.
    const title = attr(tag[0], "title")?.toLowerCase() ?? ""
    if (/comment|release/.test(href.toLowerCase()) || /comment|release/.test(title)) continue
    try {
      found.push(new URL(href, baseUrl).toString())
    } catch {
      // a malformed href in someone else's HTML is not our problem
    }
  }
  return found
}

/** The URL inside a line of free text, if there is one. */
export const extractUrl = (input: string): string | undefined => {
  const trimmed = input.trim()
  const match = trimmed.match(/https?:\/\/\S+/i)
  if (match) return match[0].replace(/[.,;)\]]+$/, "")
  // bare domain: "stripe.com/blog"
  const bare = trimmed.match(/^[\w-]+(\.[\w-]+)+(\/\S*)?$/)
  return bare ? `https://${bare[0]}` : undefined
}

export const make = Effect.gen(function* () {
  const http = SafeHttp.harden(yield* HttpClient.HttpClient)
  const parser = new Parser()

  /** Fetches a URL and returns the feed title if the body is a feed. */
  const asFeed = Effect.fn("asFeed")(function* (url: string) {
    const response = yield* http.get(url)
    if (response.status >= 400) return undefined
    const body = yield* SafeHttp.boundedText(url, response)
    const feed = yield* Effect.tryPromise(() => parser.parseString(body)).pipe(Effect.option)
    if (feed._tag === "Some") return { url, name: feed.value.title?.trim() || hostOf(url), body: undefined }
    return { url, name: undefined, body }
  })

  const resolve = Effect.fn("resolve")(function* (input: string) {
    const start = extractUrl(input)
    if (start === undefined) {
      return yield* new FeedResolveError({
        input,
        reason: "No link found. Paste the blog's address, for example https://stripe.com/blog.",
      })
    }

    const direct = yield* asFeed(start).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    if (direct?.name !== undefined) return { url: direct.url, name: nameFrom(input, direct.name) }

    // Not a feed. If we got HTML back, the page usually says where its feed is.
    if (direct?.body !== undefined) {
      for (const href of feedLinksInHtml(direct.body, start)) {
        const linked = yield* asFeed(href).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        if (linked?.name !== undefined) return { url: linked.url, name: nameFrom(input, linked.name) }
      }
    }

    // Still nothing: try the conventional paths. Against the section they gave
    // us first (plaid.com/blog/rss.xml), then the site root.
    for (const guess of guessUrls(start)) {
      const guessed = yield* asFeed(guess).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (guessed?.name !== undefined) return { url: guessed.url, name: nameFrom(input, guessed.name) }
    }

    return yield* new FeedResolveError({
      input,
      reason: `Could not find a feed at ${hostOf(start)}. Some blogs do not publish one.`,
    })
  })

  return { resolve }
})

export const layer = Layer.effect(FeedResolver, make)

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** A name the person wrote wins over the feed's own title. */
const nameFrom = (input: string, feedTitle: string): string => {
  const label = input
    .trim()
    .replace(/https?:\/\/\S+/i, "")
    .replace(/[\s–—|:-]+$/, "")
    .trim()
  return label.length > 0 ? label : feedTitle
}
