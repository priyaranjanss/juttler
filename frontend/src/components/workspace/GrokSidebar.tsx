import React, { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { BotBlobAvatar } from '../common/BotBlobAvatar';
import { Avatar } from '../common/Avatar';
import { Conversation } from '../../types';
import {
  Search,
  Plus,
  Plug,
  Bot as BotIcon,
  Users,
  ChevronDown,
  Sun,
  Moon,
  LogOut,
} from 'lucide-react';

interface GrokSidebarProps {
  onOpenCreateBotModal?: () => void;
  onOpenPlugins?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Short relative time for the row, in the style the reference uses. */
function formatListTime(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (dayDiff <= 0) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** One-line preview of the last message, whitespace collapsed. */
function previewLine(conversation: Conversation | null, fallback: string): string {
  const snippet = conversation?.lastMessageSnippet?.replace(/\s+/g, ' ').trim();
  return snippet || fallback;
}

export const GrokSidebar: React.FC<GrokSidebarProps> = ({
  onOpenCreateBotModal,
  onOpenPlugins,
  isCollapsed = false,
}) => {
  const {
    currentUser,
    bots,
    conversations,
    selectedConversationId,
    openChatWithBot,
    theme,
    toggleTheme,
    logout,
    installedPlugins,
    isWorkspaceLoading,
  } = useApp();

  const isDark = theme === 'dark';
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // Dropdown on the user account row at the bottom of the sidebar
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  if (isCollapsed) {
    return null;
  }

  const activeConversation = conversations.find((c) => c.id === selectedConversationId) || null;
  const activeBotId =
    activeConversation && !activeConversation.isGroup ? activeConversation.participantBotIds[0] : null;

  // The Chief of Staff is always pinned first. Search matches the bot's name.
  const filteredBots = bots
    .filter((bot) => bot.name.toLowerCase().includes(searchQuery.toLowerCase().trim()))
    .sort((a, b) => Number(b.isChiefOfStaff) - Number(a.isChiefOfStaff));

  const latestConversationFor = (botId: string): Conversation | null =>
    conversations
      .filter(
        (c) =>
          !c.isGroup &&
          (c.source ?? 'app') !== 'slack' &&
          c.participantBotIds.length === 1 &&
          c.participantBotIds[0] === botId
      )
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())[0] || null;

  return (
    <aside
      className={`w-[300px] xl:w-[312px] shrink-0 border-r flex flex-col justify-between h-screen sticky top-0 z-20 select-none transition-colors ${
        isDark ? 'bg-[#111113] border-[#232326] text-[#f5f5f7]' : 'bg-[#f6f6f7] border-[#e6e6e8] text-[#1c1c1e]'
      }`}
    >
      <div className="shrink-0 px-3.5 pt-3.5">
        {/* Add */}
        <div className="flex h-7 items-center justify-end">
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((prev) => !prev)}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition cursor-pointer ${
                isDark
                  ? 'text-[#98989f] hover:text-white hover:bg-[#1f1f22]'
                  : 'text-[#8e8e93] hover:text-[#1c1c1e] hover:bg-[#e8e8ea]'
              }`}
              title="Add"
              aria-label="Add"
            >
              <Plus className="h-[18px] w-[18px] stroke-[1.8]" />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />

                <div
                  className={`absolute right-0 top-full mt-1.5 w-48 rounded-[10px] border shadow-lg p-1 z-40 text-[12px] font-medium ${
                    isDark
                      ? 'bg-[#1c1c1f] border-[#2c2c2f] text-[#f5f5f7]'
                      : 'bg-white border-[#e6e6e8] text-[#1c1c1e]'
                  }`}
                >
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenCreateBotModal?.();
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition text-left ${
                      isDark ? 'hover:bg-[#26262a]' : 'hover:bg-[#f2f2f4]'
                    }`}
                  >
                    <BotIcon className="h-4 w-4 shrink-0" />
                    <span>Create new Bot</span>
                  </button>

                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      /* Create group chat - not wired up yet */
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition text-left opacity-60 ${
                      isDark ? 'hover:bg-[#26262a]' : 'hover:bg-[#f2f2f4]'
                    }`}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span>Create group chat</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Search */}
        <div
          className={`mt-3 flex h-9 items-center gap-2 rounded-lg px-3 transition ${
            isDark
              ? 'bg-[#1c1c1f] text-[#f5f5f7] focus-within:bg-[#242428]'
              : 'bg-[#ececee] text-[#1c1c1e] focus-within:bg-[#e6e6e8]'
          }`}
        >
          <Search className="h-[15px] w-[15px] shrink-0 text-[#8e8e93]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-[13px] focus:outline-none placeholder:text-[#8e8e93]"
          />
        </div>
      </div>

      {/* Bot roster */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 no-scrollbar">
        {isWorkspaceLoading && bots.length === 0 ? (
          <div role="status" aria-label="Loading bots" className="space-y-1">
            {[0, 1, 2, 3, 4, 5].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-[10px] p-2.5">
                <span
                  className={`h-9 w-9 shrink-0 animate-pulse rounded-full ${
                    isDark ? 'bg-[#26262a]' : 'bg-[#e6e6e8]'
                  }`}
                />
                <span className="min-w-0 flex-1 space-y-2">
                  <span
                    className={`block h-3 w-2/3 animate-pulse rounded ${
                      isDark ? 'bg-[#26262a]' : 'bg-[#e6e6e8]'
                    }`}
                  />
                  <span
                    className={`block h-2.5 w-1/2 animate-pulse rounded ${
                      isDark ? 'bg-[#1f1f22]' : 'bg-[#ececee]'
                    }`}
                  />
                </span>
              </div>
            ))}
            <span className="sr-only">Loading your bots…</span>
          </div>
        ) : filteredBots.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-[#8e8e93]">No bots match "{searchQuery}"</div>
        ) : (
          filteredBots.map((bot) => {
            const conversation = latestConversationFor(bot.id);
            const isSelected = activeBotId === bot.id;
            const preview = previewLine(conversation, bot.roleTitle);
            const time = formatListTime(conversation?.lastMessageAt);

            return (
              <div
                key={bot.id}
                role="button"
                tabIndex={0}
                onClick={() => openChatWithBot(bot.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openChatWithBot(bot.id);
                  }
                }}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-[10px] p-2.5 text-left transition ${
                  isSelected
                    ? isDark
                      ? 'bg-[#26262a]'
                      : 'bg-[#e9e9eb]'
                    : isDark
                      ? 'hover:bg-[#1c1c1f]'
                      : 'hover:bg-[#ededee]'
                }`}
              >
                <BotBlobAvatar name={bot.name} avatarShape={bot.avatar} color={bot.color} size={38} />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold leading-tight">{bot.name}</span>
                    <span className="shrink-0 text-[11px] text-[#8e8e93]">{time}</span>
                  </div>

                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={`min-w-0 truncate text-[12px] ${isDark ? 'text-[#98989f]' : 'text-[#8e8e93]'}`}>
                      {preview}
                    </span>
                    {bot.status === 'working' && (
                      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#0a84ff]" aria-label="Working" />
                    )}
                    {bot.status === 'waiting_approval' && (
                      <span
                        className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#ff9f0a]"
                        aria-label="Waiting for approval"
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Plugins + account */}
      <div className={`shrink-0 px-2.5 pb-3 pt-2 border-t ${isDark ? 'border-[#232326]' : 'border-[#e6e6e8]'}`}>
        <button
          onClick={() => onOpenPlugins?.()}
          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
            isDark ? 'hover:bg-[#1c1c1f]' : 'hover:bg-[#ededee]'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <Plug className="h-[17px] w-[17px] stroke-[1.8]" />
            <span>Plugins</span>
          </span>
          {installedPlugins.length > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                isDark ? 'bg-[#26262a] text-[#98989f]' : 'bg-[#e6e6e8] text-[#6e6e73]'
              }`}
            >
              {installedPlugins.length}
            </span>
          )}
        </button>

        <div className="relative mt-0.5">
          <button
            onClick={() => setAccountMenuOpen((prev) => !prev)}
            className={`w-full flex items-center justify-between rounded-lg px-2 py-1.5 transition text-left ${
              isDark ? 'hover:bg-[#1c1c1f]' : 'hover:bg-[#ededee]'
            }`}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar name={currentUser?.name || 'User'} src={currentUser?.avatar} size="md" />
              <span className="truncate text-[13px] font-medium">{currentUser?.name || 'User'}</span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-[#8e8e93] transition-transform ${
                accountMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {accountMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setAccountMenuOpen(false)} />

              <div
                role="menu"
                className={`absolute bottom-full left-0 right-0 z-40 mb-1.5 overflow-hidden rounded-[10px] border p-1 shadow-lg ${
                  isDark
                    ? 'border-[#2c2c2f] bg-[#1c1c1f] text-[#f5f5f7]'
                    : 'border-[#e6e6e8] bg-white text-[#1c1c1e]'
                }`}
              >
                <div className={`border-b px-2.5 py-2 ${isDark ? 'border-[#2c2c2f]' : 'border-[#e6e6e8]'}`}>
                  <p className="truncate text-[12px] font-semibold">{currentUser?.name || 'User'}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[#8e8e93]">{currentUser?.email}</p>
                </div>

                <button
                  role="menuitem"
                  onClick={() => toggleTheme()}
                  className={`mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] font-medium transition ${
                    isDark ? 'hover:bg-[#26262a]' : 'hover:bg-[#f2f2f4]'
                  }`}
                >
                  {isDark ? (
                    <Sun className="h-4 w-4 text-[#ff9f0a]" />
                  ) : (
                    <Moon className="h-4 w-4 text-[#8e8e93]" />
                  )}
                  <span>Change theme</span>
                </button>

                <div className={`my-1 border-t ${isDark ? 'border-[#2c2c2f]' : 'border-[#e6e6e8]'}`} />

                <button
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    void logout();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] font-medium text-[#ff453a] transition ${
                    isDark ? 'hover:bg-[#ff453a]/10' : 'hover:bg-[#ff453a]/5'
                  }`}
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
};

export default GrokSidebar;
