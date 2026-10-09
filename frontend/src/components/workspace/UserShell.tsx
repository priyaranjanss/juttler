import React, { useState, useEffect } from 'react';
import { useApp } from '../../contexts/AppContext';
import { GrokSidebar } from './GrokSidebar';
import { GrokChatView } from '../chat/GrokChatView';
import { CreateBotModal } from '../common/CreateBotModal';
import { PluginsModal } from '../plugins/PluginsModal';
import { BotBlobAvatar } from '../common/BotBlobAvatar';
import { PluginLogo } from '../common/PluginLogo';
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
  const { bots, theme } = useApp();
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
          bot={settingsBot}
          onClose={() => setSettingsBotId(null)}
        />
      )}

      {/* Create Bot Modal */}
      <CreateBotModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />

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
}

const BotSettingsPanel: React.FC<BotSettingsPanelProps> = ({ bot, onClose }) => {
  const { refreshData, showToast, theme, plugins, installedPlugins, navigate } = useApp();
  const isDark = theme === 'dark';

  // --- Bot details ---
  const [name, setName] = useState(bot.name);
  const [roleTitle, setRoleTitle] = useState(bot.roleTitle);
  const [systemPrompt, setSystemPrompt] = useState(bot.systemPrompt);
  const [avatar, setAvatar] = useState(bot.avatar);
  const [color, setColor] = useState(bot.color);

  // --- Plugin tool access (this bot only) ---
  const [botAccess, setBotAccess] = useState<Record<string, string[]>>({});

  // --- AI wiring (all per bot, nothing from .env) ---
  const [aiProvider, setAiProvider] = useState<Bot['aiProvider']>(bot.aiProvider);
  const [aiModel, setAiModel] = useState(bot.aiModel);
  const [apiKey, setApiKey] = useState(bot.aiApiKey);
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
    setApiKey(bot.aiApiKey);
    setModels([]);
    setSyncNote(null);
    setVerifyResult(null);
    setShowKey(false);
  }, [bot.id]);

  // Plugin tool access for this bot, keyed by plugin slug.
  // getBotPluginAccess already returns both the grant and the plugin's full tool
  // list, so one call serves the panel.
  useEffect(() => {
    const load = async () => {
      try {
        const access = await api.getBotPluginAccess(bot.id);
        const map: Record<string, string[]> = {};
        for (const entry of access) map[entry.pluginSlug] = entry.enabledTools;
        setBotAccess(map);
      } catch {
        setBotAccess({});
      }
    };
    load();
  }, [bot.id, installedPlugins.length]);

  const togglePluginTool = async (pluginSlug: string, toolName: string) => {
    const current = botAccess[pluginSlug] || [];
    const next = current.includes(toolName) ? current.filter((t) => t !== toolName) : [...current, toolName];

    setBotAccess((prev) => ({ ...prev, [pluginSlug]: next }));
    try {
      await api.setBotPluginAccess(bot.id, pluginSlug, next);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update tool access', 'warning');
      setBotAccess((prev) => ({ ...prev, [pluginSlug]: current }));
    }
  };

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
        aiApiKey: apiKey.trim(),
      });
      await refreshData();
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
      const result = await api.listBotModels(aiProvider, apiKey);
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

        {/* ============ PLUGIN TOOLS ============ */}
        <div className={sectionClasses}>Plugin tools</div>
        <div className="px-3 space-y-3">
          {installedPlugins.length === 0 ? (
            <div
              className={`rounded-xl border border-dashed p-3.5 text-[11px] ${
                isDark ? 'border-[#2f3336] text-[#71767b]' : 'border-[#cfd9de] text-[#8b98a5]'
              }`}
            >
              <p className="font-bold">No plugins connected</p>
              <p className="mt-1 leading-relaxed">
                Connect GitHub, Slack, Jira or Web Search in Plugins, then enable their tools here for this bot.
              </p>
              <button
                type="button"
                onClick={() => navigate('/plugins')}
                className={`mt-2 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${
                  isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
                }`}
              >
                Open Plugins
              </button>
            </div>
          ) : (
            installedPlugins.map((installation) => {
              const plugin = plugins.find((p) => p.slug === installation.pluginSlug);
              if (!plugin) return null;

              return (
                <div
                  key={installation.id}
                  className={`rounded-xl border p-3 ${isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-[#f8f9fa]'}`}
                >
                  <div className="mb-2 flex items-center space-x-2">
                    <PluginLogo slug={plugin.slug} size={18} />
                    <span className="text-[11px] font-extrabold">{plugin.name}</span>
                    <span className="ml-auto rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                      Connected
                    </span>
                  </div>

                  <div className="space-y-1">
                    {plugin.tools.map((tool) => {
                      const enabled = (botAccess[plugin.slug] || []).includes(tool.name);
                      return (
                        <button
                          key={tool.name}
                          type="button"
                          onClick={() => togglePluginTool(plugin.slug, tool.name)}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[10px] font-bold">{tool.name}</p>
                            <p className={`truncate text-[10px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                              {tool.description}
                            </p>
                          </div>
                          <span
                            className={`ml-2 flex h-4 w-8 shrink-0 items-center rounded-full transition ${
                              enabled ? 'bg-emerald-500' : isDark ? 'bg-[#2f3336]' : 'bg-[#cfd9de]'
                            }`}
                          >
                            <span
                              className={`h-3 w-3 rounded-full bg-white transition-transform ${
                                enabled ? 'translate-x-4' : 'translate-x-0.5'
                              }`}
                            />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ============ AI PROVIDER ============ */}
        <div className={sectionClasses}>AI provider</div>

        <div className="px-3 space-y-3.5">
          <div>
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
                {Object.entries(AI_PROVIDERS).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
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

          <div>
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

          <div>
            <label className={labelClasses}>API key</label>
            <div className="relative">
              <KeyRound className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`} />
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setVerifyResult(null);
                }}
                placeholder="Paste your Kilo gateway API key"
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