import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { User } from '../../../frontend/src/types/index';
import { sql } from '../config/db';
import { generateId } from '../utils/id';

export type UserRecord = User & { passwordHash: string };

interface UserRow {
  id: string;
  clerk_id: string | null;
  name: string;
  email: string;
  password_hash: string | null;
  role: string;
  avatar: string;
  status: string;
  created_at: Date;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expected] = storedHash.split(':');
  if (!salt || !expected) return false;
  const candidate = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
}

export function toSafeUser(record: UserRecord): User {
  const { passwordHash: _passwordHash, ...safeUser } = record;
  return safeUser;
}

function mapRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as 'admin' | 'user',
    avatar: row.avatar,
    status: row.status as 'active' | 'disabled',
    createdAt: row.created_at.toISOString(),
    passwordHash: row.password_hash || '',
  };
}

// ---------------------------------------------------------------------------
// Auth tokens are issued and verified as stateless HS256 JWTs.
// See config/jwt.ts — there is deliberately no server-side session store.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// User queries
// ---------------------------------------------------------------------------

export async function listUsers(): Promise<User[]> {
  const rows = (await sql`select * from users order by created_at asc`) as unknown as UserRow[];
  return rows.map((row) => toSafeUser(mapRow(row)));
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const rows = (await sql`select * from users where lower(email) = lower(${email.trim()}) limit 1`) as unknown as UserRow[];
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const rows = (await sql`select * from users where id = ${id} limit 1`) as unknown as UserRow[];
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function emailExists(email: string): Promise<boolean> {
  const rows = await sql`select 1 from users where lower(email) = lower(${email.trim()}) limit 1`;
  return rows.length > 0;
}

export async function countUsers(): Promise<number> {
  const rows = await sql`select count(*)::int as n from users`;
  return rows[0].n;
}

export async function createUserRecord(data: {
  name: string;
  email: string;
  role: 'admin' | 'user';
  passwordHash?: string | null;
  avatar?: string;
}): Promise<UserRecord> {
  const rows = (await sql`
    insert into users (id, name, email, password_hash, role, avatar)
    values (${generateId('usr_')}, ${data.name}, ${data.email.toLowerCase()}, ${data.passwordHash ?? null}, ${data.role}, ${data.avatar ?? ''})
    returning *
  `) as unknown as UserRow[];
  return mapRow(rows[0]);
}

export async function updateUserRecord(
  id: string,
  updates: { status?: 'active' | 'disabled'; role?: 'admin' | 'user' }
): Promise<User | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status');
    values.push(updates.status);
  }
  if (updates.role !== undefined) {
    fields.push('role');
    values.push(updates.role);
  }

  if (fields.length === 0) {
    const existing = await findUserById(id);
    return existing ? toSafeUser(existing) : null;
  }

  const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
  const rows = (await sql.query(`update users set ${setClause} where id = $${fields.length + 1} returning *`, [
    ...values,
    id,
  ])) as unknown as UserRow[];

  return rows.length > 0 ? toSafeUser(mapRow(rows[0])) : null;
}
