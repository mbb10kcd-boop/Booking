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
const rawPath = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "grenaa.db");
const dir = path.dirname(rawPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const client = createClient({ url: `file:${rawPath}` });
await client.execute("PRAGMA journal_mode = WAL");
await client.execute("PRAGMA foreign_keys = ON");

export const db = drizzle(client, { schema });
export { schema };
