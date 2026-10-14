import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  sanitizeFileContent,
  sanitizeRepoPath,
  sanitizeToolArgs,
} from './toolArgSanitize';

describe('sanitizeRepoPath', () => {
  it('strips template brace leftovers', () => {
    assert.equal(sanitizeRepoPath('}}backend/src/services/slackFormat.ts'), 'backend/src/services/slackFormat.ts');
    assert.equal(sanitizeRepoPath('{{path}}backend/src/a.ts'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath('{path}backend/src/a.ts'), 'backend/src/a.ts');
  });

  it('cleans quotes and backticks', () => {
    assert.equal(sanitizeRepoPath('"backend/src/a.ts"'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath('`backend/src/a.ts`'), 'backend/src/a.ts');
  });
});

describe('sanitizeFileContent', () => {
  it('unwraps a whole-file markdown fence', () => {
    assert.equal(sanitizeFileContent('```ts\nconst x = 1;\n```'), 'const x = 1;');
  });

  it('leaves normal source alone', () => {
    assert.equal(sanitizeFileContent('const x = 1;\n'), 'const x = 1;\n');
  });
});

describe('sanitizeToolArgs', () => {
  it('cleans get_file path junk', () => {
    const args: Record<string, unknown> = { path: '}}backend/src/services/slackFormat.ts', repo: 'a/b' };
    sanitizeToolArgs('github.get_file', args);
    assert.equal(args.path, 'backend/src/services/slackFormat.ts');
  });
});
