/**
 * Turn model/Markdown-ish text into Slack mrkdwn so formatting does not leak
 * as raw ** or ``` fences the user never asked to see.
 */

export interface SlackMentionTarget {
  userId: string;
  names: string[];
}

export function toSlackMrkdwn(
  text: string,
  mentionUserId?: string,
  mentionTargets: SlackMentionTarget[] = []
): string {
  let out = text.replace(/\r\n/g, '\n');

  // Fenced code blocks → Slack triple backticks (language tag dropped).
  out = out.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, body: string) => `\`\`\`\n${body.replace(/\n$/, '')}\n\`\`\``);

  // Links [label](url) → <url|label>
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>');

  // Bold/italic: Markdown ** __ * _ → Slack * _
  out = out.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  out = out.replace(/__([^_]+)__/g, '*$1*');

  // Headings → bold line
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Strip leftover XML tool markup if any slipped through.
  out = out.replace(
    /<(?:[\w.-]+:)?(?:dots_function_call|tool_call|function_call)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?(?:dots_function_call|tool_call|function_call)>/gi,
    ''
  );
  out = out.replace(/<invoke\s+name=["'][^"']+["']\s*>[\s\S]*?<\/invoke>/gi, '');
  out = out.replace(/\n{3,}/g, '\n\n');

  for (const target of mentionTargets) {
    if (!/^[UW][A-Z0-9]+$/.test(target.userId)) continue;
    const slackMention = `<@${target.userId}>`;
    const marker = `\u0000slack-user-${target.userId}\u0000`;
    out = out.replaceAll(slackMention, marker);
    for (const name of target.names) {
      const normalizedName = name.trim();
      if (!normalizedName) continue;
      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(
        new RegExp(`(^|[^\\w<])@${escapedName}(?=$|[^\\w])`, 'gi'),
        (_match, prefix: string) => `${prefix}${slackMention}`
      );
    }
    out = out.replaceAll(marker, slackMention);
  }

  if (mentionUserId && /^[UW][A-Z0-9]+$/.test(mentionUserId)) {
    const slackMention = `<@${mentionUserId}>`;
    const marker = '\u0000slack-user-mention\u0000';
    out = out.replaceAll(slackMention, marker);
    out = out.replace(new RegExp(`\\b${mentionUserId}\\b`, 'g'), slackMention);
    out = out.replaceAll(marker, slackMention);
  }

  return out.trim();
}
