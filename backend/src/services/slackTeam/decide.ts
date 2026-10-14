/**
 * Whether a Team Bot answers a Slack event.
 *
 * Direct message: every human message, and the whole DM is one conversation.
 * Channel or group DM: only an @mention starts it. After that, the thread
 * stays live, so later replies do not need another mention.
 * A top-level channel message with no mention is ignored.
 */

export interface SlackReplyInput {
  eventType: string;
  /** Slack channel_type: im, channel, group, mpim. */
  channelType?: string;
  text?: string;
  /** Set when this message is already inside a thread. */
  threadTs?: string;
  userId?: string;
  botUserId: string;
  /** Set on messages the bot itself posted. */
  botId?: string;
  subtype?: string;
  /** True when this thread was already opened by a mention. */
  threadAlreadyActive: boolean;
}

export type SlackReplyDecision = 'ignore' | 'reply' | 'activate';

const HUMAN_SUBTYPES = new Set(['file_share']);

export function decideSlackReply(input: SlackReplyInput): SlackReplyDecision {
  if (!input.userId || input.userId === input.botUserId || input.botId) return 'ignore';
  if (input.subtype && !HUMAN_SUBTYPES.has(input.subtype)) return 'ignore';
  if (input.eventType !== 'message' && input.eventType !== 'app_mention') return 'ignore';

  if (input.channelType === 'im') return 'reply';

  const mentioned =
    input.eventType === 'app_mention' ||
    (input.text ?? '').includes(`<@${input.botUserId}>`);

  if (mentioned) return 'activate';

  // A reply in a thread the bot was already pulled into.
  if (input.threadTs && input.threadAlreadyActive) return 'reply';

  return 'ignore';
}

/** DM history is one conversation. Channel history is one conversation per thread. */
export function slackThreadKey(channelType: string, threadTs: string | undefined, messageTs: string): string {
  if (channelType === 'im') return '';
  return threadTs || messageTs;
}

/** Turns Slack mention markup into text the model can read. */
export function slackTextForModel(text: string, botUserId: string): string {
  return text
    .replaceAll(`<@${botUserId}>`, '')
    .replace(/<@[A-Z0-9]+>/g, '@someone')
    .replace(/\s+/g, ' ')
    .trim();
}
