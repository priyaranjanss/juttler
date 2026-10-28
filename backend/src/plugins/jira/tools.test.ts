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
