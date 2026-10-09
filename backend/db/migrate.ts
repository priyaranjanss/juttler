import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { Pool } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The backend reads a single env file: backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Run `neon link` / `neon deploy` at the repo root first.');
  process.exit(1);
}

const schema = readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');

const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(schema);
  console.log('✓ Migration complete — schema applied to Neon Postgres');
} catch (err) {
  console.error('✗ Migration failed:', err);
  process.exit(1);
} finally {
  await pool.end();
}
