export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

export type BotStatus = 'idle' | 'working' | 'waiting_approval';

// Provider registry keys. Adding an entry here surfaces it in the bot settings
// dropdown; the endpoint is derived from the provider, never typed by hand.
export const AI_PROVIDERS = {
  kilo_gateway: {
    label: 'Kilo Gateway',
    endpoint: 'https://api.kilo.ai/api/gateway',
  },
} as const;

export type AiProvider = keyof typeof AI_PROVIDERS;

export interface Bot {
  id: string;
  userId: string;
  name: string;
  roleTitle: string;
  systemPrompt: string;
  avatar: string;
  color: string;
  allowedTools: string[];
  isChiefOfStaff: boolean;
  status: BotStatus;
  memoryEnabled: boolean;
  // AI provider wiring — set per bot in bot settings, never read from .env
  aiProvider: AiProvider;
  aiEndpoint: string;
  aiModel: string;
  aiApiKey: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageType =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'approval_request'
  | 'system';

export interface ToolCallPayload {
  toolName: string;
  args: Record<string, any>;
  callId: string;
  durationMs?: number;
}

export interface ToolResultPayload {
  toolName: string;
  callId: string;
  result: any;
  status: 'success' | 'error';
  durationMs?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderType: 'user' | 'bot' | 'system';
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  senderColor?: string;
  content: string;
  type: MessageType;
  metadata?: {
    toolCall?: ToolCallPayload;
    toolResult?: ToolResultPayload;
    approvalId?: string;
    actionName?: string;
    toolParams?: Record<string, any>;
    mentionedBotIds?: string[];
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
    };
    /** Plugin needed by this tool result that isn't connected yet. */
    missingPluginSlug?: string;
    attachment?: {
      fileName: string;
      fileSize: string;
      pageCount?: string;
      fileType?: string;
      url?: string;
    };
  };
  timestamp: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  isGroup: boolean;
  participantBotIds: string[];
  lastMessageSnippet?: string;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export type PluginAuthType = 'token' | 'oauth';

export interface PluginTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  /** Sensitive tools require human approval before they execute. */
  sensitive: boolean;
}

/** A field the user must supply to connect a plugin. */
export interface PluginCredentialSpec {
  /** Key stored in the encrypted credential object. */
  key: string;
  /** What to ask the user for, e.g. "Access token". */
  label: string;
  /** Hide the value while typing (tokens/keys), show it plainly (sites/emails). */
  secret: boolean;
  placeholder: string;
}

export interface PluginDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  logo: string;
  category: string;
  isOfficial: boolean;
  authType: PluginAuthType;
  tools: PluginTool[];
  /** What connecting this plugin asks the user for. */
  requiredCredentials: PluginCredentialSpec[];
}

/** Avatar shapes a bot may use (drawn as SVG by BotBlobAvatar). */
export const BOT_AVATAR_SHAPES = [
  'blob',
  'teardrop',
  'cloud',
  'double_drop',
  'circle',
  'bean',
  'oval',
  'triangle',
  'square',
] as const;

export type BotAvatarShape = (typeof BOT_AVATAR_SHAPES)[number];

/** Avatar swatches offered when creating a bot. */
export const BOT_AVATAR_COLORS = [
  '#7C3AED',
  '#38BDF8',
  '#10B981',
  '#2DD4BF',
  '#9A6B4B',
  '#F97316',
  '#FB7185',
  '#EC4899',
  '#6366F1',
] as const;

export interface PluginInstallation {
  id: string;
  pluginSlug: string;
  status: 'connected' | 'needs_reauth';
  /** Non-reversible fingerprint of the stored credential, never the token. */
  tokenHint: string;
  metadata: Record<string, any>;
  connectedAt: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  id: string;
  userId: string;
  botId: string;
  botName: string;
  conversationId?: string;
  actionName: string;
  toolName: string;
  toolParams: Record<string, any>;
  status: ApprovalStatus;
  reason?: string;
  rejectionReason?: string;
  createdTime: string;
  resolvedTime?: string;
  resolvedBy?: string;
}