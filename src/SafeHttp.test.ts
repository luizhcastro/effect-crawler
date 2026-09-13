import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { checkUrl, isPrivateIp } from "./SafeHttp"

test("rejects every address that points back inside", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.16.5.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
    expect(isPrivateIp(ip)).toBe(true)
  }
  for (const ip of ["::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
    expect(isPrivateIp(ip)).toBe(true)
  }
})

test("lets ordinary public addresses through", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "151.101.1.140", "2606:4700::1111"]) {
    expect(isPrivateIp(ip)).toBe(false)
  }
})

test("anything that is not an IP at all is refused", () => {
  expect(isPrivateIp("not-an-ip")).toBe(true)
  expect(isPrivateIp("")).toBe(true)
})

const refusalFor = (url: string) =>
  Effect.runPromise(
    checkUrl(url).pipe(
      Effect.flip,
      Effect.map((error) => error.reason),
    ),
  )

test("only http and https are fetchable", async () => {
  expect(await refusalFor("file:///etc/passwd")).toBe("scheme file: is not allowed")
  expect(await refusalFor("gopher://example.com")).toBe("scheme gopher: is not allowed")
  expect(await refusalFor("not a url at all")).toBe("not a valid URL")
})

test("a literal private address is refused without a DNS round trip", async () => {
  expect(await refusalFor("http://169.254.169.254/latest/meta-data/")).toBe("resolves to a private address")
  expect(await refusalFor("http://127.0.0.1:5432/")).toBe("resolves to a private address")
  expect(await refusalFor("http://[::1]/")).toBe("resolves to a private address")
})

test("a hostname that resolves into the private range is refused too", async () => {
  // localhost is the canonical case, and it exercises the DNS path
  expect(await refusalFor("http://localhost:3000/")).toBe("resolves to a private address")
})
