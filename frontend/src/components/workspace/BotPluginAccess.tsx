import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { Bot } from '../../types';
import { PluginLogo } from '../common/PluginLogo';

interface BotPluginAccessProps {
  bot: Bot;
  isDark: boolean;
  onOpenPlugins: (slug?: string) => void;
}

/**
 * One switch per connected account. Turning Slack on lets this bot use the
 * Slack account you signed in with. GitHub then asks which repositories.
 */
export const BotPluginAccess: React.FC<BotPluginAccessProps> = ({ bot, isDark, onOpenPlugins }) => {
  const { refreshData, showToast, plugins, installedPlugins } = useApp();
  const [access, setAccess] = useState<Record<string, string[]>>({});
  const [loadedBotId, setLoadedBotId] = useState<string | null>(null);
  const [repos, setRepos] = useState<Array<{ name: string; private: boolean }>>([]);
  const [allowed, setAllowed] = useState<string[]>(bot.githubRepos || []);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const installedKey = installedPlugins.map((item) => `${item.id}:${item.status}`).join('|');

  useEffect(() => {
    setAllowed(bot.githubRepos || []);
  }, [bot.id, bot.githubRepos]);

  useEffect(() => {
    let cancelled = false;
    setAccess({});
    setLoadedBotId(null);
    api
      .getBotPluginAccess(bot.id)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, string[]> = {};
        for (const row of rows) map[row.pluginSlug] = row.enabledTools;
        setAccess(map);
        setLoadedBotId(bot.id);
      })
      .catch(() => {
        if (!cancelled) {
          setAccess({});
          setLoadedBotId(bot.id);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bot.id, installedKey]);

  const githubConnected = installedPlugins.some((item) => item.pluginSlug === 'github' && item.status === 'connected');
  const githubOn = (access.github || []).length > 0;

  useEffect(() => {
    if (!githubConnected) {
      setRepos([]);
      return;
    }
    let cancelled = false;
    setLoadingRepos(true);
    api
      .listGithubRepos()
      .then((result) => {
        if (!cancelled) setRepos(result.repos);
      })
      .catch((err) => {
        if (!cancelled) {
          setRepos([]);
          showToast(err instanceof Error ? err.message : 'Could not list GitHub repositories', 'warning');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRepos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [githubConnected, showToast]);

  const muted = isDark ? 'text-[#8b98a5]' : 'text-[#536471]';
  const card = `rounded-xl border p-3 ${isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-[#f8f9fa]'}`;

  const allowPlugin = async (slug: string, on: boolean) => {
    const plugin = plugins.find((item) => item.slug === slug);
    if (!plugin) return;
    const previous = access[slug] || [];
    const next = on ? plugin.tools.map((tool) => `${slug}.${tool.name}`) : [];
    setAccess((current) => ({ ...current, [slug]: next }));
    setBusy(slug);
    try {
      await api.setBotPluginAccess(bot.id, slug, next);
    } catch (err) {
      setAccess((current) => ({ ...current, [slug]: previous }));
      showToast(err instanceof Error ? err.message : 'Could not update access', 'warning');
    } finally {
      setBusy(null);
    }
  };

  const toggleRepo = async (name: string) => {
    const next = allowed.some((repo) => repo.toLowerCase() === name.toLowerCase())
      ? allowed.filter((repo) => repo.toLowerCase() !== name.toLowerCase())
      : [...allowed, name];
    const previous = allowed;
    setAllowed(next);
    setBusy('repos');
    try {
      const updated = await api.updateBot(bot.id, { githubRepos: next });
      setAllowed(updated.githubRepos || next);
      await refreshData();
    } catch (err) {
      setAllowed(previous);
      showToast(err instanceof Error ? err.message : 'Could not update repositories', 'warning');
    } finally {
      setBusy(null);
    }
  };

  if (installedPlugins.length === 0) {
    return (
      <div className="px-3">
        <div className={`${card} border-dashed`}>
          <p className="text-[11px] font-bold">No accounts connected</p>
          <p className={`mt-1 text-[11px] leading-relaxed ${muted}`}>
            Connect an account once in Plugins. Then turn it on for each bot that should use it.
          </p>
          <button
            type="button"
            onClick={() => onOpenPlugins()}
            className={`mt-2 rounded-full px-3 py-1.5 text-[11px] font-bold ${
              isDark ? 'bg-white text-black' : 'bg-[#0f1419] text-white'
            }`}
          >
            Connect an account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-3">
      <p className={`text-[11px] leading-relaxed ${muted}`}>
        These switches are only for {bot.name}. Turning one on does not turn it on for any other bot.
      </p>
      {installedPlugins.map((installation) => {
        const plugin = plugins.find((item) => item.slug === installation.pluginSlug);
        if (!plugin) return null;
        const on = (access[plugin.slug] || []).length > 0;
        return (
          <div key={installation.id} className={card}>
            <button
              type="button"
              onClick={() => allowPlugin(plugin.slug, !on)}
              disabled={busy === plugin.slug || loadedBotId !== bot.id}
              className="flex w-full items-center gap-2 text-left"
            >
              <PluginLogo slug={plugin.slug} size={18} />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-extrabold">{plugin.name}</span>
                <span className={`block text-[10px] ${muted}`}>
                  {on ? 'This bot can use the connected account' : 'Off for this bot'}
                </span>
              </span>
              <span
                className={`flex h-4 w-8 shrink-0 items-center rounded-full ${
                  on ? 'bg-emerald-500' : isDark ? 'bg-[#2f3336]' : 'bg-[#cfd9de]'
                }`}
              >
                <span className={`h-3 w-3 rounded-full bg-white ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </span>
            </button>

            {plugin.slug === 'github' && on && (
              <div className="mt-3 border-t border-[#2f3336]/40 pt-2">
                <p className={`text-[10px] leading-relaxed ${muted}`}>
                  Choose repositories. Code changes are a branch and a pull request. Merging still asks you first.
                </p>
                {loadingRepos ? (
                  <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin" />
                ) : repos.length === 0 ? (
                  <p className={`mt-2 text-[11px] ${muted}`}>No repositories were returned for this GitHub account.</p>
                ) : (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {repos.map((repo) => {
                      const checked = allowed.some((name) => name.toLowerCase() === repo.name.toLowerCase());
                      return (
                        <li key={repo.name}>
                          <label className="flex items-center gap-2 text-[11px]">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy === 'repos'}
                              onChange={() => toggleRepo(repo.name)}
                            />
                            <span className="truncate font-semibold">{repo.name}</span>
                            {repo.private && <span className={muted}>Private</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
