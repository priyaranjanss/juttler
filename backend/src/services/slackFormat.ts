/**
 * Turn model/Markdown-ish text into Slack mrkdwn so formatting does not leak
 * as raw ** or ``` fences the user never asked to see.
 */

export function toSlackMrkdwn(text: string): string {
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

  return out.trim();
}
