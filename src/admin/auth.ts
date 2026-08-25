import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import express from "express";
import type { AppConfig } from "../config.ts";
import { layout } from "./html.ts";
import { renderLoginPage } from "./views.ts";

const COOKIE_NAME = "nm_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

function sign(password: string, expiry: number): string {
  return createHmac("sha256", password).update(`session:${expiry}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function issueToken(password: string): string {
  const expiry = Date.now() + SESSION_MS;
  return `${expiry}.${sign(password, expiry)}`;
}

function isValidToken(token: string | null, password: string): boolean {
  if (!token) return false;

  const separator = token.indexOf(".");
  if (separator === -1) return false;

  const expiry = Number.parseInt(token.slice(0, separator), 10);
  if (!Number.isSafeInteger(expiry) || expiry < Date.now()) return false;

  return safeEqual(token.slice(separator + 1), sign(password, expiry));
}

/**
 * Password auth, active only when ADMIN_PASSWORD is set.
 *
 * Left unset the admin UI is wide open, on the assumption that a reverse proxy
 * such as Pangolin is authenticating in front of it. The addon routes under /s/
 * are never covered by this - Stremio cannot authenticate, which is exactly why
 * the manifest URL carries an unguessable slug instead.
 */
export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  const password = config.adminPassword;

  if (!password) return router;

  router.use(express.urlencoded({ extended: false }));

  router.get("/login", (req, res) => {
    if (isValidToken(readCookie(req, COOKIE_NAME), password)) {
      res.redirect(303, "/");
      return;
    }
    res
      .status(req.query.err ? 401 : 200)
      .type("html")
      .send(
        layout({
          title: "Sign in - NuvioM3U",
          body: renderLoginPage(req.query.err ? "Incorrect password." : null),
        }),
      );
  });

  router.post("/login", (req, res) => {
    const supplied = typeof req.body?.password === "string" ? req.body.password : "";

    if (!safeEqual(supplied, password)) {
      res.redirect(303, "/login?err=1");
      return;
    }

    res.cookie(COOKIE_NAME, issueToken(password), {
      httpOnly: true,
      sameSite: "strict",
      secure: req.protocol === "https",
      maxAge: SESSION_MS,
      path: "/",
    });
    res.redirect(303, "/");
  });

  router.post("/logout", (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.redirect(303, "/login");
  });

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (isValidToken(readCookie(req, COOKIE_NAME), password)) {
      next();
      return;
    }
    res.redirect(303, "/login");
  });

  return router;
}
