import 'dotenv/config';
import { findBotById } from './src/repositories/bots';
import { listAvailableModels } from './src/services/aiService';

const bot = await findBotById('bot_ajf2yoc');
const key = bot?.aiApiKey ?? '';
console.log('key prefix', key.slice(0, 6), 'length', key.length);
const result = await listAvailableModels('https://api.kilo.ai/api/gateway', key);
console.log('ok', result.ok, result.message ?? '', 'count', result.models.length);
console.log(result.models.map((m) => m.id).join('\n'));
process.exit(0);
