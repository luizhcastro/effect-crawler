import * as Config from "effect/Config"

export const dryRun = Config.Boolean("DRY_RUN").pipe(Config.withDefault(false))
export const lookbackDays = Config.Int("LOOKBACK_DAYS").pipe(Config.withDefault(7))
export const model = Config.String("OPENROUTER_MODEL").pipe(Config.withDefault("deepseek/deepseek-v4.1-flash"))
export const openRouterKey = Config.Redacted("OPENROUTER_API_KEY")
