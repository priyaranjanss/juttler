import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The backend reads a single env file: backend/.env
// The Neon CLI keeps DATABASE_URL fresh in it via: neon env pull --file backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run `neon link` / `neon deploy` at the repo root to pull it into .env.local.'
  );
}

export const sql = neon(databaseUrl);

export function isDatabaseConfigured(): boolean {
  return Boolean(databaseUrl);
}
