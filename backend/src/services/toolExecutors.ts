/**
 * Real tool execution. Every tool here makes a genuine HTTP call to the
 * service's own API using the credential the user connected. There are no
 * simulated results — if the call fails, the real error is surfaced so the
 * user can fix the cause.
 *
 * Credentials arrive as a decrypted JSON object whose shape depends on the
 * plugin (see route/pluginRoutes.ts connect handlers).
 */

export interface ToolContext {
  /** Decrypted credential object for this installation. */
  credential: Record<string, any>;
  /** Extra account info captured at connect time. */
  metadata: Record<string, any>;
}

export interface ToolOutcome {
  ok: boolean;
  result: any;
  durationMs: number;
  /**
   * True when the provider rejected the credential itself (401/403 or an
   * "invalid token" style message) rather than the request. The gateway uses
   * this to move the installation to needs_reauth.
   */
  authFailed?: boolean;
}

export type ToolExecutor = (args: Record<string, any>, ctx: ToolContext) => Promise<any>;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Treat these statuses as a normal failure rather than a thrown error. */
  okStatuses?: number[];
}

/** Renders an API error body into a readable line, whatever shape it arrives in. */
function describeErrorBody(parsed: unknown, fallback: string): string {
  if (typeof parsed === 'string') return parsed || fallback;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, any>;
    const candidate = obj.message ?? obj.error ?? obj.errors ?? obj.detail;
    if (typeof candidate === 'string') return candidate;
    if (candidate !== undefined) return JSON.stringify(candidate);
    if (Object.keys(obj).length === 0) return fallback;
    return JSON.stringify(obj);
  }
  return fallback;
}

async function requestJson(url: string, options: RequestOptions = {}): Promise<any> {
  const { method = 'GET', headers = {}, body } = options;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const path = new URL(url).pathname;
    const detail = describeErrorBody(parsed, text || res.statusText || 'unknown error');
    throw new Error(`${method} ${path} failed (${res.status}): ${detail}`);
  }

  return parsed;
}

/**
 * Reads a required parameter. Numbers and booleans are accepted and coerced to
 * a string, so a schema typed as "number" (e.g. pr_number) doesn't fail
 * validation just because it arrived as a JSON number.
 */
function requiredString(args: Record<string, any>, key: string): string {
  const raw = args[key];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  throw new Error(`Missing required parameter "${key}"`);
}

/** Reads a required numeric parameter. */
function requiredNumber(args: Record<string, any>, key: string): number {
  const raw = args[key];
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Missing required parameter "${key}" (expected a positive number)`);
  }
  return parsed;
}

function optionalNumber(args: Record<string, any>, key: string, fallback: number, max: number): number {
  const raw = args[key];
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/** Accepts "owner/name" or a full GitHub URL. */
function parseRepo(value: string): { owner: string; repo: string } {
  const cleaned = value.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  const [owner, repo, ...rest] = cleaned.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`"${value}" is not a repository. Use owner/name form, e.g. "octocat/Hello-World".`);
  }
  return { owner, repo };
}

function repoUrl(args: Record<string, any>, suffix = ''): string {
  const { owner, repo } = parseRepo(requiredString(args, 'repo'));
  return `https://api.github.com/repos/${owner}/${repo}${suffix}`;
}

// ---------------------------------------------------------------------------
// Web Search (Brave Search API)
// ---------------------------------------------------------------------------

const webSearch: ToolExecutor = async (args) => {
  const apiKey = args.__credential?.apiKey;
  if (!apiKey) {
    throw new Error('Web Search needs an API key. Open Plugins, connect Web Search, and paste a Brave Search API key.');
  }

  const query = requiredString(args, 'query');
  const count = optionalNumber(args, 'max_results', 5, 10);

  const data = await requestJson(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' } }
  );

  const results = (data?.web?.results ?? []).map((r: any) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));

  return { query, total: results.length, results };
};

// ---------------------------------------------------------------------------
// GitHub REST API
// ---------------------------------------------------------------------------

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'juttler-bot',
});

const github: Record<string, ToolExecutor> = {
  github_list_prs: async (args, ctx) => {
    // state is optional — the model may send only `repo`
    const state = typeof args.state === 'string' && args.state.trim() ? args.state.trim() : 'open';
    const data = await requestJson(`${repoUrl(args, '/pulls')}?state=${encodeURIComponent(state)}&per_page=30`, {
      headers: githubHeaders(ctx.credential.token),
    });
    return {
      repo: requiredString(args, 'repo'),
      state,
      total: data.length,
      pull_requests: data.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login,
        draft: pr.draft,
        url: pr.html_url,
        head: pr.head?.ref,
        base: pr.base?.ref,
        created_at: pr.created_at,
      })),
    };
  },

  github_get_file: async (args, ctx) => {
    const path = requiredString(args, 'path');
    const ref = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : '';
    const data = await requestJson(`${repoUrl(args, `/contents/${path}`)}${ref}`, {
      headers: githubHeaders(ctx.credential.token),
    });

    if (Array.isArray(data)) {
      return { path, type: 'dir', entries: data.map((e: any) => ({ name: e.name, type: e.type })) };
    }

    const content = data.content
      ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8')
      : null;
    return { path, type: 'file', size: data.size, truncated: Boolean(data.content === ''), content };
  },

  github_list_commits: async (args, ctx) => {
    const sha = args.sha ? `?sha=${encodeURIComponent(String(args.sha))}` : '';
    const data = await requestJson(`${repoUrl(args, '/commits')}${sha}&per_page=30`, {
      headers: githubHeaders(ctx.credential.token),
    });
    return {
      repo: requiredString(args, 'repo'),
      total: data.length,
      commits: data.map((c: any) => ({
        sha: c.sha,
        message: c.commit?.message?.split('\n')[0],
        author: c.commit?.author?.name,
        date: c.commit?.author?.date,
      })),
    };
  },

  github_create_issue: async (args, ctx) => {
    const labels = String(args.labels || '')
      .split(',')
      .map((l: string) => l.trim())
      .filter(Boolean);

    const data = await requestJson(repoUrl(args, '/issues'), {
      method: 'POST',
      headers: githubHeaders(ctx.credential.token),
      body: {
        title: requiredString(args, 'title'),
        body: args.body ? String(args.body) : '',
        ...(labels.length ? { labels } : {}),
      },
    });

    return { created: true, number: data.number, url: data.html_url, state: data.state };
  },

  github_comment_pr: async (args, ctx) => {
    const prNumber = requiredNumber(args, 'pr_number');
    const data = await requestJson(repoUrl(args, `/issues/${prNumber}/comments`), {
      method: 'POST',
      headers: githubHeaders(ctx.credential.token),
      body: { body: requiredString(args, 'comment') },
    });
    return { commented: true, pr_number: prNumber, comment_url: data.html_url };
  },

  github_create_branch: async (args, ctx) => {
    const branchName = requiredString(args, 'branch_name');
    const headers = githubHeaders(ctx.credential.token);

    // Resolve the base ref: an explicit branch/SHA wins, otherwise the
    // repository's default branch.
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const from = args.from ? String(args.from) : repoInfo.default_branch;
    if (!from) {
      throw new Error('Could not determine the default branch. Pass an explicit "from" branch or SHA.');
    }

    const ref = await requestJson(`${repoUrl(args, `/git/ref/heads/${from}`)}`, { headers });
    const baseSha: string = ref.object?.sha;
    if (!baseSha) {
      throw new Error(`Could not resolve branch "${from}" to a commit.`);
    }

    await requestJson(repoUrl(args, '/git/refs'), {
      method: 'POST',
      headers,
      body: { ref: `refs/heads/${branchName}`, sha: baseSha },
    });

    return { created: true, branch: branchName, from_sha: baseSha };
  },

  github_merge_pr: async (args, ctx) => {
    const prNumber = requiredNumber(args, 'pr_number');
    const data = await requestJson(repoUrl(args, `/pulls/${prNumber}/merge`), {
      method: 'PUT',
      headers: githubHeaders(ctx.credential.token),
      body: {
        commit_title: args.commit_title ? String(args.commit_title) : undefined,
        merge_method: 'squash',
      },
    });
    return { merged: Boolean(data.merged), sha: data.sha, message: data.message };
  },
};

// ---------------------------------------------------------------------------
// Jira Cloud REST API v3
// ---------------------------------------------------------------------------

function jiraBase(ctx: ToolContext): string {
  const site = ctx.credential.site;
  if (!site) {
    throw new Error('Jira needs a site. Reconnect Jira from Plugins and include your site, e.g. "mycompany".');
  }
  return `https://${String(site).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
}

function jiraHeaders(ctx: ToolContext): Record<string, string> {
  if (!ctx.credential.email || !ctx.credential.apiToken) {
    throw new Error('Jira needs an email and an API token. Reconnect Jira from Plugins.');
  }
  const basic = Buffer.from(`${ctx.credential.email}:${ctx.credential.apiToken}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

const jira: Record<string, ToolExecutor> = {
  jira_search_tickets: async (args, ctx) => {
    const jql = requiredString(args, 'jql');
    const limit = optionalNumber(args, 'max_results', 10, 50);
    const data = await requestJson(
      `${jiraBase(ctx)}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${limit}`,
      { headers: jiraHeaders(ctx) }
    );
    return {
      total: data.total,
      issues: (data.issues ?? []).map((i: any) => ({
        key: i.key,
        summary: i.fields?.summary,
        status: i.fields?.status?.name,
        assignee: i.fields?.assignee?.displayName,
        priority: i.fields?.priority?.name,
        url: `${jiraBase(ctx)}/browse/${i.key}`,
      })),
    };
  },

  jira_create_ticket: async (args, ctx) => {
    const data = await requestJson(`${jiraBase(ctx)}/rest/api/3/issue`, {
      method: 'POST',
      headers: jiraHeaders(ctx),
      body: {
        fields: {
          project: { key: requiredString(args, 'project') },
          summary: requiredString(args, 'summary'),
          issuetype: { name: args.issue_type ? String(args.issue_type) : 'Task' },
          ...(args.description ? { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: String(args.description) }] }] } } : {}),
        },
      },
    });
    return { created: true, key: data.key, url: `${jiraBase(ctx)}/browse/${data.key}` };
  },

  jira_update_ticket: async (args, ctx) => {
    const key = requiredString(args, 'issue_key');
    const fields: Record<string, any> = {};
    if (args.summary) fields.summary = String(args.summary);
    if (args.description) {
      fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: String(args.description) }] }] };
    }
    if (Object.keys(fields).length === 0) {
      throw new Error('Nothing to update — provide summary or description.');
    }
    await requestJson(`${jiraBase(ctx)}/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: jiraHeaders(ctx),
      body: { fields },
    });
    return { updated: true, key };
  },

  jira_change_status: async (args, ctx) => {
    const key = requiredString(args, 'issue_key');
    const transitionName = requiredString(args, 'transition');
    const headers = jiraHeaders(ctx);

    const transitions = await requestJson(`${jiraBase(ctx)}/rest/api/3/issue/${key}/transitions`, { headers });
    const match = (transitions.transitions ?? []).find(
      (t: any) => t.name.toLowerCase() === transitionName.toLowerCase()
    );
    if (!match) {
      const available = (transitions.transitions ?? []).map((t: any) => t.name).join(', ');
      throw new Error(`Transition "${transitionName}" not available. Available: ${available || 'none'}`);
    }

    await requestJson(`${jiraBase(ctx)}/rest/api/3/issue/${key}/transitions`, {
      method: 'POST',
      headers,
      body: { transition: { id: match.id } },
    });
    return { transitioned: true, key, to: transitionName };
  },
};

// ---------------------------------------------------------------------------
// Slack Web API
// ---------------------------------------------------------------------------

function slackHeaders(ctx: ToolContext): Record<string, string> {
  if (!ctx.credential.token) {
    throw new Error('Slack needs a bot token. Reconnect Slack from Plugins and paste an xoxb- token.');
  }
  return { Authorization: `Bearer ${ctx.credential.token}` };
}

const slack: Record<string, ToolExecutor> = {
  slack_list_channels: async (args, ctx) => {
    const limit = optionalNumber(args, 'limit', 100, 200);
    const data = await requestJson(
      `https://slack.com/api/conversations.list?limit=${limit}&exclude_archived=true`,
      { headers: slackHeaders(ctx) }
    );
    if (!data.ok) throw new Error(`Slack error: ${data.error}`);
    return {
      total: data.channels?.length ?? 0,
      channels: (data.channels ?? []).map((c: any) => ({ id: c.id, name: c.name, purpose: c.purpose?.value })),
    };
  },

  slack_search_messages: async (args, ctx) => {
    const query = requiredString(args, 'query');
    const count = optionalNumber(args, 'count', 20, 100);
    const data = await requestJson(
      `https://slack.com/api/search.messages?query=${encodeURIComponent(query)}&count=${count}`,
      { headers: slackHeaders(ctx) }
    );
    if (!data.ok) throw new Error(`Slack error: ${data.error}`);
    return {
      total: data.messages?.total ?? 0,
      messages: (data.messages?.matches ?? []).map((m: any) => ({
        user: m.user,
        channel: m.channel?.name,
        text: m.text,
        permalink: m.permalink,
      })),
    };
  },

  slack_send_message: async (args, ctx) => {
    const channel = requiredString(args, 'channel').replace(/^#/, '');
    const data = await requestJson('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: slackHeaders(ctx),
      body: { channel, text: requiredString(args, 'text') },
    });
    if (!data.ok) throw new Error(`Slack error: ${data.error}`);
    return { sent: true, channel, ts: data.ts, permalink: data.permalink ?? null };
  },
};

// ---------------------------------------------------------------------------
// Gmail API v1 (OAuth 2.0)
// ---------------------------------------------------------------------------

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function gmailHeaders(ctx: ToolContext): Record<string, string> {
  if (!ctx.credential.token) {
    throw new Error('Gmail needs an OAuth connection. Connect it from the Plugins dialog.');
  }
  return { Authorization: `Bearer ${ctx.credential.token}` };
}

/** Gmail returns quoted-printable-ish bodies across several shapes. */
function decodeGmailBody(payload: any): string {
  if (!payload) return '';

  const fromB64 = (data: string) => {
    try {
      return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch {
      return '';
    }
  };

  if (typeof payload.body?.data === 'string' && payload.body.data) {
    return fromB64(payload.body.data);
  }

  for (const part of payload.parts ?? []) {
    const nested = decodeGmailBody(part);
    if (nested) return nested;
  }
  return '';
}

function headerValue(headers: any[], name: string): string {
  const found = (headers ?? []).find((h: any) => String(h?.name).toLowerCase() === name);
  return found?.value || '';
}

/** Builds a minimal RFC 5322 message as Gmail expects it (base64url). */
function encodeMime(to: string, subject: string, body: string): string {
  const mime = [
    `To: ${to}`,
    `Subject: ${subject.replace(/[\r\n]+/g, ' ')}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const gmail: Record<string, ToolExecutor> = {
  gmail_list_emails: async (args, ctx) => {
    const query = requiredString(args, 'query');
    const limit = optionalNumber(args, 'max_results', 10, 50);
    const headers = gmailHeaders(ctx);

    const list = await requestJson(
      `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
      { headers }
    );

    const ids: string[] = (list.messages ?? []).map((m: any) => m.id).filter(Boolean);
    if (ids.length === 0) {
      return { query, total: 0, messages: [] };
    }

    // Fetch each message's metadata (bounded by `limit`)
    const messages = await Promise.all(
      ids.map(async (id) => {
        const msg = await requestJson(
          `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers }
        );
        return {
          id,
          subject: headerValue(msg.payload?.headers, 'subject'),
          from: headerValue(msg.payload?.headers, 'from'),
          date: headerValue(msg.payload?.headers, 'date'),
          snippet: msg.snippet,
          unread: (msg.labelIds ?? []).includes('UNREAD'),
        };
      })
    );

    return { query, total: messages.length, messages };
  },

  gmail_get_message: async (args, ctx) => {
    const id = requiredString(args, 'message_id');
    const msg = await requestJson(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=full`, {
      headers: gmailHeaders(ctx),
    });

    return {
      id,
      subject: headerValue(msg.payload?.headers, 'subject'),
      from: headerValue(msg.payload?.headers, 'from'),
      to: headerValue(msg.payload?.headers, 'to'),
      date: headerValue(msg.payload?.headers, 'date'),
      body: decodeGmailBody(msg.payload).slice(0, 8000),
      labels: msg.labelIds ?? [],
    };
  },

  gmail_send_email: async (args, ctx) => {
    const to = requiredString(args, 'to');
    const subject = requiredString(args, 'subject');
    const body = requiredString(args, 'body');

    const sent = await requestJson(`${GMAIL_BASE}/messages/send`, {
      method: 'POST',
      headers: gmailHeaders(ctx),
      body: { raw: encodeMime(to, subject, body) },
    });

    return { sent: true, to, subject, id: sent.id, threadId: sent.threadId ?? null };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Executors keyed by plugin slug, then by tool name. */
const EXECUTORS: Record<string, Record<string, ToolExecutor>> = {
  'web-search': { web_search: webSearch },
  github,
  jira,
  slack,
  gmail,
};

/** Plugin slug -> tool name -> executor. Built so callers only need the tool. */
const TOOL_REGISTRY = new Map<string, { slug: string; run: ToolExecutor }>();
for (const [slug, tools] of Object.entries(EXECUTORS)) {
  for (const [toolName, run] of Object.entries(tools)) {
    TOOL_REGISTRY.set(toolName, { slug, run });
  }
}

/** Every tool the backend can actually execute, with its plugin slug. */
export const SUPPORTED_TOOLS = Array.from(TOOL_REGISTRY.entries()).map(([toolName, entry]) => ({
  toolName,
  pluginSlug: entry.slug,
}));

export function getToolExecutor(toolName: string) {
  return TOOL_REGISTRY.get(toolName);
}

/** Recognises "your credential is bad" rather than "your request was bad". */
function isAuthFailure(message: string): boolean {
  if (/\(40[13]\)/.test(message)) return true;
  return /invalid[_ ]?(credentials|auth|token)|\bunauthorized\b|\bbad credentials\b|authentication token is invalid/i.test(
    message
  );
}

export async function runTool(toolName: string, args: Record<string, any>, ctx: ToolContext): Promise<ToolOutcome> {
  const started = Date.now();
  const entry = getToolExecutor(toolName);

  if (!entry) {
    return {
      ok: false,
      result: { error: `No executor is available for tool "${toolName}".` },
      durationMs: Date.now() - started,
    };
  }

  try {
    // The credential is passed through so executors can read fields off it
    // (web_search reads its key from here; the others use ctx.credential).
    const result = await entry.run({ ...args, __credential: ctx.credential }, ctx);
    return { ok: true, result, durationMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      result: { error: message },
      durationMs: Date.now() - started,
      authFailed: isAuthFailure(message),
    };
  }
}
