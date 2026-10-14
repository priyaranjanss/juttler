import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applySearchReplace } from './edit';

describe('applySearchReplace', () => {
  it('replaces a unique snippet', () => {
    const result = applySearchReplace('const a = 1;\nconst b = 2;\n', 'const a = 1;', 'const a = 42;');
    assert.equal(result.replacements, 1);
    assert.equal(result.content, 'const a = 42;\nconst b = 2;\n');
  });

  it('requires replace_all when the snippet repeats', () => {
    assert.throws(
      () => applySearchReplace('x\nx\n', 'x', 'y'),
      /matched 2 places/
    );
    const result = applySearchReplace('x\nx\n', 'x', 'y', true);
    assert.equal(result.replacements, 2);
    assert.equal(result.content, 'y\ny\n');
  });

  it('errors when the snippet is missing', () => {
    assert.throws(() => applySearchReplace('hello', 'nope', 'x'), /not found/);
  });
});
