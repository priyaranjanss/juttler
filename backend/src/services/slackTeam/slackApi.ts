const SLACK_API = (process.env.SLACK_API_BASE || 'https://slack.com/api').replace(/\/+$/, '');

export class SlackApiError extends Error {
  code: string;
  details: string;

  constructor(method: string, code: string, details = '') {
    super(details ? `Slack ${method} failed: ${details}` : `Slack ${method} failed: ${code}`);
    this.code = code;
    this.details = details;
  }
}

/** Slack Web API. Most failures arrive as HTTP 200 with ok:false. */
export async function slackApi(
  token: string,
  method: string,
  body: Record<string, unknown> = {}
): Promise<any> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    errors?: Array<{ message?: string; pointer?: string }>;
    response_metadata?: { messages?: string[] };
  };
  if (!response.ok || data.ok === false) {
    const details = [
      ...(data.errors ?? [])
        .map((entry) => entry.message || entry.pointer)
        .filter(Boolean),
      ...(data.response_metadata?.messages ?? []),
    ].join('; ');
    throw new SlackApiError(method, data.error || `http_${response.status}`, details);
  }
  return data;
}

export const TEAM_BOT_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'users:read',
];

export const TEAM_BOT_EVENTS = [
  'app_mention',
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
];

export function publicBackendUrl(): string {
  const configured = (process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PUBLIC_BACKEND_URL is not set. Team Bot Slack needs this backend’s public https origin so Slack can deliver events.'
    );
  }
  return 'http://localhost:3000';
}

export function frontendUrl(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

/** Slack app names are short. The color must be a 6-digit hex or Slack rejects the manifest. */
export function slackAppName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ').slice(0, 35);
  return trimmed || 'Juttler Bot';
}

export function slackBackground(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366F1';
}
