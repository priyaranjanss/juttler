import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideSlackReply, slackMentionedUserIds, slackThreadKey } from './decide';

const BOT = 'UBOT';

function decide(overrides: Partial<Parameters<typeof decideSlackReply>[0]> = {}) {
  return decideSlackReply({
    eventType: 'message',
    channelType: 'channel',
    text: 'hello',
    userId: 'UALICE',
    botUserId: BOT,
    threadAlreadyActive: false,
    ...overrides,
  });
}

describe('decideSlackReply', () => {
  it('answers every direct message', () => {
    assert.equal(decide({ channelType: 'im', text: 'ping' }), 'reply');
  });

  it('ignores the bot’s own messages and edits', () => {
    assert.equal(decide({ channelType: 'im', userId: BOT }), 'ignore');
    assert.equal(decide({ channelType: 'im', botId: 'B123' }), 'ignore');
    assert.equal(decide({ channelType: 'im', subtype: 'message_changed' }), 'ignore');
    assert.equal(decide({ channelType: 'im', subtype: 'bot_message', botId: 'B123' }), 'ignore');
    assert.equal(decide({ channelType: 'im', subtype: 'thread_broadcast', threadAlreadyActive: true }), 'ignore');
  });

  it('ignores top-level channel and group messages that do not mention the bot', () => {
    assert.equal(decide({ channelType: 'channel' }), 'ignore');
    assert.equal(decide({ channelType: 'group' }), 'ignore');
    assert.equal(decide({ channelType: 'mpim', text: 'standup notes' }), 'ignore');
  });

  it('starts a thread when the bot is mentioned', () => {
    assert.equal(decide({ text: `hey <@${BOT}> look at this` }), 'activate');
    assert.equal(decide({ eventType: 'app_mention', text: `<@${BOT}> ship it`, channelType: 'mpim' }), 'activate');
  });

  it('follows an activated thread without another mention', () => {
    assert.equal(
      decide({ threadTs: '111.222', threadAlreadyActive: true, text: 'and the other file' }),
      'reply'
    );
    assert.equal(
      decide({ channelType: 'mpim', threadTs: '111.222', threadAlreadyActive: true }),
      'reply'
    );
  });

  it('ignores a thread the bot was never mentioned in', () => {
    assert.equal(decide({ threadTs: '111.222', threadAlreadyActive: false, text: 'side chat' }), 'ignore');
  });
});

describe('slackThreadKey', () => {
  it('keeps a whole DM as one conversation', () => {
    assert.equal(slackThreadKey('im', '999.1', '1000.2'), '');
  });

  it('keys a channel thread by its root timestamp', () => {
    assert.equal(slackThreadKey('channel', '111.222', '333.444'), '111.222');
    assert.equal(slackThreadKey('channel', undefined, '333.444'), '333.444');
  });
});

describe('slackMentionedUserIds', () => {
  it('extracts Slack user mentions with or without display labels', () => {
    assert.deepEqual(
      slackMentionedUserIds('Hi <@U012ABC> and <@W045DEF|priya>'),
      ['U012ABC', 'W045DEF']
    );
  });
});
