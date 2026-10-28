import React, { useState, useEffect } from 'react';
import { useApp } from '../../contexts/AppContext';
import { GrokSidebar } from './GrokSidebar';
import { GrokChatView } from '../chat/GrokChatView';
import { CreateBotModal } from '../common/CreateBotModal';
import { PluginsModal } from '../plugins/PluginsModal';
import { BotPluginAccess } from './BotPluginAccess';
import { TeamSlackCard } from './TeamSlackCard';
import { BotBlobAvatar } from '../common/BotBlobAvatar';
import { api } from '../../services/api';
import { Bot, AI_PROVIDERS } from '../../types';
import {
  X,
  ShieldCheck,
  Loader2,
  KeyRound,
  Server,
  CheckCircle2,
  AlertTriangle,
  Save,
  Trash2,
  RefreshCw,
  Boxes,
  ChevronDown,
  Settings2,
  UserRound,
  Activity,
  Cpu,
  Plug,
} from 'lucide-react';

const AVATAR_SHAPES = [
  { id: 'blob', label: 'Blob' },
  { id: 'teardrop', label: 'Teardrop' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'double_drop', label: 'Double Drop' },
  { id: 'circle', label: 'Circle' },
  { id: 'bean', label: 'Bean' },
  { id: 'oval', label: 'Oval' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'square', label: 'Square' },
];

const AVATAR_COLORS = [
  '#7C3AED', '#38BDF8', '#10B981', '#2DD4BF', '#9A6B4B',
  '#F97316', '#FB7185', '#EC4899', '#6366F1',
];

export const UserShell: React.FC = () => {
  const { bots, theme, showToast, refreshData } = useApp();
  const isDark = theme === 'dark';

  // Create Bot modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  // Plugins dialog
  const [isPluginsOpen, setIsPluginsOpen] = useState(false);
  // Plugin to open the dialog on (e.g. when a bot asks for one)
  const [pluginsOpenSlug, setPluginsOpenSlug] = useState<string | null>(null);

  // Settings panel - an inline layout column, never an overlay on top of the chat
  const [settingsBotId, setSettingsBotId] = useState<string | null>(null);

  // Sidebar visibility collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Reasoning effort for the next message, edited in the settings column
  const [reasoningMode, setReasoningMode] = useState<'think' | 'big_brain' | 'off'>('off');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const link = params.get('linkSlack');
    const install = params.get('slackInstall');
    const slackBot = params.get('slackBot');
    const connect = params.get('connect');
    const plugin = params.get('plugin');
    if (!link && !install && !connect) return;

    const linkToken = params.get('token');
    const reason = params.get('slackReason');
    window.history.replaceState({}, '', window.location.pathname);

    if (link === '1') {
      if (!linkToken) {
        showToast('Open Link account from the bot’s message in Slack.', 'warning');
        return;
      }
      void api
        .linkSlackIdentity(linkToken)
        .then((result) => showToast(result.displayName ? `Slack linked as ${result.displayName}` : 'Slack account linked', 'success'))
        .catch((err) => showToast(err instanceof Error ? err.message : 'Could not link Slack', 'warning'));
      return;
    }
    if (link === 'linked') showToast('Slack account linked', 'success');
    if (link === 'noteam') showToast('Create a Team Bot first, then link Slack', 'warning');
    if (link === 'error') showToast('Could not link Slack', 'warning');
    if (slackBot) setSettingsBotId(slackBot);
    if (install === 'connected') showToast('Slack app installed. Check your Slack DMs for a welcome message.', 'success');
    if (install === 'awaiting_admin_approval') showToast('Awaiting admin approval in Slack', 'info');
    if (install === 'pending_install') showToast('Slack install was not finished. Send the request from the bot settings.', 'warning');
    if (install === 'error') showToast(reason || 'Slack install failed', 'warning');
    if (connect && plugin === 'slack') {
      if (connect === 'success') {
        showToast('Slack account connected', 'success');
        void refreshData();
      } else {
        showToast('Slack connection failed. Check the Slack OAuth settings.', 'warning');
      }
    }
  }, [refreshData, showToast]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Always read the freshest copy of the selected bot from the roster
  const settingsBot = settingsBotId ? bots.find((b) => b.id === settingsBotId) || null : null;

  // Opens this bot's settings, or closes the column if it's already showing
  const toggleBotSettings = (bot: Bot) =>
    setSettingsBotId((prev) => (prev === bot.id ? null : bot.id));

  return (
    <div
      className={`flex h-screen min-h-screen w-full overflow-hidden font-sans transition-colors ${
        isDark ? 'bg-[#0b0b0c] text-[#f5f5f7]' : 'bg-white text-[#1c1c1e]'
      }`}
    >
      {/* 1. Left Sidebar */}
      <GrokSidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onOpenCreateBotModal={() => setIsCreateModalOpen(true)}
        onOpenPlugins={() => setIsPluginsOpen(true)}
      />

      {/* 2. Main Center Content View - Chat */}
      <main className="flex-1 min-w-0 h-screen overflow-hidden flex flex-col relative">
        <GrokChatView
          reasoningMode={reasoningMode}
          isSettingsOpen={settingsBot !== null}
          onToggleSettings={toggleBotSettings}
          onRequestPlugin={(slug) => {
            setPluginsOpenSlug(slug ?? null);
            setIsPluginsOpen(true);
          }}
        />
      </main>

      {/* 3. Bot Settings - a real column beside the chat, not a layer on top of it */}
      {settingsBot && (
        <BotSettingsPanel
          key={settingsBot.id}
          bot={settingsBot}
          reasoningMode={reasoningMode}
          onReasoningModeChange={setReasoningMode}
          onClose={() => setSettingsBotId(null)}
          onOpenPlugins={(slug) => {
            setPluginsOpenSlug(slug ?? null);
            setIsPluginsOpen(true);
          }}
        />
      )}

      {/* Create Bot Modal */}
      <CreateBotModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
      {/* Plugins dialog */}
      <PluginsModal
        isOpen={isPluginsOpen}
        initialSlug={pluginsOpenSlug}
        onClose={() => {
          setIsPluginsOpen(false);
          setPluginsOpenSlug(null);
        }}
      />
    </div>
  );
};

interface BotSettingsPanelProps {
  bot: Bot;
  onClose: () => void;
  onOpenPlugins: (slug?: string) => void;
  reasoningMode: 'think' | 'big_brain' | 'off';
  onReasoningModeChange: (mode: 'think' | 'big_brain' | 'off') => void;
}

const BotSettingsPanel: React.FC<BotSettingsPanelProps> = ({
  bot,
  onClose,
  onOpenPlugins,
  reasoningMode,
  onReasoningModeChange,
}) => {
  const { refreshData, showToast, theme, installedPlugins } = useApp();
  const isDark = theme === 'dark';

  // --- Bot details ---
  const [name, setName] = useState(bot.name);
  const [roleTitle, setRoleTitle] = useState(bot.roleTitle);
  const [systemPrompt, setSystemPrompt] = useState(bot.systemPrompt);
  const [avatar, setAvatar] = useState(bot.avatar);
  const [color, setColor] = useState(bot.color);

  // --- AI wiring (all per bot, nothing from .env) ---
  const [aiProvider, setAiProvider] = useState<Bot['aiProvider']>(bot.aiProvider);
  const [aiModel, setAiModel] = useState(bot.aiModel);
  const [apiKey, setApiKey] = useState('');
  const [removeSavedApiKey, setRemoveSavedApiKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Slack, accounts, and AI wiring stay behind the advanced toggle
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const endpoint = AI_PROVIDERS[aiProvider].endpoint;

  // Re-seed the form whenever a different bot is opened
  useEffect(() => {
    setName(bot.name);
    setRoleTitle(bot.roleTitle);
    setSystemPrompt(bot.systemPrompt);
    setAvatar(bot.avatar);
    setColor(bot.color);
    setAiProvider(bot.aiProvider);
    setAiModel(bot.aiModel);
    setApiKey('');
    setRemoveSavedApiKey(false);
    setModels([]);
    setSyncNote(null);
    setVerifyResult(null);
    setShowKey(false);
  }, [bot.id]);

  // Saves the bot's editable details. The API key is only persisted when it
  // changes and has been verified.
  const handleSave = async () => {
    if (!name.trim() || !roleTitle.trim()) {
      showToast('Bot name and role are required', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      await api.updateBot(bot.id, {
        name: name.trim(),
        roleTitle: roleTitle.trim(),
        systemPrompt,
        avatar,
        color,
        aiProvider,
        aiEndpoint: endpoint,
        aiModel: aiModel.trim(),
        ...(aiProvider === 'free_endpoint'
          ? {}
          : removeSavedApiKey
            ? { aiApiKey: null }
            : apiKey.trim()
              ? { aiApiKey: apiKey.trim() }
              : {}),
      });
      await refreshData();
      setApiKey('');
      setRemoveSavedApiKey(false);
      showToast('Bot settings saved', 'success');
      setVerifyResult(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save bot', 'warning');
    } finally {
      setIsSaving(false);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.verifyBotAi(bot.id, {
        apiKey,
        endpoint,
        provider: aiProvider,
        model: aiModel,
      });
      setVerifyResult({ ok: result.ok, message: result.message });
    } catch (err) {
      setVerifyResult({ ok: false, message: err instanceof Error ? err.message : 'Verification failed' });
    } finally {
      setIsVerifying(false);
    }
  };

  // Pulls the model list for this provider using the API key pasted above.
  const handleSyncModels = async () => {
    setIsSyncing(true);
    setSyncNote(null);
    try {
      const result = await api.listBotModels(aiProvider, apiKey, bot.id);
      if (result.ok) {
        setModels(result.models);
        setSyncNote(`Loaded ${result.models.length} model${result.models.length === 1 ? '' : 's'}.`);
        // Drop a now-invalid selection so the dropdown never lies
        if (aiModel && !result.models.some((m) => m.id === aiModel)) {
          setAiModel('');
        }
      } else {
        setModels([]);
        setSyncNote(result.message || "Couldn't load models.");
      }
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : "Couldn't load models.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${bot.name}? This cannot be undone.`)) return;
    setIsDeleting(true);
    try {
      await api.deleteBot(bot.id);
      await refreshData();
      showToast(`${bot.name} deleted`, 'success');
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete bot', 'warning');
    } finally {
      setIsDeleting(false);
    }
  };

  const muted = isDark ? 'text-[#8e8e93]' : 'text-[#8e8e93]';
  const surface = isDark ? 'bg-[#141416]' : 'bg-[#f2f2f4]';
  const divider = isDark ? 'border-[#232326]' : 'border-[#e6e6e8]';

  const inputClasses = `w-full rounded-[10px] border px-3 py-2 text-[13px] transition-colors focus:outline-none ${
    isDark
      ? 'border-transparent bg-[#1c1c1f] text-[#f5f5f7] placeholder:text-[#6e6e73] focus:border-[#3a3a3d]'
      : 'border-transparent bg-[#f2f2f4] text-[#1c1c1e] placeholder:text-[#8e8e93] focus:border-[#d1d1d6] focus:bg-white'
  }`;

  const labelClasses = `mb-1.5 block text-[11px] font-medium ${muted}`;

  const iconButton = `flex h-8 w-8 items-center justify-center rounded-full transition ${
    isDark ? 'text-[#98989f] hover:bg-[#1c1c1f] hover:text-white' : 'text-[#8e8e93] hover:bg-[#f2f2f4] hover:text-[#1c1c1e]'
  }`;

  const statusLabel =
    bot.status === 'working' ? 'Working' : bot.status === 'waiting_approval' ? 'Waiting for approval' : 'Ready';
  const statusTone =
    bot.status === 'working'
      ? isDark
        ? 'bg-[#12301b] text-[#30d158]'
        : 'bg-[#e8f7ec] text-[#1d8a3a]'
      : bot.status === 'waiting_approval'
        ? isDark
          ? 'bg-[#2a220f] text-[#ff9f0a]'
          : 'bg-[#fff4e0] text-[#9a6200]'
        : isDark
          ? 'bg-[#1c1c1f] text-[#98989f]'
          : 'bg-[#f2f2f4] text-[#6e6e73]';

  const detailRow = (icon: React.ReactNode, title: string, value: string) => (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-tight">{title}</p>
        <p className={`mt-0.5 truncate text-[12px] ${muted}`}>{value}</p>
      </div>
    </div>
  );

  return (
    <aside
      className={`shrink-0 w-[372px] xl:w-[400px] h-screen border-l flex flex-col overflow-hidden ${
        isDark ? 'bg-[#0e0e10] border-[#232326]' : 'bg-[#fcfcfd] border-[#e6e6e8]'
      }`}
      aria-label={`${bot.name} settings`}
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-end px-3">
        <button onClick={onClose} className={iconButton} aria-label="Close settings" title="Close">
          <X className="h-[18px] w-[18px] stroke-[1.8]" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 no-scrollbar">
        {/* Profile preview */}
        <div className={`rounded-[10px] p-3 ${surface}`}>
          <div
            className={`relative flex aspect-[16/10] w-full flex-col items-center justify-center overflow-hidden rounded-lg shadow-sm ${
              isDark ? 'bg-[#0b0b0c]' : 'bg-white'
            }`}
          >
            <div
              className="absolute inset-0"
              style={{ background: `radial-gradient(circle at 50% 38%, ${color}26, transparent 68%)` }}
            />
            <div className="relative flex flex-col items-center px-4">
              <BotBlobAvatar name={name || bot.name} avatarShape={avatar} color={color} size={60} />
              <h3 className="mt-3 max-w-full truncate text-[16px] font-semibold leading-tight">
                {name || bot.name}
              </h3>
              <p className={`mt-0.5 max-w-full truncate text-[11px] ${muted}`}>{roleTitle || bot.roleTitle}</p>
              <span className={`mt-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone}`}>
                {statusLabel}
              </span>
            </div>
          </div>
        </div>

        <p className={`mt-3 text-center text-[12px] ${muted}`}>
          {bot.name} · {bot.roleTitle}
        </p>

        {/* Details */}
        <section className="mt-7">
          <h4 className={`px-1 text-[12px] font-semibold ${muted}`}>Details</h4>
          <div className="mt-3 space-y-3.5 px-1">
            {detailRow(<UserRound className="h-[17px] w-[17px] stroke-[1.7] text-[#bf5af2]" />, 'Role', bot.roleTitle)}
            {detailRow(<Activity className="h-[17px] w-[17px] stroke-[1.7] text-[#30d158]" />, 'Status', statusLabel)}
            {detailRow(
              <Cpu className="h-[17px] w-[17px] stroke-[1.7] text-[#0a84ff]" />,
              'AI model',
              aiModel || AI_PROVIDERS[bot.aiProvider].label
            )}
            {detailRow(
              <Plug className="h-[17px] w-[17px] stroke-[1.7] text-[#8e8e93]" />,
              'Connected apps',
              installedPlugins.length > 0 ? `${installedPlugins.length} connected` : 'None connected'
            )}
          </div>
        </section>

        {/* Reasoning effort */}
        <section className="mt-7">
          <h4 className={`px-1 text-[12px] font-semibold ${muted}`}>Reasoning effort</h4>
          <div className={`mt-2.5 flex gap-1 rounded-full p-1 ${isDark ? 'bg-[#1c1c1f]' : 'bg-[#f2f2f4]'}`}>
            {(
              [
                { id: 'off', label: 'Standard' },
                { id: 'think', label: 'Think' },
                { id: 'big_brain', label: 'Big Brain' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                onClick={() => onReasoningModeChange(mode.id)}
                className={`flex-1 rounded-full px-2 py-1.5 text-[11px] font-medium transition ${
                  reasoningMode === mode.id
                    ? isDark
                      ? 'bg-[#f5f5f7] text-[#0b0b0c]'
                      : 'bg-white text-[#1c1c1e] shadow-sm'
                    : muted
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        {/* Profile fields */}
        <section className="mt-7 space-y-3.5">
          <h4 className={`px-1 text-[12px] font-semibold ${muted}`}>Profile</h4>

          <div>
            <label className={labelClasses}>Bot name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Atlas"
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>Role / title</label>
            <input
              type="text"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="e.g. Lead Engineer"
              className={inputClasses}
            />
          </div>

          <div>
            <label className={labelClasses}>System instructions</label>
            <textarea
              rows={4}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="How this bot should behave..."
              className={`${inputClasses} resize-y leading-relaxed`}
            />
          </div>

          <div>
            <label className={labelClasses}>Avatar shape</label>
            <div className="grid grid-cols-3 gap-1.5">
              {AVATAR_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  onClick={() => setAvatar(shape.id)}
                  className={`flex items-center gap-1.5 rounded-[10px] border px-1.5 py-1.5 transition ${
                    avatar === shape.id
                      ? isDark
                        ? 'border-[#8e8e93] bg-[#1c1c1f] text-white'
                        : 'border-[#c7c7cc] bg-white text-[#1c1c1e]'
                      : isDark
                        ? 'border-transparent bg-[#1c1c1f] text-[#98989f] hover:border-[#3a3a3d]'
                        : 'border-transparent bg-[#f2f2f4] text-[#6e6e73] hover:border-[#d1d1d6]'
                  }`}
                >
                  <BotBlobAvatar name="preview" avatarShape={shape.id} color={color} size={20} />
                  <span className="truncate text-[10px] font-medium">{shape.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClasses}>Avatar color</label>
            <div className="flex flex-wrap items-center gap-2">
              {AVATAR_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setColor(swatch)}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-transparent transition"
                  style={{ backgroundColor: swatch }}
                  aria-label={`Color ${swatch}`}
                >
                  {color === swatch && <CheckCircle2 className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Advanced toggle */}
        <button
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className={`mt-7 flex w-full items-center justify-between rounded-[10px] border px-3 py-2.5 text-[12px] font-medium transition ${
            isDark
              ? 'border-[#232326] bg-[#141416] hover:border-[#3a3a3d]'
              : 'border-[#e6e6e8] bg-white hover:border-[#d1d1d6]'
          }`}
          aria-expanded={advancedOpen}
        >
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-[#8e8e93]" />
            Advanced setup
          </span>
          <ChevronDown
            className={`h-4 w-4 text-[#8e8e93] transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {advancedOpen && (
          <div className={`mt-4 space-y-6 border-t pt-5 ${divider}`}>
            <section>
              <h4 className={`mb-2.5 px-1 text-[12px] font-semibold ${muted}`}>Slack</h4>
              <TeamSlackCard bot={bot} isDark={isDark} />
            </section>

            <section>
              <h4 className={`mb-2.5 px-1 text-[12px] font-semibold ${muted}`}>Accounts</h4>
              <BotPluginAccess key={bot.id} bot={bot} isDark={isDark} onOpenPlugins={onOpenPlugins} />
            </section>

            <section className="space-y-3.5">
              <h4 className={`px-1 text-[12px] font-semibold ${muted}`}>AI provider</h4>

              <label
                className={`flex cursor-pointer items-center justify-between rounded-[10px] border px-3 py-2.5 text-[12px] ${
                  aiProvider === 'free_endpoint'
                    ? isDark
                      ? 'border-[#bf5af2]/50 bg-[#1c1730]'
                      : 'border-[#bf5af2]/40 bg-[#f7f2ff]'
                    : isDark
                      ? 'border-transparent bg-[#1c1c1f]'
                      : 'border-transparent bg-[#f2f2f4]'
                }`}
              >
                <span>
                  Use Free Model endpoint
                  <span className={`mt-0.5 block font-normal ${muted}`}>
                    Connect without selecting a model or adding an API key.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={aiProvider === 'free_endpoint'}
                  onChange={(event) => {
                    setAiProvider(event.target.checked ? 'free_endpoint' : 'kilo_gateway');
                    setModels([]);
                    setSyncNote(null);
                    setVerifyResult(null);
                    if (event.target.checked) {
                      setApiKey('');
                      setRemoveSavedApiKey(false);
                    }
                  }}
                  className="h-4 w-4 accent-[#bf5af2]"
                />
              </label>

              {aiProvider === 'free_endpoint' && (
                <div
                  className={`rounded-[10px] border px-3 py-2.5 text-[10px] ${
                    isDark ? 'border-[#232326] bg-[#141416] text-[#8e8e93]' : 'border-[#e6e6e8] bg-white text-[#6e6e73]'
                  }`}
                >
                  <p className="break-all font-mono">{endpoint}</p>
                  <p className="mt-1.5">
                    Your message and conversation context will be sent to this external service.
                  </p>
                </div>
              )}

              <div className={aiProvider === 'free_endpoint' ? 'hidden' : ''}>
                <label className={labelClasses}>Provider</label>
                <div className="relative">
                  <Server className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8e8e93]" />
                  <select
                    value={aiProvider}
                    onChange={(e) => {
                      setAiProvider(e.target.value as Bot['aiProvider']);
                      setAiModel('');
                      setModels([]);
                      setSyncNote(null);
                      setVerifyResult(null);
                    }}
                    className={`${inputClasses} cursor-pointer appearance-none pl-9`}
                  >
                    {Object.entries(AI_PROVIDERS)
                      .filter(([key]) => key !== 'free_endpoint')
                      .map(([key, cfg]) => (
                        <option key={key} value={key}>
                          {cfg.label}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className={aiProvider === 'free_endpoint' ? 'hidden' : ''}>
                <label className={labelClasses}>Endpoint URL</label>
                <div
                  className={`w-full truncate rounded-[10px] border px-3 py-2 font-mono text-[11px] ${
                    isDark ? 'border-[#232326] bg-[#141416] text-[#8e8e93]' : 'border-[#e6e6e8] bg-white text-[#8e8e93]'
                  }`}
                  title={endpoint}
                >
                  {endpoint}
                </div>
                <p className={`mt-1 text-[10px] ${muted}`}>Set automatically from the provider.</p>
              </div>

              <div className={aiProvider === 'free_endpoint' ? 'hidden' : ''}>
                <label className={labelClasses}>Model</label>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Boxes className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8e8e93]" />
                    <select
                      value={aiModel}
                      onChange={(e) => {
                        setAiModel(e.target.value);
                        setVerifyResult(null);
                      }}
                      disabled={models.length === 0}
                      className={`${inputClasses} cursor-pointer appearance-none pl-9 disabled:cursor-not-allowed`}
                    >
                      <option value="">Select a model</option>
                      {aiModel && !models.some((model) => model.id === aiModel) && (
                        <option value={aiModel}>{aiModel} (saved)</option>
                      )}
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleSyncModels}
                    disabled={isSyncing}
                    title="Load available models using the API key above"
                    className={`flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-semibold transition disabled:opacity-60 ${
                      isDark ? 'bg-[#1c1c1f] text-[#f5f5f7] hover:bg-[#26262a]' : 'bg-[#f2f2f4] text-[#1c1c1e] hover:bg-[#e9e9eb]'
                    }`}
                  >
                    {isSyncing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span className="hidden sm:inline">{isSyncing ? 'Syncing' : 'Sync'}</span>
                  </button>
                </div>
                <p className={`mt-1 text-[10px] ${muted}`}>
                  {models.length > 0
                    ? 'Models loaded - pick the one this bot should use.'
                    : 'Press Sync to load the models available to this API key.'}
                </p>
                {syncNote && (
                  <p
                    className={`mt-1 text-[10px] font-medium ${
                      models.length > 0
                        ? isDark
                          ? 'text-[#30d158]'
                          : 'text-[#1d8a3a]'
                        : isDark
                          ? 'text-[#ff9f0a]'
                          : 'text-[#9a6200]'
                    }`}
                  >
                    {syncNote}
                  </p>
                )}
              </div>

              <div className={aiProvider === 'free_endpoint' ? 'hidden' : ''}>
                <label className={labelClasses}>API key</label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8e8e93]" />
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setRemoveSavedApiKey(false);
                      setVerifyResult(null);
                    }}
                    placeholder={
                      bot.aiApiKeyConfigured ? 'Saved key configured; enter a new key to replace' : 'Paste this bot’s Kilo Gateway API key'
                    }
                    autoComplete="off"
                    spellCheck={false}
                    className={`${inputClasses} pl-9 pr-14 font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${
                      isDark ? 'text-[#8e8e93] hover:bg-[#26262a] hover:text-white' : 'text-[#8e8e93] hover:bg-[#e9e9eb] hover:text-[#1c1c1e]'
                    }`}
                  >
                    {showKey ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
                {bot.aiApiKeyConfigured && (
                  <div className="mt-1.5 flex items-center justify-between">
                    <p className={`text-[10px] ${muted}`}>This key is saved privately for {bot.name}.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setRemoveSavedApiKey((removed) => !removed);
                        setApiKey('');
                      }}
                      className={`text-[10px] font-semibold ${removeSavedApiKey ? 'text-[#ff453a]' : 'text-[#bf5af2]'}`}
                    >
                      {removeSavedApiKey ? 'Keep saved key' : 'Remove key'}
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleVerify}
                disabled={isVerifying}
                className={`flex w-full items-center justify-center gap-2 rounded-[10px] py-2.5 text-[12px] font-semibold transition disabled:opacity-60 ${
                  isDark ? 'bg-[#1c1c1f] text-white hover:bg-[#26262a]' : 'bg-[#f2f2f4] text-[#1c1c1e] hover:bg-[#e9e9eb]'
                }`}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Verify API</span>
                  </>
                )}
              </button>

              {verifyResult && (
                <div
                  role="status"
                  className={`flex items-start gap-2 rounded-[10px] border px-3 py-2.5 text-[11px] font-medium ${
                    verifyResult.ok
                      ? isDark
                        ? 'border-[#1d8a3a]/40 bg-[#12301b]/60 text-[#30d158]'
                        : 'border-[#bfe6c8] bg-[#eef9f1] text-[#1d8a3a]'
                      : isDark
                        ? 'border-[#5c4a1f] bg-[#2a220f] text-[#ff9f0a]'
                        : 'border-[#f0d9a8] bg-[#fff8e8] text-[#9a6200]'
                  }`}
                >
                  {verifyResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="break-words">{verifyResult.message}</span>
                </div>
              )}
            </section>

            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className={`flex w-full items-center justify-center gap-2 rounded-[10px] py-2.5 text-[12px] font-semibold transition disabled:opacity-60 ${
                isDark ? 'text-[#ff6961] hover:bg-[#ff453a]/10' : 'text-[#ff453a] hover:bg-[#ff453a]/5'
              }`}
            >
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              <span>Delete bot</span>
            </button>
          </div>
        )}
      </div>

      {/* Save */}
      <div className={`shrink-0 border-t px-5 py-3 ${divider} ${isDark ? 'bg-[#0e0e10]' : 'bg-[#fcfcfd]'}`}>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={`flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-semibold transition disabled:opacity-60 ${
            isDark ? 'bg-[#f5f5f7] text-[#0b0b0c] hover:bg-white' : 'bg-[#0b0b0c] text-white hover:bg-[#27272a]'
          }`}
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
        </button>
      </div>
    </aside>
  );
};

export default UserShell;
