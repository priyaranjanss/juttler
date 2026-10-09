import {
  User,
  Bot,
  Conversation,
  Message,
  PluginDefinition,
  PluginInstallation,
  ApprovalRequest,
} from '../../types/index';

const configuredBackendUrl = (import.meta.env.VITE_BACKEND_URL || '').trim();
const backendUrl = configuredBackendUrl
  ? /^https?:\/\//i.test(configuredBackendUrl)
    ? configuredBackendUrl
    : `https://${configuredBackendUrl}`
  : '';
const BASE_URL = backendUrl
  ? `${backendUrl.replace(/\/+$/, '').replace(/\/api$/i, '')}/api`
  : '/api';

let authToken: string | null = null;

export const setAuthToken = (token: string | null): void => {
  authToken = token;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.method && options.method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // response had no JSON body
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

function jsonBody(data: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(data),
  };
}

export const api = {
  // Auth
  async register(data: { name: string; email: string; password: string }): Promise<{ user: User; token: string }> {
    return request('/auth/register', jsonBody(data));
  },

  async login(data: { email: string; password: string }): Promise<{ user: User; token: string }> {
    return request('/auth/login', jsonBody(data));
  },

  async logout(): Promise<{ success: boolean }> {
    return request('/auth/logout', { method: 'POST' });
  },

  async me(): Promise<{ user: User }> {
    return request('/auth/me');
  },

  // Bots
  async getBots(userId: string): Promise<Bot[]> {
    return request(`/bots?userId=${encodeURIComponent(userId)}`);
  },

  async createBot(botData: Partial<Bot>): Promise<Bot> {
    return request('/bots', jsonBody(botData));
  },

  async updateBot(id: string, updates: Partial<Bot>): Promise<Bot> {
    return request(`/bots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async deleteBot(id: string): Promise<{ success: boolean }> {
    return request(`/bots/${id}`, { method: 'DELETE' });
  },

  async verifyBotAi(
    id: string,
    data: { apiKey?: string; endpoint?: string; provider?: string; model?: string }
  ): Promise<{ ok: boolean; message: string; status?: number }> {
    return request(`/bots/${id}/verify-ai`, jsonBody(data));
  },

  async listBotModels(
    provider: string,
    apiKey: string
  ): Promise<{ ok: boolean; models: { id: string; name?: string }[]; message?: string; status?: number }> {
    const url = `/bots/models?provider=${encodeURIComponent(provider)}&apiKey=${encodeURIComponent(apiKey)}`;
    return request(url);
  },

  // Conversations
  async getConversations(userId: string): Promise<Conversation[]> {
    return request(`/conversations?userId=${encodeURIComponent(userId)}`);
  },

  async createConversation(data: {
    userId: string;
    title: string;
    isGroup: boolean;
    participantBotIds: string[];
  }): Promise<Conversation> {
    return request('/conversations', jsonBody(data));
  },

  async getMessages(conversationId: string): Promise<Message[]> {
    return request(`/conversations/${conversationId}/messages`);
  },

  async sendChatMessage(data: {
    conversationId: string;
    userId: string;
    messageContent: string;
    targetBotId?: string;
  }): Promise<{ messages: Message[]; activeBot?: Bot; requiresApproval?: boolean }> {
    return request('/chat', jsonBody(data));
  },

  // Plugins
  async getPlugins(): Promise<PluginDefinition[]> {
    return request('/plugins');
  },

  async getInstalledPlugins(): Promise<PluginInstallation[]> {
    return request('/plugins/installed');
  },

  async connectPlugin(
    slug: string,
    data: { credential: Record<string, any>; metadata?: Record<string, any> }
  ): Promise<PluginInstallation> {
    return request(`/plugins/${encodeURIComponent(slug)}/connect`, jsonBody(data));
  },

  async disconnectPlugin(slug: string): Promise<{ success: boolean }> {
    return request(`/plugins/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  },

  async getBotPluginAccess(botId: string): Promise<Array<{ id: string; pluginSlug: string; enabledTools: string[] }>> {
    return request(`/plugins/available-tools?botId=${encodeURIComponent(botId)}`);
  },

  async setBotPluginAccess(
    botId: string,
    slug: string,
    enabledTools: string[]
  ): Promise<{ id: string; pluginSlug: string; enabledTools: string[] }> {
    return request(`/plugins/bots/${encodeURIComponent(botId)}/plugins/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabledTools }),
    });
  },

  async startPluginOauth(slug: string): Promise<{ authorizeUrl: string }> {
    return request(`/plugins/${encodeURIComponent(slug)}/oauth/start`, { method: 'POST' });
  },

  /** Starts a fresh authorisation for a plugin in "needs_reauth". */
  async reauthPlugin(slug: string): Promise<{ method: string; authorizeUrl?: string }> {
    return request(`/plugins/${encodeURIComponent(slug)}/reauth`, { method: 'POST' });
  },

  /** Spec endpoint: full plugin access picture for one bot. */
  async getBotPluginSettings(botId: string): Promise<
    Array<{
      pluginSlug: string;
      pluginName: string;
      status: string;
      tokenHint: string;
      accessId: string | null;
      enabledTools: string[];
      availableTools: Array<{ name: string; description: string; sensitive: boolean }>;
    }>
  > {
    return request(`/plugins/bots/${encodeURIComponent(botId)}/plugins`);
  },

  /** Spec endpoint: update which tools a bot may use. */
  async updateBotPluginSettings(
    botId: string,
    pluginSlug: string,
    enabledTools: string[]
  ): Promise<{ id: string; pluginSlug: string; enabledTools: string[] }> {
    return request(`/plugins/bots/${encodeURIComponent(botId)}/plugins`, {
      method: 'PATCH',
      body: JSON.stringify({ pluginSlug, enabledTools }),
    });
  },

  // Admin
  async getAdminPluginInstallations(): Promise<
    Array<{
      installationId: string;
      userEmail: string;
      userName: string;
      pluginSlug: string;
      pluginName: string;
      status: string;
      tokenHint: string;
      connectedAt: string;
      botCount: number;
    }>
  > {
    return request('/plugins/admin/installations');
  },

  async getAdminPluginStats(): Promise<
    Array<{ pluginSlug: string; pluginName: string; installations: number; toolCalls: number; failures: number }>
  > {
    return request('/plugins/admin/stats');
  },

  async adminForceDisconnect(installationId: string): Promise<{ success: boolean }> {
    return request(`/plugins/admin/installations/${encodeURIComponent(installationId)}`, { method: 'DELETE' });
  },

  async runToolInConversation(
    conversationId: string,
    data: { toolName: string; args?: Record<string, any> }
  ): Promise<{ outcome: any }> {
    return request(`/conversations/${encodeURIComponent(conversationId)}/run-tool`, jsonBody(data));
  },

  // Approvals
  async resolveApproval(
    id: string,
    data: { status: 'approved' | 'rejected'; rejectionReason?: string }
  ): Promise<{ approval: ApprovalRequest; toolResult?: Message }> {
    return request(`/approvals/${encodeURIComponent(id)}/resolve`, jsonBody(data));
  },
};