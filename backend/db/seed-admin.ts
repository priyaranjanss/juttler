import { Pool } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, scryptSync } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set in backend/.env');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

async function seedAdmin() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: npm run seed:admin <email> <password>');
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('Password must be at least 6 characters');
    process.exit(1);
  }

  console.log(`🌱 Seeding admin user: ${email}`);
  try {
    const existing = await pool.query('select 1 from users where lower(email) = lower($1) limit 1', [email]);
    if (existing.rows.length > 0) {
      console.error('✗ User with this email already exists');
      process.exit(1);
    }

    const passwordHash = hashPassword(password);
    const id = `usr_${randomBytes(16).toString('hex')}`;

    await pool.query(
      `insert into users (id, name, email, password_hash, role, avatar)
       values ($1, $2, $3, $4, 'admin', '')
       returning id, name, email, role, created_at`,
      [id, email.split('@')[0], email.toLowerCase(), passwordHash]
    );

    console.log('✓ Admin user created successfully');
  } catch (err) {
    console.error('✗ Seed failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedAdmin();