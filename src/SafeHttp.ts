import * as dns from "node:dns/promises"
import { isIP } from "node:net"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

/**
 * The server fetches URLs that strangers typed in. Everything in this file
 * exists to keep that from reaching things it should not: the machine itself,
 * the private network around it, or a cloud metadata endpoint.
 */

export class UnsafeUrlError extends Schema.TaggedError<UnsafeUrlError>()("UnsafeUrlError", {
  url: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `Refused to fetch ${this.url}: ${this.reason}.`
  }
}

export class ResponseTooLargeError extends Schema.TaggedError<ResponseTooLargeError>()("ResponseTooLargeError", {
  url: Schema.String,
  limitBytes: Schema.Int,
}) {
  override get message(): string {
    return `${this.url} returned more than ${this.limitBytes} bytes.`
  }
}

export const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT = "15 seconds"

const USER_AGENT = "Mozilla/5.0 (compatible; radar.luizcastro.dev; +https://radar.luizcastro.dev)"

/** Reserved IPv4 ranges: loopback, private, link-local (incl. cloud metadata), CGNAT, broadcast. */
const isPrivateIpv4 = (ip: string): boolean => {
  const [a = 0, b = 0] = ip.split(".").map(Number)
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local; 169.254.169.254 is the metadata address
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast and reserved
  return false
}

const isPrivateIpv6 = (ip: string): boolean => {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "")
  if (normalized === "::1" || normalized === "::") return true
  if (normalized.startsWith("fe80") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  // IPv4-mapped (::ffff:10.0.0.1) tunnels straight back to the v4 ranges above
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped?.[1] !== undefined && isPrivateIpv4(mapped[1])
}

export const isPrivateIp = (ip: string): boolean =>
  isIP(ip) === 6 ? isPrivateIpv6(ip) : isIP(ip) === 4 ? isPrivateIpv4(ip) : true

/**
 * Parses and vets one URL: scheme, then every address its hostname resolves to.
 *
 * ponytail: there is a window between this DNS lookup and the fetch's own, so a
 * hostname that answers differently each time can still slip through (DNS
 * rebinding). Closing it means pinning the connection to the vetted IP, which
 * needs a custom dispatcher and breaks TLS SNI. If this ever runs next to
 * something worth pivoting to, that is the upgrade.
 */
export const checkUrl = Effect.fn("checkUrl")(function* (raw: string) {
  const url = yield* Effect.try({
    try: () => new URL(raw),
    catch: () => new UnsafeUrlError({ url: raw, reason: "not a valid URL" }),
  })
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return yield* new UnsafeUrlError({ url: raw, reason: `scheme ${url.protocol} is not allowed` })
  }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = isIP(host)
    ? [host]
    : yield* Effect.tryPromise({
        try: () => dns.lookup(host, { all: true }).then((entries) => entries.map((entry) => entry.address)),
        catch: () => new UnsafeUrlError({ url: raw, reason: "hostname does not resolve" }),
      })
  if (addresses.length === 0) {
    return yield* new UnsafeUrlError({ url: raw, reason: "hostname does not resolve" })
  }
  for (const address of addresses) {
    if (isPrivateIp(address)) {
      return yield* new UnsafeUrlError({ url: raw, reason: "resolves to a private address" })
    }
  }
  return url
})

/** Reads a response body, failing rather than buffering past the cap. */
export const boundedText = Effect.fn("boundedText")(function* (
  url: string,
  response: HttpClientResponse.HttpClientResponse,
) {
  const declared = response.headers["content-length"]
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
    return yield* new ResponseTooLargeError({ url, limitBytes: MAX_BODY_BYTES })
  }
  const chunks: Array<Uint8Array> = []
  let size = 0
  yield* Stream.runForEach(response.stream, (chunk) =>
    Effect.suspend(() => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) return Effect.fail(new ResponseTooLargeError({ url, limitBytes: MAX_BODY_BYTES }))
      chunks.push(chunk)
      return Effect.void
    }),
  )
  return new TextDecoder().decode(concat(chunks, size))
})

const concat = (chunks: ReadonlyArray<Uint8Array>, size: number): Uint8Array => {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * An `HttpClient` for untrusted URLs: every hop is vetted, redirects are
 * capped, and each request has a deadline.
 */
export const harden = <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
  client.pipe(
    HttpClient.mapRequestEffect((request) => Effect.as(checkUrl(request.url), request)),
    HttpClient.mapRequest(HttpClientRequest.setHeader("User-Agent", USER_AGENT)),
    HttpClient.followRedirects(MAX_REDIRECTS),
    HttpClient.transformResponse(Effect.timeout(REQUEST_TIMEOUT)),
  )
