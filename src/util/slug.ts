import { randomBytes } from "node:crypto";

/** 15 random bytes -> 20 URL-safe characters, ~120 bits of entropy. */
export function generateSlug(): string {
  return randomBytes(15).toString("base64url");
}

const SLUG_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}
