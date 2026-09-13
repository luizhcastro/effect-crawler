/**
 * Runs the hourly dispatch once, right now, instead of waiting for the cron.
 * Useful in development, and for pushing through a round that was missed.
 *
 * It keeps the workers alive for a while afterwards: dispatch only starts the
 * executions, and the work happens in this same process.
 */
import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ServicesLive, WorkersLive, WorkflowEngineLive } from "../src/layers"
import { dispatchDueEditions } from "../src/workflows"

const drainFor = Number(process.env.DRAIN_SECONDS ?? 120)

const program = Effect.gen(function* () {
  yield* dispatchDueEditions
  yield* Effect.logInfo(`dispatched; draining for ${drainFor}s`)
  yield* Effect.sleep(Duration.seconds(drainFor))
}).pipe(Effect.provide(Layer.mergeAll(WorkersLive, ServicesLive, WorkflowEngineLive)))

BunRuntime.runMain(program)
