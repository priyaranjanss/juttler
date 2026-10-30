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

/** Free endpoint stub answering from one queue per model; returns every request body. */
function fakeFreeEndpoint(replies: { tools: string[]; reasoning: string[] }): any[] {
  const bodies: any[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const queue = body.modelId === AI_PROVIDERS.free_endpoint.reasoningModel ? replies.reasoning : replies.tools;
    return new Response(JSON.stringify({ content: queue.shift() ?? '' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return bodies;
}

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
    // Without tools the whole turn is reasoning.
    assert.equal(body.modelId, AI_PROVIDERS.free_endpoint.reasoningModel);
    assert.equal(body.thinking, false);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].role, 'user');
    assert.match(body.messages[0].content, /Authoritative bot identity: You are Test bot, serving as Assistant/);
    assert.match(body.messages[0].content, /Be transparent that you are an AI assistant/);
    assert.match(body.messages[0].content, /the space context and service state supplied in this prompt/);
    assert.match(body.messages[0].content, /Distinguish what you verified from what you inferred/);
    assert.match(body.messages[0].content, /Latest message:\nSay hello\.$/);
    assert.equal(result.text, 'Hello there.');
  });

  it('sends the turn context with the latest message, after the history', async () => {
    let body: any;
    globalThis.fetch = (async (_input, init) => {
      body ??= JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: 'Yes.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const at = new Date().toISOString();
    await runBotTurn({
      bot: freeEndpointBot(),
      userName: 'Test user',
      history: [
        { id: 'm1', conversationId: 'c', senderType: 'user', senderId: 'u', senderName: 'U', content: 'Earlier question', type: 'text', timestamp: at },
        { id: 'm2', conversationId: 'c', senderType: 'bot', senderId: 'b', senderName: 'B', content: 'Earlier answer', type: 'text', timestamp: at },
      ],
      messageContent: 'Current question',
      tools: [{ name: 'demo.read', description: 'Read demo data.', parameters: { type: 'object', properties: {} } }],
      executor: async () => ({ kind: 'result', ok: true, result: {} }),
      systemAddendum: 'Space fact: demo service connected.',
    });

    assert.deepEqual(
      body.messages.map((m: any) => m.role),
      ['user', 'assistant', 'user']
    );
    assert.equal(body.messages[0].content, 'Earlier question');
    assert.equal(body.messages[1].content, 'Earlier answer');
    const latest = body.messages[2].content;
    assert.match(latest, /demo\.read: Read demo data\./);
    assert.match(latest, /Space fact: demo service connected\./);
    assert.match(latest, /Latest message:\nCurrent question$/);
  });

  it('applies space-aware behavior to overridden system prompts', async () => {
    let requestBody: Record<string, any> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: 'Done.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    await runBotTurn({
      bot: freeEndpointBot(),
      userName: 'Test user',
      history: [],
      messageContent: 'Run the command.',
      tools: [],
      executor: async () => ({ kind: 'result', ok: true, result: {} }),
      overrideSystemPrompt: 'You coordinate this workspace.',
    });

    const messages = requestBody?.messages as Array<{ content: string }>;
    assert.match(messages[0].content, /You coordinate this workspace/);
    assert.match(messages[0].content, /the space context and service state supplied in this prompt/);
    assert.match(messages[0].content, /Only state facts you can ground in the supplied context or in tool results/);
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
    const requestBodies = fakeFreeEndpoint({
      tools: ['<tool_call>{"name":"demo.echo","arguments":{"value":"from endpoint"}}</tool_call>', 'Tool finished.'],
      reasoning: ['Echo the value with demo.echo, then report it.', 'Tool finished.'],
    });

    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [],
      messageContent: 'Echo?',
      tools: [
        {
          name: 'demo.echo',
          description: 'Echoes a value.',
          parameters: {
            type: 'object',
            properties: { value: { type: 'string', description: 'Text to echo back' } },
            required: ['value'],
          },
        },
      ],
      executor: async (_toolName, args) => ({ kind: 'result', ok: true, result: args }),
    });

    assert.deepEqual(
      requestBodies.map((body) => body.modelId),
      [
        AI_PROVIDERS.free_endpoint.reasoningModel,
        AI_PROVIDERS.free_endpoint.model,
        AI_PROVIDERS.free_endpoint.model,
        AI_PROVIDERS.free_endpoint.reasoningModel,
      ],
      JSON.stringify({ text: result.text, error: result.error, tools: result.tools })
    );
    assert.equal('tools' in requestBodies[1], false);
    const messages = requestBodies[1].messages as Array<{ content: string }>;
    assert.match(messages[0].content, /does not support structured function calls/);
    assert.match(messages[0].content, /- demo\.echo: value \(string, required\) - Text to echo back/);
    assert.match(messages[0].content, /Your plan for this turn[^\n]*\nEcho the value with demo\.echo/);
    assert.deepEqual(result.tools[0].result, { value: 'from endpoint' });
    assert.equal(result.text, 'Tool finished.');

    const calledToolMessage = (requestBodies[2].messages as Array<{ role: string; content: string }>).find(
      (message) => message.role === 'assistant'
    );
    assert.equal(
      calledToolMessage?.content,
      '<tool_call>{"name":"demo.echo","arguments":{"value":"from endpoint"}}</tool_call>'
    );
  });

  it('has the reasoning model check the draft and hand remaining work back to the tool model', async () => {
    const bot = freeEndpointBot();
    const requestBodies = fakeFreeEndpoint({
      tools: [
        'Done: the pull request is open.',
        '<tool_call>{"name":"demo.open","arguments":{"title":"Change"}}</tool_call>',
        'Opened pull request #7.',
      ],
      reasoning: [
        'Open the pull request with demo.open.',
        'CONTINUE: open the pull request with demo.open.',
        'Opened pull request #7.',
      ],
    });

    const calls: string[] = [];
    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [],
      messageContent: 'Open a pull request.',
      tools: [{ name: 'demo.open', description: 'Open a pull request.', parameters: { type: 'object', properties: {} } }],
      executor: async (toolName) => {
        calls.push(toolName);
        return { kind: 'result', ok: true, result: { number: 7 } };
      },
    });

    assert.deepEqual(calls, ['demo.open']);
    assert.equal(result.text, 'Opened pull request #7.');
    assert.equal(requestBodies.length, 6);

    const review = requestBodies[2];
    assert.equal(review.modelId, AI_PROVIDERS.free_endpoint.reasoningModel);
    assert.equal(review.messages.at(-2).role, 'assistant');
    assert.equal(review.messages.at(-2).content, 'Done: the pull request is open.');
    assert.match(review.messages.at(-1).content, /Check your draft reply above before it is sent/);
    assert.match(review.messages.at(-1).content, /starting "CONTINUE:"/);
    assert.match(review.messages.at(-1).content, /Tool calls this turn:\n- none/);

    const handedBack = requestBodies[3];
    assert.equal(handedBack.modelId, AI_PROVIDERS.free_endpoint.model);
    assert.match(handedBack.messages.at(-1).content, /Your review found more to do before replying: open the pull request/);
    assert.doesNotMatch(JSON.stringify(handedBack.messages), /Done: the pull request is open|Check your draft reply/);

    const finalReview = requestBodies[5];
    assert.equal(finalReview.modelId, AI_PROVIDERS.free_endpoint.reasoningModel);
    assert.match(finalReview.messages.at(-1).content, /- demo\.open \{"title":"Change"\}: success/);
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

  it('lets the model decide how to continue using any available tool', async () => {
    const bot = freeEndpointBot();
    const calls: string[] = [];
    const requestBodies = fakeFreeEndpoint({
      tools: [
        '<tool_call>{"name":"demo.write","arguments":{"path":"change-summary.txt","content":"Completed the requested change."}}</tool_call>',
        '<tool_call>{"name":"demo.write","arguments":{"path":"completion-note.txt","content":"Additional requested output."}}</tool_call>',
        'The requested change was recorded.',
      ],
      reasoning: ['Write the change, then a completion note.', 'The requested change was recorded.'],
    });

    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [],
      messageContent: 'Complete the requested change.',
      tools: [
        {
          name: 'demo.write',
          description: 'Write the requested change.',
          parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
        },
      ],
      executor: async (toolName, args) => {
        calls.push(toolName);
        assert.equal(toolName, 'demo.write');
        assert.equal(args.path, calls.length === 1 ? 'change-summary.txt' : 'completion-note.txt');
        return {
          kind: 'result',
          ok: true,
          result: {
            written: true,
            path: args.path,
          },
        };
      },
    });

    assert.deepEqual(calls, ['demo.write', 'demo.write']);
    assert.equal(result.tools.length, 2);
    assert.equal(result.tools[0].status, 'success');
    assert.equal(result.text, 'The requested change was recorded.');
    const systemContent = String(requestBodies[1].messages[0].content);
    assert.match(systemContent, /Fill routine gaps with context, conventions, and professional judgment/);
    assert.match(systemContent, /Continue until the user's goal is met/);
    assert.doesNotMatch(systemContent, /github\.|jira\.|create_pull_request|search_code/);
  });

  it('provides prior tool outcomes to the model when continuing a conversation', async () => {
    const bot = freeEndpointBot();
    const requestBodies = fakeFreeEndpoint({
      tools: [
        '<tool_call>{"name":"demo.write","arguments":{"path":"change-summary.txt","content":"Completed the requested change."}}</tool_call>',
        'The requested change was recorded.',
      ],
      reasoning: ['Retry the write that failed.', 'The requested change was recorded.'],
    });

    const result = await runBotTurn({
      bot,
      userName: 'Test user',
      history: [
        {
          id: 'user-request',
          conversationId: 'conversation',
          senderType: 'user',
          senderId: 'user',
          senderName: 'Test user',
          content: 'Complete the requested change.',
          type: 'text',
          timestamp: new Date(0).toISOString(),
        },
        {
          id: 'file-written',
          conversationId: 'conversation',
          senderType: 'bot',
          senderId: 'bot_test',
          senderName: 'Test bot',
          content: 'The write failed.',
          type: 'tool_result',
          metadata: {
            toolResult: {
              toolName: 'demo.write',
              callId: 'write-call',
              result: { error: 'Temporary provider error' },
              status: 'error',
            },
          },
          timestamp: new Date(1).toISOString(),
        },
      ],
      messageContent: 'Why did it stop?',
      tools: [
        {
          name: 'demo.write',
          description: 'Write the requested change.',
          parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } },
        },
      ],
      executor: async (toolName, args) => {
        assert.equal(toolName, 'demo.write');
        assert.equal(args.path, 'change-summary.txt');
        return {
          kind: 'result',
          ok: true,
          result: { written: true, path: args.path },
        };
      },
    });

    assert.equal(result.tools[0].status, 'success');
    assert.equal(result.text, 'The requested change was recorded.');
    const requestMessages = JSON.stringify(requestBodies.at(-1).messages);
    assert.match(requestMessages, /Previous tool result from demo\.write \(error\)/);
    assert.match(requestMessages, /Temporary provider error/);
  });
});

describe('tool selection', () => {
  it('answers tool-capability questions from the enabled tools without forcing a call', async () => {
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
      messageContent: 'Which service tools are available to you in this space?',
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
