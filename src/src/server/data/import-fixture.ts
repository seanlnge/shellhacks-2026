import "dotenv/config";

import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error(
    "Usage: npm run data:import -- path/to/sourced-story-bundle.json",
  );
  process.exit(1);
}

try {
  const fixture: unknown = JSON.parse(await readFile(path, "utf8"));
  const { importStoryFixture } = await import("./story-store");
  const bundle = await importStoryFixture(fixture);
  console.info(`Imported sourced bundle for story ${bundle.story.id}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  const { closeDb } = await import("~/server/db");
  await closeDb();
}
