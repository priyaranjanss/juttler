import React, { useState, useMemo } from 'react';
import { useApp } from '../../contexts/AppContext';
import { api } from '../../services/api';
import { BotBlobAvatar } from './BotBlobAvatar';
import { X, Check, Bot as BotIcon } from 'lucide-react';

interface CreateBotModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** A tool shown in the picker, built from the plugin catalog. */
interface PickableTool {
  /** Canonical registry id, e.g. "slack.list_channels". */
  id: string;
  name: string;
  desc: string;
  pluginSlug: string;
  pluginName: string;
  /** False when the plugin is not connected yet, so it cannot be used. */
  connected: boolean;
  /** Sensitive tools need human approval before they run. */
  needsApproval: boolean;
}

export const CreateBotModal: React.FC<CreateBotModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { currentUser, refreshData, showToast, openChatWithBot, theme, plugins, installedPlugins } = useApp();

  const isDark = theme === 'dark';

  // The tool list is discovered from the plugin catalog rather than written
  // out here, so a new plugin (or a renamed tool) needs no change in this file.
  const availableTools = useMemo<PickableTool[]>(() => {
    const connected = new Set(installedPlugins.map((i) => i.pluginSlug));
    const out: PickableTool[] = [];

    for (const plugin of plugins) {
      for (const tool of plugin.tools) {
        out.push({
          id: `${plugin.slug}.${tool.name}`,
          name: tool.name.replace(/_/g, ' '),
          desc: tool.description,
          pluginSlug: plugin.slug,
          pluginName: plugin.name,
          connected: connected.has(plugin.slug),
          needsApproval: tool.sensitive === true,
        });
      }
    }

    return out;
  }, [plugins, installedPlugins]);

  // Bot creation state
  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [shape, setShape] = useState('blob');
  const [color, setColor] = useState('#7C3AED');

  // Start with the safe defaults: every usable tool from a connected plugin
  // that does not need approval. Nothing is pre-ticked for a plugin the user
  // has not connected.
  const [selectedTools, setSelectedTools] = useState<string[]>(() =>
    availableTools.filter((t) => t.connected && !t.needsApproval).map((t) => t.id)
  );
  const [isChiefOfStaff, setIsChiefOfStaff] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const shapeOptions = [
    { id: 'blob', label: 'Organic Blob' },
    { id: 'teardrop', label: 'Teardrop' },
    { id: 'cloud', label: 'Cloud Blob' },
    { id: 'double_drop', label: 'Double Drop' },
    { id: 'circle', label: 'Circle Pebble' },
    { id: 'bean', label: 'Kidney Bean' },
    { id: 'oval', label: 'Oval Pill' },
    { id: 'triangle', label: 'Triangle' },
    { id: 'square', label: 'Rounded Square' },
  ];

  const colorOptions = [
    '#7C3AED', // Purple
    '#38BDF8', // Sky Blue
    '#10B981', // Emerald
    '#2DD4BF', // Teal
    '#9A6B4B', // Brown
    '#F97316', // Orange
    '#FB7185', // Coral Red
    '#EC4899', // Pink
    '#6366F1', // Indigo
  ];

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolId) ? prev.filter((t) => t !== toolId) : [...prev, toolId]
    );
  };

  const handleCreateBotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !roleTitle.trim()) {
      showToast('Name and role title are required', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await api.createBot({
        userId: currentUser.id,
        name: name.trim(),
        roleTitle: roleTitle.trim(),
        systemPrompt:
          systemPrompt.trim() ||
          `You are ${name.trim()}, ${roleTitle.trim()}. Assist your workforce teammates concisely.`,
        avatar: shape,
        color,
        allowedTools: selectedTools,
        isChiefOfStaff,
      });

      showToast(`Created ${created.name}`, 'success');
      await refreshData();
      onClose();
      // Reset form
      setName('');
      setRoleTitle('');
      setSystemPrompt('');
      openChatWithBot(created.id);
    } catch (err) {
      console.error(err);
      showToast('Failed to create bot', 'warning');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden transition-all max-h-[90vh] flex flex-col ${
          isDark ? 'bg-[#121418] border-[#2f3336] text-[#e7e9ea]' : 'bg-white border-[#eff3f4] text-[#0f1419]'
        }`}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-[#2f3336]' : 'border-[#eff3f4]'}`}>
          <div className="flex items-center space-x-2">
            <BotIcon className="h-5 w-5 text-purple-400" />
            <h3 className="text-base font-extrabold tracking-tight">Create New Bot Teammate</h3>
          </div>

          <button
            onClick={onClose}
            className={`p-1.5 rounded-full transition ${isDark ? 'hover:bg-[#1c1e22] text-[#71767b]' : 'hover:bg-[#f7f9f9] text-[#536471]'}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          <form onSubmit={handleCreateBotSubmit} className="space-y-4">
            {/* Avatar Preview */}
            <div className="flex items-center space-x-4 p-3 rounded-2xl border bg-black/5 dark:bg-white/5">
              <BotBlobAvatar name={name || 'New Bot'} avatarShape={shape} color={color} size={48} />
              <div>
                <h4 className="text-sm font-bold">{name || 'Bot Name'}</h4>
                <p className="text-xs text-[#71767b]">{roleTitle || 'Specialist Role'}</p>
              </div>
            </div>

            {/* Geometric Shape Picker */}
            <div>
              <label className="text-xs font-bold block mb-1.5">Avatar Shape</label>
              <div className="grid grid-cols-3 gap-2">
                {shapeOptions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setShape(s.id)}
                    className={`p-2 rounded-xl border text-xs flex items-center space-x-2 transition ${
                      shape === s.id
                        ? isDark
                          ? 'border-purple-500 bg-purple-500/10 text-white font-bold'
                          : 'border-purple-500 bg-purple-50 text-black font-bold'
                        : isDark
                        ? 'border-[#2f3336] bg-[#16181c] text-[#71767b]'
                        : 'border-[#eff3f4] bg-[#f7f9f9] text-[#536471]'
                    }`}
                  >
                    <BotBlobAvatar name="preview" avatarShape={s.id} color={color} size={20} />
                    <span className="truncate text-[11px]">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Color Swatches */}
            <div>
              <label className="text-xs font-bold block mb-1.5">Avatar Color</label>
              <div className="flex items-center space-x-2">
                {colorOptions.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="h-7 w-7 rounded-full transition flex items-center justify-center border-2 border-transparent"
                    style={{ backgroundColor: c }}
                  >
                    {color === c && <Check className="h-4 w-4 text-white" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Name & Role */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold block mb-1">Bot Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. CodeArchitect"
                  className={`w-full p-2.5 rounded-xl border text-xs focus:outline-none ${
                    isDark ? 'bg-[#181a1f] border-[#2f3336] text-white' : 'bg-[#f7f9f9] border-[#eff3f4] text-black'
                  }`}
                />
              </div>
              <div>
                <label className="text-xs font-bold block mb-1">Role / Title *</label>
                <input
                  type="text"
                  required
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Lead Engineer"
                  className={`w-full p-2.5 rounded-xl border text-xs focus:outline-none ${
                    isDark ? 'bg-[#181a1f] border-[#2f3336] text-white' : 'bg-[#f7f9f9] border-[#eff3f4] text-black'
                  }`}
                />
              </div>
            </div>

            {/* System Prompt */}
            <div>
              <label className="text-xs font-bold block mb-1">System Instructions</label>
              <textarea
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Instructions for how this bot should act..."
                className={`w-full p-2.5 rounded-xl border text-xs focus:outline-none ${
                  isDark ? 'bg-[#181a1f] border-[#2f3336] text-white' : 'bg-[#f7f9f9] border-[#eff3f4] text-black'
                }`}
              />
            </div>

            {/* Allowed Tools & Capabilities */}
            <div>
              <label className="text-xs font-bold block mb-1.5">Allowed Tools & Capabilities</label>
              {availableTools.length === 0 ? (
                <p className={`text-[11px] ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                  No tools are available yet. Connect a plugin in the Plugins panel first.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {availableTools.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => toggleTool(tool.id)}
                      disabled={!tool.connected}
                      title={tool.connected ? tool.id : `${tool.pluginName} is not connected`}
                      className={`p-2.5 rounded-xl border text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        selectedTools.includes(tool.id)
                          ? isDark
                            ? 'border-emerald-500 bg-emerald-500/10 text-white'
                            : 'border-emerald-600 bg-emerald-50 text-black'
                          : isDark
                          ? 'border-[#2f3336] bg-[#16181c] text-[#71767b]'
                          : 'border-[#eff3f4] bg-[#f7f9f9] text-[#536471]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-bold flex items-center gap-1">
                          {tool.name}
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
                        {selectedTools.includes(tool.id) && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                      </div>
                      <p className="text-[10px] opacity-75">
                        {tool.connected ? tool.desc : `Connect ${tool.pluginName} to use this`}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full py-3 rounded-full font-bold text-xs transition ${
                  isDark ? 'bg-white text-black hover:bg-[#e7e9ea]' : 'bg-black text-white hover:bg-[#272c30]'
                }`}
              >
                {isSubmitting ? 'Creating…' : 'Create bot'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateBotModal;
