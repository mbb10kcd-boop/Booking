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

// VIGTIGT (opdaget under drift #2): Next.js' build-trin "Collecting page
// data" starter op til ~38 parallelle worker-processer, som HVER importerer
// denne fil og dermed forsøger at åbne/konfigurere samme lokale SQLite-fil
// samtidigt. Uden en busy-timeout kan SQLite øjeblikkeligt fejle med
// "SQLITE_BUSY: database is locked", hvis to workere rammer filen i samme
// millisekund - det fik hele builds til at fejle tilfældigt (særligt ved
// "Clear build cache & deploy", hvor ALLE ruter genberegnes på én gang, så
// alle 38 workere rammer filen next-to-simultant). safePragma sætter derfor
// en busy_timeout, så SQLite selv venter og prøver igen internt i stedet for
// at fejle med det samme, og prøver derudover selve PRAGMA-kaldet igen med
// kort pause, hvis det alligevel skulle fejle.
async function safePragma(
  target: { execute: (sql: string) => Promise<unknown> },
  sql: string,
  retries = 5,
) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await target.execute(sql);
      return;
    } catch (err) {
      const isBusy = err instanceof Error && /SQLITE_BUSY|database is locked/i.test(err.message);
      if (isBusy && attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      if (isBusy) {
        // Sidste forsøg fejlede stadig - log og fortsæt alligevel; disse
        // PRAGMA-indstillinger er "best effort" optimeringer/indstillinger,
        // ikke et krav for i øvrigt at kunne læse/skrive data.
        console.warn(
          `PRAGMA-kald "${sql}" fejlede efter ${retries} forsøg (databasen var låst) - fortsætter alligevel.`,
        );
        return;
      }
      throw err;
    }
  }
}

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
  await safePragma(client, "PRAGMA busy_timeout = 5000");
  await safePragma(client, "PRAGMA journal_mode = WAL");
}
await safePragma(client, "PRAGMA foreign_keys = ON");

export const db = drizzle(client, { schema });
export { schema };
