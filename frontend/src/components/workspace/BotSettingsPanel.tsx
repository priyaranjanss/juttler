import React, { useEffect, useMemo, useState } from 'react';
import { X, Save, Check } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { Bot } from '../../types';

interface BotSettingsPanelProps {
  bot: Bot;
  onClose: () => void;
}

/** A tool this bot can be granted, discovered from the plugin catalog. */
interface GrantableTool {
  /** Canonical registry id, e.g. "slack.list_channels". */
  toolId: string;
  /** Short legacy name, kept so old grants still match. */
  legacyName: string;
  label: string;
  description: string;
  pluginSlug: string;
  pluginName: string;
  needsApproval: boolean;
  /** False when the plugin is not connected, so it cannot be granted yet. */
  pluginConnected: boolean;
}

export const BotSettingsPanel: React.FC<BotSettingsPanelProps> = ({ bot, onClose }) => {
  const { refreshData, showToast, theme, plugins, installedPlugins } = useApp();
  const isDark = theme === 'dark';
  const [name, setName] = useState(bot.name);
  const [roleTitle, setRoleTitle] = useState(bot.roleTitle);
  const [systemPrompt, setSystemPrompt] = useState(bot.systemPrompt);
  const [allowedTools, setAllowedTools] = useState(bot.allowedTools || []);
  const [memoryEnabled, setMemoryEnabled] = useState(bot.memoryEnabled);
  const [isSaving, setIsSaving] = useState(false);
  /** Canonical tool ids currently granted to this bot, per plugin. */
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const [busyTool, setBusyTool] = useState<string | null>(null);

  // Tools are discovered from the catalog, so a new plugin needs no edit here.
  const grantableTools = useMemo<GrantableTool[]>(() => {
    const connected = new Set(installedPlugins.map((i) => i.pluginSlug));
    const out: GrantableTool[] = [];

    for (const plugin of plugins) {
      for (const tool of plugin.tools) {
        out.push({
          toolId: `${plugin.slug}.${tool.name}`,
          legacyName: `${plugin.slug}_${tool.name}`,
          label: tool.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: tool.description,
          pluginSlug: plugin.slug,
          pluginName: plugin.name,
          needsApproval: tool.sensitive === true,
          pluginConnected: connected.has(plugin.slug),
        });
      }
    }

    return out;
  }, [plugins, installedPlugins]);

  // The bot's real grants live per plugin, which is what the Tool Gateway
  // checks — so this panel reads and writes those rather than a static list.
  useEffect(() => {
    let cancelled = false;

    const loadGrants = async () => {
      try {
        const settings = await api.getBotPluginSettings(bot.id);
        if (cancelled) return;
        const grantsBy: Record<string, string[]> = {};
        for (const entry of settings) grantsBy[entry.pluginSlug] = entry.enabledTools ?? [];
        setGrants(grantsBy);
      } catch {
        // Nothing granted yet is the normal state for a fresh bot.
        if (!cancelled) setGrants({});
      }
    };

    void loadGrants();
    return () => {
      cancelled = true;
    };
  }, [bot.id]);

  useEffect(() => {
    setName(bot.name);
    setRoleTitle(bot.roleTitle);
    setSystemPrompt(bot.systemPrompt);
    setAllowedTools(bot.allowedTools || []);
    setMemoryEnabled(bot.memoryEnabled);
  }, [bot]);

  /**
   * Grants or revokes one tool through the real per-plugin grant API, so the
   * Tool Gateway sees the change immediately.
   */
  const toggleGrant = async (tool: GrantableTool) => {
    if (!tool.pluginConnected) {
      showToast(`Connect ${tool.pluginName} first`, 'warning');
      return;
    }

    const current = grants[tool.pluginSlug] ?? [];
    const isOn = current.includes(tool.toolId) || current.includes(tool.legacyName);
    const next = isOn
      ? current.filter((n) => n !== tool.toolId && n !== tool.legacyName)
      : [...current, tool.toolId];

    // Optimistic, then reconciled against the server's answer.
    setGrants((prev) => ({ ...prev, [tool.pluginSlug]: next }));
    setBusyTool(tool.toolId);
    try {
      const result = await api.setBotPluginAccess(bot.id, tool.pluginSlug, next);
      setGrants((prev) => ({ ...prev, [tool.pluginSlug]: result.enabledTools ?? next }));
    } catch (error) {
      setGrants((prev) => ({ ...prev, [tool.pluginSlug]: current }));
      showToast(
        error instanceof Error ? error.message : `Could not update ${tool.label}`,
        'warning'
      );
    } finally {
      setBusyTool(null);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !roleTitle.trim()) {
      showToast('Bot name and role are required', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      await api.updateBot(bot.id, {
        name: name.trim(),
        roleTitle: roleTitle.trim(),
        systemPrompt: systemPrompt.trim(),
        allowedTools,
        memoryEnabled,
      });
      await refreshData();
      showToast(`${name.trim()} settings saved`, 'success');
    } catch (error) {
      console.error('Failed to save bot settings:', error);
      showToast('Failed to save bot settings', 'warning');
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClass = `w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 ${
    isDark
      ? 'border-[#2f3336] bg-[#0e0f12] text-white'
      : 'border-[#e5e7eb] bg-white text-[#0f1419]'
  }`;
  const mutedText = isDark ? 'text-[#8b9299]' : 'text-[#536471]';

  return (
    <aside
      aria-label={`${bot.name} settings`}
      className={`flex h-full min-h-0 w-[360px] shrink-0 flex-col overflow-hidden border-l ${
        isDark
          ? 'border-[#26292d] bg-[#121418] text-[#e7e9ea]'
          : 'border-[#e5e7eb] bg-white text-[#0f1419]'
      }`}
    >
      <div className={`flex items-center justify-between border-b p-4 ${isDark ? 'border-[#26292d]' : 'border-[#e5e7eb]'}`}>
        <div className="min-w-0">
          <h2 className="text-sm font-bold">Bot settings</h2>
          <p className={`mt-0.5 truncate text-xs ${mutedText}`}>{bot.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`rounded-full p-2 ${isDark ? 'hover:bg-[#26292d]' : 'hover:bg-[#f0f2f5]'}`}
          aria-label="Close bot settings"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
          <div className="space-y-3">
            <label className="block text-xs font-semibold">
              Bot name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={`${fieldClass} mt-1.5`}
                required
              />
            </label>
            <label className="block text-xs font-semibold">
              Role / title
              <input
                value={roleTitle}
                onChange={(event) => setRoleTitle(event.target.value)}
                className={`${fieldClass} mt-1.5`}
                required
              />
            </label>
            <label className="block text-xs font-semibold">
              System instructions
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={6}
                className={`${fieldClass} mt-1.5 min-h-24 max-h-48 resize-y overflow-y-hidden`}
              />
            </label>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold">Allowed tools</h3>
            {grantableTools.length === 0 ? (
              <p className={`rounded-xl border px-3 py-2 text-xs ${mutedText} ${isDark ? 'border-[#2f3336]' : 'border-[#e5e7eb]'}`}>
                No tools are available yet. Connect a plugin in the Plugins panel.
              </p>
            ) : (
              <div className="space-y-1.5">
                {grantableTools.map((tool) => {
                  const granted =
                    (grants[tool.pluginSlug] ?? []).includes(tool.toolId) ||
                    (grants[tool.pluginSlug] ?? []).includes(tool.legacyName);
                  const disabled = !tool.pluginConnected || busyTool === tool.toolId;

                  return (
                    <label
                      key={tool.toolId}
                      title={
                        tool.pluginConnected
                          ? `${tool.toolId} — provided by ${tool.pluginName}`
                          : `Connect ${tool.pluginName} to use this`
                      }
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${
                        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                      } ${
                        granted
                          ? isDark
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-emerald-600/40 bg-emerald-50'
                          : isDark
                          ? 'border-[#2f3336] bg-[#0e0f12]'
                          : 'border-[#e5e7eb] bg-[#f8f9fa]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium">
                          {tool.label}
                          {tool.needsApproval && (
                            <span
                              className={`rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-wider ${
                                isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              approval
                            </span>
                          )}
                        </span>
                        <span className={`mt-0.5 block truncate font-normal ${mutedText}`}>
                          {tool.pluginConnected
                            ? tool.description
                            : `Connect ${tool.pluginName} to use this`}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={granted}
                        disabled={disabled}
                        onChange={() => void toggleGrant(tool)}
                        className="sr-only"
                      />
                      {granted && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                    </label>
                  );
                })}
              </div>
            )}
          </section>

          <label className="flex cursor-pointer items-center justify-between text-xs font-semibold">
            <span>
              Memory
              <span className={`mt-0.5 block font-normal ${mutedText}`}>
                Let this bot retain useful context.
              </span>
            </span>
            <input
              type="checkbox"
              checked={memoryEnabled}
              onChange={(event) => setMemoryEnabled(event.target.checked)}
              className="h-4 w-4 accent-purple-500"
            />
          </label>
        </div>

        <div className={`border-t p-4 ${isDark ? 'border-[#26292d]' : 'border-[#e5e7eb]'}`}>
          <button
            type="submit"
            disabled={isSaving}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-purple-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </form>
    </aside>
  );
};
