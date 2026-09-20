import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "path";
import fs from "fs";
import * as schema from "./schema";

// Beslutning: libsql (i stedet for better-sqlite3) som SQLite-driver.
// better-sqlite3 kræver at blive kompileret lokalt (node-gyp + Python + C++
// build tools) på maskiner uden et allerede-downloadet prebuilt binary, hvilket
// fejler ofte på almindelige Windows-arbejdscomputere (manglende Python/VS
// Build Tools, eller en firewall der blokerer download af prebuilts fra
// GitHub). libsql henter i stedet et prebuilt binary som en almindelig
// npm-pakke (samme kanal som alle andre pakker), hvilket er langt mere
// robust på tværs af maskiner/netværk. Se ARKITEKTUR.md afsnit 1.
// VIGTIGT (opdaget under drift): Render's gratis plan har ingen persistent
// disk (kun "Starter"-planen og opefter understøtter det). Uden en ekstern
// database-URL bor SQLite-filen derfor kun på containerens midlertidige
// filsystem, som nulstilles ved hver deploy OG ved genstart efter
// inaktivitet - dvs. ALLE rigtige bookinger/dagsnoter/indbakke-data forsvinder
// før eller siden, uanset seed-scriptet. Sæt TURSO_DATABASE_URL (og evt.
// TURSO_AUTH_TOKEN) som miljøvariabel på Render for at bruge en ekte
// persistent libsql-database i stedet (fx en gratis Turso-database) - ingen
// kodeændring nødvendig udover det. Se ARKITEKTUR.md.
const remoteUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

let client;
if (remoteUrl) {
  client = createClient({ url: remoteUrl, authToken });
} else {
  const rawPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "grenaa.db");
  const dir = path.dirname(rawPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  client = createClient({ url: `file:${rawPath}` });
  // WAL-tilstand er kun relevant for en lokal fil (en ekstern libsql/Turso-
  // server styrer selv sin lagring og understøtter ikke nødvendigvis denne
  // PRAGMA over netværket).
  await client.execute("PRAGMA journal_mode = WAL");
}
await client.execute("PRAGMA foreign_keys = ON");

export const db = drizzle(client, { schema });
export { schema };
