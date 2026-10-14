import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractIssueKeys, pickIssueKeyArg, resolveIssueKey, stripKeyJunk } from './keys';
import { normalizeJql } from './jql';

describe('resolveIssueKey', () => {
  it('parses full keys case-insensitively', () => {
    assert.equal(resolveIssueKey('work on ics-9'), 'ICS-9');
    assert.equal(resolveIssueKey('ICS-9'), 'ICS-9');
  });

  it('resolves bare numbers with preferred project', () => {
    assert.equal(resolveIssueKey('9', 'ICS'), 'ICS-9');
    assert.equal(resolveIssueKey('ticket 9', 'ICS'), 'ICS-9');
    assert.equal(resolveIssueKey('#12', 'ABC'), 'ABC-12');
  });

  it('strips XML / DSML junk', () => {
    assert.equal(stripKeyJunk('<parameter name="issue_key">ICS-9</parameter>').includes('ICS-9'), true);
    assert.equal(resolveIssueKey('<parameter name="issue_key">ICS-9</parameter>'), 'ICS-9');
    assert.equal(resolveIssueKey('|DSML|parameter name="'), null);
  });
});

describe('pickIssueKeyArg', () => {
  it('accepts aliases', () => {
    assert.equal(pickIssueKeyArg({ key: 'ics-9' }), 'ICS-9');
    assert.equal(pickIssueKeyArg({ issue: 'fix XYZ-99 please' }), 'XYZ-99');
  });

  it('uses _contextIssueKey when arg is empty or junk', () => {
    assert.equal(
      pickIssueKeyArg({ issue_key: '', _contextIssueKey: 'ICS-9' }),
      'ICS-9'
    );
    assert.equal(
      pickIssueKeyArg({ issue_key: '<parameter name="', _contextIssueKey: 'ICS-9' }),
      'ICS-9'
    );
  });

  it('uses preferred project for bare number args', () => {
    assert.equal(pickIssueKeyArg({ issue_key: '9' }, 'ICS'), 'ICS-9');
  });
});

describe('extractIssueKeys', () => {
  it('finds keys in casual text and bare numbers', () => {
    assert.deepEqual(extractIssueKeys(null, 'work on ics-9 please'), ['ICS-9']);
    assert.deepEqual(extractIssueKeys('ICS', 'continue', 'do 9'), ['ICS-9']);
  });
});

describe('normalizeJql', () => {
  it('rewrites bare keys and numbers', () => {
    assert.equal(normalizeJql('ics-9'), 'key = ICS-9');
    assert.equal(normalizeJql('9', 'ICS'), 'key = ICS-9');
  });
});
