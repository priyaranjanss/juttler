import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useRouter } from '../../router';
import { BotBlobAvatar } from '../common/BotBlobAvatar';
import { Markdown } from './Markdown';
import { PluginLogo } from '../common/PluginLogo';
import {
  Message,
  Bot,
} from '../../types';
import { api } from '../../services/api';
import {
  Mic,
  ShieldAlert,
  Terminal,
  Copy,
  Check,
  Plus,
  ArrowUp,
  AlertTriangle,
  Settings,
  Loader2,
  GitBranch,
  Wrench,
  CheckCircle2,
  XCircle,
  ChevronRight,
} from 'lucide-react';

/** Short human line under a workspace-tool card. */
function summariseWorkspaceArgs(toolName: string, args: Record<string, any> | undefined): string {
  const a = args || {};
  switch (toolName) {
    case 'create_bot':
      return [a.name, a.role_title].filter(Boolean).join(' â€” ');
    case 'update_bot':
    case 'delete_bot':
      return String(a.bot_name || '');
    case 'set_bot_tools': {
      const tools = typeof a.tools === 'string' ? a.tools.split(',').filter(Boolean) : [];
      return `${a.bot_name || ''} â†’ ${tools.length ? tools.join(', ') : 'no tools'} (${a.plugin_slug || ''})`;
    }
    case 'connect_plugin':
    case 'disconnect_plugin':
    case 'get_plugin_requirements':
      return String(a.plugin_slug || '');
    default:
      return '';
  }
}

// The Chief of Staff hands work to specialists with this tool; the chat renders
// it as a delegation card rather than a raw tool call.
const DELEGATE_TOOL = 'delegate_to_bot';

// Chief of Staff workspace-management tools, rendered as their own cards
// rather than raw tool-call JSON.
const WORKSPACE_TOOL_LABELS: Record<string, string> = {
  get_team_roster: 'Checking the team roster',
  create_bot: 'Creating a Bot',
  update_bot: 'Updating a Bot',
  delete_bot: 'Deleting a Bot',
  set_bot_tools: 'Setting a Bot\'s tools',
  list_plugins: 'Listing plugins',
  get_plugin_requirements: 'Checking what a plugin needs',
  connect_plugin: 'Connecting a plugin',
  disconnect_plugin: 'Disconnecting a plugin',
};

interface GrokChatViewProps {
  // Opens the bot settings column, or closes it if this bot is already shown.
  onToggleSettings: (bot: Bot) => void;
  /** Opens the Plugins dialog, optionally on one plugin's detail view. */
  onRequestPlugin: (slug?: string) => void;
}

export const GrokChatView: React.FC<GrokChatViewProps> = ({
  onToggleSettings,
  onRequestPlugin,
}) => {
  const {
    currentUser,
    bots,
    conversations,
    selectedConversationId,
    setSelectedConversationId,
    showToast,
    refreshData,
    theme,
    openChatWithBot,
    isWorkspaceLoading,
    plugins,
    installedPlugins,
  } = useApp();

  /** Display name for a plugin slug, used by the "connect this" card. */
  const pluginNameFor = useCallback(
    (slug: string) => plugins.find((p) => p.slug === slug)?.name ?? null,
    [plugins]
  );

  const isDark = theme === 'dark';
  const { path, navigate } = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [messageLoadError, setMessageLoadError] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [expandedToolCalls, setExpandedToolCalls] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  // Approval id currently being resolved, so we can show a spinner on that card
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  // Plugin @ mention in the composer
  const [isPluginMentionOpen, setIsPluginMentionOpen] = useState(false);
  const [pluginMention, setPluginMention] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Current active conversation
  const currentConv =
    conversations.find((c) => c.id === selectedConversationId) || conversations[0];

  // Primary active bot in conversation
  const activeBotInThread =
    bots.find((b) => currentConv?.participantBotIds?.includes(b.id)) ||
    bots.find((b) => b.isChiefOfStaff) ||
    bots[0];

  // Load messages whenever the selected conversation changes; ignore stale
  // responses if the user switches conversations before a request completes.
  const fetchMessages = async () => {
    if (!currentConv) return;
    setIsMessagesLoading(true);
    setMessageLoadError(false);
    try {
      const msgs = await api.getMessages(currentConv.id);
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to load messages:', err);
      setMessageLoadError(true);
    } finally {
      setIsMessagesLoading(false);
    }
  };

  useEffect(() => {
    let isCurrent = true;
    if (!currentConv) {
      setMessages([]);
      setIsMessagesLoading(false);
      setMessageLoadError(false);
      return () => {
        isCurrent = false;
      };
    }

    setMessages([]);
    setIsMessagesLoading(true);
    setMessageLoadError(false);
    api.getMessages(currentConv.id)
      .then((loadedMessages) => {
        if (isCurrent) setMessages(loadedMessages);
      })
      .catch((error) => {
        if (!isCurrent) return;
        console.error('Failed to load messages:', error);
        setMessageLoadError(true);
      })
      .finally(() => {
        if (isCurrent) setIsMessagesLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [currentConv?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Auto-grow textarea. Typing "@" opens a plugin mention list, so the user can
  // point a bot at a connected service without remembering tool names.
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputText(value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }

    const lastWord = value.split(/\s+/).pop() || '';
    if (lastWord.startsWith('@')) {
      setPluginMention(lastWord.slice(1).toLowerCase());
      setIsPluginMentionOpen(true);
    } else {
      setIsPluginMentionOpen(false);
    }
  };

  const insertPluginMention = (slug: string) => {
    const words = inputText.split(/\s+/);
    words.pop();
    setInputText([...words, `@${slug} `].join(' '));
    setIsPluginMentionOpen(false);
    textareaRef.current?.focus();
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputText;
    if (!textToSend.trim() || isSending || !currentConv) return;

    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsPluginMentionOpen(false);
    setIsSending(true);

    // Optimistically add user message
    const optimisticMsg: Message = {
      id: `temp_${Date.now()}`,
      conversationId: currentConv.id,
      senderType: 'user',
      senderId: currentUser.id,
      senderName: currentUser.name,
      content: textToSend,
      type: 'text',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const response = await api.sendChatMessage({
        conversationId: currentConv.id,
        userId: currentUser.id,
        messageContent: textToSend,
        targetBotId: activeBotInThread?.id,
      });

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticMsg.id),
        ...response.messages,
      ]);
      await refreshData();
    } catch (err) {
      console.error('Failed to send message:', err);
      showToast('Error communicating with bot', 'warning');
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyMessage = (msgId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(msgId);
    showToast('Copied to clipboard', 'info');
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // Approving runs the tool for real through the gateway and returns its result
  const handleApproveApproval = async (approvalId: string) => {
    setResolvingApprovalId(approvalId);
    try {
      const { approval, toolResult } = await api.resolveApproval(approvalId, { status: 'approved' });

      // The backend may have run the tool; if it attached a result, show it
      if (toolResult) {
        setMessages((prev) => [...prev, toolResult]);
      } else {
        await fetchMessages();
      }
      showToast(`${approval.botName} executed ${approval.toolName}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Approval failed', 'warning');
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const handleRejectApproval = async (approvalId: string) => {
    setResolvingApprovalId(approvalId);
    try {
      await api.resolveApproval(approvalId, { status: 'rejected', rejectionReason: 'Rejected by user' });
      showToast('Action rejected', 'warning');
      await fetchMessages();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rejection failed', 'warning');
    } finally {
      setResolvingApprovalId(null);
    }
  };

  const toggleToolCallExpanded = (callId: string) => {
    setExpandedToolCalls((prev) => ({ ...prev, [callId]: !prev[callId] }));
  };

  // Tool activity is internal plumbing: the roster lookup a Chief runs, the raw
  // payload a tool returned, and a specialist hand-off are all hidden from the
  // thread. The bot's own answer is what the user reads.
  //
  // Two exceptions, both of which ask the user to do something and so must stay
  // visible: approval cards, and the "connect this service" card carried by a
  // tool result that reports a missing plugin.
  const visibleMessages = messages.filter((m) => {
    if (m.type === 'tool_call') return false;
    if (m.type === 'tool_result') return Boolean(m.metadata?.missingPluginSlug);
    return true;
  });

  // Status Indicator
  const statusBadge =
    activeBotInThread?.status === 'working' ? (
      <span className="flex items-center space-x-1 text-[11px] font-semibold text-purple-400">
        <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
        <span>Working...</span>
      </span>
    ) : activeBotInThread?.status === 'waiting_approval' ? (
      <span className="flex items-center space-x-1 text-[11px] font-semibold text-amber-400">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
        <span>Waiting for your approval</span>
      </span>
    ) : (
      <span className="text-[11px] text-[#71767b]">Active</span>
    );

  // Bot id taken from /workspace/chat/:botId
  const botIdFromUrl = useMemo(() => {
    const segments = path.split('/');
    return segments[1] === 'workspace' && segments[2] === 'chat' ? segments[3] || null : null;
  }, [path]);

  // The URL is the source of truth for which bot's chat is open. This covers
  // first load, refresh, shared links, and back/forward navigation.
  useEffect(() => {
    if (!currentUser || bots.length === 0) return;

    // Missing bot id -> send the user to the Chief bot's URL
    if (!botIdFromUrl) {
      const chief = bots.find((b) => b.isChiefOfStaff) || bots[0];
      if (chief) {
        navigate(`/workspace/chat/${chief.id}`);
      }
      return;
    }

    // Unknown bot id -> same fallback
    if (!bots.some((b) => b.id === botIdFromUrl)) {
      const chief = bots.find((b) => b.isChiefOfStaff) || bots[0];
      if (chief && botIdFromUrl !== chief.id) {
        navigate(`/workspace/chat/${chief.id}`);
      }
      return;
    }

    // Already showing this bot? Then nothing to do.
    const activeConv = conversations.find((c) => c.id === selectedConversationId);
    if (activeConv && activeConv.participantBotIds[0] === botIdFromUrl) return;

    openChatWithBot(botIdFromUrl);
  }, [botIdFromUrl, bots, conversations, selectedConversationId, currentUser, navigate, openChatWithBot]);

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 h-screen overflow-hidden transition-colors ${
        isDark ? 'bg-[#0a0b0d] text-[#e7e9ea]' : 'bg-white text-[#0f1419]'
      }`}
    >
      {/* Header Bar */}
      <header
        className={`h-14 shrink-0 border-b px-6 flex items-center justify-between backdrop-blur-md sticky top-0 z-10 transition-colors ${
          isDark
            ? 'border-[#26292d] bg-[#0a0b0d]/90 text-white'
            : 'border-[#e5e7eb] bg-white/90 text-[#0f1419]'
        }`}
      >
        <div className="flex items-center space-x-3 min-w-0">
          <BotBlobAvatar
            name={activeBotInThread?.name || 'Chief'}
            avatarShape={activeBotInThread?.avatar}
            color={activeBotInThread?.color}
            size={36}
          />

          <div className="min-w-0 text-left">
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-extrabold truncate">
                {activeBotInThread?.name || 'Chief'}
              </h2>
              {activeBotInThread?.isChiefOfStaff && (
                <span className="rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-[9px] font-mono font-bold px-2 py-0.2 shrink-0">
                  Chief
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <span className={`text-[11px] truncate ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                {activeBotInThread?.roleTitle || 'Chief'}
              </span>
              <span className="text-[10px] text-[#71767b]">Â·</span>
              {statusBadge}
            </div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => showToast('Voice call feature active', 'info')}
            className={`p-2 rounded-full transition ${
              isDark ? 'hover:bg-[#16181c] text-[#71767b] hover:text-white' : 'hover:bg-[#f0f2f5] text-[#536471] hover:text-black'
            }`}
            title="Voice / Call"
          >
            <Mic className="h-4 w-4" />
          </button>

          <button
            onClick={() => activeBotInThread && onToggleSettings(activeBotInThread)}
            className={`p-2 rounded-full transition ${
              isDark ? 'hover:bg-[#16181c] text-[#71767b] hover:text-white' : 'hover:bg-[#f0f2f5] text-[#536471] hover:text-black'
            }`}
            title="Bot settings"
            aria-label={`Settings for ${activeBotInThread?.name || 'bot'}`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Message Stream */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden no-scrollbar px-4 sm:px-6 py-5 space-y-5 max-w-3xl w-full mx-auto">
        {(isWorkspaceLoading || isMessagesLoading) && messages.length === 0 ? (
          <div
            role="status"
            aria-label="Loading conversation"
            className="mx-auto flex min-h-[50vh] w-full max-w-xl flex-col justify-center gap-5"
          >
            <span className="sr-only">Loading conversationâ€¦</span>
            <div className={`h-16 w-3/4 animate-pulse rounded-2xl ${isDark ? 'bg-[#181a1f]' : 'bg-[#f0f2f5]'}`} />
            <div className={`ml-auto h-12 w-2/3 animate-pulse rounded-2xl ${isDark ? 'bg-[#202327]' : 'bg-[#e9edf0]'}`} />
            <div className={`h-24 w-4/5 animate-pulse rounded-2xl ${isDark ? 'bg-[#181a1f]' : 'bg-[#f0f2f5]'}`} />
            <div className="flex items-center justify-center gap-2 text-xs text-[#71767b]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading conversation</span>
            </div>
          </div>
        ) : messageLoadError && messages.length === 0 ? (
          <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
            <p className={`text-sm ${isDark ? 'text-[#8b9299]' : 'text-[#536471]'}`}>
              This conversation couldnâ€™t be loaded.
            </p>
            <button
              onClick={() => void fetchMessages()}
              className="rounded-full bg-purple-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-purple-500"
            >
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4 pt-12">
            <BotBlobAvatar
              name={activeBotInThread?.name || 'Chief'}
              avatarShape={activeBotInThread?.avatar}
              color={activeBotInThread?.color}
              size={64}
            />

            <div className="space-y-1 max-w-md">
              <h2 className="text-xl font-extrabold tracking-tight">
                {activeBotInThread?.name || 'Chief'}
              </h2>
              <p className={`text-xs ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                {activeBotInThread?.roleTitle || 'Chief'}
              </p>
              {activeBotInThread?.systemPrompt && (
                <p className={`text-xs italic pt-2 ${isDark ? 'text-[#8b9299]' : 'text-[#536471]'}`}>
                  "{activeBotInThread.systemPrompt}"
                </p>
              )}
            </div>

            {/* Suggested prompts */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-3 max-w-lg">
              <button
                onClick={() => handleSendMessage('What can you help me with?')}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
                  isDark
                    ? 'border-[#26292d] bg-[#121418] text-[#e7e9ea] hover:bg-[#1c1e22]'
                    : 'border-[#e5e7eb] bg-[#f8f9fa] text-[#0f1419] hover:bg-[#e5e7eb]'
                }`}
              >
                What can you help me with?
              </button>
              <button
                onClick={() => handleSendMessage('Search the web for the latest news')}
                className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
                  isDark
                    ? 'border-[#26292d] bg-[#121418] text-[#e7e9ea] hover:bg-[#1c1e22]'
                    : 'border-[#e5e7eb] bg-[#f8f9fa] text-[#0f1419] hover:bg-[#e5e7eb]'
                }`}
              >
                Search the web
              </button>
            </div>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isUser = msg.senderType === 'user';
            // Tool identity for this message, so card conditions stay readable
            const toolCall = msg.metadata?.toolCall;
            const toolName = toolCall?.toolName;
            const isDelegation = toolName === DELEGATE_TOOL;
            const isWorkspaceToolCall = toolName !== undefined && WORKSPACE_TOOL_LABELS[toolName] !== undefined;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1`}
              >
                {/* Sender Title */}
                <div className="flex items-center space-x-2 px-1 text-[11px] opacity-70">
                  <span className="font-bold">{isUser ? currentUser.name : msg.senderName}</span>
                  <span>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* Message Bubble */}
                {msg.type === 'text' && (
                  <div
                    className={`max-w-xl text-xs sm:text-sm p-3.5 px-4 rounded-[20px] leading-relaxed group relative ${
                      isUser
                        ? isDark
                          ? 'bg-[#1e2025] text-white rounded-tr-md'
                          : 'bg-[#0f1419] text-white rounded-tr-md shadow-sm'
                        : isDark
                        ? 'bg-[#181a1f] text-[#e7e9ea] rounded-tl-md'
                        : 'bg-[#f0f2f5] text-[#0f1419] rounded-tl-md'
                    }`}
                  >
                    {/* Bot replies render markdown; the user's own text stays literal */}
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <Markdown content={msg.content} isDark={isDark} />
                    )}

                    {!isUser && (
                      <button
                        onClick={() => handleCopyMessage(msg.id, msg.content)}
                        className={`absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 transition ${
                          isDark ? 'hover:bg-[#202327] text-[#71767b]' : 'hover:bg-white text-[#536471]'
                        }`}
                        title="Copy"
                      >
                        {copiedMessageId === msg.id ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* Delegation card â€” Chief handing work to a specialist */}
                {msg.type === 'tool_call' && isDelegation && toolCall && (
                  <div
                    className={`w-full max-w-xl rounded-2xl border p-3 text-xs ${
                      isDark ? 'border-[#2f3336] bg-[#121418]' : 'border-[#e5e7eb] bg-[#f8f9fa]'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <GitBranch className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                      <span className="font-bold">
                        Delegated to {String(toolCall.args?.bot_name || 'a specialist')}
                      </span>
                    </div>
                    {toolCall.args?.brief && (
                      <p className={`mt-1.5 leading-relaxed ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                        {String(toolCall.args.brief)}
                      </p>
                    )}
                  </div>
                )}

                {/* Workspace-management card â€” Chief adding bots / plugins */}
                {msg.type === 'tool_call' && isWorkspaceToolCall && toolCall && (
                  <div
                    className={`w-full max-w-xl rounded-2xl border p-3 text-xs ${
                      isDark ? 'border-[#2f3336] bg-[#121418]' : 'border-[#e5e7eb] bg-[#f8f9fa]'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                      <span className="font-bold">{WORKSPACE_TOOL_LABELS[toolName!]}</span>
                    </div>
                    {summariseWorkspaceArgs(toolName!, toolCall.args) && (
                      <p className={`mt-1.5 text-[11px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                        {summariseWorkspaceArgs(toolName!, toolCall.args)}
                      </p>
                    )}
                  </div>
                )}

                {/* Tool Call Card */}
                {msg.type === 'tool_call' && toolCall && !isDelegation && !isWorkspaceToolCall && (
                  <div
                    className={`w-full max-w-xl rounded-2xl border p-3 text-xs font-mono ${
                      isDark ? 'border-[#26292d] bg-[#121418]' : 'border-[#e5e7eb] bg-[#f8f9fa]'
                    }`}
                  >
                    <button
                      onClick={() => toggleToolCallExpanded(msg.metadata!.toolCall!.callId)}
                      className="w-full flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2">
                        <Terminal className="h-3.5 w-3.5 text-purple-400" />
                        <span>Invoking tool: <strong>{toolCall.toolName}</strong></span>
                      </div>
                      <span className={`text-[10px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                        {expandedToolCalls[toolCall.callId] ? 'Hide' : 'Inspect'}
                      </span>
                    </button>
                    {expandedToolCalls[toolCall.callId] && (
                      <pre
                        className={`mt-2 p-2 rounded-lg border font-mono text-[10px] overflow-x-auto ${
                          isDark ? 'bg-black border-[#26292d] text-[#71767b]' : 'bg-white border-[#e5e7eb] text-[#536471]'
                        }`}
                      >
                        {JSON.stringify(toolCall.args, null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                {/* Tool result - the real payload a tool returned. Hidden when
                    this message is really a "connect this service" prompt, which
                    has its own card below. */}
                {msg.type === 'tool_result' && msg.metadata?.toolResult && !msg.metadata?.missingPluginSlug && (
                  <div
                    className={`w-full max-w-xl rounded-2xl border p-3 text-xs space-y-2 ${
                      msg.metadata.toolResult.status === 'error'
                        ? isDark
                          ? 'border-rose-500/40 bg-rose-500/5'
                          : 'border-rose-200 bg-rose-50'
                        : isDark
                          ? 'border-[#26292d] bg-[#121418]'
                          : 'border-[#e5e7eb] bg-[#f8f9fa]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {msg.metadata.toolResult.status === 'error' ? (
                          <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        )}
                        <span className="font-mono font-bold text-[11px]">
                          {msg.metadata.toolResult.toolName}{' '}
                          {msg.metadata.toolResult.status === 'error' ? 'failed' : 'result'}
                        </span>
                      </div>
                      {msg.metadata.toolResult.durationMs ? (
                        <span className={`text-[10px] font-mono ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                          {msg.metadata.toolResult.durationMs}ms
                        </span>
                      ) : null}
                    </div>

                    <pre
                      className={`overflow-x-auto rounded-xl border p-2.5 font-mono text-[10px] max-h-56 ${
                        isDark ? 'border-[#26292d] bg-black text-[#e7e9ea]' : 'border-[#e5e7eb] bg-white text-[#0f1419]'
                      }`}
                    >
                      {typeof msg.metadata.toolResult.result === 'object'
                        ? JSON.stringify(msg.metadata.toolResult.result, null, 2)
                        : String(msg.metadata.toolResult.result ?? '')}
                    </pre>
                  </div>
                )}

                {/* "Connect this service" â€” the bot needs a plugin you don't have */}
                {msg.type === 'tool_result' && msg.metadata?.missingPluginSlug && (
                  <button
                    onClick={() => onRequestPlugin(msg.metadata!.missingPluginSlug!)}
                    className={`w-full max-w-xl flex items-center justify-between rounded-2xl border border-dashed p-3 text-left transition ${
                      isDark ? 'border-[#536471] hover:bg-[#181a1f]' : 'border-[#cfd9de] hover:bg-[#f7f9f9]'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <PluginLogo slug={msg.metadata.missingPluginSlug} size={22} />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold">
                          Connect {pluginNameFor(msg.metadata.missingPluginSlug) || msg.metadata.missingPluginSlug}
                        </p>
                        <p className={`text-[10px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                          Opening the Plugins dialog so you can add it
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#71767b]" />
                  </button>
                )}

                {/* System notice â€” e.g. why the AI couldn't answer */}
                {msg.type === 'system' && (
                  <div
                    className={`w-full max-w-xl flex items-start space-x-2 rounded-2xl border px-3.5 py-2.5 text-[11px] font-medium ${
                      isDark
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="leading-relaxed">{msg.content}</span>
                  </div>
                )}

                {/* Approval Request Card â€” sensitive tool waits here */}
                {msg.type === 'approval_request' && msg.metadata?.approvalId && (
                  <div
                    className={`w-full max-w-xl rounded-2xl border-2 p-4 text-xs space-y-3 shadow-xl ${
                      isDark ? 'border-amber-500/60 bg-[#16181c]' : 'border-amber-400 bg-amber-50/60'
                    }`}
                  >
                    <div className="flex items-center space-x-2 text-amber-500 font-bold uppercase tracking-wider text-[11px]">
                      <ShieldAlert className="h-4 w-4" />
                      <span>Human Authorization Required</span>
                    </div>
                    <p className="text-xs leading-relaxed">{msg.content}</p>

                    {msg.metadata.toolParams && (
                      <pre
                        className={`overflow-x-auto rounded-xl border p-2.5 font-mono text-[10px] ${
                          isDark ? 'border-[#2f3336] bg-black' : 'border-amber-200 bg-white'
                        }`}
                      >
                        {JSON.stringify(msg.metadata.toolParams, null, 2)}
                      </pre>
                    )}

                    {/* Resolved approvals stay visible but stop taking clicks */}
                    {resolvingApprovalId === msg.metadata.approvalId ? (
                      <div className="flex items-center space-x-2 text-[11px] text-[#71767b]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Running...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end space-x-2 pt-1">
                        <button
                          onClick={() => handleRejectApproval(msg.metadata!.approvalId!)}
                          className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3.5 py-1.5 text-[11px] font-bold text-rose-400 transition hover:bg-rose-500/20"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleApproveApproval(msg.metadata!.approvalId!)}
                          className={`rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition ${
                            isDark ? 'border-[#2f3336] bg-[#202327]' : 'border-[#cfd9de] bg-white'
                          }`}
                        >
                          Approve & Run
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer â€” in normal flow, so the message list can never slide under it */}
      <div className="shrink-0 relative w-full max-w-3xl mx-auto px-4 pt-2 pb-4">
        {/* Plugin mention list, opened by typing @ */}
        {isPluginMentionOpen && (
          <div
            className={`absolute bottom-full left-4 z-30 mb-2 w-64 rounded-2xl border shadow-xl p-2 ${
              isDark ? 'bg-[#16181c] border-[#26292d] text-white' : 'bg-white border-[#e5e7eb] text-black'
            }`}
          >
            <p className={`px-2 pb-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`}>
              Connected plugins
            </p>
            {installedPlugins.length === 0 ? (
              <p className={`px-2 py-2 text-[11px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                Nothing connected yet - open Plugins to add one.
              </p>
            ) : (
              <div className="space-y-0.5">
                {plugins
                  .filter(
                    (p) =>
                      installedPlugins.some((i) => i.pluginSlug === p.slug) &&
                      (p.name.toLowerCase().includes(pluginMention) || p.slug.toLowerCase().includes(pluginMention))
                  )
                  .map((p) => (
                    <button
                      key={p.slug}
                      onClick={() => insertPluginMention(p.slug)}
                      className={`flex w-full items-center space-x-2 rounded-xl p-1.5 text-left transition ${
                        isDark ? 'hover:bg-[#202327]' : 'hover:bg-[#f0f2f5]'
                      }`}
                    >
                      <PluginLogo slug={p.slug} size={20} />
                      <span className="text-[11px] font-semibold">{p.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        {/* Soft fade so messages scrolling away look intentional */}
        <div
          className={`pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t to-transparent ${
            isDark ? 'from-[#0a0b0d]' : 'from-white'
          }`}
        />
        <div
          className={`flex items-end space-x-2 p-2 px-3 rounded-full border shadow-xl transition-all ${
            isDark
              ? 'bg-[#16181c] border-[#26292d] focus-within:border-[#536471]'
              : 'bg-white border-[#e5e7eb] focus-within:border-[#cfd9de]'
          }`}
        >
          <button
            onClick={() => showToast('Attachment options open', 'info')}
            className={`p-2 rounded-full transition shrink-0 ${
              isDark ? 'text-[#71767b] hover:text-white hover:bg-[#202327]' : 'text-[#536471] hover:text-black hover:bg-[#f0f2f5]'
            }`}
            title="Attach files or triggers"
          >
            <Plus className="h-5 w-5 stroke-[2.5]" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${activeBotInThread?.name || 'Chief'}...`}
            className="flex-1 bg-transparent border-none text-xs sm:text-sm focus:outline-none resize-none max-h-36 py-2 px-1 placeholder:text-[#71767b]"
          />

          <div className="flex items-center space-x-1.5 shrink-0">
            <button
              onClick={() => showToast('Voice dictation active', 'info')}
              className="h-9 w-9 rounded-full bg-black text-white flex items-center justify-center transition hover:scale-105 shadow-sm shrink-0"
              title="Voice Input"
            >
              <Mic className="h-4 w-4" />
            </button>

            {inputText.trim() && (
              <button
                onClick={() => handleSendMessage()}
                disabled={isSending}
                className={`h-9 w-9 rounded-full flex items-center justify-center transition shrink-0 ${
                  isDark ? 'bg-white text-black hover:bg-[#e7e9ea]' : 'bg-[#0f1419] text-white hover:bg-[#272c30]'
                }`}
                title="Send Message"
              >
                <ArrowUp className="h-4 w-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GrokChatView;
