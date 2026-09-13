/**
 * The blogroll: blogs we recommend, and the feeds they publish.
 *
 * This is a signed opinion, not a directory listing. It changes by pull
 * request, and `bun run feeds:check` has to pass before a merge — that is the
 * whole editorial process. Every new subscriber starts with this list.
 */

export type Category = "companies" | "people" | "ecosystem"

export interface CuratedFeed {
  readonly name: string
  readonly url: string
  readonly site: string
  readonly category: Category
  readonly description: string
}

export const CURATION: ReadonlyArray<CuratedFeed> = [
  // -- companies --------------------------------------------------------------
  {
    name: "Stripe Engineering",
    url: "https://stripe.com/blog/feed.rss",
    site: "https://stripe.com/blog/engineering",
    category: "companies",
    description: "Payments infrastructure at a scale where correctness is the product.",
  },
  {
    name: "Cloudflare",
    url: "https://blog.cloudflare.com/rss/",
    site: "https://blog.cloudflare.com",
    category: "companies",
    description: "Networking, edge compute, and unusually candid outage write-ups.",
  },
  {
    name: "Netflix TechBlog",
    url: "https://netflixtechblog.com/feed",
    site: "https://netflixtechblog.com",
    category: "companies",
    description: "Streaming, data platforms, and the JVM at absurd volume.",
  },
  {
    name: "Discord Engineering",
    url: "https://discord.com/blog/rss.xml",
    site: "https://discord.com/category/engineering",
    category: "companies",
    description: "Real-time messaging problems most teams never have to solve.",
  },
  {
    name: "Figma",
    url: "https://www.figma.com/blog/feed/atom.xml",
    site: "https://www.figma.com/blog",
    category: "companies",
    description: "Multiplayer editing, CRDTs, and rendering in the browser.",
  },
  {
    name: "Vercel",
    url: "https://vercel.com/atom",
    site: "https://vercel.com/blog",
    category: "companies",
    description: "Frontend infrastructure and the deployment model around it.",
  },
  {
    name: "Shopify Engineering",
    url: "https://shopify.engineering/blog.atom",
    site: "https://shopify.engineering",
    category: "companies",
    description: "One of the largest Rails systems in production, described honestly.",
  },
  {
    name: "GitHub Engineering",
    url: "https://github.blog/feed/",
    site: "https://github.blog/engineering/",
    category: "companies",
    description: "Git at scale, plus the platform work underneath it.",
  },
  {
    name: "Meta Engineering",
    url: "https://engineering.fb.com/feed/",
    site: "https://engineering.fb.com",
    category: "companies",
    description: "Infrastructure papers with the numbers left in.",
  },
  {
    name: "Airbnb Engineering",
    url: "https://medium.com/feed/airbnb-engineering",
    site: "https://medium.com/airbnb-engineering",
    category: "companies",
    description: "Service migrations and data infrastructure, told as case studies.",
  },
  {
    name: "DoorDash Engineering",
    url: "https://careersatdoordash.com/feed/",
    site: "https://careersatdoordash.com/engineering-blog/",
    category: "companies",
    description: "Logistics, forecasting, and the hard parts of a three-sided marketplace.",
  },
  {
    name: "Slack Engineering",
    url: "https://slack.engineering/feed",
    site: "https://slack.engineering",
    category: "companies",
    description: "Large PHP/Hack systems and the operational reality of always-on chat.",
  },
  {
    name: "Datadog Engineering",
    url: "https://www.datadoghq.com/blog/engineering/index.xml",
    site: "https://www.datadoghq.com/blog/engineering/",
    category: "companies",
    description: "Time-series storage and the ingestion pipeline that feeds it.",
  },
  {
    name: "Twilio Engineering",
    url: "https://www.twilio.com/blog/feed",
    site: "https://www.twilio.com/en-us/blog",
    category: "companies",
    description: "Telephony and messaging APIs, plus the reliability work behind them.",
  },
  {
    name: "HubSpot Product & Engineering",
    url: "https://product.hubspot.com/blog/rss.xml",
    site: "https://product.hubspot.com/blog",
    category: "companies",
    description: "Multi-tenant SaaS architecture and the migrations it forces.",
  },
  {
    name: "Intercom Engineering",
    url: "https://www.intercom.com/blog/feed/",
    site: "https://www.intercom.com/blog/engineering/",
    category: "companies",
    description: "Shipping fast without the system rotting, written up as practice.",
  },
  {
    name: "Linear",
    url: "https://linear.app/rss/now.xml",
    site: "https://linear.app/blog",
    category: "companies",
    description: "Local-first sync and interface craft, from a team that argues for both.",
  },
  {
    name: "GitLab Engineering",
    url: "https://about.gitlab.com/atom.xml",
    site: "https://about.gitlab.com/blog/",
    category: "companies",
    description: "A whole DevOps platform built in the open, postmortems included.",
  },
  {
    name: "Plaid Engineering",
    url: "https://plaid.com/blog/rss.xml",
    site: "https://plaid.com/blog/",
    category: "companies",
    description: "Fintech plumbing: bank integrations, data quality, and trust.",
  },
  {
    name: "Auth0 Engineering",
    url: "https://auth0.com/blog/rss.xml",
    site: "https://auth0.com/blog/",
    category: "companies",
    description: "Identity, tokens, and the ways authentication goes wrong.",
  },

  // -- people -----------------------------------------------------------------
  {
    name: "Dan Abramov",
    url: "https://overreacted.io/rss.xml",
    site: "https://overreacted.io",
    category: "people",
    description: "Slow, careful essays that rebuild an idea from the bottom.",
  },
  {
    name: "Kent C. Dodds",
    url: "https://kentcdodds.com/blog/rss.xml",
    site: "https://kentcdodds.com/blog",
    category: "people",
    description: "Testing and web architecture, with strong opinions defended in public.",
  },
  {
    name: "Julia Evans",
    url: "https://jvns.ca/atom.xml",
    site: "https://jvns.ca",
    category: "people",
    description: "Systems explained by someone actually poking at them while writing.",
  },
  {
    name: "Martin Fowler",
    url: "https://martinfowler.com/feed.atom",
    site: "https://martinfowler.com",
    category: "people",
    description: "The vocabulary most architecture arguments are borrowing from.",
  },
  {
    name: "Simon Willison",
    url: "https://simonwillison.net/atom/everything/",
    site: "https://simonwillison.net",
    category: "people",
    description: "Daily notes on language models, SQLite, and building small tools.",
  },
  {
    name: "Matt Pocock",
    url: "https://www.totaltypescript.com/rss.xml",
    site: "https://www.totaltypescript.com",
    category: "people",
    description: "The type system, one uncomfortable corner at a time.",
  },

  // -- ecosystem --------------------------------------------------------------
  {
    name: "Effect",
    url: "https://effect.website/rss.xml",
    site: "https://effect.website/blog",
    category: "ecosystem",
    description: "Release notes and design rationale for the Effect ecosystem.",
  },
  {
    name: "Bun",
    url: "https://bun.sh/rss.xml",
    site: "https://bun.sh/blog",
    category: "ecosystem",
    description: "A runtime shipping fast enough that the changelog is worth reading.",
  },
  {
    name: "TypeScript",
    url: "https://devblogs.microsoft.com/typescript/feed/",
    site: "https://devblogs.microsoft.com/typescript/",
    category: "ecosystem",
    description: "What is landing in the compiler, straight from the team.",
  },
]

/**
 * Blogs from `blogs-exemple.md` that are deliberately absent, and why. Kept
 * here so nobody re-adds them and rediscovers the same wall.
 *
 * - Uber Engineering — the feed answers HTTP 406 to anything that is not a
 *   browser, so it cannot be polled.
 * - Segment — segment.com does not respond to requests from our network.
 * - Notion — the blog publishes no feed.
 * - Atlassian Developer — the only feed it declares is the comments feed.
 */

export const CATEGORY_LABELS: Record<Category, string> = {
  companies: "Companies",
  people: "People",
  ecosystem: "Ecosystem",
}

export const byCategory = (category: Category): ReadonlyArray<CuratedFeed> =>
  CURATION.filter((feed) => feed.category === category)
