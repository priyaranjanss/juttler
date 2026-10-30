/**
 * Jira tools over the connected site.
 */

import { optionalNumber, requiredString, ToolExecutor } from '../shared';
import {
  adfToText,
  jiraBase,
  jiraIssueUrl,
  jiraRequest,
  plainTextDoc,
  preferredProject,
  searchIssues,
} from './client';
import { normalizeJql } from './jql';
import { pickIssueKeyArg } from './keys';

type JiraToolContext = Parameters<ToolExecutor>[1];

/** Finds exactly one Jira user by account id, email, or display name. */
async function resolveJiraUser(ctx: JiraToolContext, who: string): Promise<{ accountId: string; displayName: string }> {
  const users = await jiraRequest(ctx, `${jiraBase(ctx)}/rest/api/3/user/search?query=${encodeURIComponent(who)}`);
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
  return { accountId: chosen.accountId, displayName: chosen.displayName || who };
}

function labelList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : String(value ?? '').split(',');
  return items.map((item) => String(item).trim().replace(/\s+/g, '-')).filter(Boolean);
}

/** Optional fields shared by create_ticket and update_ticket. */
async function optionalIssueFields(args: Record<string, any>, ctx: JiraToolContext): Promise<Record<string, any>> {
  const fields: Record<string, any> = {};
  if (typeof args.priority === 'string' && args.priority.trim()) fields.priority = { name: args.priority.trim() };
  if (args.labels !== undefined && args.labels !== null) fields.labels = labelList(args.labels);
  if (typeof args.due_date === 'string' && args.due_date.trim()) fields.duedate = args.due_date.trim();
  if (typeof args.parent === 'string' && args.parent.trim()) fields.parent = { key: args.parent.trim().toUpperCase() };
  if (typeof args.assignee === 'string' && args.assignee.trim()) {
    fields.assignee = { accountId: (await resolveJiraUser(ctx, args.assignee.trim())).accountId };
  }
  return fields;
}

function projectForCreate(args: Record<string, any>): string {
  const explicit =
    typeof args.project === 'string' && args.project.trim() ? args.project.trim().toUpperCase() : null;
  const project = explicit || preferredProject(args);
  if (!project) {
    throw new Error('project is required.');
  }
  return project;
}

export const jiraTools: Record<string, ToolExecutor> = {
  list_projects: async (_args, ctx) => {
    const base = jiraBase(ctx);
    const data = await jiraRequest(ctx, `${base}/rest/api/3/project/search?maxResults=50`);
    const projects = (data.values ?? []).map((project: any) => ({
      key: project.key,
      name: project.name,
      type: project.projectTypeKey,
    }));
    return {
      total: typeof data.total === 'number' ? data.total : projects.length,
      projects,
    };
  },

  search_tickets: async (args, ctx) => {
    const project = preferredProject(args);
    const jql = normalizeJql(args.jql, project);
    const limit = optionalNumber(args, 'max_results', 20, 100);
    const base = jiraBase(ctx);
    const found = await searchIssues(ctx, jql, limit);

    let total: number | undefined;
    try {
      const counted = await jiraRequest(ctx, `${base}/rest/api/3/search/approximate-count`, {
        method: 'POST',
        body: { jql },
      });
      if (typeof counted?.count === 'number') total = counted.count;
    } catch {
      // optional
    }

    const issues = found.issues.map((issue: any) => {
      const key = issue.key || issue.fields?.key;
      if (typeof key !== 'string' || !key) {
        throw new Error('Jira returned an issue without its key; refusing to guess issue identifiers.');
      }
      const fields = issue.fields ?? {};
      return {
        key,
        summary: fields.summary ?? issue.summary ?? '(no summary)',
        status: fields.status?.name ?? issue.status?.name ?? issue.status ?? 'Unknown',
        assignee: fields.assignee?.displayName ?? issue.assignee?.displayName ?? null,
        priority: fields.priority?.name ?? issue.priority?.name ?? null,
        project: fields.project?.key ?? issue.project?.key ?? key.split('-')[0],
        url: jiraIssueUrl(ctx, key),
      };
    });

    return {
      total: total ?? (typeof found.total === 'number' ? found.total : issues.length),
      returned: issues.length,
      jql,
      issues,
    };
  },

  get_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const base = jiraBase(ctx);
    const data = await jiraRequest(
      ctx,
      `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,reporter,priority,description,comment,issuetype,project,labels,duedate,parent,subtasks,issuelinks,created,updated`,
    );
    const fields = data.fields ?? {};
    const comments = (fields.comment?.comments ?? []).slice(-20).map((comment: any) => ({
      author: comment.author?.displayName,
      body: adfToText(comment.body).trim(),
      created: comment.created,
    }));
    return {
      key: data.key,
      summary: fields.summary,
      status: fields.status?.name,
      issue_type: fields.issuetype?.name,
      project: fields.project?.key,
      assignee: fields.assignee?.displayName ?? null,
      reporter: fields.reporter?.displayName ?? null,
      priority: fields.priority?.name,
      labels: fields.labels ?? [],
      due_date: fields.duedate ?? null,
      parent: fields.parent ? { key: fields.parent.key, summary: fields.parent.fields?.summary } : null,
      subtasks: (fields.subtasks ?? []).map((task: any) => ({
        key: task.key,
        summary: task.fields?.summary,
        status: task.fields?.status?.name,
      })),
      links: (fields.issuelinks ?? []).map((link: any) => {
        const other = link.outwardIssue ?? link.inwardIssue;
        return {
          type: link.outwardIssue ? link.type?.outward : link.type?.inward,
          key: other?.key,
          summary: other?.fields?.summary,
          status: other?.fields?.status?.name,
        };
      }),
      created: fields.created,
      updated: fields.updated,
      description: adfToText(fields.description).trim(),
      comments,
      url: jiraIssueUrl(ctx, data.key),
    };
  },

  create_ticket: async (args, ctx) => {
    const base = jiraBase(ctx);
    const project = projectForCreate(args);
    const data = await jiraRequest(ctx, `${base}/rest/api/3/issue`, {
      method: 'POST',
      body: {
        fields: {
          project: { key: project },
          summary: requiredString(args, 'summary'),
          issuetype: { name: args.issue_type ? String(args.issue_type) : 'Task' },
          ...(args.description ? { description: plainTextDoc(String(args.description)) } : {}),
          ...(await optionalIssueFields(args, ctx)),
        },
      },
    });
    return { created: true, key: data.key, url: jiraIssueUrl(ctx, data.key) };
  },

  update_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const fields: Record<string, any> = await optionalIssueFields(args, ctx);
    if (args.summary) fields.summary = String(args.summary);
    if (args.description) fields.description = plainTextDoc(String(args.description));
    if (Object.keys(fields).length === 0) {
      throw new Error('Nothing to update. Provide summary, description, priority, labels, due_date, parent, or assignee.');
    }
    await jiraRequest(ctx, `${jiraBase(ctx)}/rest/api/3/issue/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: { fields },
    });
    return { updated: true, key };
  },

  list_transitions: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const base = jiraBase(ctx);
    const data = await jiraRequest(ctx, `${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
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
    const transitions = await jiraRequest(ctx, `${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    const list = transitions.transitions ?? [];
    const match =
      list.find((t: any) => String(t.id) === wanted) ||
      list.find((t: any) => String(t.name || '').toLowerCase() === wanted) ||
      list.find((t: any) => String(t.to?.name || '').toLowerCase() === wanted);
    if (!match) {
      const available = list
        .map((t: any) => `${t.name}${t.to?.name ? ` → ${t.to.name}` : ''}`)
        .join(', ');
      throw new Error(`Transition "${args.transition}" is not available on ${key}. Available: ${available || 'none'}.`);
    }
    await jiraRequest(ctx, `${base}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
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
    const key = pickIssueKeyArg(args);
    const base = jiraBase(ctx);
    const data = await jiraRequest(ctx, `${base}/rest/api/3/issue/${encodeURIComponent(key)}/comment`, {
      method: 'POST',
      body: { body: plainTextDoc(requiredString(args, 'comment')) },
    });
    return { commented: true, key, comment_id: data.id, url: jiraIssueUrl(ctx, key) };
  },

  assign_ticket: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const who = requiredString(args, 'assignee');
    const user = await resolveJiraUser(ctx, who);
    await jiraRequest(ctx, `${jiraBase(ctx)}/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, {
      method: 'PUT',
      body: { accountId: user.accountId },
    });
    return { assigned: true, key, assignee: user.displayName };
  },

  find_users: async (args, ctx) => {
    const query = requiredString(args, 'query');
    const users = await jiraRequest(ctx, `${jiraBase(ctx)}/rest/api/3/user/search?query=${encodeURIComponent(query)}&maxResults=20`);
    return {
      users: (Array.isArray(users) ? users : [])
        .filter((user: any) => user.accountType !== 'app')
        .map((user: any) => ({
          account_id: user.accountId,
          name: user.displayName,
          email: user.emailAddress ?? null,
          active: user.active,
        })),
    };
  },

  get_project: async (args, ctx) => {
    const project = projectForCreate(args);
    const data = await jiraRequest(ctx, `${jiraBase(ctx)}/rest/api/3/project/${encodeURIComponent(project)}`);
    return {
      key: data.key,
      name: data.name,
      lead: data.lead?.displayName ?? null,
      issue_types: (data.issueTypes ?? []).map((type: any) => ({ name: type.name, subtask: Boolean(type.subtask) })),
      components: (data.components ?? []).map((component: any) => component.name),
    };
  },

  link_tickets: async (args, ctx) => {
    const key = pickIssueKeyArg(args);
    const other = String(args.other_issue_key ?? '').trim().toUpperCase();
    if (!other) throw new Error('other_issue_key is required.');
    const wanted = requiredString(args, 'link_type').toLowerCase();
    const base = jiraBase(ctx);
    const types = (await jiraRequest(ctx, `${base}/rest/api/3/issueLinkType`)).issueLinkTypes ?? [];
    const outward = types.find(
      (type: any) => String(type.name).toLowerCase() === wanted || String(type.outward).toLowerCase() === wanted
    );
    const inward = outward ? null : types.find((type: any) => String(type.inward).toLowerCase() === wanted);
    const type = outward ?? inward;
    if (!type) {
      const available = types.map((t: any) => `${t.name} (${t.outward} / ${t.inward})`).join(', ');
      throw new Error(`Unknown link type "${args.link_type}". Available: ${available || 'none'}.`);
    }
    // Jira stores "A <outward phrase> B" as inwardIssue A, outwardIssue B; issue_key is the subject of the phrase.
    const [inwardKey, outwardKey] = outward ? [key, other] : [other, key];
    await jiraRequest(ctx, `${base}/rest/api/3/issueLink`, {
      method: 'POST',
      body: { type: { name: type.name }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } },
    });
    return { linked: true, description: `${key} ${outward ? type.outward : type.inward} ${other}` };
  },
};
