/**
 * Web Search plugin - Brave Search API.
 *
 * A single API key pasted at connect time. Metadata in ./index.ts, API calls in
 * ./executor.ts.
 */

import { requiredString, optionalNumber, requestJson } from '../shared';
import { ToolExecutor } from '../shared';

export const webSearchTools: Record<string, ToolExecutor> = {
  search: async (args, ctx) => {
    const apiKey = ctx.credential.apiKey;
    if (!apiKey) {
      throw new Error('Web Search needs an API key. Open Plugins, connect Web Search, and paste a Brave Search API key.');
    }

    const query = requiredString(args, 'query');
    const count = optionalNumber(args, 'max_results', 5, 10);

    const data = await requestJson(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      { headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' } }
    );

    const results = (data?.web?.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));

    return { query, total: results.length, results };
  },
};
