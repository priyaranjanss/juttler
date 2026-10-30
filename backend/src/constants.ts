/**
 * Backend-owned constants that the runtime actually needs.
 *
 * Kept out of types.ts so the type module stays purely declarative (and fully
 * erasable), while anything used as a VALUE lives here.
 *
 * The frontend has matching copies in frontend/src/types/index.ts. They must
 * agree: the frontend renders the label and auto-fills the endpoint when a bot
 * is saved, while the backend uses the same values as its fallback.
 */

/** Provider registry: label for the UI and the endpoint the backend calls. */
export const AI_PROVIDERS = {
  kilo_gateway: {
    label: 'Kilo Gateway',
    endpoint: 'https://api.kilo.ai/api/gateway',
  },
  free_endpoint: {
    label: 'Free Model Endpoint',
    endpoint: 'https://allaitools-generate.freemodels.workers.dev/api/chat',
    // Sent as `modelId`; the endpoint silently falls back to its default for unknown ids.
    // `model` makes the tool calls; `reasoningModel` plans, reviews and writes replies
    // because it reasons better but emits malformed tool calls.
    model: 'sol',
    reasoningModel: 'claude-sonnet-5',
  },
} as const;

/** Avatar shapes a bot may use. */
export const BOT_AVATAR_SHAPES = [
  'blob',
  'teardrop',
  'cloud',
  'double_drop',
  'circle',
  'bean',
  'oval',
  'triangle',
  'square',
] as const;

/** Avatar swatches offered when creating a bot. */
export const BOT_AVATAR_COLORS = [
  '#7C3AED',
  '#38BDF8',
  '#10B981',
  '#2DD4BF',
  '#9A6B4B',
  '#F97316',
  '#FB7185',
  '#EC4899',
  '#6366F1',
] as const;
