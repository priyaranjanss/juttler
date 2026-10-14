import { sql } from '../config/db';
import { generateId } from '../utils/id';

export type TeamRole = 'owner' | 'manager' | 'member';

export interface Team {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  slackUserId: string | null;
  slackTeamId: string | null;
  slackDisplayName: string | null;
  slackLinkedAt: string | null;
  name: string;
  email: string;
}

interface TeamRow {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: Date;
}

interface MemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: TeamRole;
  slack_user_id: string | null;
  slack_team_id: string | null;
  slack_display_name: string | null;
  slack_linked_at: Date | null;
  name: string;
  email: string;
}

function mapTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

function mapMember(row: MemberRow): TeamMember {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    role: row.role,
    slackUserId: row.slack_user_id,
    slackTeamId: row.slack_team_id,
    slackDisplayName: row.slack_display_name,
    slackLinkedAt: row.slack_linked_at ? row.slack_linked_at.toISOString() : null,
    name: row.name,
    email: row.email,
  };
}

const MEMBER_SELECT = `
  select m.id, m.team_id, m.user_id, m.role, m.slack_user_id, m.slack_team_id, m.slack_display_name, m.slack_linked_at,
         u.name, u.email
  from team_members m
  join users u on u.id = m.user_id
`;

export async function ensureOwnedTeam(userId: string, ownerName: string): Promise<Team> {
  const existing = (await sql`
    select t.*
    from teams t
    join team_members m on m.team_id = t.id
    where m.user_id = ${userId} and m.role = 'owner'
    order by t.created_at asc
    limit 1
  `) as unknown as TeamRow[];
  if (existing.length > 0) return mapTeam(existing[0]);

  const teamId = generateId('team_');
  const name = `${ownerName.trim() || 'My'}'s team`.replace(/'s's team$/, "'s team");
  const created = (await sql`
    insert into teams (id, name, owner_user_id)
    values (${teamId}, ${name}, ${userId})
    returning *
  `) as unknown as TeamRow[];
  await sql`
    insert into team_members (id, team_id, user_id, role)
    values (${generateId('tm_')}, ${teamId}, ${userId}, 'owner')
  `;
  return mapTeam(created[0]);
}

/** The team this person owns, otherwise the first team they belong to. */
export async function findPrimaryTeam(userId: string): Promise<{ team: Team; role: TeamRole } | null> {
  const rows = (await sql`
    select t.*, m.role
    from teams t
    join team_members m on m.team_id = t.id
    where m.user_id = ${userId}
    order by case when m.role = 'owner' then 0 when m.role = 'manager' then 1 else 2 end, t.created_at asc
    limit 1
  `) as unknown as Array<TeamRow & { role: TeamRole }>;
  if (rows.length === 0) return null;
  return { team: mapTeam(rows[0]), role: rows[0].role };
}

export async function listMembers(teamId: string): Promise<TeamMember[]> {
  const rows = (await sql.query(
    `${MEMBER_SELECT} where m.team_id = $1 order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end, u.name asc`,
    [teamId]
  )) as unknown as MemberRow[];
  return rows.map(mapMember);
}

export async function findMembership(teamId: string, userId: string): Promise<TeamMember | null> {
  const rows = (await sql.query(`${MEMBER_SELECT} where m.team_id = $1 and m.user_id = $2 limit 1`, [
    teamId,
    userId,
  ])) as unknown as MemberRow[];
  return rows.length > 0 ? mapMember(rows[0]) : null;
}

export function canManageTeam(role: TeamRole): boolean {
  return role === 'owner' || role === 'manager';
}

export async function addMember(teamId: string, userId: string, role: TeamRole = 'member'): Promise<void> {
  await sql`
    insert into team_members (id, team_id, user_id, role)
    values (${generateId('tm_')}, ${teamId}, ${userId}, ${role})
    on conflict (team_id, user_id) do nothing
  `;
}

/**
 * Records which Slack user a Juttler account is. Linking applies to every
 * team they belong to, because Slack identifies the person, not the chat.
 * Returns false when they are not on a team yet.
 */
export async function linkSlackAccount(
  userId: string,
  slackUserId: string,
  slackTeamId: string,
  slackDisplayName?: string | null
): Promise<boolean> {
  const name = slackDisplayName?.trim() || null;
  const rows = await sql`
    update team_members
    set slack_user_id = ${slackUserId},
        slack_team_id = ${slackTeamId},
        slack_display_name = coalesce(${name}, slack_display_name),
        slack_linked_at = now()
    where user_id = ${userId}
    returning id
  `;
  return rows.length > 0;
}

/** The Juttler user who linked this Slack identity inside this team and workspace. */
export async function findLinkedMember(
  teamId: string,
  slackUserId: string,
  slackTeamId: string
): Promise<TeamMember | null> {
  const rows = (await sql.query(
    `${MEMBER_SELECT}
     where m.team_id = $1 and m.slack_user_id = $2 and m.slack_team_id = $3
     limit 1`,
    [teamId, slackUserId, slackTeamId]
  )) as unknown as MemberRow[];
  return rows.length > 0 ? mapMember(rows[0]) : null;
}
