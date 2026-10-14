import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  Bot,
  Conversation,
  Message,
  PluginDefinition,
  PluginInstallation,
} from '../types/index';
import { api, setAuthToken } from '../services/api';
import { useRouter } from '../router';

export type NavigationTab = 'chat';

export type AppTheme = 'light' | 'dark';

const TOKEN_STORAGE_KEY = 'juttler_token';
const THEME_STORAGE_KEY = 'juttler_theme';

interface AppContextType {
  currentUser: User;
  isAuthenticated: boolean;
  bots: Bot[];
  conversations: Conversation[];
  activeTab: NavigationTab;
  selectedConversationId: string | null;
  isLoading: boolean;
  isWorkspaceLoading: boolean;
  theme: AppTheme;
  notification: { message: string; type: 'info' | 'success' | 'warning' } | null;
  setActiveTab: (tab: NavigationTab) => void;
  setSelectedConversationId: (id: string | null) => void;
  navigate: (to: string) => void;
  toggleTheme: () => void;
  login: (user: User, token: string) => void;
  logout: () => void;
  refreshData: () => Promise<void>;
  showToast: (message: string, type?: 'info' | 'success' | 'warning') => void;
  openChatWithBot: (botId: string) => Promise<void>;
  // Plugins — the marketplace catalog and what this account has connected
  plugins: PluginDefinition[];
  installedPlugins: PluginInstallation[];
  /** Plugins not yet connected, for the "bot needs one" prompt in chat. */
  missingPluginFor: (toolName: string) => PluginDefinition | null;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const GUEST_USER: User = {
  id: 'guest',
  name: 'Guest',
  email: '',
  role: 'user',
  avatar: '',
  status: 'active',
  createdAt: new Date().toISOString(),
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { navigate } = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const [bots, setBots] = useState<Bot[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [plugins, setPlugins] = useState<PluginDefinition[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<PluginInstallation[]>([]);
  const [activeTab, setActiveTab] = useState<NavigationTab>('chat');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState<boolean>(false);
  const workspaceDataLoaded = useRef(false);
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'success' | 'warning' } | null>(null);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  const refreshData = useCallback(async () => {
    if (!currentUser) return;

    if (!workspaceDataLoaded.current) {
      setIsWorkspaceLoading(true);
    }
    try {
      const [bList, cList, pList, iList] = await Promise.all([
        api.getBots(currentUser.id),
        api.getConversations(currentUser.id),
        api.getPlugins(),
        api.getInstalledPlugins(),
      ]);

      setBots(bList);
      setConversations(cList);
      setPlugins(pList);
      setInstalledPlugins(iList);
    } catch (err) {
      console.error('Failed to load application data:', err);
      showToast('Failed to load workspace data', 'warning');
    } finally {
      workspaceDataLoaded.current = true;
      setIsWorkspaceLoading(false);
    }
  }, [currentUser, showToast]);

  useEffect(() => {
    if (currentUser) {
      refreshData();
    }
  }, [currentUser, refreshData]);

  // Restore session from stored token on first load
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      setIsWorkspaceLoading(true);
      setAuthToken(storedToken);
      try {
        const { user } = await api.me();
        if (cancelled) return;
        setCurrentUser(user);
        setIsAuthenticated(true);
      } catch {
        if (cancelled) return;
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setAuthToken(null);
        setIsWorkspaceLoading(false);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((user: User, token: string) => {
    workspaceDataLoaded.current = false;
    setIsWorkspaceLoading(true);
    setCurrentUser(user);
    setIsAuthenticated(true);
    setAuthToken(token);
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      // ignore storage errors
    }
    setActiveTab('chat');
  }, []);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    setCurrentUser(null);
    setIsAuthenticated(false);
    workspaceDataLoaded.current = false;
    setIsWorkspaceLoading(false);
    setAuthToken(null);
    setBots([]);
    setConversations([]);
    setPlugins([]);
    setInstalledPlugins([]);
    setActiveTab('chat');
    setSelectedConversationId(null);
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  // Always-fresh view of the state openChatWithBot depends on, so the callback
  // can stay referentially stable (no spurious effect re-runs) while still
  // reading the latest conversations/bots and never creating a duplicate thread.
  const stateRef = useRef({ currentUser, bots, conversations });
  stateRef.current = { currentUser, bots, conversations };

  const openChatWithBot = useCallback(async (botId: string) => {
    const { currentUser, bots, conversations } = stateRef.current;
    if (!currentUser) return;

    const existing = conversations.find(
      (c) =>
        !c.isGroup &&
        (c.source ?? 'app') !== 'slack' &&
        c.participantBotIds.length === 1 &&
        c.participantBotIds[0] === botId
    );

    let conversation = existing;
    if (!conversation) {
      const targetBot = bots.find((b) => b.id === botId);
      conversation = await api.createConversation({
        userId: currentUser.id,
        title: targetBot ? `${targetBot.name} (${targetBot.roleTitle})` : 'Bot Chat',
        isGroup: false,
        participantBotIds: [botId],
      });
      setConversations((prev) => (prev.some((c) => c.id === conversation!.id) ? prev : [conversation!, ...prev]));
    }

    setSelectedConversationId(conversation.id);
    setActiveTab('chat');
    // Each bot owns its own URL so the chat survives refresh, back/forward,
    // and a link shared with someone else.
    navigate(`/workspace/chat/${botId}`);
  }, [navigate]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Which plugin (not yet connected) provides a tool — used to prompt the user
  // in chat instead of letting the bot fail silently.
  const missingPluginFor = useCallback(
    (toolName: string): PluginDefinition | null => {
      const owner = plugins.find((p) => p.tools.some((t) => t.name === toolName));
      if (!owner) return null;
      const connected = installedPlugins.some((i) => i.pluginSlug === owner.slug);
      return connected ? null : owner;
    },
    [plugins, installedPlugins]
  );

  return (
    <AppContext.Provider
      value={{
        currentUser: currentUser ?? GUEST_USER,
        isAuthenticated,
        bots,
        conversations,
        activeTab,
        selectedConversationId,
        isLoading,
        isWorkspaceLoading,
        theme,
        notification,
        setActiveTab,
        setSelectedConversationId,
        navigate,
        toggleTheme,
        login,
        logout,
        refreshData,
        showToast,
        openChatWithBot,
        plugins,
        installedPlugins,
        missingPluginFor,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};