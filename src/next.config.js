/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

/** @type {import("next").NextConfig} */
const config = {
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
};

export default config;
