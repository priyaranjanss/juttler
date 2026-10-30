import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseRepo } from './client';
import { sanitizeBranchName, sanitizeRepoPath } from './paths';

describe('github path helpers', () => {
  it('sanitizes messy repo paths before hitting GitHub', () => {
    assert.equal(sanitizeRepoPath('repo:backend/src/index.ts'), 'backend/src/index.ts');
    assert.equal(sanitizeRepoPath(':backend/src/index.ts'), 'backend/src/index.ts');
    assert.equal(sanitizeRepoPath('https://github.com/acme/app/blob/main/backend/src/index.ts'), 'backend/src/index.ts');
    assert.equal(sanitizeRepoPath('`backend/src/index.ts`'), 'backend/src/index.ts');
    assert.equal(sanitizeRepoPath('backend/src/index.ts?raw=1'), 'backend/src/index.ts');
  });

  it('accepts repo strings that bots often generate', () => {
    assert.deepEqual(parseRepo('https://github.com/acme/app.git'), { owner: 'acme', repo: 'app' });
    assert.deepEqual(parseRepo('repo:acme/app'), { owner: 'acme', repo: 'app' });
    assert.deepEqual(parseRepo('acme/app'), { owner: 'acme', repo: 'app' });
    assert.throws(() => parseRepo('https://github.com/acme/app/extra'));
  });

  it('normalizes branch names for GitHub refs', () => {
    assert.equal(sanitizeBranchName('feature/IDE access'), 'feature/IDE-access');
    assert.equal(sanitizeBranchName(':feature/test:123'), 'feature/test-123');
    assert.equal(sanitizeBranchName('refs/heads/feature/foo'), 'feature/foo');
  });
});


