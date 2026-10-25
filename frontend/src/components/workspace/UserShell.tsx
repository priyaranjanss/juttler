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
  const { bots, theme, showToast } = useApp();
  const isDark = theme === 'dark';

  // Create Bot modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  // Plugins dialog
  const [isPluginsOpen, setIsPluginsOpen] = useState(false);
  // Plugin to open the dialog on (e.g. when a bot asks for one)
  const [pluginsOpenSlug, setPluginsOpenSlug] = useState<string | null>(null);

  // Settings panel â€” an inline layout column, never an overlay on top of the chat
  const [settingsBotId, setSettingsBotId] = useState<string | null>(null);

  // Sidebar visibility collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const link = params.get('linkSlack');
    const install = params.get('slackInstall');
    const slackBot = params.get('slackBot');
    if (!link && !install) return;

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
  }, [showToast]);

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

  const openBotSettings = (bot: Bot) => setSettingsBotId(bot.id);

  // Opens this bot's settings, or closes the column if it's already showing
  const toggleBotSettings = (bot: Bot) =>
    setSettingsBotId((prev) => (prev === bot.id ? null : bot.id));

  return (
    <div
      className={`min-h-screen flex font-sans transition-colors overflow-hidden ${
        isDark ? 'bg-[#0a0b0d] text-[#e7e9ea]' : 'bg-white text-[#0f1419]'
      }`}
    >
      {/* 1. Left Sidebar */}
      <GrokSidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onOpenCreateBotModal={() => setIsCreateModalOpen(true)}
        onOpenBotProfile={openBotSettings}
        onOpenPlugins={() => setIsPluginsOpen(true)}
      />

      {/* 2. Main Center Content View - Chat */}
      <main className="flex-1 min-w-0 h-screen overflow-hidden flex flex-col relative">
        <GrokChatView
          onToggleSettings={toggleBotSettings}
          onRequestPlugin={(slug) => {
            setPluginsOpenSlug(slug ?? null);
            setIsPluginsOpen(true);
          }}
        />
      </main>

      {/* 3. Bot Settings â€” a real column beside the chat, not a layer on top of it */}
      {settingsBot && (
        <BotSettingsPanel
          key={settingsBot.id}
          bot={settingsBot}
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
}

const BotSettingsPanel: React.FC<BotSettingsPanelProps> = ({ bot, onClose, onOpenPlugins }) => {
  const { refreshData, showToast, theme } = useApp();
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

  const inputClasses = `w-full rounded-xl border py-2 px-3 text-xs transition-colors focus:outline-none focus:ring-2 disabled:opacity-60 ${
    isDark
      ? 'border-[#2f3336] bg-[#181a1f] text-[#e7e9ea] placeholder:text-[#71767b] focus:border-[#48cae4]/60 focus:ring-[#48cae4]/20'
      : 'border-[#d0d7de] bg-[#f7f9f9] text-[#0f1419] placeholder:text-[#8b98a5] focus:border-[#1d9bf0]/60 focus:ring-[#1d9bf0]/20'
  }`;

  const labelClasses = `block text-[11px] font-bold uppercase tracking-wider mb-1.5 ${
    isDark ? 'text-[#8b98a5]' : 'text-[#536471]'
  }`;

  const sectionClasses = `text-[10px] font-bold uppercase tracking-wider px-3 pt-4 pb-1.5 ${
    isDark ? 'text-[#536471]' : 'text-[#8b98a5]'
  }`;

  return (
    <aside
      className={`shrink-0 w-[380px] h-screen overflow-y-auto border-l ${
        isDark ? 'bg-[#16181c] border-[#2f3336]' : 'bg-white border-[#e1e8ed]'
      }`}
    >
      {/* Header */}
      <div className={`sticky top-0 z-10 p-4 border-b flex items-center justify-between ${isDark ? 'border-[#2f3336] bg-[#16181c]' : 'border-[#e5e7eb] bg-white'}`}>
        <div className="flex items-center space-x-2.5 min-w-0">
          <BotBlobAvatar name={name || bot.name} avatarShape={avatar} color={color} size={32} />
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold truncate">{bot.name}</h3>
            <p className={`text-[11px] truncate ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>Bot settings</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className={`p-1.5 rounded-full transition shrink-0 ${isDark ? 'hover:bg-[#202327] text-[#71767b]' : 'hover:bg-[#f0f2f5] text-[#536471]'}`}
          aria-label="Close settings"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="pb-6">
        {/* ============ BOT DETAILS ============ */}
        <div className={sectionClasses}>Bot details</div>

        <div className="px-3 space-y-3.5">
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
            <p className={`mt-1 text-[10px] ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
              Sent as the system prompt on every chat with this bot.
            </p>
          </div>

          {/* Avatar shape */}
          <div>
            <label className={labelClasses}>Avatar shape</label>
            <div className="grid grid-cols-3 gap-1.5">
              {AVATAR_SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setAvatar(s.id)}
                  className={`p-1.5 rounded-xl border flex items-center space-x-1.5 transition ${
                    avatar === s.id
                      ? isDark
                        ? 'border-purple-500 bg-purple-500/10 text-white'
                        : 'border-purple-500 bg-purple-50 text-black'
                      : isDark
                        ? 'border-[#2f3336] bg-[#181a1f] text-[#71767b] hover:border-[#536471]'
                        : 'border-[#eff3f4] bg-[#f7f9f9] text-[#536471] hover:border-[#cfd9de]'
                  }`}
                >
                  <BotBlobAvatar name="preview" avatarShape={s.id} color={color} size={20} />
                  <span className="truncate text-[10px] font-semibold">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Avatar color */}
          <div>
            <label className={labelClasses}>Avatar color</label>
            <div className="flex items-center flex-wrap gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full transition flex items-center justify-center border-2 border-transparent"
                  style={{ backgroundColor: c }}
                  aria-label={`Color ${c}`}
                >
                  {color === c && <CheckCircle2 className="h-4 w-4 text-white" />}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={sectionClasses}>Slack</div>
        <TeamSlackCard bot={bot} isDark={isDark} />

        <div className={sectionClasses}>Accounts</div>
        <BotPluginAccess key={bot.id} bot={bot} isDark={isDark} onOpenPlugins={onOpenPlugins} />

        {/* ============ AI PROVIDER ============ */}
        <div className={sectionClasses}>AI provider</div>

        <div className="px-3 space-y-3.5">
          <label
            className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 text-xs ${
              aiProvider === 'free_endpoint'
                ? isDark
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : 'border-purple-600/40 bg-purple-50'
                : isDark
                  ? 'border-[#2f3336] bg-[#0e0f12]'
                  : 'border-[#e5e7eb] bg-[#f8f9fa]'
            }`}
          >
            <span>
              Use Free Model endpoint
              <span className={`mt-0.5 block font-normal ${isDark ? 'text-[#8b9299]' : 'text-[#536471]'}`}>
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
              className="h-4 w-4 accent-purple-500"
            />
          </label>

          {aiProvider === 'free_endpoint' && (
            <div
              className={`rounded-xl border px-3 py-2.5 text-[10px] ${
                isDark
                  ? 'border-[#2f3336] bg-[#121418] text-[#8b9299]'
                  : 'border-[#e5e7eb] bg-[#f8f9fa] text-[#536471]'
              }`}
            >
              <p className="font-mono break-all">{endpoint}</p>
              <p className="mt-1.5">
                Your message and conversation context will be sent to this external service.
              </p>
            </div>
          )}
          <div className={aiProvider === 'free_endpoint' ? 'hidden' : ''}>
            <label className={labelClasses}>Provider</label>
            <div className="relative">
              <Server className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`} />
              <select
                value={aiProvider}
                onChange={(e) => {
                  setAiProvider(e.target.value as Bot['aiProvider']);
                  setAiModel('');
                  setModels([]);
                  setSyncNote(null);
                  setVerifyResult(null);
                }}
                className={`${inputClasses} pl-9 cursor-pointer appearance-none`}
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
              className={`w-full rounded-xl border px-3 py-2 text-[11px] font-mono truncate ${
                isDark ? 'border-[#2f3336] bg-[#121418] text-[#71767b]' : 'border-[#e5e7eb] bg-[#f7f9f9] text-[#8b98a5]'
              }`}
              title={endpoint}
            >
              {endpoint}
            </div>
            <p className={`mt-1 text-[10px] ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
              Set automatically from the provider.
            </p>
          </div>

          <div className={aiProvider === 'free_endpoint' ? 'hidden' : ''}>
            <label className={labelClasses}>Model</label>
            <div className="flex items-center space-x-2">
              <div className="relative flex-1 min-w-0">
                <Boxes className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`} />
                <select
                  value={aiModel}
                  onChange={(e) => {
                    setAiModel(e.target.value);
                    setVerifyResult(null);
                  }}
                  disabled={models.length === 0}
                  className={`${inputClasses} pl-9 cursor-pointer appearance-none disabled:cursor-not-allowed`}
                >
                  <option value="">Select a model</option>
                  {aiModel && !models.some((model) => model.id === aiModel) && (
                    <option value={aiModel}>{aiModel} (saved)</option>
                  )}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </select>
              </div>

              {/* Sync â€” fetches the models this API key can use */}
              <button
                type="button"
                onClick={handleSyncModels}
                disabled={isSyncing}
                title="Load available models using the API key above"
                className={`shrink-0 flex items-center space-x-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition disabled:opacity-60 ${
                  isDark
                    ? 'border-[#2f3336] bg-[#181a1f] text-[#e7e9ea] hover:bg-[#202327]'
                    : 'border-[#d0d7de] bg-[#f7f9f9] text-[#0f1419] hover:bg-[#eff3f4]'
                }`}
              >
                {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{isSyncing ? 'Syncing' : 'Sync'}</span>
              </button>
            </div>
            <p className={`mt-1 text-[10px] ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
              {models.length > 0
                ? 'Models loaded â€” pick the one this bot should use.'
                : 'Press Sync to load the models available to this API key.'}
            </p>
            {syncNote && (
              <p
                className={`mt-1 text-[10px] font-medium ${
                  models.length > 0
                    ? isDark ? 'text-emerald-400' : 'text-emerald-600'
                    : isDark ? 'text-amber-400' : 'text-amber-600'
                }`}
              >
                {syncNote}
              </p>
            )}
          </div>

          <div className={aiProvider === 'free_endpoint' ? 'hidden' : ''}>
            <label className={labelClasses}>API key</label>
            <div className="relative">
              <KeyRound className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`} />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setRemoveSavedApiKey(false);
                  setVerifyResult(null);
                }}
                placeholder={bot.aiApiKeyConfigured ? 'Saved key configured; enter a new key to replace' : 'Paste this bot’s Kilo Gateway API key'}
                autoComplete="off"
                spellCheck={false}
                className={`${inputClasses} pl-9 pr-14 font-mono`}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[10px] font-bold transition ${
                  isDark ? 'text-[#71767b] hover:text-white hover:bg-[#202327]' : 'text-[#8b98a5] hover:text-black hover:bg-[#eff3f4]'
                }`}
              >
                {showKey ? 'HIDE' : 'SHOW'}
              </button>
            </div>
            {bot.aiApiKeyConfigured && (
              <div className="mt-1.5 flex items-center justify-between">
                <p className={`text-[10px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                  This key is saved privately for {bot.name}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setRemoveSavedApiKey((removed) => !removed);
                    setApiKey('');
                  }}
                  className={`text-[10px] font-semibold ${removeSavedApiKey ? 'text-rose-400' : 'text-purple-400'}`}
                >
                  {removeSavedApiKey ? 'Keep saved key' : 'Remove key'}
                </button>
              </div>
            )}
          </div>

          {/* Verify */}
          <button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying}
            className={`w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-60 ${
              isDark ? 'bg-[#202327] text-white hover:bg-[#2a2e34]' : 'bg-[#f0f2f5] text-black hover:bg-[#e5e7eb]'
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
              className={`flex items-start space-x-2 rounded-xl border px-3 py-2.5 text-xs font-medium ${
                verifyResult.ok
                  ? isDark
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : isDark
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    : 'border-amber-200 bg-amber-50 text-amber-700'
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
        </div>

        {/* ============ ACTIONS ============ */}
        <div className="px-3 pt-5 space-y-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className={`w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-60 ${
              isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
            }`}
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className={`w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-60 ${
              isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'
            }`}
          >
            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            <span>Delete bot</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default UserShell;
