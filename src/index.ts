import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/index.ts";
import { createApp } from "./app.ts";
import { probeEverything } from "./health/prober.ts";

const config = loadConfig();
const db = openDatabase(config.dbPath);
const app = createApp(db, config);

const server = app.listen(config.port, () => {
  console.log(`NuvioM3U listening on port ${config.port}`);
  console.log(`  database: ${config.dbPath}`);
  console.log(`  public URL: ${config.publicUrl ?? "(derived from request headers)"}`);
  console.log(`  admin auth: ${config.adminPassword ? "password" : "disabled"}`);
});

let healthTimer: NodeJS.Timeout | undefined;

if (config.healthcheckIntervalMinutes > 0) {
  const intervalMs = config.healthcheckIntervalMinutes * 60_000;
  console.log(`  health checks: every ${config.healthcheckIntervalMinutes} min`);

  healthTimer = setInterval(() => {
    probeEverything(db)
      .then((summary) => {
        console.log(
          `Health check: ${summary.checked} checked, ${summary.ok} ok, ${summary.dead} dead.`,
        );
      })
      .catch((error: unknown) => {
        console.error("Health check failed:", error);
      });
  }, intervalMs);

  healthTimer.unref();
}

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down.`);
  if (healthTimer) clearInterval(healthTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
