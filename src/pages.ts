import { CATEGORY_LABELS, type Category, CURATION } from "./curation"
import type { Frequency, UserFeed } from "./domain"
import { MAX_FEEDS_PER_USER } from "./domain"
import { type Html, html, page, render } from "./html"

const CATEGORIES: ReadonlyArray<Category> = ["companies", "people", "ecosystem"]

const footer = html`
  <footer>
    Radar reads these feeds, asks a language model to score each post against
    what you said you care about, and mails you only what clears the bar.
    <a href="https://github.com/luizcastro/effect-crawler">Source and the curated list</a>.
  </footer>
`

/** The public blogroll. No login, no database — this is the front door. */
export const directory = (notice?: string): string =>
  page(
    "Radar",
    html`
      <h1>Radar</h1>
      <p class="lede">
        Engineering blogs worth reading, and a weekly email with only the posts
        that match what you work on. Not a feed of everything — a short list,
        scored against a profile you write.
      </p>

      ${CATEGORIES.map(
        (category) => html`
          <h2>${CATEGORY_LABELS[category]}</h2>
          <ul class="blogs">
            ${CURATION.filter((feed) => feed.category === category).map(
              (feed) => html`
                <li>
                  <a href="${feed.site}" rel="noopener">${feed.name}</a>
                  <span>${feed.description}</span>
                </li>
              `,
            )}
          </ul>
        `,
      )}

      <h2>Subscribe</h2>
      ${notice ? html`<p class="notice">${notice}</p>` : ""}
      <form method="post" action="/subscribe">
        <div class="row">
          <input type="email" name="email" required placeholder="you@example.com" aria-label="Email address" />
          <button type="submit">Subscribe</button>
        </div>
        <p class="hint">
          We email you a confirmation link first. Every edition carries a
          one-click unsubscribe.
        </p>
      </form>
      ${footer}
    `,
  )

export const message = (title: string, body: string, isError = false): string =>
  page(
    `${title} · Radar`,
    html`
      <h1>${title}</h1>
      <p class="${isError ? "error" : "notice"}">${body}</p>
      <p><a href="/">Back to the blogroll</a></p>
    `,
  )

export const signIn = (notice?: string): string =>
  page(
    "Sign in · Radar",
    html`
      <h1>Sign in</h1>
      <p class="lede">We email you a link. No password to remember or leak.</p>
      ${notice ? html`<p class="notice">${notice}</p>` : ""}
      <form method="post" action="/signin">
        <div class="row">
          <input type="email" name="email" required placeholder="you@example.com" aria-label="Email address" />
          <button type="submit">Email me a link</button>
        </div>
      </form>
    `,
  )

const PROFILE_PLACEHOLDER = `# Write this in whatever language you think in — the model reads it as-is.
#
# Say what you build, and be specific about what bores you. The second half
# does more work than the first: "little interest in mobile" is what stops
# twelve React Native posts from reaching your inbox.

Backend engineer, TypeScript, working in fintech.

Interested in: system architecture, advanced TypeScript, infrastructure and
scaling, post-mortems, accounts of how real systems were actually built.

Little interest in: mobile, purely visual frontend, company news, product
announcements with no technical content, job postings, conferences.`

export const accountPage = (options: {
  readonly email: string
  readonly profile: string
  readonly frequency: Frequency
  readonly feeds: ReadonlyArray<UserFeed>
  readonly notice?: string
  readonly error?: string
}): string => {
  const feedsText = options.feeds.map((feed) => feed.input).join("\n")
  const broken = options.feeds.filter((feed) => feed.status === "failing" || feed.status === "dead")
  return page(
    "Your radar · Radar",
    html`
      <h1>Your radar</h1>
      <p class="lede">Signed in as ${options.email}.</p>
      ${options.error ? html`<p class="error">${options.error}</p>` : ""}
      ${options.notice ? html`<p class="notice">${options.notice}</p>` : ""}

      <form method="post" action="/account">
        <h2>Profile</h2>
        <label for="profile">What you want to read</label>
        <textarea id="profile" class="editor" name="profile" spellcheck="false">${
          options.profile.trim().length > 0 ? options.profile : PROFILE_PLACEHOLDER
        }</textarea>

        <h2>Blogs</h2>
        <label for="feeds">One address per line</label>
        <textarea id="feeds" class="editor" name="feeds" spellcheck="false" placeholder="https://example.com/blog">${feedsText}</textarea>
        <p class="hint">
          Paste the blog's address and we find its feed. ${options.feeds.length} of
          ${MAX_FEEDS_PER_USER} used.
        </p>

        ${
          broken.length === 0
            ? ""
            : html`
                <ul class="feeds">
                  ${broken.map(
                    (feed) => html`
                      <li>
                        <span class="state bad">${feed.status}</span>
                        <span>${feed.name ?? feed.input}</span>
                        <span class="state">${feed.error ?? ""}</span>
                      </li>
                    `,
                  )}
                </ul>
                <p class="hint">
                  A blog marked <code>dead</code> failed five times in a row and is no
                  longer fetched. Remove the line, or fix the address to try again.
                </p>
              `
        }

        <h2>Frequency</h2>
        <label for="frequency">How often to send</label>
        <select id="frequency" name="frequency">
          ${(["daily", "weekly", "monthly"] as const).map(
            (value) =>
              html`<option value="${value}" ${value === options.frequency ? html`selected` : ""}>${value}</option>`,
          )}
        </select>
        <p class="hint">
          If nothing clears the bar, we skip that round rather than mail you an
          empty list.
        </p>

        <div class="row"><button type="submit">Save</button></div>
      </form>

      <footer>
        <a href="/signout">Sign out</a> ·
        <a href="/unsubscribe-confirm">Unsubscribe</a>
      </footer>
    `,
  )
}

export const confirmEmail = (link: string): { subject: string; html: string } => ({
  subject: "Confirm your Radar subscription",
  html: mail(html`
    <p>One click and you are in:</p>
    <p><a href="${link}">Confirm my subscription</a></p>
    <p style="color:#888;font-size:13px">If you did not ask for this, ignore it — nothing was created.</p>
  `),
})

export const loginEmail = (link: string): { subject: string; html: string } => ({
  subject: "Your Radar sign-in link",
  html: mail(html`
    <p>Here is your sign-in link. It works once, for the next 15 minutes:</p>
    <p><a href="${link}">Sign in to Radar</a></p>
    <p style="color:#888;font-size:13px">If you did not ask for this, ignore it.</p>
  `),
})

const mail = (body: Html): string =>
  `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;font-size:15px;line-height:1.6;color:#1a1a1a">
  <h1 style="font-size:20px;margin:0 0 16px">Radar</h1>
  ${render(body)}
</div>`
