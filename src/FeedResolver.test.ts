import { expect, test } from "bun:test"
import { extractUrl, feedLinksInHtml, guessUrls } from "./FeedResolver"

test("pulls a URL out of whatever was typed", () => {
  expect(extractUrl("https://jvns.ca")).toBe("https://jvns.ca")
  expect(extractUrl("Julia Evans – https://jvns.ca/atom.xml")).toBe("https://jvns.ca/atom.xml")
  expect(extractUrl("see https://jvns.ca, it is good.")).toBe("https://jvns.ca")
  expect(extractUrl("stripe.com/blog")).toBe("https://stripe.com/blog")
  expect(extractUrl("Netflix Tech Blog")).toBeUndefined()
})

test("finds the feed a page declares, and ignores the comments feed", () => {
  const page = `
    <link rel="alternate" type="application/rss+xml" title="Comments Feed" href="/comments/feed/">
    <link rel="alternate" type="application/rss+xml" title="Posts" href="/feed/">
    <link rel="stylesheet" href="/style.css">
  `
  expect(feedLinksInHtml(page, "https://example.com/blog/")).toEqual(["https://example.com/feed/"])
})

test("relative hrefs resolve against the page, not the site root", () => {
  const page = `<link rel="alternate" type="application/atom+xml" href="atom.xml">`
  expect(feedLinksInHtml(page, "https://example.com/blog/")).toEqual(["https://example.com/blog/atom.xml"])
})

test("guesses inside the given section before the site root", () => {
  const guesses = guessUrls("https://plaid.com/blog/")
  expect(guesses[0]).toBe("https://plaid.com/blog/feed")
  expect(guesses).toContain("https://plaid.com/blog/rss.xml")
  expect(guesses).toContain("https://plaid.com/feed")
  // the section comes first: plaid.com/blog/rss.xml exists, plaid.com/rss.xml does not
  expect(guesses.indexOf("https://plaid.com/blog/rss.xml")).toBeLessThan(guesses.indexOf("https://plaid.com/feed"))
})

test("a bare domain still guesses from the root", () => {
  expect(guessUrls("https://jvns.ca")[0]).toBe("https://jvns.ca/feed")
})
