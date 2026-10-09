/**
 * Backend-owned domain types.
 *
 * The backend is a standalone service: it deliberately does NOT import from the
 * frontend. The frontend keeps its own copy of these shapes in
 * frontend/src/types/index.ts, so each side deploys independently.
 *
 * If you change a shape here, mirror it there (and vice versa) - the runtime
 * contract between them is the HTTP API, not a shared module.
 */

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

export type AiProvider = 'kilo_gateway';

export type BotStatus = 'idle' | 'working' | 'waiting_approval';

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
  // AI provider wiring, set per bot in the UI
  aiProvider: AiProvider;
  aiEndpoint: string;
  aiModel: string;
  aiApiKey: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageType = 'text' | 'tool_call' | 'tool_result' | 'approval_request' | 'system';

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
    missingPluginSlug?: string;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
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

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

export type PluginAuthType = 'token' | 'oauth';

export interface PluginCredentialSpec {
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
}

export interface PluginTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  sensitive: boolean;
}

export interface PluginDefinition {
  slug: string;
  name: string;
  description: string;
  category: string;
  isOfficial: boolean;
  authType: PluginAuthType;
  tools: PluginTool[];
  requiredCredentials: PluginCredentialSpec[];
}

export interface PluginInstallationView {
  id: string;
  pluginSlug: string;
  status: 'connected' | 'needs_reauth';
  tokenHint: string;
  metadata: Record<string, any>;
  connectedAt: string;
}
