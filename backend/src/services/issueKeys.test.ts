import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractIssueKeys } from './issueKeys';

describe('extractIssueKeys', () => {
  it('finds keys in casual text', () => {
    assert.deepEqual(extractIssueKeys('work on ics-9 please'), ['ICS-9']);
    assert.deepEqual(extractIssueKeys('fix ABC-12 and abc-12'), ['ABC-12']);
  });

  it('returns empty when none', () => {
    assert.deepEqual(extractIssueKeys('hello there'), []);
  });
});
