import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { api } from '../../services/api';
import { BotBlobAvatar } from '../common/BotBlobAvatar';
import { PluginLogo } from '../common/PluginLogo';
import { PluginDefinition, PluginInstallation, Bot } from '../../types';
import {
  Search,
  Link2,
  X,
  Loader2,
  KeyRound,
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  Unlink,
  ShieldCheck,
} from 'lucide-react';

interface PluginsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Plugin slug to open the detail view on, when the dialog is opened for one. */
  initialSlug?: string | null;
}

/**
 * Plugins, as a dialog shown over the workspace.
 *
 * Two views inside one dialog: the marketplace list (browse + connect) and a
 * plugin's detail (credential form + per-bot tool toggles).
 */
export const PluginsModal: React.FC<PluginsModalProps> = ({ isOpen, onClose, initialSlug }) => {
  const { theme, bots, installedPlugins, refreshData, showToast, currentUser } = useApp();
  const isDark = theme === 'dark';

  const [catalog, setCatalog] = useState<PluginDefinition[]>([]);
  const [query, setQuery] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  /** 'list' = marketplace, 'admin' = platform-wide connections. */
  const [view, setView] = useState<'list' | 'admin'>('list');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  /** Connected plugin awaiting inline disconnect confirmation, by slug. */
  const [disconnectSlug, setDisconnectSlug] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await api.getPlugins());
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load plugins', 'warning');
    } finally {
      setIsLoadingCatalog(false);
    }
  }, [showToast]);

  /**
   * Disconnects a connected plugin from the list, inline-confirmed first so a
   * stray click on a small target cannot drop a working credential.
   */
  const handleDisconnect = async (slug: string, name: string) => {
    setIsDisconnecting(true);
    try {
      await api.disconnectPlugin(slug);
      showToast(`${name} disconnected`, 'success');
      setDisconnectSlug(null);
      await Promise.all([loadCatalog(), refreshData()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Disconnect failed', 'warning');
    } finally {
      setIsDisconnecting(false);
    }
  };

  // Reset to the list each time the dialog opens, honouring a requested plugin
  useEffect(() => {
    if (!isOpen) return;
    setView('list');
    setOpenSlug(initialSlug ?? null);
    loadCatalog();
  }, [isOpen, initialSlug, loadCatalog]);

  // OAuth returns to the workspace with the outcome in the query string
  useEffect(() => {
    if (!isOpen) return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('connect');
    if (result === 'success') {
      showToast('Plugin connected', 'success');
      refreshData();
    }
    if (result === 'error') {
      showToast('Plugin connection failed â€” check the backend configuration', 'warning');
    }
    if (result) {
      const url = new URL(window.location.href);
      url.searchParams.delete('connect');
      url.searchParams.delete('plugin');
      window.history.replaceState({}, '', url.toString());
    }
  }, [isOpen, refreshData, showToast]);

  const installedBySlug = useMemo(
    () => new Map(installedPlugins.map((i) => [i.pluginSlug, i])),
    [installedPlugins]
  );

  const filtered = catalog.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase().trim()) ||
      p.description.toLowerCase().includes(query.toLowerCase().trim())
  );

  const connectedList = catalog.filter((p) => installedBySlug.has(p.slug));
  const openPlugin = catalog.find((p) => p.slug === openSlug) || null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className={`flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border shadow-2xl transition ${
          isDark ? 'border-[#2f3336] bg-[#121418] text-[#e7e9ea]' : 'border-[#e5e7eb] bg-white text-[#0f1419]'
        }`}
      >
        {openPlugin ? (
          <PluginDetail
            plugin={openPlugin}
            installation={installedBySlug.get(openPlugin.slug)}
            botList={bots}
            onBack={() => setOpenSlug(null)}
            onClose={onClose}
          />
        ) : view === 'admin' ? (
          <AdminPluginsView onClose={onClose} onBack={() => setView('list')} />
        ) : (
          <>
            {/* ---------- Header ---------- */}
            <div className={`flex items-center justify-between border-b px-5 py-4 ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
              <div>
                <h3 className="text-base font-extrabold tracking-tight">Plugins</h3>
                <p className={`mt-0.5 text-[11px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                  Give your bots access to external services. Connect once, use from any bot.
                </p>
              </div>
              <button
                onClick={onClose}
                className={`p-1.5 rounded-full transition ${isDark ? 'hover:bg-[#1c1e22] text-[#71767b]' : 'hover:bg-[#f7f9f9] text-[#536471]'}`}
                aria-label="Close plugins"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ---------- Search ---------- */}
            <div className="px-5 pt-4">
              <div
                className={`flex items-center rounded-xl border px-3 py-2 ${
                  isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-[#f8f9fa]'
                }`}
              >
                <Search className={`mr-2 h-4 w-4 ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search plugins..."
                  className="w-full bg-transparent text-xs focus:outline-none"
                />
              </div>
            </div>

            {/* ---------- Body ---------- */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Connected plugins come first: disconnect has to be reachable
                  without scrolling past the whole marketplace. */}
              {connectedList.length > 0 && (
                <div>
                  <p className={`px-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
                    Connected to your account ({connectedList.length})
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {connectedList.map((plugin) => {
                      const installation = installedBySlug.get(plugin.slug);
                      const isConfirming = disconnectSlug === plugin.slug;
                      return (
                        <div
                          key={plugin.id}
                          className={`rounded-xl border transition ${
                            isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-white'
                          }`}
                        >
                          <div className="flex items-center space-x-3 p-2.5">
                            {/* Main row opens the plugin detail */}
                            <button
                              onClick={() => setOpenSlug(plugin.slug)}
                              className="flex min-w-0 flex-1 items-center space-x-3 rounded-lg text-left transition hover:opacity-80"
                            >
                              <PluginLogo slug={plugin.slug} size={20} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] font-bold">{plugin.name}</p>
                                <p className={`truncate text-[10px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                                  {plugin.tools.length} tools
                                  {installation?.tokenHint ? ` Â· ${installation.tokenHint}` : ''}
                                </p>
                              </div>
                            </button>

                            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />

                            {/* Labelled rather than icon-only, so it reads as an action */}
                            <button
                              onClick={() => setDisconnectSlug(plugin.slug)}
                              disabled={isDisconnecting && isConfirming}
                              className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold transition disabled:opacity-50 ${
                                isDark
                                  ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                                  : 'border-red-200 text-red-600 hover:bg-red-50'
                              }`}
                            >
                              <Unlink className="h-3 w-3" />
                              <span>Disconnect</span>
                            </button>
                          </div>

                          {/* Inline confirm — a second tap is required to actually drop it */}
                          {isConfirming && (
                            <div
                              className={`flex items-center justify-between gap-2 border-t px-2.5 py-2 ${
                                isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'
                              }`}
                            >
                              <p className={`text-[10px] font-bold ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                                Disconnect {plugin.name}? Bots lose access until you reconnect.
                              </p>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                  onClick={() => setDisconnectSlug(null)}
                                  disabled={isDisconnecting}
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition disabled:opacity-50 ${
                                    isDark ? 'hover:bg-[#202327]' : 'hover:bg-[#f0f2f5]'
                                  }`}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleDisconnect(plugin.slug, plugin.name)}
                                  disabled={isDisconnecting}
                                  className="flex items-center gap-1 rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-red-600 disabled:opacity-50"
                                >
                                  {isDisconnecting && <Loader2 className="h-3 w-3 animate-spin" />}
                                  <span>Disconnect</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {isLoadingCatalog ? (
                <div className="flex items-center justify-center gap-2 py-16 text-[#71767b]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading plugins...</span>
                </div>
              ) : filtered.length === 0 ? (
                <p className={`py-12 text-center text-xs ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`}>
                  No plugins match "{query}"
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {filtered.map((plugin) => {
                    const installation = installedBySlug.get(plugin.slug);
                    return (
                      <div
                        key={plugin.id}
                        className={`flex flex-col rounded-2xl border ${
                          isDark
                            ? 'border-[#2f3336] bg-[#181a1f] hover:border-[#536471]'
                            : 'border-[#e5e7eb] bg-[#f8f9fa] hover:border-[#cfd9de]'
                        }`}
                      >
                        <button
                          onClick={() => setOpenSlug(plugin.slug)}
                          className="flex flex-col space-y-2.5 rounded-2xl p-3.5 text-left transition"
                        >
                          <div className="flex w-full items-start justify-between">
                            <PluginLogo slug={plugin.slug} size={28} />
                            {installation ? (
                              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                                Connected
                              </span>
                            ) : (
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                                  isDark ? 'border-[#2f3336] bg-[#202327]' : 'border-[#e5e7eb] bg-white'
                                }`}
                              >
                                Add
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-extrabold">{plugin.name}</p>
                            <p className={`mt-0.5 text-[11px] leading-relaxed ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                              {plugin.description}
                            </p>
                            {plugin.slug === 'slack' && (
                              <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-sky-400">
                                Each bot posts as itself
                              </p>
                            )}
                            <p className={`mt-1.5 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
                              {plugin.category} Â· {plugin.tools.length} tools
                            </p>
                          </div>
                        </button>

                        {/* Disconnect lives on the card too, not just the detail view */}
                        {installation && (
                          <div
                            className={`flex items-center justify-between border-t px-3.5 py-2 ${
                              isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'
                            }`}
                          >
                            <button
                              onClick={() => setOpenSlug(plugin.slug)}
                              className={`text-[10px] font-bold transition ${isDark ? 'text-[#71767b] hover:text-white' : 'text-[#8b98a5] hover:text-black'}`}
                            >
                              Manage access
                            </button>
                            <button
                              onClick={() => setDisconnectSlug(plugin.slug)}
                              className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold transition ${
                                isDark
                                  ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                                  : 'border-red-200 text-red-600 hover:bg-red-50'
                              }`}
                            >
                              <Unlink className="h-3 w-3" />
                              <span>Disconnect</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ---------- Footer ---------- */}
            <div className={`flex items-center justify-between border-t px-5 py-3 ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
              <div className="flex items-center space-x-2">
                <button
                  onClick={async () => {
                    await Promise.all([loadCatalog(), refreshData()]);
                  }}
                  className={`flex items-center space-x-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                    isDark ? 'border-[#2f3336] bg-[#202327] hover:bg-[#2a2e34]' : 'border-[#e5e7eb] bg-[#f8f9fa] hover:bg-[#eff3f4]'
                  }`}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh</span>
                </button>

                {/* Platform-wide view — admins only */}
                {currentUser.role === 'admin' && (
                  <button
                    onClick={() => setView('admin')}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                      isDark ? 'border-[#2f3336] hover:bg-[#202327]' : 'border-[#e5e7eb] hover:bg-[#f0f2f5]'
                    }`}
                  >
                    All connections
                  </button>
                )}
              </div>

              <button
                onClick={onClose}
                className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition ${
                  isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
                }`}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Plugin detail â€” stays inside the same dialog
// ---------------------------------------------------------------------------

interface PluginDetailProps {
  plugin: PluginDefinition;
  installation?: PluginInstallation;
  botList: Bot[];
  onBack: () => void;
  onClose: () => void;
}

const PluginDetail: React.FC<PluginDetailProps> = ({ plugin, installation, botList, onBack, onClose }) => {
  const { theme, refreshData, showToast } = useApp();
  const isDark = theme === 'dark';

  const [credentialText, setCredentialText] = useState('');
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [isOauthStarting, setIsOauthStarting] = useState(false);
  const [isReauthing, setIsReauthing] = useState(false);
  const [botAccess, setBotAccess] = useState<Record<string, string[]>>({});

  // OAuth-only plugins: ask the backend for the authorize URL and bounce there
  const handleOauthConnect = async () => {
    setIsOauthStarting(true);
    try {
      const { authorizeUrl } = await api.startPluginOauth(plugin.slug);
      window.location.href = authorizeUrl;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start Google authorization', 'warning');
      setIsOauthStarting(false);
    }
  };

  // Re-authorise a credential the provider has rejected
  const handleReauth = async () => {
    setIsReauthing(true);
    try {
      const result = await api.reauthPlugin(plugin.slug);
      if (result.authorizeUrl) {
        window.location.href = result.authorizeUrl;
        return;
      }
      showToast(`Paste a fresh credential for ${plugin.name} and connect again.`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Re-authentication failed', 'warning');
    } finally {
      setIsReauthing(false);
    }
  };

  // Which bots may use which of this plugin's tools
  useEffect(() => {
    const load = async () => {
      const entries: Record<string, string[]> = {};
      await Promise.all(
        botList.map(async (bot) => {
          try {
            const access = await api.getBotPluginAccess(bot.id);
            const entry = access.find((a) => a.pluginSlug === plugin.slug);
            if (entry) entries[bot.id] = entry.enabledTools;
          } catch {
            entries[bot.id] = [];
          }
        })
      );
      setBotAccess(entries);
    };
    if (botList.length > 0) load();
  }, [botList, plugin.slug]);

  const handleConnect = async () => {
    if (!credentialText.trim()) {
      showToast('Paste a token or API key first', 'warning');
      return;
    }
    setIsConnecting(true);
    try {
      const credential =
        plugin.slug === 'jira'
          ? { site: site.trim(), email: email.trim(), apiToken: credentialText.trim() }
          : { token: credentialText.trim() };

      if (plugin.slug === 'jira' && (!credential.site || !credential.email)) {
        showToast('Enter your Jira site and email first', 'warning');
        return;
      }

      await api.connectPlugin(plugin.slug, {
        credential,
        metadata: plugin.slug === 'jira' ? { site: credential.site } : {},
      });
      showToast(`${plugin.name} connected`, 'success');
      setCredentialText('');
      await refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Connection failed', 'warning');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {    setIsDisconnecting(true);
    try {
      await api.disconnectPlugin(plugin.slug);
      showToast(`${plugin.name} disconnected`, 'success');
      setConfirmDisconnect(false);
      await refreshData();
      onBack();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Disconnect failed', 'warning');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const toggleToolForBot = async (botId: string, toolName: string) => {
    const current = botAccess[botId] || [];
    const next = current.includes(toolName) ? current.filter((t) => t !== toolName) : [...current, toolName];

    setBotAccess((prev) => ({ ...prev, [botId]: next }));
    try {
      await api.setBotPluginAccess(botId, plugin.slug, next);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update tool access', 'warning');
      setBotAccess((prev) => ({ ...prev, [botId]: current }));
    }
  };

  const inputClasses = `w-full rounded-xl border px-3 py-2 text-xs transition-colors focus:outline-none focus:ring-2 disabled:opacity-60 ${
    isDark
      ? 'border-[#2f3336] bg-[#181a1f] text-[#e7e9ea] placeholder:text-[#71767b] focus:border-[#48cae4]/60 focus:ring-[#48cae4]/20'
      : 'border-[#d0d7de] bg-[#f7f9f9] text-[#0f1419] placeholder:text-[#8b98a5] focus:border-[#1d9bf0]/60 focus:ring-[#1d9bf0]/20'
  }`;

  const labelClasses = `block text-[10px] font-bold uppercase tracking-wider mb-1.5 ${
    isDark ? 'text-[#8b98a5]' : 'text-[#536471]'
  }`;

  return (
    <div className="flex h-[80vh] max-h-full min-h-0 w-full flex-col overflow-hidden">
      {/* Header */}
      <div className={`flex items-center space-x-3 border-b px-5 py-4 ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
        <button
          onClick={onBack}
          className={`rounded-full p-1.5 transition ${isDark ? 'hover:bg-[#1c1e22] text-[#71767b] hover:text-white' : 'hover:bg-[#f7f9f9] text-[#536471] hover:text-black'}`}
          aria-label="Back to plugins"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <PluginLogo slug={plugin.slug} size={28} />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-extrabold">{plugin.name}</h3>
          <p className={`truncate text-[11px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>{plugin.category}</p>
        </div>

        {installation?.status === 'needs_reauth' ? (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold text-amber-400">
            Needs re-auth
          </span>
        ) : installation ? (
          <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
            Connected
          </span>
        ) : (
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${isDark ? 'border-[#2f3336] text-[#71767b]' : 'border-[#e5e7eb] text-[#536471]'}`}>
            Not connected
          </span>
        )}

        <button
          onClick={onClose}
          className={`rounded-full p-1.5 transition ${isDark ? 'text-[#71767b] hover:bg-[#1c1e22] hover:text-white' : 'text-[#536471] hover:bg-[#f7f9f9] hover:text-black'}`}
          aria-label="Close plugins"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className={`shrink-0 space-y-3 border-b px-5 py-4 ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
        <p className={`text-xs leading-relaxed ${isDark ? 'text-[#e7e9ea]' : 'text-[#0f1419]'}`}>{plugin.description}</p>

        {/* ---------- Connect ---------- */}
        {installation?.status === 'needs_reauth' && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="flex items-center space-x-2 text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-bold">Credential rejected</span>
            </div>
            <p className={`text-[11px] leading-relaxed ${isDark ? 'text-amber-300/80' : 'text-amber-800'}`}>
              {plugin.name} stopped accepting the stored credential. Re-authorise to restore access — every Bot
              using this plugin is blocked until you do.
            </p>
            <button
              onClick={handleReauth}
              disabled={isReauthing}
              className="flex w-full items-center justify-center space-x-2 rounded-xl bg-amber-500/20 px-4 py-2 text-[11px] font-bold text-amber-400 transition hover:bg-amber-500/30 disabled:opacity-60"
            >
              {isReauthing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>{isReauthing ? 'Re-authorising...' : `Re-authorise ${plugin.name}`}</span>
            </button>
          </div>
        )}

        {plugin.authType === 'oauth' ? (
          /* OAuth-only plugins have nothing to paste — run the flow */
          <div className="space-y-2">
            {plugin.slug === 'slack' ? (
              <p className={`text-[11px] leading-relaxed ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                Slack is connected on the bot, not as a shared login. Open the bot’s settings and choose Connect to
                Slack. It posts as that bot. A direct message is always answered. A channel answers only when the bot
                is @mentioned, then it follows that thread.
              </p>
            ) : (
              <p className={`text-[11px] leading-relaxed ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                {plugin.name} connects with your{' '}
                {plugin.slug === 'github' ? 'GitHub' : plugin.slug === 'jira' ? 'Atlassian' : 'Google'} account.
                {' '}You'll approve access there, and the credential is stored encrypted — it is never shown again.
              </p>
            )}

            {plugin.slug === 'jira' && installation?.metadata?.siteName && (
              <p className={`text-[11px] ${isDark ? 'text-[#8b98a5]' : 'text-[#536471]'}`}>
                Connected Jira site: {installation.metadata.siteName}
              </p>
            )}

            {plugin.slug !== 'slack' && !installation && (
              <button
                onClick={handleOauthConnect}
                disabled={isOauthStarting}
                className={`flex w-full items-center justify-center space-x-2 rounded-xl px-4 py-2.5 text-xs font-bold transition disabled:opacity-60 ${
                  isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
                }`}
              >
                {isOauthStarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                <span>
                  {isOauthStarting
                    ? `Opening ${plugin.name}...`
                    : `Connect ${plugin.name}`}
                </span>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <label className={labelClasses}>
              {plugin.slug === 'jira' ? 'Jira API token' : 'Access token'}
            </label>

            {plugin.slug === 'jira' && (
              <>
                <input
                  type="text"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  placeholder="your-site (before .atlassian.net)"
                  className={inputClasses}
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={inputClasses}
                />
              </>
            )}

            <div className="relative">
              <KeyRound className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`} />
              <input
                type="password"
                value={credentialText}
                onChange={(e) => setCredentialText(e.target.value)}
                placeholder={
                  plugin.slug === 'jira'
                    ? 'Atlassian API token'
                    : plugin.slug === 'slack'
                      ? 'xoxb-...'
                      : 'ghp_...'
                }
                autoComplete="off"
                spellCheck={false}
                className={`${inputClasses} pl-9 font-mono`}
              />
            </div>

            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className={`flex w-full items-center justify-center space-x-2 rounded-xl px-4 py-2.5 text-xs font-bold transition disabled:opacity-60 ${
                isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
              }`}
            >
              {isConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              <span>{installation ? 'Update credential' : 'Connect'}</span>
            </button>
          </div>
        )}

          {installation &&
            (confirmDisconnect ? (
              <div className="flex space-x-2">
                <button
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="flex flex-1 items-center justify-center space-x-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-400 transition hover:bg-red-500/20 disabled:opacity-60"
                >
                  {isDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>Yes, disconnect</span>
                </button>
                <button
                  onClick={() => setConfirmDisconnect(false)}
                  className={`rounded-xl border px-3 py-2 text-[11px] font-bold ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDisconnect(true)}
                className={`flex w-full items-center justify-center space-x-2 rounded-xl px-4 py-2 text-[11px] font-bold transition ${
                  isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'
                }`}
              >
                <Unlink className="h-3.5 w-3.5" />
                <span>Disconnect</span>
              </button>
            ))}
        </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <div>
          <label className={labelClasses}>Tools ({plugin.tools.length})</label>
          <div
            className={`divide-y rounded-2xl border ${
              isDark ? 'divide-[#2f3336] border-[#2f3336] bg-[#181a1f]' : 'divide-[#e5e7eb] border-[#e5e7eb] bg-white'
            }`}
          >
            {plugin.tools.map((tool) => {
              // The canonical registry id, e.g. "slack.list_channels", is what
              // grants are stored under and what the Tool Gateway resolves.
              const toolId = `${plugin.slug}.${tool.name}`;
              return (
              <div key={toolId} className="p-3">
                <div className="flex items-start space-x-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[11px] font-bold">{toolId}</p>
                    <p className={`text-[11px] leading-relaxed ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                      {tool.description}
                    </p>
                  </div>
                  {tool.sensitive && (
                    <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                      Approval
                    </span>
                  )}
                </div>

                {installation && botList.length > 0 && (
                  <div className={`mt-2 space-y-1 border-t pt-2 ${isDark ? 'border-[#2f3336]/50' : 'border-[#e5e7eb]'}`}>
                    {botList.map((bot) => {
                      const enabled = (botAccess[bot.id] || []).includes(toolId);
                      return (
                        <button
                          key={bot.id}
                          onClick={() => toggleToolForBot(bot.id, toolId)}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <BotBlobAvatar name={bot.name} avatarShape={bot.avatar} color={bot.color} size={22} />
                            <span className="truncate text-[11px] font-semibold">{bot.name}</span>
                          </div>
                          <span
                            className={`flex h-4 w-8 shrink-0 items-center rounded-full transition ${
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
                )}
              </div>
              );
            })}
          </div>

          <p className={`mt-2 text-[11px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
            {installation
              ? 'Enable a tool per bot. Bots can only run tools you turn on here.'
              : 'Connect the plugin to choose which bots may use each tool.'}
          </p>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Admin view — every plugin connection on the platform, with force-disconnect
// ---------------------------------------------------------------------------

interface AdminPluginsViewProps {
  onClose: () => void;
  onBack: () => void;
}

const AdminPluginsView: React.FC<AdminPluginsViewProps> = ({ onClose, onBack }) => {
  const { theme, showToast } = useApp();
  const isDark = theme === 'dark';

  const [rows, setRows] = useState<
    Array<{
      installationId: string;
      userEmail: string;
      userName: string;
      pluginSlug: string;
      pluginName: string;
      status: string;
      tokenHint: string;
      botCount: number;
    }>
  >([]);
  const [stats, setStats] = useState<
    Array<{ pluginSlug: string; pluginName: string; installations: number; toolCalls: number; failures: number }>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [installations, usage] = await Promise.all([
        api.getAdminPluginInstallations(),
        api.getAdminPluginStats(),
      ]);
      setRows(installations);
      setStats(usage);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load admin data', 'warning');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const forceDisconnect = async (installationId: string, label: string) => {
    setBusyId(installationId);
    try {
      await api.adminForceDisconnect(installationId);
      showToast(`Disconnected ${label}`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Disconnect failed', 'warning');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex max-h-[86vh] flex-col">
      <div className={`flex items-center justify-between border-b px-5 py-4 ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className={`rounded-full p-1.5 transition ${isDark ? 'hover:bg-[#1c1e22] text-[#71767b] hover:text-white' : 'hover:bg-[#f7f9f9] text-[#536471] hover:text-black'}`}
            aria-label="Back to plugins"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div>
            <h3 className="text-sm font-extrabold">All plugin connections</h3>
            <p className={`text-[11px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
              Every account on this workspace
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className={`rounded-full p-1.5 transition ${isDark ? 'text-[#71767b] hover:bg-[#1c1e22] hover:text-white' : 'text-[#536471] hover:bg-[#f7f9f9] hover:text-black'}`}
          aria-label="Close plugins"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[#71767b]">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading connections...</span>
          </div>
        ) : (
          <>
            {/* Usage per plugin */}
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
                Usage by plugin
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {stats.map((s) => (
                  <div
                    key={s.pluginSlug}
                    className={`rounded-xl border p-2.5 ${isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-[#f8f9fa]'}`}
                  >
                    <p className="text-[11px] font-bold">{s.pluginName}</p>
                    <p className={`text-[10px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                      {s.installations} connected · {s.toolCalls} calls
                      {s.failures > 0 ? ` · ${s.failures} failed` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Every installation */}
            <div>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-[#536471]' : 'text-[#8b98a5]'}`}>
                Connections ({rows.length})
              </p>
              <div className="mt-2 space-y-1.5">
                {rows.length === 0 ? (
                  <p className={`py-8 text-center text-xs ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`}>
                    No plugin connections yet.
                  </p>
                ) : (
                  rows.map((r) => (
                    <div
                      key={r.installationId}
                      className={`flex items-center space-x-3 rounded-xl border p-2.5 ${
                        isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-white'
                      }`}
                    >
                      <PluginLogo slug={r.pluginSlug} size={20} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-bold">{r.pluginName}</p>
                        <p className={`truncate text-[10px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                          {r.userName ? `${r.userName} · ${r.userEmail}` : r.userEmail} · {r.botCount} bots
                        </p>
                      </div>
                      {r.status === 'needs_reauth' ? (
                        <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold text-amber-400">
                          Needs re-auth
                        </span>
                      ) : (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                      )}
                      <button
                        onClick={() => forceDisconnect(r.installationId, `${r.pluginName} for ${r.userEmail}`)}
                        disabled={busyId === r.installationId}
                        className="shrink-0 rounded-full border border-red-500/30 px-2.5 py-1 text-[10px] font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-60"
                      >
                        {busyId === r.installationId ? 'Removing...' : 'Force disconnect'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PluginsModal;
