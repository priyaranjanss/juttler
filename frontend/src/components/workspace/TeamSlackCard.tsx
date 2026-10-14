import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import { useApp } from '../../contexts/AppContext';
import { Bot, SlackBotInstall, TeamView } from '../../types';

interface TeamSlackCardProps {
  bot: Bot;
  isDark: boolean;
}

/** Connects this bot to Slack. It posts as itself. */
export const TeamSlackCard: React.FC<TeamSlackCardProps> = ({ bot, isDark }) => {
  const { showToast } = useApp();
  const [install, setInstall] = useState<SlackBotInstall | null>(null);
  const [linked, setLinked] = useState<TeamView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getTeamBotSlack(bot.id), api.getMyTeam()])
      .then(([next, team]) => {
        if (cancelled) return;
        setInstall(next);
        setLinked(team.team);
      })
      .catch(() => {
        if (!cancelled) setInstall(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bot.id, bot.name]);

  const muted = isDark ? 'text-[#8b98a5]' : 'text-[#536471]';
  const card = `rounded-xl border p-3 ${isDark ? 'border-[#2f3336] bg-[#181a1f]' : 'border-[#e5e7eb] bg-[#f8f9fa]'}`;
  const primary = `w-full rounded-xl py-2 text-xs font-bold transition disabled:opacity-60 ${
    isDark ? 'bg-white text-black hover:bg-[#d7dbdc]' : 'bg-[#0f1419] text-white hover:bg-[#27313a]'
  }`;

  const connect = async () => {
    setBusy('connect');
    try {
      const result = await api.connectTeamBotSlack(bot.id);
      if (result.authorizeUrl) {
        window.location.href = result.authorizeUrl;
        return;
      }
      showToast(`${bot.name} is already in Slack`, 'success');
      setInstall(await api.getTeamBotSlack(bot.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not connect Slack', 'warning');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await api.disconnectTeamBotSlack(bot.id);
      setInstall(await api.getTeamBotSlack(bot.id));
      showToast(`${bot.name} disconnected from Slack`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not disconnect Slack', 'warning');
    } finally {
      setBusy(null);
    }
  };

  const status = install?.status ?? 'not_connected';
  const workspace = install?.slackTeamName || install?.ownerSlackTeamName;
  const mention = `@${bot.name}`;
  const connectedLike = status !== 'not_connected';

  return (
    <div className="px-3">
      <div className={card}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold">Slack app</p>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#71767b]" />}
        </div>
        <p className={`mt-1 text-[11px] leading-relaxed ${muted}`}>
          {bot.name} posts in Slack as {mention}.
        </p>

        <ul className={`mt-2 space-y-1 text-[11px] leading-relaxed ${muted}`}>
          <li>Workspace: {status === 'connected' && workspace ? workspace : 'chosen when you bring it to Slack'}</li>
          <li>Direct message: every message, one conversation</li>
          <li>Channel or group: only when someone writes {mention}, then that thread</li>
          <li>Other people’s @names are ignored</li>
          <li>Only a linked Juttler account gets a model reply</li>
          <li>
            Linked:{' '}
            {linked?.members?.filter((member) => member.slackLinked).length
              ? linked.members
                  .filter((member) => member.slackLinked)
                  .map((member) => `${member.name} as ${member.slackDisplayName || 'Slack'}`)
                  .join(', ')
              : 'nobody yet'}
          </li>
        </ul>

        {status === 'connected' && (
          <p className="mt-2 text-[11px] font-semibold text-emerald-400">
            Live in {workspace || 'Slack'} as {mention}. Invite it with /invite {mention}.
          </p>
        )}
        {status === 'awaiting_admin_approval' && (
          <p className="mt-2 text-[11px] font-semibold text-amber-400">
            Awaiting admin approval. Send the request again after an admin approves the app.
          </p>
        )}
        {status === 'error' && install?.detail && (
          <p className="mt-2 text-[11px] font-medium text-amber-400">{install.detail}</p>
        )}
        {status === 'pending_install' && (
          <p className={`mt-2 text-[11px] ${muted}`}>
            The Slack app exists. Finish installing it into the workspace.
          </p>
        )}

        {status !== 'connected' && (
          <button type="button" onClick={connect} disabled={busy !== null} className={`${primary} mt-3`}>
            {busy === 'connect'
              ? 'Opening Slack…'
              : status === 'awaiting_admin_approval'
                ? 'Send request'
                : status === 'pending_install'
                  ? 'Finish connecting Slack'
                  : 'Connect to Slack'}
          </button>
        )}

        {connectedLike && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy !== null}
            className={`mt-2 w-full rounded-xl py-2 text-xs font-bold transition disabled:opacity-60 ${
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
