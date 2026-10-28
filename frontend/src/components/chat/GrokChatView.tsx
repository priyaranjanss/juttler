import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useRouter } from '../../router';
import { BotBlobAvatar } from '../common/BotBlobAvatar';
import { Markdown } from './Markdown';
import { PluginLogo } from '../common/PluginLogo';
import { Message, Bot } from '../../types';
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
  FileText,
  Download,
} from 'lucide-react';

/** Short human line under a workspace-tool card. */
function summariseWorkspaceArgs(toolName: string, args: Record<string, any> | undefined): string {
  const a = args || {};
  switch (toolName) {
    case 'create_bot':
      return [a.name, a.role_title].filter(Boolean).join(' — ');
    case 'update_bot':
    case 'delete_bot':
      return String(a.bot_name || '');
    case 'set_bot_tools': {
      const tools = typeof a.tools === 'string' ? a.tools.split(',').filter(Boolean) : [];
      return `${a.bot_name || ''} → ${tools.length ? tools.join(', ') : 'no tools'} (${a.plugin_slug || ''})`;
    }
    case 'connect_plugin':
    case 'disconnect_plugin':
    case 'get_plugin_requirements':
      return String(a.plugin_slug || '');
    default:
      return '';
  }
}

// Copy escalates as the wait grows, so a long turn never looks stalled.
function thinkingLabel(elapsedMs: number): string {
  if (elapsedMs < 3000) return 'Thinking';
  if (elapsedMs < 10000) return 'Working on it';
  if (elapsedMs < 25000) return 'Still working - this can take a while';
  return 'Still on it - gathering what it needs';
}

/** Ticks only while active, so an idle indicator costs nothing. */
function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return elapsed;
}

/** Centred time marker at the top of the thread. */
function chatTimeLabel(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = date.toDateString() === new Date().toDateString();
  if (sameDay) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

/** Image-generation tool results arrive as base64 payloads. */
function renderImageResult(result: any, isDark: boolean) {
  const images: any[] = Array.isArray(result?.images) ? result.images : [];
  if (images.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2">
      {images.map((image, index) => {
        const src = image?.b64_json ? `data:image/png;base64,${image.b64_json}` : image?.url;
        if (!src) return null;
        return (
          <img
            key={`${index}-${image?.revised_prompt ?? ''}`}
            src={src}
            alt={result?.revised_prompt || result?.prompt || 'Generated image'}
            className={`w-full rounded-[10px] border object-cover ${isDark ? 'border-[#2c2c2f]' : 'border-[#e6e6e8]'}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Shown while a reply is being generated, so the wait is visibly alive rather
 * than an empty thread after the user's message.
 */
const ThinkingIndicator: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const elapsed = useElapsed(true);

  return (
    <div className="flex items-center gap-2.5 px-1 py-1" aria-live="polite">
      <div className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full motion-safe:animate-bounce ${
              isDark ? 'bg-[#8e8e93]' : 'bg-[#b0b0b5]'
            }`}
            style={{ animationDelay: `${i * 0.16}s`, animationDuration: '0.9s' }}
          />
        ))}
      </div>
      <span className={`text-[11px] font-medium ${isDark ? 'text-[#8e8e93]' : 'text-[#8e8e93]'}`}>
        {thinkingLabel(elapsed)}
      </span>
    </div>
  );
};

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
  set_bot_tools: "Setting a Bot's tools",
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
  /** Reasoning effort chosen from the settings panel. */
  reasoningMode: 'think' | 'big_brain' | 'off';
  /** Hides the header settings control while the panel is already open. */
  isSettingsOpen: boolean;
}

export const GrokChatView = ({
  onToggleSettings,
  onRequestPlugin,
  reasoningMode,
  isSettingsOpen,
}: GrokChatViewProps) => {
  const {
    currentUser,
    bots,
    conversations,
    selectedConversationId,
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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingConversationIds, setSendingConversationIds] = useState<Set<string>>(() => new Set());
  const [expandedToolCalls, setExpandedToolCalls] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  // Approval id currently being resolved, so we can show a spinner on that card
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(null);
  // Plugin @ mention in the composer
  const [isPluginMentionOpen, setIsPluginMentionOpen] = useState(false);
  const [pluginMention, setPluginMention] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);
  selectedConversationIdRef.current = selectedConversationId;
  const sendingConversationIdsRef = useRef<Set<string>>(new Set());

  // Current active conversation
  const currentConv = conversations.find((c) => c.id === selectedConversationId) || null;
  const inputText = currentConv ? drafts[currentConv.id] || '' : '';
  const isSending = currentConv ? sendingConversationIds.has(currentConv.id) : false;

  // True once a real bot reply has landed in the thread, so the thinking
  // indicator stops even while isSending is still being cleared.
  const hasBotReply = (() => {
    if (!currentConv) return false;
    const last = messages[messages.length - 1];
    return (
      !!last &&
      last.senderType === 'bot' &&
      last.type === 'text' &&
      last.content.trim().length > 0
    );
  })();
  const setInputText = (value: string) => {
    if (!currentConv) return;
    const conversationId = currentConv.id;
    setDrafts((previous) => ({ ...previous, [conversationId]: value }));
  };

  /**
   * The bot this thread is actually addressed to.
   *
   * It is read from the conversation's own participant order, not from the
   * global bot list: a thread created for Devon has participantBotIds ["devon"],
   * and searching the global list first would hand the message to whichever
   * participant happens to appear earliest there — usually the Chief. That is
   * what let a message meant for one bot get answered by another.
   */
  const activeBotInThread = useMemo(() => {
    const participants = currentConv?.participantBotIds ?? [];

    // The first participant is the thread's designated recipient.
    for (const botId of participants) {
      const bot = bots.find((b) => b.id === botId);
      if (bot) return bot;
    }

    return bots.find((b) => b.isChiefOfStaff) || bots[0] || null;
  }, [currentConv?.participantBotIds, bots]);

  // Load messages whenever the selected conversation changes; ignore stale
  // responses if the user switches conversations before a request completes.
  const fetchMessages = async () => {
    if (!currentConv) return;
    const conversationId = currentConv.id;
    setIsMessagesLoading(true);
    setMessageLoadError(false);
    try {
      const msgs = await api.getMessages(conversationId);
      if (selectedConversationIdRef.current === conversationId) setMessages(msgs);
    } catch (err) {
      if (selectedConversationIdRef.current !== conversationId) return;
      console.error('Failed to load messages:', err);
      setMessageLoadError(true);
    } finally {
      if (selectedConversationIdRef.current === conversationId) setIsMessagesLoading(false);
    }
  };

  useEffect(() => {
    let isCurrent = true;
    setIsPluginMentionOpen(false);
    setPluginMention('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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
    api
      .getMessages(currentConv.id)
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
  }, [messages, isSending, currentConv?.id]);

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
    if (!textToSend.trim() || !currentConv) return;

    const conversationId = currentConv.id;
    if (sendingConversationIdsRef.current.has(conversationId)) return;
    sendingConversationIdsRef.current.add(conversationId);
    setSendingConversationIds(new Set(sendingConversationIdsRef.current));

    setDrafts((previous) => ({ ...previous, [conversationId]: '' }));
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsPluginMentionOpen(false);
    // Optimistically add user message
    const optimisticMsg: Message = {
      id: `temp_${Date.now()}`,
      conversationId,
      senderType: 'user',
      senderId: currentUser.id,
      senderName: currentUser.name,
      content: textToSend,
      type: 'text',
      timestamp: new Date().toISOString(),
    };
    if (selectedConversationIdRef.current === conversationId) {
      setMessages((prev) => [...prev, optimisticMsg]);
    }

    try {
      const response = await api.sendChatMessage({
        conversationId,
        userId: currentUser.id,
        messageContent: textToSend,
        targetBotId: activeBotInThread?.id,
        reasoningMode,
      });

      if (selectedConversationIdRef.current === conversationId) {
        const responseIds = new Set(response.messages.map((message) => message.id));
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticMsg.id && !responseIds.has(m.id)),
          ...response.messages.filter((m) => m.conversationId === conversationId),
        ]);
      }
      await refreshData();
    } catch (err) {
      console.error('Failed to send message:', err);
      // Long turns can outlive the browser wait while the server still finishes.
      // Reload the thread so a late reply / tool trail is not lost.
      try {
        const latest = await api.getMessages(conversationId);
        if (selectedConversationIdRef.current === conversationId && latest.length > 0) {
          setMessages(latest.filter((m) => m.conversationId === conversationId));
          const finished = latest.some(
            (m) =>
              m.senderType === 'bot' &&
              m.type === 'text' &&
              new Date(m.timestamp).getTime() >= new Date(optimisticMsg.timestamp).getTime()
          );
          if (finished) {
            showToast('Reply arrived after a slow turn', 'info');
            await refreshData();
            return;
          }
        }
      } catch {
        // fall through to the normal error path
      }
      showToast('Error communicating with bot', 'warning');
      if (selectedConversationIdRef.current === conversationId) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      }
    } finally {
      sendingConversationIdsRef.current.delete(conversationId);
      setSendingConversationIds(new Set(sendingConversationIdsRef.current));
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
      if (toolResult && selectedConversationIdRef.current === toolResult.conversationId) {
        setMessages((prev) => [...prev, toolResult]);
      } else if (!toolResult) {
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
    if (
      activeConv &&
      (activeConv.source ?? 'app') !== 'slack' &&
      activeConv.participantBotIds[0] === botIdFromUrl
    ) {
      return;
    }

    openChatWithBot(botIdFromUrl);
  }, [botIdFromUrl, bots, conversations, selectedConversationId, currentUser, navigate, openChatWithBot]);

  const threadStartedAt = visibleMessages[0]?.timestamp || currentConv?.lastMessageAt;

  const bubbleBase = 'max-w-[85%] rounded-[14px] px-4 py-2.5 text-[13px] leading-[1.5]';
  const userBubble = isDark ? 'bg-[#f5f5f7] text-[#0b0b0c]' : 'bg-[#0b0b0c] text-white';
  const botBubble = isDark ? 'bg-[#1c1c1f] text-[#f5f5f7]' : 'bg-[#f2f2f4] text-[#1c1c1e]';
  const cardBase = isDark ? 'border-[#2c2c2f] bg-[#141416]' : 'border-[#e6e6e8] bg-white';
  const mutedText = 'text-[#8e8e93]';

  return (
    <div
      className={`flex-1 flex flex-col min-w-0 min-h-0 h-screen overflow-hidden transition-colors ${
        isDark ? 'bg-[#0b0b0c] text-[#f5f5f7]' : 'bg-white text-[#1c1c1e]'
      }`}
    >
      {/* Header */}
      <header
        className={`h-14 shrink-0 border-b px-5 flex items-center justify-between ${
          isDark ? 'border-[#232326]' : 'border-[#ededf0]'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <BotBlobAvatar
            name={activeBotInThread?.name || 'Chief'}
            avatarShape={activeBotInThread?.avatar}
            color={activeBotInThread?.color}
            size={28}
          />
          <h2 className="truncate text-[15px] font-semibold">
            {activeBotInThread?.name || 'Chief'}
          </h2>
        </div>

        {!isSettingsOpen && (
          <button
            onClick={() => activeBotInThread && onToggleSettings(activeBotInThread)}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
              isDark ? 'text-[#98989f] hover:bg-[#1c1c1f] hover:text-white' : 'text-[#8e8e93] hover:bg-[#f2f2f4] hover:text-[#1c1c1e]'
            }`}
            title="Bot settings"
            aria-label={`Settings for ${activeBotInThread?.name || 'bot'}`}
          >
            <Settings className="h-[18px] w-[18px] stroke-[1.7]" />
          </button>
        )}
      </header>

      {/* Message stream */}
      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
        <div className="mx-auto w-full max-w-[720px] px-5 py-5">
          {threadStartedAt && visibleMessages.length > 0 && (
            <div className={`pb-5 text-center text-[11px] font-medium ${mutedText}`}>
              {chatTimeLabel(threadStartedAt)}
            </div>
          )}

          {(isWorkspaceLoading || isMessagesLoading) && messages.length === 0 ? (
            <div
              role="status"
              aria-label="Loading conversation"
              className="mx-auto flex min-h-[45vh] w-full flex-col justify-center gap-3"
            >
              <span className="sr-only">Loading conversation…</span>
              <div className={`h-16 w-3/4 animate-pulse rounded-[14px] ${isDark ? 'bg-[#1c1c1f]' : 'bg-[#f2f2f4]'}`} />
              <div className={`ml-auto h-11 w-2/3 animate-pulse rounded-[14px] ${isDark ? 'bg-[#26262a]' : 'bg-[#e6e6e8]'}`} />
              <div className={`h-20 w-4/5 animate-pulse rounded-[14px] ${isDark ? 'bg-[#1c1c1f]' : 'bg-[#f2f2f4]'}`} />
              <div className="skip flex items-center justify-center gap-2 text-[11px] text-[#8e8e93]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading conversation</span>
              </div>
            </div>
          ) : messageLoadError && messages.length === 0 ? (
            <div role="alert" className="flex min-h-[45vh] flex-col items-center justify-center gap-3 text-center">
              <p className={`text-[13px] ${mutedText}`}>This conversation couldn't be loaded.</p>
              <button
                onClick={() => void fetchMessages()}
                className={`rounded-full px-4 py-2 text-[12px] font-semibold transition ${
                  isDark ? 'bg-[#f5f5f7] text-[#0b0b0c] hover:bg-white' : 'bg-[#0b0b0c] text-white hover:bg-[#27272a]'
                }`}
              >
                Try again
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4 text-center">
              <BotBlobAvatar
                name={activeBotInThread?.name || 'Chief'}
                avatarShape={activeBotInThread?.avatar}
                color={activeBotInThread?.color}
                size={56}
              />

              <div className="max-w-md space-y-1">
                <h2 className="text-[17px] font-semibold tracking-tight">
                  {activeBotInThread?.name || 'Chief'}
                </h2>
                <p className={`text-[12px] ${mutedText}`}>
                  {activeBotInThread?.roleTitle || 'Chief'}
                </p>
                {activeBotInThread?.systemPrompt && (
                  <p className={`pt-2 text-[12px] leading-relaxed ${mutedText}`}>
                    {activeBotInThread.systemPrompt}
                  </p>
                )}
              </div>

              <div className="flex max-w-lg flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  onClick={() => handleSendMessage('What can you help me with?')}
                  className={`rounded-full px-3.5 py-2 text-[12px] font-medium transition ${
                    isDark ? 'bg-[#1c1c1f] text-[#f5f5f7] hover:bg-[#26262a]' : 'bg-[#f2f2f4] text-[#1c1c1e] hover:bg-[#e9e9eb]'
                  }`}
                >
                  What can you help me with?
                </button>
                <button
                  onClick={() => handleSendMessage('Search the web for the latest news')}
                  className={`rounded-full px-3.5 py-2 text-[12px] font-medium transition ${
                    isDark ? 'bg-[#1c1c1f] text-[#f5f5f7] hover:bg-[#26262a]' : 'bg-[#f2f2f4] text-[#1c1c1e] hover:bg-[#e9e9eb]'
                  }`}
                >
                  Search the web
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleMessages.map((msg) => {
                const isUser = msg.senderType === 'user';
                const toolCall = msg.metadata?.toolCall;
                const toolName = toolCall?.toolName;
                const isDelegation = toolName === DELEGATE_TOOL;
                const isWorkspaceToolCall = toolName !== undefined && WORKSPACE_TOOL_LABELS[toolName] !== undefined;
                const attachment = msg.metadata?.attachment;

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    {msg.type === 'text' && (
                      <div className={`group relative ${bubbleBase} ${isUser ? userBubble : botBubble}`}>
                        {isUser ? (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        ) : (
                          <Markdown content={msg.content} isDark={isDark} />
                        )}

                        {!isUser && (
                          <button
                            onClick={() => handleCopyMessage(msg.id, msg.content)}
                            className={`absolute -right-8 top-1.5 rounded-full p-1 opacity-0 transition group-hover:opacity-100 ${
                              isDark ? 'text-[#8e8e93] hover:bg-[#1c1c1f] hover:text-white' : 'text-[#8e8e93] hover:bg-[#f2f2f4] hover:text-[#1c1c1e]'
                            }`}
                            title="Copy"
                          >
                            {copiedMessageId === msg.id ? (
                              <Check className="h-3 w-3 text-[#30d158]" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* File attachment carried with a message */}
                    {msg.type === 'text' && attachment && (
                      <div
                        className={`flex w-full max-w-[320px] items-center gap-3 rounded-[10px] border p-2.5 ${
                          isDark ? 'border-[#2c2c2f] bg-[#141416]' : 'border-[#e6e6e8] bg-white'
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            isDark ? 'bg-[#26262a]' : 'bg-[#f2f2f4]'
                          }`}
                        >
                          <FileText className="h-4 w-4 text-[#ff453a]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-semibold">{attachment.fileName}</p>
                          <p className={`text-[10px] ${mutedText}`}>
                            {[attachment.pageCount ? `${attachment.pageCount} pages` : null, attachment.fileSize]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        {attachment.url ? (
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={attachment.fileName}
                            className={`shrink-0 rounded-full p-1.5 transition ${
                              isDark ? 'text-[#98989f] hover:bg-[#26262a] hover:text-white' : 'text-[#8e8e93] hover:bg-[#f2f2f4] hover:text-[#1c1c1e]'
                            }`}
                            aria-label={`Download ${attachment.fileName}`}
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        ) : (
                          <Download className={`h-4 w-4 shrink-0 ${isDark ? 'text-[#48484a]' : 'text-[#c7c7cc]'}`} />
                        )}
                      </div>
                    )}

                    {/* Delegation card - Chief handing work to a specialist */}
                    {msg.type === 'tool_call' && isDelegation && toolCall && (
                      <div className={`w-full max-w-[420px] rounded-[10px] border p-3 text-[12px] ${cardBase}`}>
                        <div className="flex items-center gap-2">
                          <GitBranch className="h-3.5 w-3.5 shrink-0 text-[#bf5af2]" />
                          <span className="font-semibold">
                            Delegated to {String(toolCall.args?.bot_name || 'a specialist')}
                          </span>
                        </div>
                        {toolCall.args?.brief && (
                          <p className={`mt-1.5 leading-relaxed ${mutedText}`}>{String(toolCall.args.brief)}</p>
                        )}
                      </div>
                    )}

                    {/* Workspace-management card - Chief adding bots / plugins */}
                    {msg.type === 'tool_call' && isWorkspaceToolCall && toolCall && (
                      <div className={`w-full max-w-[420px] rounded-[10px] border p-3 text-[12px] ${cardBase}`}>
                        <div className="flex items-center gap-2">
                          <Wrench className="h-3.5 w-3.5 shrink-0 text-[#bf5af2]" />
                          <span className="font-semibold">{WORKSPACE_TOOL_LABELS[toolName!]}</span>
                        </div>
                        {summariseWorkspaceArgs(toolName!, toolCall.args) && (
                          <p className={`mt-1.5 text-[11px] ${mutedText}`}>
                            {summariseWorkspaceArgs(toolName!, toolCall.args)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Tool call card */}
                    {msg.type === 'tool_call' && toolCall && !isDelegation && !isWorkspaceToolCall && (
                      <div className={`w-full max-w-[420px] rounded-[10px] border p-3 text-[12px] font-mono ${cardBase}`}>
                        <button
                          onClick={() => toggleToolCallExpanded(msg.metadata!.toolCall!.callId)}
                          className="flex w-full items-center justify-between"
                        >
                          <span className="flex items-center gap-2">
                            <Terminal className="h-3.5 w-3.5 text-[#bf5af2]" />
                            <span>
                              Invoking tool: <strong>{toolCall.toolName}</strong>
                            </span>
                          </span>
                          <span className={`text-[10px] ${mutedText}`}>
                            {expandedToolCalls[toolCall.callId] ? 'Hide' : 'Inspect'}
                          </span>
                        </button>
                        {expandedToolCalls[toolCall.callId] && (
                          <pre
                            className={`mt-2 overflow-x-auto rounded-lg border p-2 font-mono text-[10px] ${
                              isDark ? 'border-[#2c2c2f] bg-black text-[#98989f]' : 'border-[#e6e6e8] bg-[#fafafa] text-[#6e6e73]'
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
                        className={`w-full max-w-[420px] space-y-2 rounded-[10px] border p-3 text-[12px] ${
                          msg.metadata.toolResult.status === 'error'
                            ? 'border-[#ff6961]/40 bg-[#ff6961]/5'
                            : cardBase
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {msg.metadata.toolResult.status === 'error' ? (
                              <XCircle className="h-3.5 w-3.5 shrink-0 text-[#ff453a]" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#30d158]" />
                            )}
                            <span className="font-mono text-[11px] font-semibold">
                              {msg.metadata.toolResult.toolName}{' '}
                              {msg.metadata.toolResult.status === 'error' ? 'failed' : 'result'}
                            </span>
                          </div>
                          {msg.metadata.toolResult.durationMs ? (
                            <span className={`text-[10px] font-mono ${mutedText}`}>
                              {msg.metadata.toolResult.durationMs}ms
                            </span>
                          ) : null}
                        </div>

                        <pre
                            className={`max-h-56 overflow-x-auto rounded-lg border p-2.5 font-mono text-[10px] ${
                              isDark ? 'border-[#2c2c2f] bg-black text-[#f5f5f7]' : 'border-[#e6e6e8] bg-white text-[#1c1c1e]'
                            }`}
                          >
                            {typeof msg.metadata.toolResult.result === 'object'
                              ? JSON.stringify(msg.metadata.toolResult.result, null, 2)
                              : String(msg.metadata.toolResult.result ?? '')}
                          </pre>
                      </div>
                    )}

                    {/* "Connect this service" - the bot needs a plugin you don't have */}
                    {msg.type === 'tool_result' && msg.metadata?.missingPluginSlug && (
                      <button
                        onClick={() => onRequestPlugin(msg.metadata!.missingPluginSlug!)}
                        className={`flex w-full max-w-[420px] items-center justify-between rounded-[10px] border border-dashed p-3 text-left transition ${
                          isDark ? 'border-[#48484a] hover:bg-[#1c1c1f]' : 'border-[#d1d1d6] hover:bg-[#f7f7f8]'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <PluginLogo slug={msg.metadata.missingPluginSlug} size={22} />
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold">
                              Connect {pluginNameFor(msg.metadata.missingPluginSlug) || msg.metadata.missingPluginSlug}
                            </p>
                            <p className={`text-[10px] ${mutedText}`}>Opening the Plugins dialog so you can add it</p>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#8e8e93]" />
                      </button>
                    )}

                    {/* System notice - e.g. why the AI couldn't answer */}
                    {msg.type === 'system' && (
                      <div
                        className={`flex w-full max-w-[420px] items-start gap-2 rounded-[10px] border px-3.5 py-2.5 text-[11px] font-medium ${
                          isDark
                            ? 'border-[#5c4a1f] bg-[#2a220f] text-[#ffd60a]'
                            : 'border-[#f0d9a8] bg-[#fff8e8] text-[#8a6100]'
                        }`}
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="leading-relaxed">{msg.content}</span>
                      </div>
                    )}

                    {/* Approval request card - a sensitive tool waits here */}
                    {msg.type === 'approval_request' && msg.metadata?.approvalId && (
                      <div
                        className={`w-full max-w-[460px] space-y-3 rounded-[10px] border p-4 text-[12px] ${
                          isDark ? 'border-[#5c4a1f] bg-[#1c1911]' : 'border-[#f0d9a8] bg-[#fffaf0]'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#ff9f0a]">
                          <ShieldAlert className="h-4 w-4" />
                          <span>Human authorization required</span>
                        </div>
                        <p className="text-[12px] leading-relaxed">{msg.content}</p>

                        {msg.metadata.toolParams && (
                          <pre
                            className={`overflow-x-auto rounded-lg border p-2.5 font-mono text-[10px] ${
                              isDark ? 'border-[#2c2c2f] bg-black' : 'border-[#f0d9a8] bg-white'
                            }`}
                          >
                            {JSON.stringify(msg.metadata.toolParams, null, 2)}
                          </pre>
                        )}

                        {/* Resolved approvals stay visible but stop taking clicks */}
                        {resolvingApprovalId === msg.metadata.approvalId ? (
                          <div className={`flex items-center gap-2 text-[11px] ${mutedText}`}>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Running…</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              onClick={() => handleRejectApproval(msg.metadata!.approvalId!)}
                              className={`rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
                                isDark ? 'bg-[#2c2c2f] text-[#ff6961] hover:bg-[#333336]' : 'bg-[#f2f2f4] text-[#ff453a] hover:bg-[#e9e9eb]'
                              }`}
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => handleApproveApproval(msg.metadata!.approvalId!)}
                              className={`rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition ${
                                isDark ? 'bg-[#f5f5f7] text-[#0b0b0c] hover:bg-white' : 'bg-[#0b0b0c] text-white hover:bg-[#27272a]'
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
              })}
            </div>
          )}

          {/* Reply in progress - keeps the wait visibly alive */}
          {isSending && !isMessagesLoading && !hasBotReply && <div className="pt-3"><ThinkingIndicator isDark={isDark} /></div>}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="relative w-full shrink-0">
        <div className="mx-auto w-full max-w-[720px] px-5 pb-5 pt-2">
          {/* Plugin mention list, opened by typing @ */}
          {isPluginMentionOpen && (
            <div
              className={`absolute bottom-full left-5 z-30 mb-1 w-64 rounded-[10px] border p-2 shadow-lg ${
                isDark ? 'border-[#2c2c2f] bg-[#1c1c1f] text-[#f5f5f7]' : 'border-[#e6e6e8] bg-white text-[#1c1c1e]'
              }`}
            >
              <p className={`px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>
                Connected plugins
              </p>
              {installedPlugins.length === 0 ? (
                <p className={`px-2 py-2 text-[11px] ${mutedText}`}>
                  Nothing connected yet - open Plugins to add one.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {plugins
                    .filter(
                      (p) =>
                        installedPlugins.some((i) => i.pluginSlug === p.slug) &&
                        (p.name.toLowerCase().includes(pluginMention) ||
                          p.slug.toLowerCase().includes(pluginMention))
                    )
                    .map((p) => (
                      <button
                        key={p.slug}
                        onClick={() => insertPluginMention(p.slug)}
                        className={`flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition ${
                          isDark ? 'hover:bg-[#26262a]' : 'hover:bg-[#f2f2f4]'
                        }`}
                      >
                        <PluginLogo slug={p.slug} size={20} />
                        <span className="text-[11px] font-medium">{p.name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          <div
            className={`flex items-end gap-2 rounded-full border py-1.5 pl-2 pr-2 transition ${
              isDark
                ? 'border-[#2c2c2f] bg-[#141416] focus-within:border-[#3a3a3d]'
                : 'border-[#e6e6e8] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.05)] focus-within:border-[#d1d1d6]'
            }`}
          >
            <button
              onClick={() => showToast('Attachment options open', 'info')}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
                isDark
                  ? 'bg-[#26262a] text-[#f5f5f7] hover:bg-[#2f2f33]'
                  : 'bg-[#f2f2f4] text-[#3a3a3c] hover:bg-[#e9e9eb]'
              }`}
              title="Attach files or triggers"
              aria-label="Attach"
            >
              <Plus className="h-[18px] w-[18px] stroke-[2]" />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${activeBotInThread?.name || 'Chief'}`}
              className={`max-h-32 flex-1 resize-none bg-transparent py-2 text-[13px] leading-relaxed outline-none placeholder:text-[#8e8e93]`}
            />

            {inputText.trim() && (
              <button
                onClick={() => handleSendMessage()}
                disabled={isSending}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                  isDark ? 'bg-[#f5f5f7] text-[#0b0b0c] hover:bg-white' : 'bg-[#0b0b0c] text-white hover:bg-[#27272a]'
                }`}
                title="Send Message"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4 stroke-[2.2]" />
              </button>
            )}

            <button
              onClick={() => showToast('Voice dictation active', 'info')}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                isDark ? 'bg-[#f5f5f7] text-[#0b0b0c] hover:bg-white' : 'bg-[#0b0b0c] text-white hover:bg-[#27272a]'
              }`}
              title="Voice Input"
              aria-label="Voice input"
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GrokChatView;
