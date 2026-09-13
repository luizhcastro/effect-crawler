import * as Config from "effect/Config"
import * as Schema from "effect/Schema"

/** Write emails to `out/` instead of sending them. Also relaxes the Resend config. */
export const dryRun = Config.Boolean("DRY_RUN").pipe(Config.withDefault(false))

/** Public base URL, used to build the links that go inside emails. */
export const appUrl = Config.String("APP_URL").pipe(Config.withDefault("http://localhost:3000"))

export const port = Config.Int("PORT").pipe(Config.withDefault(3000))

export const databaseUrl = Config.Redacted("DATABASE_URL")

/** HMAC key behind every confirmation, login and unsubscribe link. */
export const secretKey = Config.Redacted("SECRET_KEY")

export const model = Config.String("OPENROUTER_MODEL").pipe(Config.withDefault("deepseek/deepseek-v4.1-flash"))
export const openRouterKey = Config.Redacted("OPENROUTER_API_KEY")

export const resendKey = Config.Redacted("RESEND_API_KEY")
export const mailFrom = Config.String("MAIL_FROM").pipe(Config.withDefault("Radar <radar@radar.luizcastro.dev>"))

/**
 * Ceiling on scoring calls per calendar month. Each edition is one call, and
 * `MAX_POSTS_PER_EDITION` bounds the size of that call, so this bounds spend.
 */
export const monthlyScoringCalls = Config.Int("MONTHLY_SCORING_CALLS").pipe(Config.withDefault(2000))

/** Recipients of the operational alert when the cap is hit. */
export const alertTo = Config.Array(Schema.NonEmptyString, "ALERT_TO").pipe(Config.withDefault([]))
