import React, { useEffect, useState } from 'react';
import { X, Save, Check } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { Bot } from '../../types';

const availableTools = [
  { id: 'web_search', name: 'Web Search' },
  { id: 'github_list_prs', name: 'GitHub PR Reader' },
  { id: 'github_merge_pr', name: 'GitHub PR Merger' },
  { id: 'jira_search_tickets', name: 'Jira Ticket Reader' },
  { id: 'slack_send_message', name: 'Slack Publisher' },
  { id: 'code_interpreter', name: 'Code Sandbox' },
  { id: 'file_read', name: 'Read Files' },
  { id: 'file_write', name: 'Write Files' },
];

interface BotSettingsPanelProps {
  bot: Bot;
  onClose: () => void;
}

export const BotSettingsPanel: React.FC<BotSettingsPanelProps> = ({ bot, onClose }) => {
  const { refreshData, showToast, theme } = useApp();
  const isDark = theme === 'dark';
  const [name, setName] = useState(bot.name);
  const [roleTitle, setRoleTitle] = useState(bot.roleTitle);
  const [systemPrompt, setSystemPrompt] = useState(bot.systemPrompt);
  const [allowedTools, setAllowedTools] = useState(bot.allowedTools || []);
  const [memoryEnabled, setMemoryEnabled] = useState(bot.memoryEnabled);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(bot.name);
    setRoleTitle(bot.roleTitle);
    setSystemPrompt(bot.systemPrompt);
    setAllowedTools(bot.allowedTools || []);
    setMemoryEnabled(bot.memoryEnabled);
  }, [bot]);

  const toggleTool = (toolId: string) => {
    setAllowedTools((current) =>
      current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId]
    );
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
            <div className="space-y-1.5">
              {availableTools.map((tool) => {
                const isEnabled = allowedTools.includes(tool.id);
                return (
                  <label
                    key={tool.id}
                    className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs ${
                      isEnabled
                        ? isDark
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : 'border-emerald-600/40 bg-emerald-50'
                        : isDark
                          ? 'border-[#2f3336] bg-[#0e0f12]'
                          : 'border-[#e5e7eb] bg-[#f8f9fa]'
                    }`}
                  >
                    <span>{tool.name}</span>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => toggleTool(tool.id)}
                      className="sr-only"
                    />
                    {isEnabled && <Check className="h-4 w-4 text-emerald-500" />}
                  </label>
                );
              })}
            </div>
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
