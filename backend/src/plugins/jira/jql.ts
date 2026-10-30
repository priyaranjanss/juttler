/**
 * JQL cleanup. The model writes the query; an empty one lists recent issues,
 * scoped to the bot's configured project when it has one.
 */

import { stripKeyJunk } from './keys';

export function normalizeJql(raw: unknown, preferredProject?: string | null): string {
  const trimmed = stripKeyJunk(raw);
  if (trimmed) return trimmed;

  const project = preferredProject?.trim().toUpperCase() || null;
  return project ? `project = ${project} ORDER BY updated DESC` : 'ORDER BY updated DESC';
}
