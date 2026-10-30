import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { githubTools } from './tools';

const originalFetch = globalThis.fetch;
const ctx = { credential: { token: 'token' }, metadata: {} };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function stubGitHub(app: { slug: string; name: string }, log = ''): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    requested.push(path);
    if (path.endsWith('/check-runs/42')) {
      return json({
        id: 42,
        name: 'build',
        status: 'completed',
        conclusion: 'failure',
        app,
        output: { title: 'build', summary: 'Build ID: 1', text: null },
        html_url: 'https://github.com/acme/web/runs/42',
        details_url: 'https://ci.example/builds/1',
      });
    }
    if (path.endsWith('/check-runs/42/annotations')) {
      return json([{ annotation_level: 'failure', path: 'src/a.ts', start_line: 3, message: 'Type error' }]);
    }
    if (path.endsWith('/actions/jobs/42/logs')) return new Response(log, { status: 200 });
    throw new Error(`Unexpected GitHub request: ${path}`);
  }) as typeof fetch;
  return requested;
}

describe('GitHub check logs', () => {
  it('says where logs are kept when another app ran the check', async () => {
    const requested = stubGitHub({ slug: 'cloudflare-workers-and-pages', name: 'Cloudflare Workers and Pages' });

    const result = await githubTools.get_check_logs({ repo: 'acme/web', check_run_id: 42 }, ctx);

    assert.equal(result.logs, null);
    assert.equal(result.check.logs_on_github, false);
    assert.equal(result.check.summary, 'Build ID: 1');
    assert.equal(result.check.details_url, 'https://ci.example/builds/1');
    assert.match(result.logs_location, /Cloudflare Workers and Pages keeps its logs outside GitHub/);
    assert.deepEqual(result.annotations, [{ level: 'failure', path: 'src/a.ts', line: 3, message: 'Type error' }]);
    assert.equal(requested.some((path) => path.includes('/actions/jobs/')), false);
  });

  it('returns the end of a GitHub Actions job log', async () => {
    const log = `${'setup line\n'.repeat(2_000)}Error: test failed`;
    stubGitHub({ slug: 'github-actions', name: 'GitHub Actions' }, log);

    const result = await githubTools.get_check_logs({ repo: 'acme/web', check_run_id: 42 }, ctx);

    assert.equal(result.logs_truncated, true);
    assert.equal(result.logs.length, 12_000);
    assert.match(result.logs, /Error: test failed$/);
  });
});
