/**
 * The contract every plugin folder implements.
 *
 * A plugin owns its own metadata, its tools, and - if it supports OAuth - how to
 * talk to the provider. The registry in ./index.ts is the single place the rest
 * of the app looks, so adding a plugin is one new folder plus one line there.
 */

import { PluginAuthType, PluginCredentialSpec, PluginTool } from '../types';
import { ToolExecutor } from './shared';

/** Provider-specific bits of an OAuth 2.0 flow. */
export interface PluginOAuthSpec {
  /** Env var prefix for CLIENT_ID / CLIENT_SECRET, e.g. "GOOGLE". */
  envPrefix: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** Bot/app scopes, sent as `scope`. Empty for user-token-only apps. */
  scope: string;
  /**
   * Separate user scopes, sent as `user_scope`. Slack needs this to hand back a
   * user token (xoxp-) so actions happen as the real person.
   */
  userScope?: string;
  /** Must match the route the provider redirects back to, i.e. the plugin slug. */
  callbackSlug: string;
  /** Extra authorize params, e.g. response_type, access_type, prompt. */
  extraAuthParams: Record<string, string>;
  /**
   * True for providers that reject an authorize URL without response_type
   * (Google). Slack's v2 endpoint does not use it, so it must stay off there.
   */
  requiresResponseType?: boolean;
  /** Slack expects a form-encoded token request; most others take JSON. */
  tokenBodyStyle: 'json' | 'form';
  /** Pulls the usable access token out of the token response. */
  extractToken: (response: any) => string | undefined;
  /** Shapes the token response into the stored credential object. */
  toCredential: (response: any) => Record<string, any>;
  /** Extra account metadata to show in the UI, from the token response. */
  identity: (response: any) => Record<string, any>;
  /** Overrides identity with an authenticated profile fetch when needed. */
  fetchIdentity?: (accessToken: string) => Promise<Record<string, any>>;
  /** Fail the OAuth flow when account identity could not be resolved. */
  identityRequired?: boolean;
}

export interface PluginModule {
  definition: {
    slug: string;
    name: string;
    description: string;
    category: string;
    isOfficial: boolean;
    authType: PluginAuthType;
    /** What connecting this plugin asks the user for. Empty means OAuth-only. */
    requiredCredentials: PluginCredentialSpec[];
    tools: PluginTool[];
  };
  /** Tool name -> implementation. */
  tools: Record<string, ToolExecutor>;
  oauth?: PluginOAuthSpec;
}
