/**
 * Jira plugin - Jira Cloud REST API v3.
 *
 * Jira authenticates with a site + account email + API token (basic auth), so
 * those are the three fields asked for at connect time. Metadata in ./index.ts,
 * API calls in ./executor.ts.
 */

import { requiredString, optionalNumber, requestJson } from '../shared';
import { ToolExecutor } from '../shared';
import { normalizeJql, pickIssueKeyArg } from './jql';

/** Jira is per-site, so the base URL comes from the stored credential. */
function jiraBase(ctx: { credential: Record<string, any> }): string {
  const site = ctx.credential.site;
  if (!site) {
    throw new Error('Jira needs a site. Reconnect Jira from Plugins and include your site, e.g. "mycompany".');
  }
  let host = String(site).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!host.includes('.')) host = `${host}.atlassian.net`;
  return `https://${host}`;
}

/** Flattens Atlassian document JSON into plain text for the model. */
function adfToText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  if (!Array.isArray(node.content)) return '';
  const text = node.content.map((child: any) => adfToText(child)).join('');
  return node.type === 'paragraph' || node.type === 'heading' ? `${text}\n` : text;
}

function jiraHeaders(ctx: { credential: Record<string, any> }): Record<string, string> {
  if (!ctx.credential.email || !ctx.credential.apiToken) {
    throw new Error('Jira needs an email and an API token. Reconnect Jira from Plugins.');
  }
  const basic = Buffer.from(`${ctx.credential.email}:${ctx.credential.apiToken}`).toString('base64');
  return { Authorization: `Basic ${basic}`, Accept: 'application/json' };
}

/** Jira's v3 description/comment format (Atlassian Document Format). */
function plainTextDoc(text: string) {
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

async function jiraAccount(base: string, headers: Record<string, string>): Promise<{ name: string; email: string }> {
  const me = await requestJson(`${base}/rest/api/3/myself`, { headers });
  return { name: me.displayName || me.name || '', email: me.emailAddress || '' };
}

const SEARCH_FIELDS = ['summary', 'status', 'assignee', 'priority', 'issuetype', 'project', 'updated'];

/**
 * Jira Cloud tenants disagree on search payloads. Try enhanced search first,
 * then classic /search, so a 400 on one shape does not block ticket work.
 */
async function searchIssues(
  base: string,
  headers: Record<string, string>,
  jql: string,
  limit: number
): Promise<any> {
  const attempts: Array<{ url: string; body: Record<string, unknown> }> = [
    { url: `${base}/rest/api/3/search/jql`, body: { jql, maxResults: limit } },
    {
      url: `${base}/rest/api/3/search/jql`,
      body: { jql, maxResults: limit, fields: SEARCH_FIELDS },
    },
    {
      url: `${base}/rest/api/3/search`,
      body: { jql, maxResults: limit, startAt: 0, fields: SEARCH_FIELDS },
    },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      return await requestJson(attempt.url, {
        method: 'POST',
        headers,
        body: attempt.body,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(message);
      if (!/\(400\)|\(404\)|\(410\)/.test(message)) throw lastError;
    }
  }
  throw lastError ?? new Error('Jira search failed.');
}

/** Preferred project from work desk, if the gateway injected it. */
function preferredProject(args: Record<string, any>): string | null {
  const raw = args._preferredProject ?? args.preferred_project;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().toUpperCase();
}

export const jiraTools: Record<string, ToolExecutor> = {
  list_projects: async (_args, ctx) => {
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);
    const data = await requestJson(`${base}/rest/api/3/project/search?maxResults=50`, { headers });
    const projects = (data.values ?? []).map((project: any) => ({
      key: project.key,
      name: project.name,
      type: project.projectTypeKey,
    }));
    return {
      total: typeof data.total === 'number' ? data.total : projects.length,
      account: await jiraAccount(base, headers),
      projects,
    };
  },

  search_tickets: async (args, ctx) => {
    const jql = normalizeJql(args.jql, preferredProject(args));
    const limit = optionalNumber(args, 'max_results', 20, 100);
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);
    const found = await searchIssues(base, headers, jql, limit);
    let total: number | undefined;
    try {
      const counted = await requestJson(`${base}/rest/api/3/search/approximate-count`, {
        method: 'POST',
        headers,
        body: { jql },
      });
      if (typeof counted?.count === 'number') total = counted.count;
    } catch {
      // Count is optional; search results are enough to continue the ticket work.
    }
    const account = await jiraAccount(base, headers);
    const issues = (found.issues ?? []).map((issue: any) => ({
      key: issue.key,
      summary: issue.fields?.summary,
      status: issue.fields?.status?.name,
      assignee: issue.fields?.assignee?.displayName ?? null,
      priority: issue.fields?.priority?.name,
      project: issue.fields?.project?.key,
      url: `${base}/browse/${issue.key}`,
    }));
    return {
      total: total ?? (typeof found.total === 'number' ? found.total : issues.length),
      returned: issues.length,
      jql,
      account,
      issues,
      hint:
        issues.length === 1
          ? `Use jira.get_ticket with issue_key=${issues[0].key} to read the full description.`
          : undefined,
    };
  },

  create_ticket: async (args, ctx) => {
    const base = jiraBase(ctx);
    const project =
      (typeof args.project === 'string' && args.project.trim()
        ? args.project.trim().toUpperCase()
        : null) || preferredProject(args);
    if (!project) {
      throw new Error('project is required (e.g. ABC). Call jira.list_projects if unsure.');
    }
    const data = await requestJson(`${base}/rest/api/3/issue`, {
      method: 'POST',
      headers: jiraHeaders(ctx),
      body: {
        fields: {
          project: { key: project },
          summary: requiredString(args, 'summary'),
          issuetype: { name: args.issue_type ? String(args.issue_type) : 'Task' },
          ...(args.description ? { description: plainTextDoc(String(args.description)) } : {}),
        },
      },
    });
    return { created: true, key: data.key, url: `${base}/browse/${data.key}` };
  },

  update_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const fields: Record<string, any> = {};
    if (args.summary) fields.summary = String(args.summary);
    if (args.description) fields.description = plainTextDoc(String(args.description));
    if (Object.keys(fields).length === 0) {
      throw new Error('Nothing to update - provide summary or description.');
    }
    await requestJson(`${jiraBase(ctx)}/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: jiraHeaders(ctx),
      body: { fields },
    });
    return { updated: true, key };
  },

  list_transitions: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const base = jiraBase(ctx);
    const data = await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      headers: jiraHeaders(ctx),
    });
    const transitions = (data.transitions ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      to: t.to?.name ?? null,
    }));
    return { key, transitions };
  },

  change_status: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const wanted = requiredString(args, 'transition').trim().toLowerCase();
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);

    const transitions = await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      headers,
    });
    const list = transitions.transitions ?? [];
    const match =
      list.find((t: any) => String(t.name || '').toLowerCase() === wanted) ||
      list.find((t: any) => String(t.to?.name || '').toLowerCase() === wanted) ||
      list.find(
        (t: any) =>
          String(t.name || '').toLowerCase().includes(wanted) ||
          String(t.to?.name || '').toLowerCase().includes(wanted)
      );
    if (!match) {
      const available = list
        .map((t: any) => `${t.name}${t.to?.name ? ` → ${t.to.name}` : ''}`)
        .join(', ');
      throw new Error(
        `Transition "${args.transition}" is not available on ${key}. Available: ${available || 'none'}. Call jira.list_transitions first.`
      );
    }

    await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
      headers,
      body: { transition: { id: match.id } },
    });
    return {
      transitioned: true,
      key,
      transition: match.name,
      to: match.to?.name ?? null,
    };
  },

  get_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const base = jiraBase(ctx);
    const data = await requestJson(
      `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,priority,description,comment,issuetype,project`,
      { headers: jiraHeaders(ctx) }
    );
    const comments = (data.fields?.comment?.comments ?? []).slice(-8).map((comment: any) => ({
      author: comment.author?.displayName,
      body: adfToText(comment.body).trim(),
      created: comment.created,
    }));
    return {
      key: data.key,
      summary: data.fields?.summary,
      status: data.fields?.status?.name,
      issue_type: data.fields?.issuetype?.name,
      project: data.fields?.project?.key,
      assignee: data.fields?.assignee?.displayName ?? null,
      priority: data.fields?.priority?.name,
      description: adfToText(data.fields?.description).trim(),
      comments,
      url: `${base}/browse/${data.key}`,
    };
  },

  add_comment: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const base = jiraBase(ctx);
    const data = await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: 'POST',
      headers: jiraHeaders(ctx),
      body: { body: plainTextDoc(requiredString(args, 'comment')) },
    });
    return { commented: true, key, comment_id: data.id, url: `${base}/browse/${key}` };
  },

  assign_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const who = requiredString(args, 'assignee');
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);
    const users = await requestJson(`${base}/rest/api/3/user/search?query=${encodeURIComponent(who)}`, { headers });
    const list = Array.isArray(users) ? users : [];
    const needle = who.toLowerCase();
    const exact = list.find(
      (user: any) =>
        user.accountId === who ||
        String(user.emailAddress || '').toLowerCase() === needle ||
        String(user.displayName || '').toLowerCase() === needle
    );
    const chosen = exact || (list.length === 1 ? list[0] : null);
    if (!chosen?.accountId) {
      const names = list.map((user: any) => user.displayName).filter(Boolean).join(', ');
      throw new Error(`No single Jira user matched "${who}". Matches: ${names || 'none'}.`);
    }
    await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, {
      method: 'PUT',
      headers,
      body: { accountId: chosen.accountId },
    });
    return { assigned: true, key, assignee: chosen.displayName || who };
  },
};
