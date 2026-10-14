import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertWorkScope, normalizeProject, normalizeRepo, normalizeRepos, WorkDesk } from './workScope';

const desk: WorkDesk = {
  name: 'Darr',
  githubRepos: ['acme/app'],
  jiraProject: 'ABC',
};

describe('work desk', () => {
  it('reads owner/name from a GitHub URL', () => {
    assert.equal(normalizeRepo('https://github.com/acme/app.git'), 'acme/app');
    assert.equal(normalizeRepo('acme/app/extra'), null);
  });

  it('keeps a short unique repo list', () => {
    assert.deepEqual(normalizeRepos(['acme/app', 'https://github.com/acme/app']), ['acme/app']);
    assert.throws(() => normalizeRepos(['nope']), /owner\/name/);
  });

  it('stores a Jira key in uppercase and allows clearing it', () => {
    assert.equal(normalizeProject(' abc '), 'ABC');
    assert.equal(normalizeProject(''), null);
    assert.throws(() => normalizeProject('1'), /project key/);
  });

  it('allows only the named GitHub repository', () => {
    const args = { repo: 'https://github.com/acme/app' };
    assertWorkScope(desk, 'github', args);
    assert.equal(args.repo, 'acme/app');
    assert.throws(
      () => assertWorkScope({ ...desk, githubRepos: [] }, 'github', { repo: 'acme/app' }),
      /no GitHub repository/
    );
    const multi: WorkDesk = { ...desk, githubRepos: ['acme/app', 'acme/other'] };
    assert.throws(() => assertWorkScope(multi, 'github', { repo: 'evil/repo' }), /acme\/app/);
  });

  it('fills in repo when the bot has exactly one allowed repository', () => {
    const args: Record<string, any> = {};
    assertWorkScope(desk, 'github', args);
    assert.equal(args.repo, 'acme/app');
    // Wrong or bare names still resolve to the single desk repo.
    const junk: Record<string, any> = { repo: 'wrong/name' };
    assertWorkScope(desk, 'github', junk);
    assert.equal(junk.repo, 'acme/app');
  });

  it('matches a bare repo name when several desks exist', () => {
    const multi: WorkDesk = { ...desk, githubRepos: ['acme/app', 'acme/other'] };
    const args: Record<string, any> = { repo: 'other' };
    assertWorkScope(multi, 'github', args);
    assert.equal(args.repo, 'acme/other');
  });

  it('does not limit Slack or Jira', () => {
    const slack = { channel: 'C123' };
    assertWorkScope(desk, 'slack', slack);
    assert.deepEqual(slack, { channel: 'C123' });

    const jira: Record<string, any> = { project: 'OTHER', issue_key: 'ZZZ-1' };
    assertWorkScope(desk, 'jira', jira);
    assert.equal(jira.project, 'OTHER');
    assert.equal(jira.issue_key, 'ZZZ-1');
    assert.equal(jira._preferredProject, 'ABC');
  });

  it('normalizes Jira key aliases and fills create project', () => {
    const keyed: Record<string, any> = { key: 'ics-9' };
    assertWorkScope(desk, 'jira', keyed);
    assert.equal(keyed.issue_key, 'ics-9');

    const create: Record<string, any> = { summary: 'New bug' };
    assertWorkScope(desk, 'jira', create);
    assert.equal(create.project, 'ABC');
  });
});
