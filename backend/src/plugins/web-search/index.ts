import { webSearchTools } from './executor';
import { PluginModule } from '../types';

export const webSearchPlugin: PluginModule = {
  definition: {
    slug: 'web-search',
    name: 'Web Search',
    description: 'Search the public web and return titles, snippets, and URLs.',
    category: 'Research',
    isOfficial: true,
    authType: 'token',
    requiredCredentials: [
      { key: 'apiKey', label: 'Search API key', secret: true, placeholder: 'Paste a Brave Search API key' },
    ],
    tools: [
      {
        name: 'search',
        description: 'Search the web and return relevant results with titles, URLs, and snippets.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: { type: 'number', description: 'How many results to return (max 10)' },
          },
          required: ['query'],
        },
      },
    ],
  },
  tools: webSearchTools,
};
