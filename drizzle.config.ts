import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // "turso" er drizzle-kit's dialect-navn for libsql (også ved brug af en
  // ren lokal fil, ingen Turso-konto eller netværk involveret) - se
  // src/db/index.ts for hvorfor libsql blev valgt frem for better-sqlite3.
  dialect: "turso",
  dbCredentials: {
    // Bruger samme TURSO_DATABASE_URL/TURSO_AUTH_TOKEN som src/db/index.ts og
    // src/db/seed.ts, så "db:push" skubber skemaet til den rigtige
    // (persistente) database, når den er sat op - ellers falder den tilbage
    // til den lokale fil som før.
    url: process.env.TURSO_DATABASE_URL || `file:${process.env.DATABASE_PATH || "./data/grenaa.db"}`,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
