/**
 * JQL normalization — bare keys and empty searches become valid filters.
 */

import { resolveIssueKey, stripKeyJunk } from './keys';

export function normalizeJql(raw: unknown, preferredProject?: string | null): string {
  const trimmed = stripKeyJunk(raw);
  const project = preferredProject?.trim().toUpperCase() || null;

  if (!trimmed) {
    return project
      ? `project = ${project} AND updated >= -120d ORDER BY updated DESC`
      : 'updated >= -120d ORDER BY updated DESC';
  }
  if (/^order\s+by\b/i.test(trimmed)) {
    const base = project ? `project = ${project} AND updated >= -120d` : 'updated >= -120d';
    return `${base} ${trimmed}`;
  }

  const asKey = resolveIssueKey(trimmed, preferredProject);
  if (
    asKey &&
    !/\b(AND|OR|NOT|ORDER|project|key|status|assignee|updated|created|text|summary|type|IN|=|~)\b/i.test(
      trimmed
    )
  ) {
    return `key = ${asKey}`;
  }

  // Free text containing exactly one key and no operators
  if (!/\b(AND|OR|NOT|ORDER|project|key|status|assignee|updated|created|text|summary|type|IN|=|~)\b/i.test(trimmed)) {
    const keys = [...trimmed.matchAll(/\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g)];
    if (keys.length === 1) return `key = ${keys[0][1].toUpperCase()}`;
  }

  return trimmed;
}
