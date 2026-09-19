import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // "turso" er drizzle-kit's dialect-navn for libsql (også ved brug af en
  // ren lokal fil, ingen Turso-konto eller netværk involveret) - se
  // src/db/index.ts for hvorfor libsql blev valgt frem for better-sqlite3.
  dialect: "turso",
  dbCredentials: {
    url: `file:${process.env.DATABASE_PATH || "./data/grenaa.db"}`,
  },
} satisfies Config;
