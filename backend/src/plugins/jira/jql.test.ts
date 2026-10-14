import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractIssueKey, normalizeJql, pickIssueKeyArg } from './jql';

describe('normalizeJql', () => {
  it('rewrites a bare issue key', () => {
    assert.equal(normalizeJql('ics-9'), 'key = ICS-9');
    assert.equal(normalizeJql('"ABC-12"'), 'key = ABC-12');
  });

  it('scopes empty search to preferred project', () => {
    assert.equal(
      normalizeJql('', 'ICS'),
      'project = ICS AND updated >= -120d ORDER BY updated DESC'
    );
  });

  it('keeps real JQL', () => {
    assert.equal(normalizeJql('project = ABC AND status = Open'), 'project = ABC AND status = Open');
  });
});

describe('pickIssueKeyArg', () => {
  it('accepts common aliases', () => {
    assert.equal(pickIssueKeyArg({ key: 'ics-9' }), 'ICS-9');
    assert.equal(pickIssueKeyArg({ issue_key: 'ABC-1' }), 'ABC-1');
    assert.equal(pickIssueKeyArg({ issue: 'fix XYZ-99 please' }), 'XYZ-99');
  });
});

describe('extractIssueKey', () => {
  it('returns null for junk', () => {
    assert.equal(extractIssueKey('}}-9'), null);
    assert.equal(extractIssueKey(''), null);
  });
});
