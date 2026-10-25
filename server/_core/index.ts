import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerDiscordRoutes } from "../discord/routes";
import { blockDiscordBotForReadiness, startDiscordBot, stopDiscordBot } from "../discord/bot";
import { publicPlatformScript } from "./publicConfig";
import { runStartupMigrations } from "./migrations";
import { getReadiness, shouldStartProductionGateway } from "./readiness";
import { logStartupReport } from "./startupReport";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Keep general API parsing bounded. Any future upload route must opt into its own limit.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "32kb", extended: false, parameterLimit: 100 }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/ready", async (_req, res) => {
    const readiness = await getReadiness();
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.status,
      ...(readiness.code ? { code: readiness.code } : {}),
      migration: readiness.migration.state,
      migrationMode: readiness.migration.mode,
    });
  });
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerDiscordRoutes(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  await runStartupMigrations();
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on port ${port}`);
    logStartupReport();
    void (async () => {
      if (process.env.NODE_ENV === "production" && process.env.SYSTEMIX_ENABLE_PRODUCTION_GATEWAY === "true") {
        const readiness = await getReadiness();
        if (!shouldStartProductionGateway(process.env, readiness.ready)) {
          const code = readiness.code ?? "readiness_not_ready";
          blockDiscordBotForReadiness(code);
          console.warn(`[Systemix] Production Gateway held by readiness policy (${code})`);
          return;
        }
      }
      await startDiscordBot();
    })().catch((error) => {
      console.error(`[Systemix] Gateway startup policy failed (${error instanceof Error ? error.name : "unknown"})`);
    });
  });
  const shutdown = () => { void stopDiscordBot().finally(() => server.close()); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startServer().catch(error => { console.error(error); process.exit(1); });
