import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contentLooksLikeToolMarkup,
  extractEmbeddedToolCalls,
  stripEmbeddedToolMarkup,
} from './embeddedToolCalls';

const tools = ['github.get_file', 'jira.get_ticket', 'github.list_files'];

describe('embedded tool calls', () => {
  it('parses dots_function_call invoke XML', () => {
    const text = `<dots_function_call>
  <invoke name="github.get_file">
    <parameter name="path">backend/src/services/slackTeam/inbound.ts</parameter>
    <parameter name="repo">priyaranjanss/juttler</parameter>
  </invoke>
</dots_function_call>`;
    assert.equal(contentLooksLikeToolMarkup(text), true);
    const calls = extractEmbeddedToolCalls(text, tools);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'github.get_file');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), {
      path: 'backend/src/services/slackTeam/inbound.ts',
      repo: 'priyaranjanss/juttler',
    });
    assert.equal(stripEmbeddedToolMarkup(text), '');
  });

  it('resolves a bare tool name when only one plugin tool matches', () => {
    const text = `<tool_call><invoke name="get_ticket"><parameter name="issue_key">ics-10</parameter></invoke></tool_call>`;
    const calls = extractEmbeddedToolCalls(text, tools);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'jira.get_ticket');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { issue_key: 'ics-10' });
  });

  it('parses JSON inside a dots_function_call block', () => {
    const text = `<dots_function_call>{"name":"github.list_files","arguments":{"path":"src"}}</dots_function_call>`;
    const calls = extractEmbeddedToolCalls(text, tools);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'github.list_files');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'src' });
  });
});
