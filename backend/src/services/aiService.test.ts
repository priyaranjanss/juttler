import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AI_PROVIDERS } from '../constants';
import { Bot } from '../types';
import { describeLlmGap, resolveLlmWiring, runBotTurn, verifyAiConfig } from './aiService';

const originalFetch = globalThis.fetch;

function freeEndpointBot(): Bot {
  return {
    id: 'bot_test',
    userId: 'user_test',
    name: 'Test bot',
    roleTitle: 'Assistant',
    systemPrompt: 'Be helpful.',
    avatar: 'blob',
    color: '#6366f1',
    allowedTools: [],
    isChiefOfStaff: false,
    status: 'idle',
    memoryEnabled: true,
    aiProvider: 'free_endpoint',
    aiEndpoint: AI_PROVIDERS.free_endpoint.endpoint,
    aiModel: '',
    aiApiKey: '',
    isTeamBot: false,
    teamId: null,
    publishedAt: null,
    jiraProject: null,
    githubRepos: [],
    reasoningMode: 'off',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('free model endpoint', () => {
  it('runs a bot turn without a model or API key', async () => {
    const bot = freeEndpointBot();
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(
        JSON.stringify({ content: 'Hello there.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    assert.equal(resolveLlmWiring(bot)?.provider, 'free_endpoint');
    assert.equal(describeLlmGap(bot), 'ok');
    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [],
      messageContent: 'Say hello.',
      tools: [],
      executor: async () => ({ kind: 'result', ok: true, result: {} }),
    });

    assert.equal(requestUrl, AI_PROVIDERS.free_endpoint.endpoint);
    assert.equal(new Headers(requestInit?.headers).get('origin'), 'https://rusherai.com');
    const body = JSON.parse(String(requestInit?.body));
    assert.equal(body.stream, false);
    assert.equal('model' in body, false);
    assert.equal(body.messages[0].role, 'user');
    assert.match(body.messages[0].content, /Authoritative bot identity: You are Test bot, serving as Assistant/);
    assert.match(body.messages[0].content, /Do not identify yourself as the underlying AI model/);
    assert.equal(body.messages.at(-1).content, 'Say hello.');
    assert.equal(result.text, 'Hello there.');
  });

  it('verifies the endpoint without requiring credentials', async () => {
    let requestUrl = '';
    globalThis.fetch = (async (input) => {
      requestUrl = String(input);
      return new Response(
        JSON.stringify({ content: 'pong' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await verifyAiConfig('', AI_PROVIDERS.free_endpoint.endpoint, '', 'free_endpoint');

    assert.equal(requestUrl, AI_PROVIDERS.free_endpoint.endpoint);
    assert.equal(result.ok, true);
  });

  it('keeps tool execution available through the endpoint text format', async () => {
    const bot = freeEndpointBot();
    const responses = [
      '<tool_call>{"name":"demo.echo","arguments":{"value":"from endpoint"}}</tool_call>',
      'Tool finished.',
    ];
    const requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: responses.shift() } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [],
      messageContent: 'Echo?',
      tools: [
        {
          name: 'demo.echo',
          description: 'Echoes a value.',
          parameters: { type: 'object', properties: { value: { type: 'string' } } },
        },
      ],
      executor: async (_toolName, args) => ({ kind: 'result', ok: true, result: args }),
    });

    assert.equal(
      requestBodies.length,
      2,
      JSON.stringify({ requestCount: requestBodies.length, text: result.text, error: result.error, tools: result.tools })
    );
    assert.equal('tools' in requestBodies[0], false);
    const messages = requestBodies[0].messages as Array<{ content: string }>;
    assert.match(messages[0].content, /does not support structured function calls/);
    assert.deepEqual(result.tools[0].result, { value: 'from endpoint' });
    assert.equal(result.text, 'Tool finished.');

    const calledToolMessage = (requestBodies[1].messages as Array<{ role: string; content: string }>).find(
      (message) => message.role === 'assistant'
    );
    assert.match(calledToolMessage?.content ?? '', /Tools called internally: demo\.echo/);
    assert.doesNotMatch(calledToolMessage?.content ?? '', /"arguments"/);
  });

  it('does not expose raw concatenated tool-call JSON as a reply', async () => {
    const bot = freeEndpointBot();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          content:
            '{"name":"get_team_roster","arguments":{}}{"name":"github.list_prs","arguments":{"repo":"owner/project"}}',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [],
      messageContent: 'Do you have GitHub access?',
      tools: [
        {
          name: 'github.list_prs',
          description: 'List pull requests.',
          parameters: { type: 'object', properties: {} },
        },
      ],
      executor: async () => ({ kind: 'result', ok: true, result: {} }),
    });

    assert.equal(result.text, undefined);
    assert.doesNotMatch(JSON.stringify(result), /get_team_roster|github\.list_prs/);
    assert.equal(result.error?.kind, 'bad_response');
  });
});

describe('tool selection', () => {
  it('allows a direct answer to a capability question without forcing tool calls', async () => {
    const bot: Bot = {
      ...freeEndpointBot(),
      aiProvider: 'kilo_gateway',
      aiEndpoint: AI_PROVIDERS.kilo_gateway.endpoint,
      aiModel: 'test-model',
      aiApiKey: 'test-key',
    };
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'Yes, GitHub is connected.' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [],
      messageContent: 'Do you have GitHub access?',
      tools: [
        {
          name: 'github.list_prs',
          description: 'List pull requests.',
          parameters: { type: 'object', properties: {} },
        },
      ],
      executor: async () => ({ kind: 'result', ok: true, result: {} }),
    });

    assert.equal(requestBody?.tool_choice, 'auto');
    assert.equal(result.text, 'Yes, GitHub is connected.');
  });
});
