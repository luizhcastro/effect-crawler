import { expect, test } from "bun:test"
import { html, raw, render } from "./html"

test("interpolated values are escaped, so a blog name cannot be a script", () => {
  const name = `<script>alert('x')</script>`
  expect(render(html`<p>${name}</p>`)).toBe("<p>&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</p>")
})

test("attribute values cannot break out of their quotes", () => {
  const url = `" onmouseover="steal()`
  expect(render(html`<a href="${url}">x</a>`)).toBe(`<a href="&quot; onmouseover=&quot;steal()">x</a>`)
})

test("nested html is kept as markup, not escaped twice", () => {
  const inner = html`<em>hi</em>`
  expect(render(html`<p>${inner}</p>`)).toBe("<p><em>hi</em></p>")
})

test("arrays render in order without separators", () => {
  expect(render(html`<ul>${[1, 2, 3].map((n) => html`<li>${n}</li>`)}</ul>`)).toBe(
    "<ul><li>1</li><li>2</li><li>3</li></ul>",
  )
})

test("nothing is rendered for null, undefined and false", () => {
  expect(render(html`<p>${null}${undefined}${false}</p>`)).toBe("<p></p>")
})

test("raw is the deliberate escape hatch", () => {
  expect(render(html`<p>${raw("<b>bold</b>")}</p>`)).toBe("<p><b>bold</b></p>")
})
