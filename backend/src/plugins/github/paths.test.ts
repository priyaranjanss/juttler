import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPlausibleRepoPath, requiredPath, sanitizeBranchName, sanitizeRepoPath } from './paths';

describe('sanitizeRepoPath', () => {
  it('strips leading colon that becomes %3A on GitHub', () => {
    assert.equal(sanitizeRepoPath(':backend/src/services/slackFormat.ts'), 'backend/src/services/slackFormat.ts');
    assert.equal(sanitizeRepoPath('::src/a.ts'), 'src/a.ts');
  });

  it('strips template and quote junk', () => {
    assert.equal(sanitizeRepoPath('}}backend/src/a.ts'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath('"backend/src/a.ts"'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath('{{path}}backend/src/a.ts'), 'backend/src/a.ts');
  });

  it('rejects punctuation-only and picks first real path from a list', () => {
    assert.equal(sanitizeRepoPath(','), '');
    assert.equal(isPlausibleRepoPath(':'), false);
    assert.equal(sanitizeRepoPath(',backend/src/a.ts'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath('a.ts, b.ts'), 'a.ts');
  });

  it('strips github blob URLs down to the file path', () => {
    assert.equal(
      sanitizeRepoPath('https://github.com/acme/app/blob/main/src/index.ts'),
      'src/index.ts'
    );
  });
});

describe('requiredPath', () => {
  it('accepts file alias', () => {
    assert.equal(requiredPath({ file: ':src/x.ts' }), 'src/x.ts');
  });
});

describe('sanitizeBranchName', () => {
  it('cleans branch names', () => {
    assert.equal(sanitizeBranchName('refs/heads/fix/ics-9'), 'fix/ics-9');
    assert.equal(sanitizeBranchName('  my branch  '), 'my-branch');
  });
});
