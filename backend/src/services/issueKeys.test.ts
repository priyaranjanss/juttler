import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractIssueKeys, resolveThreadIssueKeys } from './issueKeys';

describe('extractIssueKeys', () => {
  it('finds keys in casual text', () => {
    assert.deepEqual(extractIssueKeys('work on ics-9 please'), ['ICS-9']);
    assert.deepEqual(extractIssueKeys('Fix ABC-12 and abc-12'), ['ABC-12']);
  });

  it('returns empty when none', () => {
    assert.deepEqual(extractIssueKeys('hello there'), []);
  });
});

describe('resolveThreadIssueKeys', () => {
  it('resolves bare numbers with preferred project', () => {
    assert.deepEqual(
      resolveThreadIssueKeys({ preferredProject: 'ICS', message: '9' }),
      ['ICS-9']
    );
  });

  it('picks keys from history when the user says continue', () => {
    assert.deepEqual(
      resolveThreadIssueKeys({
        preferredProject: 'ICS',
        message: 'continue',
        historyTexts: ['@Devon work on ics-9 ticket', 'I said continue'],
      }),
      ['ICS-9']
    );
  });
});
