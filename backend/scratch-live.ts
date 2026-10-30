import { findBotById } from './src/repositories/bots';
import { runBotTurnWithTools } from './src/services/botTurn';

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input, init) => {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (String(input).includes('api.github.com') && method !== 'GET') {
    console.log(`   !! BLOCKED GitHub write: ${method} ${new URL(String(input)).pathname}`);
    return new Response(JSON.stringify({ message: 'Blocked in test' }), { status: 403 });
  }
  const body = typeof init?.body === 'string' && String(input).includes('freemodels') ? JSON.parse(init.body) : null;
  const res = await realFetch(input, init);
  if (body) {
    const text = await res.clone().text();
    let content = text;
    try {
      content = JSON.parse(text).content ?? text;
    } catch {}
    console.log(`   [${body.modelId}] ${String(content).replace(/\s+/g, ' ').slice(0, 220)}`);
  }
  return res;
}) as typeof fetch;

async function main() {
  const chief = await findBotById('bot_ajf2yoc');
  if (!chief) throw new Error('Chief not found');
  for (const prompt of process.argv.slice(2)) {
    console.log(`\n===== ${prompt}`);
    const started = Date.now();
    const run = await runBotTurnWithTools({ userId: chief.userId, bot: chief, userName: 'Tester', messageContent: prompt });
    console.log(`-- tools: ${run.tools.map((t) => `${t.toolName}:${t.status}`).join(', ') || 'none'} (${Math.round((Date.now() - started) / 1000)}s)`);
    console.log(run.error ? `ERROR ${run.error.kind}: ${run.error.message}` : run.text);
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
