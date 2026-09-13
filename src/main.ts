import * as BunRuntime from "@effect/platform-bun/BunRuntime"
import * as Layer from "effect/Layer"
import { MainLive } from "./layers"

BunRuntime.runMain(Layer.launch(MainLive))
