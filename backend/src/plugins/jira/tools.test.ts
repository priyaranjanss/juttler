import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { jiraTools } from './tools';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Jira search tools', () => {
  it('returns verified ticket details with links to the user Jira site', async () => {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/search/jql')) {
        return new Response(
          JSON.stringify({
            issues: [
              {
                key: 'ICS-12',
                fields: {
                  summary: 'Repair issue search',
                  status: { name: 'In Progress' },
                  assignee: { displayName: 'Sonal' },
                  priority: { name: 'High' },
                  project: { key: 'ICS' },
                },
              },
            ],
            total: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname.endsWith('/search/approximate-count')) {
        return new Response(JSON.stringify({ count: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected Jira request: ${url.pathname}`);
    }) as typeof fetch;

    const result = await jiraTools.search_tickets(
      { jql: 'project = ICS' },
      {
        credential: { token: 'access-token' },
        metadata: { cloudId: 'cloud-id', siteUrl: 'https://juttler.atlassian.net' },
      }
    );

    assert.deepEqual(result.issues, [
      {
        key: 'ICS-12',
        summary: 'Repair issue search',
        status: 'In Progress',
        assignee: 'Sonal',
        priority: 'High',
        project: 'ICS',
        url: 'https://juttler.atlassian.net/browse/ICS-12',
      },
    ]);
    assert.equal(result.total, 1);
    assert.equal(result.returned, 1);
  });

  it('refuses to fabricate issue keys when Jira omits them', async () => {
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/search/jql')) {
        return new Response(JSON.stringify({ issues: [{ fields: { summary: 'Keyless result' } }], total: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname.endsWith('/search/approximate-count')) {
        return new Response(JSON.stringify({ count: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected Jira request: ${url.pathname}`);
    }) as typeof fetch;

    await assert.rejects(
      () =>
        jiraTools.search_tickets(
          { jql: 'project = ICS' },
          {
            credential: { token: 'access-token' },
            metadata: { cloudId: 'cloud-id', siteUrl: 'https://juttler.atlassian.net' },
          }
        ),
      /without its key; refusing to guess/
    );
  });
});

describe('Jira link tool', () => {
  const ctx = {
    credential: { token: 'access-token' },
    metadata: { cloudId: 'cloud-id', siteUrl: 'https://juttler.atlassian.net' },
  };

  function captureLinks(): Array<Record<string, any>> {
    const posted: Array<Record<string, any>> = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/issueLinkType')) {
        return new Response(
          JSON.stringify({ issueLinkTypes: [{ name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname.endsWith('/issueLink')) {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
      }
      throw new Error(`Unexpected Jira request: ${url.pathname}`);
    }) as typeof fetch;
    return posted;
  }

  it('stores "A blocks B" with A as the inward issue', async () => {
    const posted = captureLinks();
    const result = await jiraTools.link_tickets(
      { issue_key: 'ICS-1', link_type: 'blocks', other_issue_key: 'ICS-2' },
      ctx
    );
    assert.deepEqual(posted[0], {
      type: { name: 'Blocks' },
      inwardIssue: { key: 'ICS-1' },
      outwardIssue: { key: 'ICS-2' },
    });
    assert.equal(result.description, 'ICS-1 blocks ICS-2');
  });

  it('stores "A is blocked by B" as B blocks A', async () => {
    const posted = captureLinks();
    await jiraTools.link_tickets(
      { issue_key: 'ICS-1', link_type: 'is blocked by', other_issue_key: 'ICS-2' },
      ctx
    );
    assert.deepEqual(posted[0], {
      type: { name: 'Blocks' },
      inwardIssue: { key: 'ICS-2' },
      outwardIssue: { key: 'ICS-1' },
    });
  });
});
