import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeJql } from './jql';

describe('normalizeJql', () => {
  it('lists recent issues in the configured project when no filter is supplied', () => {
    assert.equal(normalizeJql('', 'ICS'), 'project = ICS ORDER BY updated DESC');
    assert.equal(normalizeJql('', null), 'ORDER BY updated DESC');
  });

  it('passes the model-written JQL through unchanged', () => {
    assert.equal(normalizeJql('project = ABC AND status = Open'), 'project = ABC AND status = Open');
    assert.equal(normalizeJql('ORDER BY updated DESC', 'ICS'), 'ORDER BY updated DESC');
    assert.equal(normalizeJql('key = ICS-9'), 'key = ICS-9');
  });

  it('strips template junk around the query', () => {
    assert.equal(normalizeJql('"key = ABC-12"'), 'key = ABC-12');
  });
});
