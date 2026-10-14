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
    assert.throws(() => assertWorkScope(desk, 'github', { repo: 'other/repo' }), /acme\/app/);
    assert.throws(
      () => assertWorkScope({ ...desk, githubRepos: [] }, 'github', { repo: 'acme/app' }),
      /no GitHub repository/
    );
  });

  it('fills in repo when the bot has exactly one allowed repository', () => {
    const args: Record<string, any> = {};
    assertWorkScope(desk, 'github', args);
    assert.equal(args.repo, 'acme/app');
  });

  it('does not limit Slack or Jira', () => {
    const slack = { channel: 'C123' };
    assertWorkScope(desk, 'slack', slack);
    assert.deepEqual(slack, { channel: 'C123' });

    const jira = { project: 'OTHER', issue_key: 'ZZZ-1' };
    assertWorkScope(desk, 'jira', jira);
    assert.equal(jira.project, 'OTHER');
    assert.equal(jira.issue_key, 'ZZZ-1');
  });
});
