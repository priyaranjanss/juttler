/**
 * The Chief of Staff — the default bot every new user gets.
 *
 * It is the single front door to the workspace: it receives the user's goals,
 * breaks them into subtasks, routes each to the right specialist bot, tracks
 * progress, and comes back with one synthesized answer (or a decision the user
 * needs to make). It never takes irreversible or external action without an
 * explicit approval.
 *
 * Behaviour is driven entirely by the prompt below — there are no hardcoded
 * replies, so the bot's words come from whichever model the user configured.
 */

import { registry, listAllTools } from '../plugins';

export interface RosterEntry {
  name: string;
  roleTitle: string;
  systemPrompt?: string;
  allowedTools?: string[];
  /** Tools this bot may actually call, as "plugin.tool". */
  tools?: string[];
  isChief?: boolean;
}

/** Connected services, so the Chief never has to look them up. */
export interface WorkspaceService {
  name: string;
  slug: string;
  connected: boolean;
  toolCount: number;
  /** What connecting it would ask the user for (empty for OAuth-only). */
  needs: string[];
}

function serviceLines(services: WorkspaceService[] | undefined): string {
  if (!services || services.length === 0) return 'There are no services available yet.';

  return services
    .map((s) => {
      const status = s.connected ? `connected, ${s.toolCount} tools` : `NOT connected${s.needs.length ? `, needs: ${s.needs.join(', ')}` : ''}`;
      return `- ${s.name} (${s.slug}) - ${status}`;
    })
    .join('\n');
}

function rosterTools(entry: RosterEntry): string {
  if (!entry.tools || entry.tools.length === 0) return 'no tools enabled';
  return entry.tools.join(', ');
}

/**
 * Tools a freshly-created Chief declares, from the registry rather than named
 * here so it never goes stale when a plugin is added or renamed.
 *
 * This is capability metadata for the prompt, not a permission — actual
 * execution is gated per plugin grant and by approval, both enforced in the
 * Tool Gateway. Listing every tool means the Chief describes itself accurately
 * as soon as the account connects something.
 */
export function chiefDefaultTools(): string[] {
  return listAllTools(registry).map((t) => t.id);
}

/**
 * The Chief's default instructions. They are stored on the bot like any other
 * bot's instructions, so the user (or the Chief itself) can edit them; the
 * live team and service facts are added at turn time by buildChiefSystemPrompt.
 */
export const CHIEF_SYSTEM_PROMPT = `You are the Chief of Staff of this workspace and the single front door for the user. The user should normally talk only to you.

Your core job is to:
- Understand the user's goals
- Break work into clear subtasks
- Route each subtask to the most suitable specialist Bot, or do it yourself when that is faster
- Coordinate specialists when they need to work together
- Track progress and detect stalled work
- Synthesize results into one clear response for the user
- Only come back to the user when you have a result or when you need a decision

Communication style:
- Be calm, clear, and concise.
- Lead with the outcome or status.
- Clearly separate facts, recommendations, and decisions the user must make.
- When you delegate, tell the user who you assigned the work to and what you are still waiting on.

Working style:
- Reason from the team, services, and tools in your context, and from what your tools can tell you, to understand what is possible and to answer or act.
- Make reasonable assumptions, state them, and proceed. Never ask a question you could answer yourself.
- When you do ask, ask once, ask everything at once, and make it easy to answer.
- You manage this space on the user's behalf. Anything the user could change in the app - Bots and every one of their settings and instructions (yours included), which tools each Bot may use, the team, and chats - is work you carry out with your tools, not a request you bounce back. Connecting a plugin account is done by the user.

Hard rules:
1. Prefer delegation for specialist work, and act yourself for anything that is one or two tool calls.
2. The user's request is their approval for the actions it asks for. Check with the user first only before an action they did not ask for that sends something outside this workspace, cannot be undone, deletes important data, or costs money.
3. If you are genuinely blocked, ask the user clearly and wait.
4. Do not invent information. If you don't know something, say so.`;

export const CHIEF_BOT_CONFIG = {
  name: 'Chief',
  roleTitle: 'Team Coordinator & Front Door',
  // Distinctive geometric mark that reads as "coordinator" among team avatars
  avatar: 'double_drop',
  color: '#7C3AED',
  isChiefOfStaff: true,
  memoryEnabled: true,
  allowedTools: chiefDefaultTools(),
};

function rosterLines(roster: RosterEntry[]): string {
  const specialists = roster.filter((b) => !(b.isChief ?? isChiefName(b.name)));
  if (specialists.length === 0) {
    return 'There are no specialist Bots on the team yet.';
  }

  return specialists
    .map((b) => `- ${b.name} - ${b.roleTitle}. Tools: ${rosterTools(b)}${b.systemPrompt ? `. Focus: ${oneLine(b.systemPrompt, 160)}` : ''}`)
    .join('\n');
}

function isChiefName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === 'chief' || n === 'chief of staff' || n === 'cheif';
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

/**
 * Builds the system prompt for a Chief of Staff bot: its own instructions,
 * followed by the live facts of the space.
 *
 * The roster and connected services are baked straight in, with each bot's
 * actual tool access. That is deliberate: it means the model never has to spend
 * tool calls looking up who is on the team or whether Gmail is connected, which
 * is what used to exhaust a turn before it ever reached the real work.
 */
export function buildChiefSystemPrompt(
  userName: string,
  roster: RosterEntry[],
  workspace?: WorkspaceService[],
  instructions?: string
): string {
  const servicesBlock = workspace
    ? `
Services:
${serviceLines(workspace)}
`
    : '';

  return `${instructions?.trim() || CHIEF_SYSTEM_PROMPT}

User Name: ${userName}.
${servicesBlock}
Specialist Bots:
${rosterLines(roster)}

How this space works:
- The services, Bots, and tool access above are current. get_team_roster, get_bot, and list_plugins return fresh data after a change.
- delegate_to_bot hands a self-contained brief to a specialist and returns its answer. A specialist can use only the tools listed against its name; set_bot_tools changes that.
- Your own tools are the tools of every connected service plus the workspace tools that manage this space.
- Tool calls per turn are limited.`;
}

/** True when a bot is the workspace's Chief of Staff. */
export function isChiefOfStaffBot(bot: { name: string; isChiefOfStaff?: boolean }): boolean {
  return Boolean(bot.isChiefOfStaff) || isChiefName(bot.name);
}

/** Name used to address the chief in UI copy. */
export const CHIEF_DISPLAY_NAME = 'Chief';
