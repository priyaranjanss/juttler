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
  return { Authorization: `Basic ${basic}` };
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
    const jql = typeof args.jql === 'string' && args.jql.trim()
      ? args.jql.trim()
      : 'created >= "1970-01-01" ORDER BY updated DESC';
    const limit = optionalNumber(args, 'max_results', 20, 100);
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);
    const [found, counted, account] = await Promise.all([
      requestJson(`${base}/rest/api/3/search/jql`, {
        method: 'POST',
        headers,
        body: {
          jql,
          maxResults: limit,
          fields: ['summary', 'status', 'assignee', 'priority', 'issuetype', 'project'],
        },
      }),
      requestJson(`${base}/rest/api/3/search/approximate-count`, {
        method: 'POST',
        headers,
        body: { jql },
      }),
      jiraAccount(base, headers),
    ]);
    const issues = (found.issues ?? []).map((issue: any) => ({
      key: issue.key,
      summary: issue.fields?.summary,
      status: issue.fields?.status?.name,
      assignee: issue.fields?.assignee?.displayName ?? null,
      priority: issue.fields?.priority?.name,
      project: issue.fields?.project?.key,
      url: `${base}/browse/${issue.key}`,
    }));
    const total = typeof counted?.count === 'number' ? counted.count : issues.length;
    return {
      total,
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
          project: { key: requiredString(args, 'project') },
          summary: requiredString(args, 'summary'),
          issuetype: { name: args.issue_type ? String(args.issue_type) : 'Task' },
          ...(args.description ? { description: plainTextDoc(String(args.description)) } : {}),
        },
      },
    });
    return { created: true, key: data.key, url: `${base}/browse/${data.key}` };
  },

  update_ticket: async (args, ctx) => {
    const key = requiredString(args, 'issue_key');
    const fields: Record<string, any> = {};
    if (args.summary) fields.summary = String(args.summary);
    if (args.description) fields.description = plainTextDoc(String(args.description));
    if (Object.keys(fields).length === 0) {
      throw new Error('Nothing to update - provide summary or description.');
    }
    await requestJson(`${jiraBase(ctx)}/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: jiraHeaders(ctx),
      body: { fields },
    });
    return { updated: true, key };
  },

  change_status: async (args, ctx) => {
    const key = requiredString(args, 'issue_key');
    const transitionName = requiredString(args, 'transition');
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);

    // Jira transitions are per-workflow, so look the name up to get its id.
    const transitions = await requestJson(`${base}/rest/api/3/issue/${key}/transitions`, { headers });
    const match = (transitions.transitions ?? []).find(
      (t: any) => t.name.toLowerCase() === transitionName.toLowerCase()
    );
    if (!match) {
      const available = (transitions.transitions ?? []).map((t: any) => t.name).join(', ');
      throw new Error(`Transition "${transitionName}" not available. Available: ${available || 'none'}`);
    }

    await requestJson(`${base}/rest/api/3/issue/${key}/transitions`, {
      method: 'POST',
      headers,
      body: { transition: { id: match.id } },
    });
    return { transitioned: true, key, to: transitionName };
  },

  get_ticket: async (args, ctx) => {
    const key = requiredString(args, 'issue_key');
    const base = jiraBase(ctx);
    const data = await requestJson(
      `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,priority,description,comment`,
      { headers: jiraHeaders(ctx) }
    );
    const comments = (data.fields?.comment?.comments ?? []).slice(-5).map((comment: any) => ({
      author: comment.author?.displayName,
      body: adfToText(comment.body).trim(),
      created: comment.created,
    }));
    return {
      key: data.key,
      summary: data.fields?.summary,
      status: data.fields?.status?.name,
      assignee: data.fields?.assignee?.displayName ?? null,
      priority: data.fields?.priority?.name,
      description: adfToText(data.fields?.description).trim(),
      comments,
      url: `${base}/browse/${data.key}`,
    };
  },

  add_comment: async (args, ctx) => {
    const key = requiredString(args, 'issue_key');
    const base = jiraBase(ctx);
    const data = await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: 'POST',
      headers: jiraHeaders(ctx),
      body: { body: plainTextDoc(requiredString(args, 'comment')) },
    });
    return { commented: true, key, comment_id: data.id, url: `${base}/browse/${key}` };
  },

  assign_ticket: async (args, ctx) => {
    const key = requiredString(args, 'issue_key');
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
