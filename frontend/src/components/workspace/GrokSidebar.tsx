import React, { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { BotBlobAvatar } from '../common/BotBlobAvatar';
import { Avatar } from '../common/Avatar';
import { Bot } from '../../types';
import {
  Search,
  Plus,
  Plug,
  Bot as BotIcon,
  Users,
  Settings2,
  ChevronDown,
  Sun,
  Moon,
} from 'lucide-react';

interface GrokSidebarProps {
  onOpenCreateBotModal?: () => void;
  onOpenBotProfile?: (bot: Bot) => void;
  onOpenPlugins?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const GrokSidebar: React.FC<GrokSidebarProps> = ({
  onOpenCreateBotModal,
  onOpenBotProfile,
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
    navigate,
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

  // Search filter: filter bots specifically by bot name as requested.
  // The Chief of Staff is always pinned first — it is the user's front door.
  const filteredBots = bots
    .filter((bot) => bot.name.toLowerCase().includes(searchQuery.toLowerCase().trim()))
    .sort((a, b) => Number(b.isChiefOfStaff) - Number(a.isChiefOfStaff));

  return (
    <aside
      className={`w-72 shrink-0 border-r flex flex-col justify-between h-screen sticky top-0 z-20 select-none transition-colors ${
        isDark ? 'bg-[#121418] border-[#26292d] text-[#e7e9ea]' : 'bg-[#f8f9fa] border-[#e5e7eb] text-[#0f1419]'
      }`}
    >
      {/* Top Header: + Icon with Dropdown Menu (Create new Bot / Create group chat) */}
      <div className="p-3 pb-2 flex flex-col space-y-2 shrink-0">
        {/* Top Header Row with + icon and dropdown menu */}
        <div className="flex items-center justify-end h-6 relative">
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className={`p-1 rounded-full transition cursor-pointer ${
              isDark
                ? 'text-[#71767b] hover:text-white hover:bg-[#181a1f]'
                : 'text-[#8b98a5] hover:text-black hover:bg-[#eef1f4]'
            }`}
            title="Add"
          >
            <Plus className="h-5 w-5 stroke-[2]" />
          </button>

          {/* Dropdown Menu Overlay */}
          {dropdownOpen && (
            <>
              {/* Backdrop overlay to close dropdown when clicking outside */}
              <div
                className="fixed inset-0 z-30"
                onClick={() => setDropdownOpen(false)}
              />

              {/* Dropdown Menu Box */}
              <div
                className={`absolute right-0 top-full mt-1 w-48 rounded-2xl border shadow-xl p-1.5 z-40 space-y-0.5 text-xs font-semibold ${
                  isDark
                    ? 'bg-[#181a1f] border-[#26292d] text-[#e7e9ea]'
                    : 'bg-white border-[#e5e7eb] text-[#0f1419]'
                }`}
              >
                {/* 1. Create new Bot -> opens working Create Bot modal */}
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    if (onOpenCreateBotModal) onOpenCreateBotModal();
                  }}
                  className={`w-full flex items-center space-x-2 px-3 py-2 rounded-xl transition text-left ${
                    isDark ? 'hover:bg-[#26292d]' : 'hover:bg-[#f0f2f5]'
                  }`}
                >
                  <BotIcon className="h-4 w-4 shrink-0 text-purple-400" />
                  <span>Create new Bot</span>
                </button>

                {/* 2. Create group chat -> does nothing */}
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    /* Create group chat - do nothing as requested */
                  }}
                  className={`w-full flex items-center space-x-2 px-3 py-2 rounded-xl transition text-left opacity-80 ${
                    isDark ? 'hover:bg-[#26292d]' : 'hover:bg-[#f0f2f5]'
                  }`}
                >
                  <Users className="h-4 w-4 shrink-0 text-[#71767b]" />
                  <span>Create group chat</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Search Bar filtering bot by name */}
        <div
          className={`flex items-center px-3 py-2 rounded-xl border text-xs transition ${
            isDark
              ? 'bg-[#181a1f] border-[#26292d] text-white focus-within:border-[#536471]'
              : 'bg-[#eef1f4] border-transparent text-[#0f1419] focus-within:border-[#cfd9de] focus-within:bg-white'
          }`}
        >
          <Search className={`h-4 w-4 mr-2 shrink-0 ${isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent focus:outline-none placeholder:text-[#8b98a5] text-xs font-medium"
          />
        </div>
      </div>

      {/* Main Bot Roster - Displaying all bots from database */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {isWorkspaceLoading && bots.length === 0 ? (
          <div role="status" aria-label="Loading bots" className="space-y-2 p-2">
            {[0, 1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className={`flex items-center gap-3 rounded-2xl p-2.5 ${
                  isDark ? 'bg-[#181a1f]/60' : 'bg-white/70'
                }`}
              >
                <span className={`h-9 w-9 shrink-0 animate-pulse rounded-full ${isDark ? 'bg-[#2f3336]' : 'bg-[#e5e7eb]'}`} />
                <span className="min-w-0 flex-1 space-y-2">
                  <span className={`block h-3 w-2/3 animate-pulse rounded ${isDark ? 'bg-[#2f3336]' : 'bg-[#e5e7eb]'}`} />
                  <span className={`block h-2.5 w-1/2 animate-pulse rounded ${isDark ? 'bg-[#26292d]' : 'bg-[#eef1f4]'}`} />
                </span>
              </div>
            ))}
            <span className="sr-only">Loading your bots…</span>
          </div>
        ) : filteredBots.length === 0 ? (
          <div className="p-4 text-center text-xs text-[#71767b]">
            No bots match "{searchQuery}"
          </div>
        ) : (
          filteredBots.map((bot) => {
            // Check if this bot is selected in active conversation
            const activeConv = conversations.find((c) => c.id === selectedConversationId);
            const isSelected =
              activeConv &&
              !activeConv.isGroup &&
              activeConv.participantBotIds.includes(bot.id);

            return (
              <div
                key={bot.id}
                onClick={() => openChatWithBot(bot.id)}
                className={`group relative w-full flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition ${
                  isSelected
                    ? isDark
                      ? 'bg-[#26292d] text-white font-semibold'
                      : 'bg-[#e5e7eb] text-[#0f1419] font-semibold'
                    : isDark
                    ? 'text-[#e7e9ea] hover:bg-[#181a1f]'
                    : 'text-[#0f1419] hover:bg-[#f0f2f5]'
                }`}
              >
                <div className="flex items-center space-x-3 min-w-0">
                  {/* Grok Geometric Avatar */}
                  <BotBlobAvatar name={bot.name} avatarShape={bot.avatar} color={bot.color} size={36} />

                  {/* Bot Name & Subtitle (roleTitle / last snippet) */}
                  <div className="min-w-0 text-left">
                    <div className="flex items-center space-x-1">
                      <span className="text-xs font-extrabold truncate leading-tight">{bot.name}</span>
                      {bot.isChiefOfStaff && (
                        <span className="shrink-0 rounded-full bg-purple-500/20 px-1 py-0.2 text-[8px] font-extrabold uppercase font-mono text-purple-400">
                          CoS
                        </span>
                      )}
                    </div>
                    <span className={`text-[11px] truncate block leading-tight ${isDark ? 'text-[#71767b]' : 'text-[#536471]'}`}>
                      {bot.roleTitle}
                    </span>
                  </div>
                </div>

                {/* Status dot + settings affordance */}
                <div className="shrink-0 flex items-center space-x-1">
                  {bot.status === 'working' && (
                    <span className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
                  )}
                  {bot.status === 'waiting_approval' && (
                    <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBotProfile?.(bot);
                    }}
                    className={`p-1 rounded-md transition opacity-0 group-hover:opacity-100 ${
                      isDark ? 'hover:bg-[#202327] text-[#71767b] hover:text-white' : 'hover:bg-[#e5e7eb] text-[#536471] hover:text-black'
                    }`}
                    title="Bot settings"
                    aria-label={`Settings for ${bot.name}`}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Section: Plugins & Account User from Database */}
      <div className={`p-3 border-t shrink-0 space-y-2 ${isDark ? 'border-[#26292d] bg-[#0e0f12]' : 'border-[#e5e7eb] bg-[#f8f9fa]'}`}>
        {/* Plugins Section */}
        <button
          onClick={() => onOpenPlugins?.()}
          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-xl cursor-pointer transition text-xs font-bold ${
            isDark ? 'text-[#e7e9ea] hover:bg-[#181a1f]' : 'text-[#0f1419] hover:bg-[#eef1f4]'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            <Plug className="h-4 w-4 stroke-[2]" />
            <span>Plugins</span>
          </div>
          {installedPlugins.length > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
              {installedPlugins.length}
            </span>
          )}
        </button>

        {/* User account - opens a small dropdown (Settings / Change theme) */}
        <div className="relative">
          <button
            onClick={() => setAccountMenuOpen((prev) => !prev)}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-xl transition text-left min-w-0 ${
              isDark ? 'hover:bg-[#181a1f]' : 'hover:bg-[#eef1f4]'
            }`}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
          >
            <div className="flex items-center space-x-2.5 min-w-0">
              <Avatar name={currentUser?.name || 'User'} src={currentUser?.avatar} size="md" />
              <span className={`text-xs font-extrabold truncate ${isDark ? 'text-white' : 'text-[#0f1419]'}`}>
                {currentUser?.name || 'User'}
              </span>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${
                isDark ? 'text-[#71767b]' : 'text-[#8b98a5]'
              } ${accountMenuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {accountMenuOpen && (
            <>
              {/* Click-outside to dismiss */}
              <div className="fixed inset-0 z-30" onClick={() => setAccountMenuOpen(false)} />

              <div
                role="menu"
                className={`absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-2xl border shadow-xl ${
                  isDark ? 'border-[#26292d] bg-[#16181c] text-white' : 'border-[#e5e7eb] bg-white text-[#0f1419]'
                }`}
              >
                <button
                  role="menuitem"
                  onClick={() => toggleTheme()}
                  className={`flex w-full items-center space-x-2.5 px-3 py-2 text-xs font-semibold transition ${
                    isDark ? 'border-[#26292d] hover:bg-[#202327]' : 'border-[#e5e7eb] hover:bg-[#f0f2f5]'
                  }`}
                >
                  {isDark ? (
                    <Sun className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Moon className="h-4 w-4 text-purple-600" />
                  )}
                  <span>Change theme</span>
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