import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { jiraBase, jiraHeaders, jiraRequest, searchIssues } from './client';

const originalFetch = globalThis.fetch;
const originalClientId = process.env.JIRA_CLIENT_ID;
const originalClientSecret = process.env.JIRA_CLIENT_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalClientId === undefined) delete process.env.JIRA_CLIENT_ID;
  else process.env.JIRA_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.JIRA_CLIENT_SECRET;
  else process.env.JIRA_CLIENT_SECRET = originalClientSecret;
});

describe('Jira OAuth client', () => {
  it('uses the authorised Jira cloud site and bearer token', () => {
    const ctx = {
      credential: { token: 'access-token' },
      metadata: { cloudId: 'cloud-id', siteUrl: 'https://example.atlassian.net' },
    };

    assert.equal(jiraBase(ctx), 'https://api.atlassian.com/ex/jira/cloud-id');
    assert.equal(jiraHeaders(ctx).Authorization, 'Bearer access-token');
  });

  it('refreshes expired tokens and persists the rotated refresh token', async () => {
    process.env.JIRA_CLIENT_ID = 'client-id';
    process.env.JIRA_CLIENT_SECRET = 'client-secret';

    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url === 'https://auth.atlassian.com/oauth/token') {
        return new Response(
          JSON.stringify({ access_token: 'fresh-access-token', refresh_token: 'rotated-refresh-token' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (requests.filter((request) => request.url === url).length === 1) {
        return new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ value: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const persisted: Array<[string, string | undefined]> = [];
    const ctx = {
      credential: { token: 'expired-token', refreshToken: 'old-refresh-token' },
      metadata: { cloudId: 'cloud-id' },
      refreshAccessToken: async (token: string, refreshToken?: string) => {
        persisted.push([token, refreshToken]);
      },
    };

    const result = await jiraRequest(ctx, `${jiraBase(ctx)}/rest/api/3/myself`);

    assert.deepEqual(result, { value: 'ok' });
    assert.equal(requests.length, 3);
    assert.equal(new Headers(requests[0].init?.headers).get('authorization'), 'Bearer expired-token');
    assert.equal(new Headers(requests[2].init?.headers).get('authorization'), 'Bearer fresh-access-token');
    assert.deepEqual(persisted, [['fresh-access-token', 'rotated-refresh-token']]);
    assert.equal(ctx.credential.refreshToken, 'rotated-refresh-token');
  });

  it('keeps existing API-token installations working', () => {
    const ctx = {
      credential: { site: 'example', email: 'user@example.com', apiToken: 'legacy-token' },
      metadata: {},
    };
    assert.equal(jiraBase(ctx), 'https://example.atlassian.net');
    assert.match(jiraHeaders(ctx).Authorization, /^Basic /);
  });

  it('requests Jira issue fields explicitly and returns actual issue records', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          issues: [{ key: 'ICS-12', fields: { summary: 'A real ticket' } }],
          total: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await searchIssues(
      { credential: { token: 'access-token' }, metadata: { cloudId: 'cloud-id' } },
      'project = ICS ORDER BY updated DESC',
      20
    );

    assert.deepEqual(result.issues, [{ key: 'ICS-12', fields: { summary: 'A real ticket' } }]);
    assert.ok(Array.isArray(requestBody?.fields));
    assert.ok((requestBody?.fields as string[]).includes('summary'));
    assert.equal(requestBody?.jql, 'project = ICS ORDER BY updated DESC');
  });

  it('falls back when Jira reports a count but omits issue records', async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith('/search/jql')) {
        return new Response(JSON.stringify({ issues: [], total: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ issues: [{ key: 'ICS-7', fields: {} }], total: 2 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await searchIssues(
      { credential: { token: 'access-token' }, metadata: { cloudId: 'cloud-id' } },
      'project = ICS',
      20
    );

    assert.deepEqual(result.issues, [{ key: 'ICS-7', fields: {} }]);
    assert.ok(paths.some((path) => path.endsWith('/search/jql')));
    assert.ok(paths.some((path) => path.endsWith('/search')));
  });

  it('explains that a Jira 404 key must be verified rather than guessed', async () => {
    globalThis.fetch = (async () =>
      new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    await assert.rejects(
      () =>
        jiraRequest(
          { credential: { token: 'access-token' }, metadata: { cloudId: 'cloud-id' } },
          'https://api.atlassian.com/ex/jira/cloud-id/rest/api/3/issue/ICS-1'
        ),
      /ICS-1 was not found or is not visible.*exact key returned by Jira search/
    );
  });
});
