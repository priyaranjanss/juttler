/**
 * The bot's work desk.
 *
 * A bot has no computer. It may develop only in the GitHub repositories named
 * on the bot, and it may touch Jira only inside the one project named on the bot.
 * Slack stays a conversation and is not limited here.
 */

export interface WorkDesk {
  name: string;
  githubRepos: string[];
  jiraProject: string | null;
  isTeamBot?: boolean;
}

const MAX_REPOS = 8;

/** Accepts "owner/name" or a GitHub URL. Returns null when it is not one repo. */
export function normalizeRepo(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const [owner, repo, extra] = cleaned.split('/');
  if (!owner || !repo || extra) return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return `${owner}/${repo}`;
}

/** Turns a saved or typed list into the repos this bot may use. */
export function normalizeRepos(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('GitHub repositories must be a list of owner/name values.');
  }
  const repos: string[] = [];
  for (const item of value) {
    const repo = normalizeRepo(String(item ?? ''));
    if (!repo) {
      throw new Error(`"${item}" is not a repository. Use owner/name, for example octocat/Hello-World.`);
    }
    if (!repos.some((existing) => existing.toLowerCase() === repo.toLowerCase())) repos.push(repo);
  }
  if (repos.length > MAX_REPOS) {
    throw new Error(`Keep this bot to ${MAX_REPOS} repositories so its work stays in one place.`);
  }
  return repos;
}

/** Empty clears the project. A real key is stored uppercase, like ABC. */
export function normalizeProject(value: unknown): string | null {
  if (value == null) return null;
  const key = String(value).trim().toUpperCase();
  if (!key) return null;
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
    throw new Error('A Jira project key looks like ABC or PROJ1.');
  }
  return key;
}

/**
 * Rejects a GitHub call for a repository this bot is not allowed to use.
 * On success, `repo` is rewritten to the saved owner/name.
 * If the model omits repo and only one is allowed, that one is used.
 */
export function assertWorkScope(bot: WorkDesk, pluginSlug: string, args: Record<string, any>): void {
  if (pluginSlug === 'github') {
    if (bot.githubRepos.length === 0) {
      throw new Error(
        `${bot.name} has no GitHub repository allowed. Turn on GitHub for this bot and choose repositories in its settings.`
      );
    }
    // One desk repo → always use it. Models often omit or mangle `repo`.
    if (bot.githubRepos.length === 1) {
      args.repo = bot.githubRepos[0];
      return;
    }
    const raw = typeof args.repo === 'string' ? args.repo.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '') : '';
    if (!raw) {
      throw new Error(
        `${bot.name} can use these repositories: ${bot.githubRepos.join(', ')}. Pass repo as owner/name.`
      );
    }
    const exact = normalizeRepo(raw);
    if (exact) {
      const allowed = bot.githubRepos.find((item) => item.toLowerCase() === exact.toLowerCase());
      if (allowed) {
        args.repo = allowed;
        return;
      }
    }
    // Bare repo name ("juttler") when it uniquely matches a desk entry.
    const bare = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const nameOnly = bare.includes('/') ? bare.split('/').pop()! : bare;
    const byName = bot.githubRepos.filter(
      (item) => item.split('/')[1]?.toLowerCase() === nameOnly.toLowerCase()
    );
    if (byName.length === 1) {
      args.repo = byName[0];
      return;
    }
    throw new Error(
      `${bot.name} can only use these repositories: ${bot.githubRepos.join(', ')}. Pass repo as owner/name.`
    );
  }

  if (pluginSlug === 'jira') {
    // Normalize common model aliases before the executor runs.
    if (args.issue_key == null && (args.key != null || args.issueKey != null || args.issue != null)) {
      args.issue_key = args.key ?? args.issueKey ?? args.issue;
    }
    if (bot.jiraProject) {
      args._preferredProject = bot.jiraProject;
      if (
        (args.project == null || String(args.project).trim() === '') &&
        typeof args.summary === 'string'
      ) {
        // create_ticket without project → desk project.
        args.project = bot.jiraProject;
      }
    }
  }
}

/** Facts about this bot's work environment, given to the model on every turn. */
export function describeWorkDesk(bot: WorkDesk): string {
  const lines = ['Work environment: you have no computer, shell, or local files; you act only through the tools listed.'];
  if (bot.githubRepos.length === 1) {
    lines.push(`GitHub repository configured for this bot: ${bot.githubRepos[0]} (filled in when repo is omitted).`);
  } else if (bot.githubRepos.length > 1) {
    lines.push(`GitHub repositories configured for this bot: ${bot.githubRepos.join(', ')}. Other repositories are refused.`);
  }
  if (bot.jiraProject) {
    lines.push(`Jira project configured for this bot: ${bot.jiraProject} (used when a project is omitted).`);
  }
  return lines.join('\n');
}
