import { createRequire } from "node:module";

/**
 * The server version, read from `package.json` at runtime so it can never drift
 * from the published package. `package.json` sits one level above both `src/`
 * (tsx, tests) and `dist/` (the build), and is in the published `files`.
 */
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const PACKAGE_VERSION: string = pkg.version;
