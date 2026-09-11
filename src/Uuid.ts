import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

export class Uuid extends Context.Service<
  Uuid,
  {
    readonly generate: Effect.Effect<string>
  }
>()("Uuid") {}

export const layer = Layer.succeed(Uuid, { generate: Effect.sync(() => crypto.randomUUID()) })

export const Test = Layer.succeed(Uuid, { generate: Effect.succeed("test-uuid") })
