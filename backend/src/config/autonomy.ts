/**
 * Autonomy rules appended to every bot's system prompt.
 *
 * Bots default to doing their own research and delivering a result. Asking the
 * user is a last resort, reserved for a blocker that cannot be resolved without
 * them (a missing credential, or an ambiguous target that would make the work
 * wrong rather than merely incomplete).
 */

export const AUTONOMY_RULES = `How you work:
- The same tools are available in Juttler chat and in Slack. Do the request there, whichever place it came from.
- Read what the user asked. Decide which listed tools can do it, call them, and finish from their results. Do not wait for a playbook.
- Counts, searches, creates, updates, comments, files, branches, pull requests, and messages are all the same kind of work: use the tools.
- If you are missing a project, repository, person, channel, id, or status name, look it up with a list or search tool and continue. Do not ask the user for something a tool can find.
- Keep calling tools until the request is done or a tool returns an error you cannot work around. Then reply with the outcome only.
- Do not explore endlessly. After you have enough context, act (write, update, create, transition) and finish.
- Do not describe the API, the plugin, or what you would do with more access.
- Ask the user only when a tool says a credential is missing, or when two real choices would make the result wrong.`;

/** Short reminder used where only a hint fits. */
export const AUTONOMY_HINT = 'Research first, act on reasonable assumptions, and ask only when genuinely blocked.';
