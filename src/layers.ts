import * as OpenRouterClient from "@effect/ai-openrouter/OpenRouterClient"
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as PgClient from "@effect/sql-pg/PgClient"
import * as PgMigrator from "@effect/sql-pg/PgMigrator"
import type * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as ClusterWorkflowEngine from "effect/unstable/cluster/ClusterWorkflowEngine"
import * as SingleRunner from "effect/unstable/cluster/SingleRunner"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpRouter from "effect/unstable/http/HttpRouter"
import * as AppConfig from "./config"
import * as FeedReader from "./FeedReader"
import * as FeedResolver from "./FeedResolver"
import * as Mailer from "./Mailer"
import { loader } from "./migrations"
import * as Repo from "./Repo"
import * as Scorer from "./Scorer"
import * as Tokens from "./Tokens"
import * as Uuid from "./Uuid"
import * as web from "./web"
import * as workflows from "./workflows"

/**
 * How the one process is put together: the website, the scheduler, and the
 * workers that do the sending, sharing a database connection and a shutdown.
 * That sharing is the whole reason the design fits on one small machine.
 *
 * Kept apart from `main.ts` so scripts can borrow these layers without
 * starting a web server as a side effect of importing them.
 */

// -- database -----------------------------------------------------------------

const PgLive = Layer.unwrap(Effect.map(AppConfig.databaseUrl, (url) => PgClient.layer({ url })))

const MigratedSql = PgMigrator.layer({ loader }).pipe(
  Layer.provideMerge(PgLive),
  // The migrator shells out for the optional schema dump, so it wants the
  // platform services even though nothing else here does.
  Layer.provide(BunServices.layer),
)

// -- durable execution --------------------------------------------------------

// Single-node cluster: no runner-to-runner traffic, but the mailbox and the
// workflow state live in Postgres, so a restart resumes rather than forgets.
const ClusterLive = SingleRunner.layer().pipe(Layer.provide([MigratedSql, BunServices.layer]))

export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(ClusterLive))

// -- application services -----------------------------------------------------

type MailerLayer = Layer.Layer<Mailer.Mailer, Config.ConfigError, FileSystem.FileSystem | HttpClient.HttpClient>

const MailerLive = Layer.unwrap(
  Effect.map(AppConfig.dryRun, (dryRun): MailerLayer => (dryRun ? Mailer.layerFile : Mailer.layerResend)),
)

const ScorerLive = Scorer.layer.pipe(
  Layer.provide(Scorer.OpenRouterModel),
  Layer.provide(OpenRouterClient.layerConfig({ apiKey: AppConfig.openRouterKey })),
)

export const ServicesLive = Layer.mergeAll(
  Repo.layer.pipe(Layer.provide(MigratedSql)),
  FeedReader.layer,
  FeedResolver.layer,
  ScorerLive,
  MailerLive,
  Tokens.layer,
  Uuid.layer,
).pipe(Layer.provide([FetchHttpClient.layer, BunServices.layer]))

// -- wiring -------------------------------------------------------------------

export const WorkersLive = workflows.layer.pipe(Layer.provide([WorkflowEngineLive, ServicesLive]))

const ServerLive = Layer.unwrap(
  Effect.map(AppConfig.port, (port) =>
    HttpRouter.serve(web.routes).pipe(
      // Bun binds to :: unless told otherwise, and the address it reports back
      // is then parsed as IPv4 and rejected.
      // `HttpRouter.serve` logs the address itself once the socket is up.
      Layer.provide(BunHttpServer.layer({ port, hostname: "0.0.0.0" })),
    ),
  ),
).pipe(Layer.provide([ServicesLive, WorkflowEngineLive]))

export const MainLive = Layer.mergeAll(ServerLive, WorkersLive)
