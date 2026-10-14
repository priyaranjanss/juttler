/**
 * Jira plugin - Jira Cloud REST API v3.
 *
 * Jira authenticates with a site + account email + API token (basic auth), so
 * those are the three fields asked for at connect time. Metadata in ./index.ts,
 * API calls in ./executor.ts.
 */

import { requiredString, optionalNumber, requestJson } from '../shared';
import { ToolExecutor } from '../shared';

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

/** Issue keys are uppercase (ICS-9). Lowercase ics-9 often 404s. */
function issueKey(value: string): string {
  return value.trim().toUpperCase();
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

/** Jira's v3 description format (Atlassian Document Format). */
function plainTextDoc(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

async function jiraAccount(base: string, headers: Record<string, string>): Promise<{ name: string; email: string }> {
  const me = await requestJson(`${base}/rest/api/3/myself`, { headers });
  return { name: me.displayName || me.name || '', email: me.emailAddress || '' };
}

/**
 * Enhanced search rejects unbounded JQL with 400.
 * Always include at least one real filter clause.
 */
function boundedJql(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return 'updated >= -120d ORDER BY updated DESC';
  // Bare ORDER BY / empty filters are unbounded.
  if (/^order\s+by\b/i.test(trimmed)) return `updated >= -120d ${trimmed}`;
  return trimmed;
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
    const jql = boundedJql(args.jql);
    const limit = optionalNumber(args, 'max_results', 20, 100);
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);
    const found = await requestJson(`${base}/rest/api/3/search/jql`, {
      method: 'POST',
      headers,
      body: {
        jql,
        maxResults: limit,
        fields: ['summary', 'status', 'assignee', 'priority', 'issuetype', 'project', 'updated'],
      },
    });
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
      total: total ?? issues.length,
      returned: issues.length,
      jql,
      account,
      issues,
    };
  },

  create_ticket: async (args, ctx) => {
    const base = jiraBase(ctx);
    const data = await requestJson(`${base}/rest/api/3/issue`, {
      method: 'POST',
      headers: jiraHeaders(ctx),
      body: {
        fields: {
          project: { key: requiredString(args, 'project').toUpperCase() },
          summary: requiredString(args, 'summary'),
          issuetype: { name: args.issue_type ? String(args.issue_type) : 'Task' },
          ...(args.description ? { description: plainTextDoc(String(args.description)) } : {}),
        },
      },
    });
    return { created: true, key: data.key, url: `${base}/browse/${data.key}` };
  },

  update_ticket: async (args, ctx) => {
    const key = issueKey(requiredString(args, 'issue_key'));
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
    const key = issueKey(requiredString(args, 'issue_key'));
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
    const key = issueKey(requiredString(args, 'issue_key'));
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
    const key = issueKey(requiredString(args, 'issue_key'));
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
    const key = issueKey(requiredString(args, 'issue_key'));
    const base = jiraBase(ctx);
    const data = await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: 'POST',
      headers: jiraHeaders(ctx),
      body: { body: plainTextDoc(requiredString(args, 'comment')) },
    });
    return { commented: true, key, comment_id: data.id, url: `${base}/browse/${key}` };
  },

  assign_ticket: async (args, ctx) => {
    const key = issueKey(requiredString(args, 'issue_key'));
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
