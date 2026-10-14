/**
 * Shared Jira Cloud REST helpers.
 */

import { requestJson } from '../shared';

export function jiraBase(ctx: { credential: Record<string, any> }): string {
  const site = ctx.credential.site;
  if (!site) {
    throw new Error('Jira needs a site. Reconnect Jira from Plugins and include your site, e.g. "mycompany".');
  }
  let host = String(site).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!host.includes('.')) host = `${host}.atlassian.net`;
  return `https://${host}`;
}

export function jiraHeaders(ctx: { credential: Record<string, any> }): Record<string, string> {
  if (!ctx.credential.email || !ctx.credential.apiToken) {
    throw new Error('Jira needs an email and an API token. Reconnect Jira from Plugins.');
  }
  const basic = Buffer.from(`${ctx.credential.email}:${ctx.credential.apiToken}`).toString('base64');
  return { Authorization: `Basic ${basic}`, Accept: 'application/json' };
}

/** Flatten Atlassian Document Format to plain text. */
export function adfToText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (!Array.isArray(node.content)) return '';
  const text = node.content.map((child: any) => adfToText(child)).join('');
  return node.type === 'paragraph' || node.type === 'heading' ? `${text}\n` : text;
}

/** Plain text → ADF doc (multi-paragraph). */
export function plainTextDoc(text: string) {
  const paragraphs = String(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}|\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || all.length === 1);

  const content =
    paragraphs.length === 0
      ? [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]
      : paragraphs.map((line) => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        }));

  return { type: 'doc', version: 1, content };
}

export async function jiraAccount(
  base: string,
  headers: Record<string, string>
): Promise<{ name: string; email: string }> {
  const me = await requestJson(`${base}/rest/api/3/myself`, { headers });
  return { name: me.displayName || me.name || '', email: me.emailAddress || '' };
}

const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'priority', 'issuetype', 'project', 'updated'];

/** Try enhanced search, then classic — tenants disagree on payloads. */
export async function searchIssues(
  base: string,
  headers: Record<string, string>,
  jql: string,
  limit: number
): Promise<any> {
  const attempts: Array<{ url: string; body: Record<string, unknown> }> = [
    { url: `${base}/rest/api/3/search/jql`, body: { jql, maxResults: limit } },
    { url: `${base}/rest/api/3/search/jql`, body: { jql, maxResults: limit, fields: SEARCH_FIELDS } },
    {
      url: `${base}/rest/api/3/search`,
      body: { jql, maxResults: limit, startAt: 0, fields: SEARCH_FIELDS },
    },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      return await requestJson(attempt.url, { method: 'POST', headers, body: attempt.body });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);
      if (!/\(400\)|\(404\)|\(410\)/.test(message)) throw lastError;
    }
  }
  throw lastError ?? new Error('Jira search failed.');
}

export function preferredProject(args: Record<string, any>): string | null {
  const raw = args._preferredProject ?? args.preferred_project ?? args.project;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().toUpperCase();
}
