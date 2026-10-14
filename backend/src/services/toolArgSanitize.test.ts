import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPlausibleRepoPath,
  sanitizeFileContent,
  sanitizeRepoPath,
  sanitizeToolArgs,
} from './toolArgSanitize';

describe('sanitizeRepoPath', () => {
  it('strips leading colon (%3A bug)', () => {
    assert.equal(
      sanitizeRepoPath(':backend/src/services/slackFormat.ts'),
      'backend/src/services/slackFormat.ts'
    );
  });

  it('strips template brace leftovers', () => {
    assert.equal(sanitizeRepoPath('}}backend/src/a.ts'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath('{{path}}backend/src/a.ts'), 'backend/src/a.ts');
  });

  it('cleans quotes and backticks', () => {
    assert.equal(sanitizeRepoPath('"backend/src/a.ts"'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath('`backend/src/a.ts`'), 'backend/src/a.ts');
  });

  it('rejects lone commas and picks the first real path from a list', () => {
    assert.equal(sanitizeRepoPath(','), '');
    assert.equal(isPlausibleRepoPath(','), false);
    assert.equal(sanitizeRepoPath('backend/src/a.ts, backend/src/b.ts'), 'backend/src/a.ts');
    assert.equal(sanitizeRepoPath(',backend/src/a.ts'), 'backend/src/a.ts');
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
  it('cleans get_file path junk including leading colon', () => {
    const args: Record<string, unknown> = {
      path: ':backend/src/services/slackFormat.ts',
      repo: 'a/b',
    };
    sanitizeToolArgs('github.get_file', args);
    assert.equal(args.path, 'backend/src/services/slackFormat.ts');
  });

  it('fills path from file / file_path aliases', () => {
    const viaFile: Record<string, unknown> = { file: ':backend/src/a.ts' };
    sanitizeToolArgs('github.get_file', viaFile);
    assert.equal(viaFile.path, 'backend/src/a.ts');

    const viaFilePath: Record<string, unknown> = { file_path: 'src/b.ts' };
    sanitizeToolArgs('github.get_file', viaFilePath);
    assert.equal(viaFilePath.path, 'src/b.ts');
  });
});
