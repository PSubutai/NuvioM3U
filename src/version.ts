import { createRequire } from "node:module";

// Read at runtime rather than imported: package.json sits outside rootDir, and
// a JSON import would push the emitted tree down a directory.
const requireJson = createRequire(import.meta.url);
const pkg = requireJson("../package.json") as { version?: string };

if (!pkg.version) {
  throw new Error("package.json has no version field.");
}

export const ADDON_VERSION = pkg.version;
export const USER_AGENT = `NuvioM3U/${ADDON_VERSION}`;
