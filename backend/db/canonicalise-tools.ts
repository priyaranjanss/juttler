/**
 * Rewrites legacy tool names in bot_plugin_access.enabled_tools to canonical
 * "<plugin_slug>.<tool_name>" ids, using the registry as the source of truth.
 *
 * This is a cleanup, not a fix: reads already normalise any spelling through
 * the registry, so old grants keep working either way. Running this makes the
 * stored data match what new writes produce, so there is only one convention
 * in the database.
 *
 * The registry is the only mapping used, so new plugins need no change here.
 *
 * Run: node --import tsx db/canonicalise-tools.ts
 */

import { fileURLToPath } from 'url';
import { Pool } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

import { canonicalToolId } from '../src/plugins';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });

  // Snapshot the valid ids once, used only to report anything unmapped.
  let rewritten = 0;
  const unmapped = new Set<string>();

  try {
    const rows = (await pool.query('select id, enabled_tools from bot_plugin_access')) as unknown as {
      rows: Array<{ id: string; enabled_tools: string[] }>;
    };

    for (const row of rows.rows) {
      const current = row.enabled_tools ?? [];
      const next: string[] = [];
      let changed = false;

      for (const name of current) {
        const canonical = canonicalToolId(name);
        if (!canonical) {
          // Unknown names are kept as-is rather than dropped, so nothing is
          // silently lost; they will still resolve (or not) at read time.
          unmapped.add(name);
          next.push(name);
          continue;
        }
        if (canonical !== name) changed = true;
        if (!next.includes(canonical)) next.push(canonical);
      }

      if (!changed) continue;

      await pool.query('update bot_plugin_access set enabled_tools = $1 where id = $2', [next, row.id]);
      rewritten += 1;
    }

    console.log(`✓ Canonicalised ${rewritten} bot tool grant(s).`);
    if (unmapped.size > 0) {
      console.log(
        `! ${unmapped.size} stored name(s) matched no registered tool and were left untouched: ` +
          [...unmapped].join(', ')
      );
    }
  } catch (err) {
    console.error('✗ Canonicalisation failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
