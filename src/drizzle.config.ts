import "dotenv/config";

import { type Config } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for Drizzle commands");

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  tablesFilter: ["src_*"],
} satisfies Config;
