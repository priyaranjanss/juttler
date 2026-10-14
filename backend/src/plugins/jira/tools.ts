/**
 * Jira tools — full ticket agent over the connected site.
 * Prefer get_ticket when a key is known; search when exploring.
 */

import { optionalNumber, requiredString, requestJson, ToolExecutor } from '../shared';
import {
  adfToText,
  jiraAccount,
  jiraBase,
  jiraHeaders,
  plainTextDoc,
  preferredProject,
  searchIssues,
} from './client';
import { normalizeJql } from './jql';
import { pickIssueKeyArg } from './keys';

function projectForCreate(args: Record<string, any>): string {
  const explicit =
    typeof args.project === 'string' && args.project.trim() ? args.project.trim().toUpperCase() : null;
  const project = explicit || preferredProject(args);
  if (!project) {
    throw new Error('project is required (e.g. ABC). Call list_projects if unsure.');
  }
  return project;
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
    const project = preferredProject(args);
    const jql = normalizeJql(args.jql, project);
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
      // optional
    }

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
      account: await jiraAccount(base, headers),
      issues,
      next:
        issues.length === 1
          ? `Call get_ticket with issue_key=${issues[0].key} to read the full description.`
          : issues.length > 1
            ? 'Call get_ticket with the issue_key you want to work on.'
            : 'No issues matched. Broaden jql or list_projects.',
    };
  },

  get_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args, preferredProject(args));
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
      next: 'Implement the described work with GitHub tools (search_code → get_file → edit_file → create_pull_request), then optionally add_comment with the PR link.',
    };
  },

  create_ticket: async (args, ctx) => {
    const base = jiraBase(ctx);
    const project = projectForCreate(args);
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
    const key = pickIssueKeyArg(args, preferredProject(args));
    const fields: Record<string, any> = {};
    if (args.summary) fields.summary = String(args.summary);
    if (args.description) fields.description = plainTextDoc(String(args.description));
    if (Object.keys(fields).length === 0) {
      throw new Error('Nothing to update — provide summary or description.');
    }
    await requestJson(`${jiraBase(ctx)}/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: jiraHeaders(ctx),
      body: { fields },
    });
    return { updated: true, key };
  },

  list_transitions: async (args, ctx) => {
    const key = pickIssueKeyArg(args, preferredProject(args));
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
    const key = pickIssueKeyArg(args, preferredProject(args));
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
        `Transition "${args.transition}" is not available on ${key}. Available: ${available || 'none'}. Call list_transitions first.`
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

  add_comment: async (args, ctx) => {
    const key = pickIssueKeyArg(args, preferredProject(args));
    const base = jiraBase(ctx);
    const data = await requestJson(`${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: 'POST',
      headers: jiraHeaders(ctx),
      body: { body: plainTextDoc(requiredString(args, 'comment')) },
    });
    return { commented: true, key, comment_id: data.id, url: `${base}/browse/${key}` };
  },

  assign_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args, preferredProject(args));
    const who = requiredString(args, 'assignee');
    const base = jiraBase(ctx);
    const headers = jiraHeaders(ctx);
    const users = await requestJson(`${base}/rest/api/3/user/search?query=${encodeURIComponent(who)}`, {
      headers,
    });
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
