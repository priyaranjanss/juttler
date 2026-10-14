/**
 * Thread-aware Jira issue keys for the bot turn.
 * Full keys (ICS-9), bare numbers with desk project (9 → ICS-9), and history.
 */

import { extractIssueKeys as extractFromChunks } from '../plugins/jira/keys';

export { resolveIssueKey, stripKeyJunk, pickIssueKeyArg } from '../plugins/jira/keys';

/** Keys mentioned in the current message (and optional extra chunks). */
export function extractIssueKeys(...chunks: Array<string | null | undefined>): string[] {
  return extractFromChunks(null, ...chunks);
}

/**
 * Resolve issue keys for this turn from the message + recent user messages,
 * using the bot's preferred Jira project for bare numbers like "9".
 */
export function resolveThreadIssueKeys(options: {
  preferredProject?: string | null;
  message: string;
  historyTexts?: Array<string | null | undefined>;
}): string[] {
  return extractFromChunks(
    options.preferredProject,
    options.message,
    ...(options.historyTexts ?? [])
  );
}
