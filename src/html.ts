/**
 * A tiny HTML layer with one job: make escaping the default.
 *
 * The pages render blog names, profiles and error text that strangers typed. A
 * plain template string interpolates them raw, which is one forgotten call away
 * from cross-site scripting. Here the default is escaped and the exception is
 * loud (`raw`), so the dangerous case is the one you have to ask for.
 */

const RAW = Symbol.for("radar/html/raw")

export interface Html {
  readonly [RAW]: string
}

export const isHtml = (value: unknown): value is Html => typeof value === "object" && value !== null && RAW in value

/** Marks a string as already-safe HTML. Only ever call this on markup we wrote. */
export const raw = (value: string): Html => ({ [RAW]: value })

export const render = (value: Html): string => value[RAW]

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const interpolate = (value: unknown): string => {
  if (value === null || value === undefined || value === false) return ""
  if (isHtml(value)) return value[RAW]
  if (Array.isArray(value)) return value.map(interpolate).join("")
  return escapeHtml(String(value))
}

export const html = (strings: TemplateStringsArray, ...values: ReadonlyArray<unknown>): Html =>
  raw(strings.reduce((acc, part, i) => acc + interpolate(values[i - 1]) + part))

// -- page chrome --------------------------------------------------------------

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfa;
  --panel: #ffffff;
  --ink: #1c1e22;
  --muted: #6b7280;
  --line: #e6e6e3;
  --accent: #3b5bdb;
  --danger: #b4232a;
  --editor-bg: #fafafa;
  --editor-ink: #383a41;
  --editor-line: #dcdcda;
  --editor-gutter: #a6a6a6;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1a1c1f;
    --panel: #212429;
    --ink: #e6e8ea;
    --muted: #9aa1ab;
    --line: #2e3238;
    --accent: #74ade8;
    --danger: #d07277;
    --editor-bg: #282c34;
    --editor-ink: #dcdfe4;
    --editor-line: #3b414d;
    --editor-gutter: #5d636f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding-block: 48px;
  padding-inline: 20px;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 42rem; margin: 0 auto; }
h1 { font-size: clamp(2rem, 6vw, 2.75rem); line-height: 1.1; margin: 0 0 12px; letter-spacing: -0.02em; text-wrap: balance; }
h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); margin: 48px 0 16px; font-weight: 600; }
h3 { font-size: 1.05rem; margin: 0 0 20px; }
p { margin: 0 0 16px; }
a { color: var(--accent); }
.lede { color: var(--muted); font-size: 1.05rem; max-width: 34rem; }
.blogs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 20px; }
.blogs li { display: flex; flex-direction: column; gap: 3px; }
.blogs a { font-weight: 600; text-decoration: none; color: var(--ink); }
.blogs a:hover { color: var(--accent); }
.blogs span { color: var(--muted); font-size: 0.9rem; }
form { display: flex; flex-direction: column; gap: 12px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
.row > input { flex: 1 1 16rem; }
input[type="email"], select {
  font: inherit; padding: 11px 13px; border: 1px solid var(--line);
  border-radius: 7px; background: var(--panel); color: var(--ink); min-width: 0;
}
button {
  font: inherit; font-weight: 550; padding: 11px 20px; border: 0; border-radius: 7px;
  background: var(--ink); color: var(--bg); cursor: pointer;
}
button:hover { opacity: 0.87; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
label { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); font-weight: 600; }
.hint { color: var(--muted); font-size: 0.88rem; margin: 0; }
.editor {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13.5px; line-height: 1.65; tab-size: 2;
  width: 100%; min-height: 17rem; resize: vertical;
  padding: 14px 14px 14px 52px;
  border: 1px solid var(--editor-line); border-radius: 8px;
  background: var(--editor-bg); color: var(--editor-ink);
  caret-color: var(--accent);
  /* the gutter is a painted stripe, not an element: no scroll to keep in sync */
  background-image: linear-gradient(to right, transparent 0 40px, var(--editor-line) 40px 41px, transparent 41px);
  background-attachment: local;
}
.notice, .error {
  padding: 12px 14px; border-radius: 7px; font-size: 0.93rem;
  border: 1px solid var(--line); background: var(--panel); margin: 0 0 24px;
}
.error { border-color: var(--danger); color: var(--danger); }
.feeds { list-style: none; padding: 0; margin: 0 0 8px; font-size: 0.9rem; }
.feeds li { display: flex; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--line); align-items: baseline; }
.feeds .state { font-family: ui-monospace, monospace; font-size: 0.75rem; color: var(--muted); }
.feeds .state.bad { color: var(--danger); }
footer { margin-top: 72px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.85rem; }
`

export const page = (title: string, body: Html): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap">
<style>${STYLES}</style>
</head>
<body><main>${render(body)}</main></body>
</html>`
