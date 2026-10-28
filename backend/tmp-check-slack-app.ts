import { sql } from './src/config/db.ts';

async function main() {
  const app = await sql`
    select sa.id, sa.bot_id, sa.status, sa.slack_team_id, sa.bot_user_id, sa.status_detail,
           sa.bot_token, sa.signing_secret, sa.slack_app_id, sa.client_id,
           b.is_team_bot, b.team_id, b.name, b.user_id, b.status as bot_status,
           t.name as team_name, t.owner_user_id,
           tm.slack_user_id, tm.slack_team_id, tm.slack_display_name, tm.slack_linked_at, tm.role
    from slack_bot_apps sa
    join bots b on b.id = sa.bot_id
    left join teams t on t.id = b.team_id
    left join team_members tm on tm.team_id = b.team_id and tm.user_id = b.user_id
    order by sa.updated_at desc
    limit 1
  `;

  if (!app.length) {
    console.log('No slack_bot_apps row.');
    return;
  }

  const r = app[0] as any;
  console.log('appId:', r.id);
  console.log('botId:', r.bot_id);
  console.log('status:', r.status);
  console.log('slackTeamId:', r.slack_team_id);
  console.log('botUserId:', r.bot_user_id);
  console.log('slackAppId:', r.slack_app_id);
  console.log('clientId:', r.client_id);
  console.log('botToken set:', Boolean(r.bot_token));
  console.log('signingSecret set:', Boolean(r.signing_secret));
  console.log('isTeamBot:', r.is_team_bot);
  console.log('teamId:', r.team_id);
  console.log('teamName:', r.team_name);
  console.log('ownerUser:', r.user_id, '/ teamOwner:', r.owner_user_id);
  console.log('ownerSlackUserId:', r.slack_user_id, '/ linkedAt:', r.slack_linked_at);
  console.log('owner role:', r.role);
  console.log('botStatus:', r.bot_status);

  const { decryptTokenSafe } = await import('./src/services/tokenCrypto.ts');
  const token = decryptTokenSafe(r.bot_token);
  console.log('decrypted bot_token prefix:', typeof token === 'string' ? token.slice(0, 140) : token);

  const { slackApi } = await import('./src/services/slackTeam/slackApi.ts');
  const auth = await slackApi(token, 'auth.test', {});
  console.log('auth.test:', JSON.stringify(auth, null, 2));

  // Exact bytes of the /api/slack/events POST Slack just sent, including the final
  // newline Slack always appends to Events API deliveries.
  const rawBody =
`{
  "token": "ZnVuY3Rpb25fMDAxMTA1NDE4MDQ3NjE2NTkyOTYzNTg2MjkyNTc4NjU2Nzg3ODM=",
  "team_id": "T0C4FMT25PC",
  "api_app_id": "A0CCBEHH023",
  "event": {
    "type": "app_mention",
    "user": "U0C4APM1B6Z",
    "text": "<@U0CCUNP4U9X> can you hear me",
    "ts": "1761638340.397149",
    "channel": "D0C7L9AG1M2",
    "thread_ts": "1761638340.397149"
  },
  "type": "event_callback",
  "event_id": "Ev0C9N8K3AC",
  "event_time": 1761638340,
  "authorizations": [
    {
      "enterprise_id": null,
      "team_id": "T0C4FMT25PC",
      "user_id": "U0C4APM1B6Z",
      "is_bot": false,
      "username": "priyaranjan"
    }
  ],
  "is_ext_shared_channel": false,
  "event_context": "Eb2FDE9OAL"
}`;
  // Slack deliveries include a trailing newline. If the verifier's rawBody helper
  // does not preserve it, signature will fail even though this template looks right.
  const rawBodyWithNewline = rawBody + '\n';

  const timestamp = '1761638340';
  const webhookSecret = decryptTokenSafe(r.signing_secret);
  console.log('signing secret decrypted ok:', Boolean(webhookSecret));
  console.log('signing secret bytes:', Buffer.from(webhookSecret).toString('hex'));
  console.log('signing secret length:', Buffer.from(webhookSecret).byteLength);

  const crypto = await import('crypto');
  const webhookDigest = `v0=${crypto.createHmac('sha256', webhookSecret).update(`v0:${timestamp}:${rawBodyWithNewline}`).digest('hex')}`;
  console.log('webhook digest present ->', Boolean(webhookDigest));
  console.log('webhook digest:', webhookDigest);
  console.log('webhookDigest byte length:', Buffer.from(webhookDigest).byteLength);
  console.log('rawBodyWithNewline length (bytes):', Buffer.byteLength(rawBodyWithNewline));
  console.log('rawBodyWithNewline ends with newline:', rawBodyWithNewline.endsWith('\n'));
  console.log('rawBody === rawBodyWithNewline:', rawBody === rawBodyWithNewline);

  const { verifySlackSignature } = await import('./src/services/slackTeam/signature.ts');

  // First: the real event time is old, so the age guard should fail.
  const oldAge = Math.abs(Date.now() / 1000 - Number(timestamp));
  console.log('old age seconds:', oldAge, '/ within 5m:', oldAge <= 60 * 5);
  console.log('verify with old timestamp + newline body ->', verifySlackSignature(rawBodyWithNewline, timestamp, webhookDigest, webhookSecret));

  // Second: use a current timestamp. If this passes, the only blocker was the age.
  const nowTimestamp = String(Math.floor(Date.now() / 1000));
  const nowDigest = `v0=${crypto.createHmac('sha256', webhookSecret).update(`v0:${nowTimestamp}:${rawBodyWithNewline}`).digest('hex')}`;
  console.log('nowDigest present ->', Boolean(nowDigest));
  console.log('verify with current timestamp + newline body ->', verifySlackSignature(rawBodyWithNewline, nowTimestamp, nowDigest, webhookSecret));

  // Third: same current timestamp but without the newline, to see if the body shape
  // is what Slack actually sent.
  const nowDigestNoNewline = `v0=${crypto.createHmac('sha256', webhookSecret).update(`v0:${nowTimestamp}:${rawBody}`).digest('hex')}`;
  console.log('verify with current timestamp + no-newline body ->', verifySlackSignature(rawBody, nowTimestamp, nowDigestNoNewline, webhookSecret));
  console.log('nowDigestNoNewline === nowDigest:', nowDigestNoNewline === nowDigest);

}

main().catch((err) => {
  console.error('failed:', err);
  process.exit(1);
});
