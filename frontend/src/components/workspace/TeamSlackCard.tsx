import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { Bot, TeamView } from '../../types';

interface TeamSlackCardProps {
  bot: Bot;
  isDark: boolean;
}

/** Connects the owner's Slack user account for mention-triggered bot replies. */
export const TeamSlackCard: React.FC<TeamSlackCardProps> = ({ bot, isDark }) => {
  const { showToast, installedPlugins, refreshData, currentUser } = useApp();
  const [linked, setLinked] = useState<TeamView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const slackConnection = installedPlugins.find((plugin) => plugin.pluginSlug === 'slack');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getMyTeam()
      .then((team) => {
        if (cancelled) return;
        setLinked(team.team);
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : 'Could not load Slack account links', 'warning');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bot.id, bot.name, showToast]);

  const muted = isDark ? 'text-[#8b98a5]' : 'text-[#536471]';
  const card = `rounded-[10px] border p-3 ${isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-[#f8f9fa]'}`;
  const primary = `w-full rounded-[10px] py-2 text-xs font-bold transition disabled:opacity-60 ${
    isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
  }`;

  const connect = async () => {
    setBusy('connect');
    try {
      const result = await api.startPluginOauth('slack');
      window.location.href = result.authorizeUrl;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not connect Slack', 'warning');
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await api.disconnectPlugin('slack');
      await refreshData();
      showToast('Slack disconnected', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not disconnect Slack', 'warning');
    } finally {
      setBusy(null);
    }
  };

  const connected = slackConnection?.status === 'connected';
  const workspace = typeof slackConnection?.metadata?.team_name === 'string'
    ? slackConnection.metadata.team_name
    : null;
  const slackDisplayName =
    linked?.members?.find((member) => member.userId === currentUser.id)?.slackDisplayName || 'your Slack account';

  return (
    <div className="px-3">
      <div className={card}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold">Slack account</p>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#71767b]" />}
        </div>
        <p className={`mt-1 text-[11px] leading-relaxed ${muted}`}>
          Connect your Slack account with OAuth. {bot.name} listens for mentions of your Slack account and replies as you.
        </p>

        <ul className={`mt-2 space-y-1 text-[11px] leading-relaxed ${muted}`}>
          <li>Workspace: {connected && workspace ? workspace : 'connect your Slack account'}</li>
          <li>Replies are posted as {slackDisplayName}</li>
          <li>Mentions start a thread; follow-ups in that thread continue the conversation</li>
          <li>
            Connected account: {connected ? slackDisplayName : 'not connected'}
          </li>
        </ul>

        {connected && (
          <p className="mt-2 text-[11px] font-semibold text-emerald-400">
            Listening in {workspace || 'Slack'} as {slackDisplayName}.
          </p>
        )}
        {connected && (
          <p className={`mt-2 text-[11px] ${muted}`}>
            Slack Event Subscriptions must include user event <code>message.channels</code> (and <code>message.groups</code> for private channels).
          </p>
        )}

        {!connected && (
          <button type="button" onClick={connect} disabled={busy !== null} className={`${primary} mt-3`}>
            {busy === 'connect' ? 'Opening Slack…' : 'Connect Slack account'}
          </button>
        )}

        {connected && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy !== null}
            className={`mt-2 w-full rounded-[10px] py-2 text-xs font-bold transition disabled:opacity-60 ${
              isDark
                ? 'border border-[#2f3336] text-[#f4212e] hover:bg-[#2a1215]'
                : 'border border-[#e5e7eb] text-[#f4212e] hover:bg-[#fff5f5]'
            }`}
          >
            {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect Slack'}
          </button>
        )}
      </div>
    </div>
  );
};
