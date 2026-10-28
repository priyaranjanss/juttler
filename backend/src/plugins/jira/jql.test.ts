import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeJql } from './jql';

describe('normalizeJql', () => {
  it('rewrites a bare issue key', () => {
    assert.equal(normalizeJql('ics-9'), 'key = ICS-9');
    assert.equal(normalizeJql('"ABC-12"'), 'key = ABC-12');
  });

  it('rewrites a bare number with preferred project', () => {
    assert.equal(normalizeJql('9', 'ICS'), 'key = ICS-9');
    assert.equal(normalizeJql('ticket 12', 'ABC'), 'key = ABC-12');
  });

  it('searches the whole preferred project when no filter is supplied', () => {
    assert.equal(
      normalizeJql('', 'ICS'),
      'project = ICS ORDER BY updated DESC'
    );
    assert.equal(normalizeJql('', null), 'ORDER BY updated DESC');
  });

  it('does not silently add a recent-date limit to an order-only query', () => {
    assert.equal(normalizeJql('ORDER BY updated DESC', 'ICS'), 'project = ICS ORDER BY updated DESC');
  });

  it('keeps real JQL', () => {
    assert.equal(normalizeJql('project = ABC AND status = Open'), 'project = ABC AND status = Open');
  });
});
