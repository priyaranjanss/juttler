import { slackApi, SlackApiError, TEAM_BOT_BOT_SCOPES, TEAM_BOT_EVENTS, publicBackendUrl, slackAppName, slackBackground } from './slackApi';

export function eventsUrl(): string {
  return `${publicBackendUrl()}/api/slack/events`;
}

export function installRedirectUrl(): string {
  return `${publicBackendUrl()}/api/slack/team-bots/callback`;
}

export function buildManifest(input: { name: string; description: string; color: string }): Record<string, unknown> {
  const name = slackAppName(input.name);
  return {
    display_information: {
      name,
      description: (input.description || `${name} from Juttler`).slice(0, 140),
      background_color: slackBackground(input.color),
    },
    features: {
      bot_user: {
        display_name: name,
        always_online: true,
      },
    },
    oauth_config: {
      redirect_urls: [installRedirectUrl()],
      scopes: { bot: TEAM_BOT_BOT_SCOPES },
    },
    settings: {
      event_subscriptions: {
        request_url: eventsUrl(),
        bot_events: TEAM_BOT_EVENTS,
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

function configToken(): string {
  const token = (process.env.SLACK_CONFIG_TOKEN || '').trim();
  if (!token) {
    throw new Error(
      'SLACK_CONFIG_TOKEN is not set. Create an app configuration token at https://api.slack.com/apps (Your App Configuration Tokens) and add it to backend/.env. That token is what creates each Team Bot’s own Slack app.'
    );
  }
  return token;
}

export interface SlackAppCredentials {
  appId: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

/**
 * Creates the Bot’s Slack app, or updates the manifest when one already exists.
 * An update does not rotate credentials; those stay on the row from create.
 */
export async function upsertSlackApp(input: {
  appId?: string | null;
  name: string;
  description: string;
  color: string;
}): Promise<SlackAppCredentials | null> {
  const manifest = buildManifest(input);
  const token = configToken();

  try {
    if (input.appId) {
      await slackApi(token, 'apps.manifest.update', { app_id: input.appId, manifest });
      return null;
    }

    const created = await slackApi(token, 'apps.manifest.create', { manifest });
    const credentials = created.credentials ?? {};
    if (!created.app_id || !credentials.client_id || !credentials.client_secret || !credentials.signing_secret) {
      throw new Error('Slack created the app but did not return its credentials.');
    }
    return {
      appId: created.app_id,
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      signingSecret: credentials.signing_secret,
    };
  } catch (err) {
    if (err instanceof SlackApiError) {
      throw new Error(err.details || err.message);
    }
    throw err;
  }
}

export async function deleteSlackApp(appId: string): Promise<void> {
  const token = (process.env.SLACK_CONFIG_TOKEN || '').trim();
  if (!token || !appId) return;
  await slackApi(token, 'apps.manifest.delete', { app_id: appId });
}
