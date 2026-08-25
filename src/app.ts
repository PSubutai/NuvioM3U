import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Db } from "./db/index.ts";
import type { AppConfig } from "./config.ts";
import { createAddonRouter } from "./addon/routes.ts";
import { createAdminRouter } from "./admin/routes.ts";
import { createAuthRouter } from "./admin/auth.ts";
import { layout } from "./admin/html.ts";

export function createApp(db: Db, config: AppConfig): Express {
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", true);

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Addon routes are mounted before auth: Stremio cannot sign in, which is why
  // each list's manifest URL carries an unguessable slug instead.
  app.use("/s/:slug", createAddonRouter(db));

  app.use(createAuthRouter(config));
  app.use(createAdminRouter(db, config));

  app.use((req, res) => {
    if (req.path.startsWith("/s/")) {
      res.status(404).json({ err: "not found" });
      return;
    }
    res.status(404).type("html").send(layout({ title: "Not found", body: "<p>Not found.</p>" }));
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", error);
    if (res.headersSent) return;

    if (req.path.startsWith("/s/")) {
      res.status(500).json({ err: "internal error" });
      return;
    }
    res
      .status(500)
      .type("html")
      .send(layout({ title: "Error", body: "<p>Something went wrong. Check the container logs.</p>" }));
  });

  return app;
}
