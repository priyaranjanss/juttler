import { findBotById } from './src/repositories/bots';
import { runApprovedToolForBot } from './src/services/botTurn';

async function main() {
  const chief = await findBotById('bot_ajf2yoc');
  if (!chief) throw new Error('Chief not found');
  const result = await runApprovedToolForBot(chief.userId, chief.id, 'github.delete_branch', {
    repo: 'priyaranjanss/juttler',
    branch: 'fix-cloudflare-workers-build',
  });
  console.log(JSON.stringify(result));
}

main().then(() => process.exit(0), (err) => {
  console.error(err);
  process.exit(1);
});
