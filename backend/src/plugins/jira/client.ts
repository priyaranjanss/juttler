/**
 * Shared Jira Cloud REST helpers.
 */

import { isAuthFailure, requestJson, ToolContext } from '../shared';

type JiraContext = Pick<ToolContext, 'credential' | 'metadata' | 'refreshAccessToken'>;

export function jiraBase(ctx: JiraContext): string {
  const cloudId = ctx.metadata.cloudId;
  if (cloudId) {
    return `https://api.atlassian.com/ex/jira/${encodeURIComponent(String(cloudId))}`;
  }

  const site = ctx.credential.site;
  if (!site) {
    throw new Error('Jira needs an authorised site. Connect Jira from Plugins and grant access to a Jira site.');
  }
  let host = String(site).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!host.includes('.')) host = `${host}.atlassian.net`;
  return `https://${host}`;
}

export function jiraIssueUrl(ctx: JiraContext, issueKey: string): string {
  const siteUrl = ctx.metadata.siteUrl;
  const base = typeof siteUrl === 'string' && siteUrl
    ? siteUrl.replace(/\/+$/, '')
    : ctx.credential.site
      ? jiraBase(ctx)
      : '';
  return base ? `${base}/browse/${encodeURIComponent(issueKey)}` : '';
}

export function jiraHeaders(ctx: JiraContext): Record<string, string> {
  if (ctx.credential.token) {
    return {
      Authorization: `Bearer ${String(ctx.credential.token)}`,
      Accept: 'application/json',
    };
  }

  if (ctx.credential.email && ctx.credential.apiToken) {
    const basic = Buffer.from(`${ctx.credential.email}:${ctx.credential.apiToken}`).toString('base64');
    return { Authorization: `Basic ${basic}`, Accept: 'application/json' };
  }

  throw new Error('Jira needs an OAuth connection. Connect Jira from Plugins.');
}

interface JiraRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export async function jiraRequest(
  ctx: JiraContext,
  url: string,
  options: JiraRequestOptions = {}
): Promise<any> {
  const headers = () => ({ ...options.headers, ...jiraHeaders(ctx) });

  try {
    return await requestJson(url, { ...options, headers: headers() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const issueKey = url.match(/\/issue\/([^/?]+)/i)?.[1];
    if (issueKey && /\(404\)/.test(message)) {
      throw new Error(
        `Jira issue ${decodeURIComponent(issueKey)} was not found or is not visible to the connected account.`
      );
    }
    if (
      !ctx.credential.refreshToken ||
      !ctx.credential.token ||
      !isAuthFailure(message)
    ) {
      throw error;
    }

    const clientId = process.env.JIRA_CLIENT_ID;
    const clientSecret = process.env.JIRA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Jira access expired and token refresh is not configured. Reconnect Jira.');
    }

    const response = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: ctx.credential.refreshToken,
      }),
    });
    const token = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error_description?: string;
      error?: string;
    };
    if (!response.ok || !token.access_token) {
      const reason = token.error_description || token.error || `HTTP ${response.status}`;
      throw new Error(`Could not refresh the Jira OAuth token: ${reason}. Reconnect Jira.`);
    }

    ctx.credential.token = token.access_token;
    if (token.refresh_token) ctx.credential.refreshToken = token.refresh_token;
    await ctx.refreshAccessToken?.(token.access_token, token.refresh_token);
    return requestJson(url, { ...options, headers: headers() });
  }
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

const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'priority', 'issuetype', 'project', 'updated'];

/** Search enhanced JQL first, then the classic endpoint for older Jira sites. */
export async function searchIssues(
  ctx: JiraContext,
  jql: string,
  limit: number
): Promise<any> {
  const base = jiraBase(ctx);
  const attempts: Array<{ url: string; body: Record<string, unknown> }> = [
    { url: `${base}/rest/api/3/search/jql`, body: { jql, maxResults: limit, fields: SEARCH_FIELDS } },
    {
      url: `${base}/rest/api/3/search`,
      body: { jql, maxResults: limit, startAt: 0, fields: SEARCH_FIELDS },
    },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const result = await jiraRequest(ctx, attempt.url, { method: 'POST', body: attempt.body });
      if (!Array.isArray(result?.issues)) {
        throw new Error('Jira issue search returned an unexpected response (missing issues array).');
      }
      if (result.issues.length === 0 && Number(result.total) > 0) {
        throw new Error('Jira issue search returned a count but no issue records.');
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);
      const canTryFallback =
        /\(400\)|\(404\)|\(410\)/.test(message) ||
        /unexpected response|count but no issue records/i.test(message);
      if (!canTryFallback) throw lastError;
    }
  }
  throw lastError ?? new Error('Jira search failed.');
}

export function preferredProject(args: Record<string, any>): string | null {
  const raw = args._preferredProject ?? args.preferred_project ?? args.project;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().toUpperCase();
}
