import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickIssueKeyArg, resolveIssueKey, stripKeyJunk } from './keys';

describe('resolveIssueKey', () => {
  it('parses full keys case-insensitively', () => {
    assert.equal(resolveIssueKey('ics-9'), 'ICS-9');
    assert.equal(resolveIssueKey('ICS-9'), 'ICS-9');
  });

  it('does not invent a key from a bare number', () => {
    assert.equal(resolveIssueKey('9'), null);
    assert.equal(resolveIssueKey('ticket 9'), null);
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
    assert.equal(pickIssueKeyArg({ ticket: 'XYZ-99' }), 'XYZ-99');
  });

  it('rejects a value that is not a full key', () => {
    assert.throws(() => pickIssueKeyArg({ issue_key: '9' }), /not a Jira issue key/);
    assert.throws(() => pickIssueKeyArg({ issue_key: '' }), /not a Jira issue key/);
  });
});
