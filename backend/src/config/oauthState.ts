/**
 * OAuth state store — single-use, user-bound CSRF state for the plugin OAuth
 * flows.
 *
 * State has to survive the round trip to the provider and back, which in
 * practice means surviving a container restart and being reachable from every
 * replica. When Upstash Redis is configured the state lives there; otherwise it
 * falls back to an in-memory map, which is correct for local development but
 * loses in-flight flows on restart.
 *
 * Each user who authorises gets their own state, so their token is bound to
 * them and never to the developer's account.
 */

import { Redis } from '@upstash/redis';

const KEY_PREFIX = 'juttler:oauth:state:';
// Slack suggests 10 minutes; keep it short since this is a one-shot handoff.
const TTL_SECONDS = 10 * 60;

export interface OauthState {
  userId: string;
  pluginSlug: string;
  /** Set when this handoff installs a Team Bot’s own Slack app. */
  slackInstallId?: string;
}

const memory = new Map<string, OauthState & { expiresAt: number }>();
let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

export function isDurableStateStore(): boolean {
  return getRedis() !== null;
}

export async function putOauthState(state: string, value: OauthState): Promise<void> {
  const client = getRedis();

  if (client) {
    await client.set(`${KEY_PREFIX}${state}`, value, { ex: TTL_SECONDS });
    return;
  }

  memory.set(state, { ...value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
}

/** Consumes a state, returning null when it is unknown, expired, or reused. */
export async function consumeOauthState(state: string): Promise<OauthState | null> {
  const client = getRedis();

  if (client) {
    // Read then delete, so a replayed state can never bind twice.
    const key = `${KEY_PREFIX}${state}`;
    const found = (await client.get<OauthState>(key)) ?? null;
    if (!found) return null;
    await client.del(key);
    return found;
  }

  const entry = memory.get(state);
  if (!entry) return null;
  memory.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, pluginSlug: entry.pluginSlug, slackInstallId: entry.slackInstallId };
}
