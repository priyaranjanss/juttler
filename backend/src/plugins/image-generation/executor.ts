import { ToolExecutor, ToolOutcome } from '../shared';

/** Image generation request parameters. */
interface GenerateParams {
  prompt: string;
  model?: 'dall-e-3' | 'dall-e-2' | 'gpt-image-1';
  size?: '1024x1024' | '1792x1024' | '1024x1792' | '512x512' | '256x256';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
}

interface EditParams {
  image: string;
  prompt: string;
  mask?: string;
  model?: 'dall-e-2' | 'gpt-image-1';
  size?: '1024x1024' | '512x512' | '256x256';
  n?: number;
}

interface VariationParams {
  image: string;
  model?: 'dall-e-2' | 'gpt-image-1';
  size?: '1024x1024' | '512x512' | '256x256';
  n?: number;
}

interface ImageResult {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
}

interface ImageApiResponse {
  created: number;
  data: ImageResult[];
}

interface ApiErrorBody {
  error?: { message?: string };
}

async function callImageApi(
  credential: Record<string, any>,
  endpoint: string,
  body: Record<string, any>
): Promise<ImageApiResponse> {
  const apiKey = credential?.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Image generation API key is not configured. Connect the Image Generation plugin first.');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errorBody = await res.json() as ApiErrorBody;
      detail = errorBody?.error?.message ? `: ${errorBody.error.message}` : '';
    } catch {
      // no JSON body
    }
    throw new Error(`Image generation API returned ${res.status}${detail}`);
  }

  return (await res.json()) as ImageApiResponse;
}

function errorOutcome(message: string, started: number): ToolOutcome {
  return { ok: false, result: { error: message }, durationMs: Date.now() - started };
}

function successOutcome<T>(result: T, started: number): ToolOutcome {
  return { ok: true, result, durationMs: Date.now() - started };
}

export const imageGenerationTools: Record<string, ToolExecutor> = {
  generate: async (args: Record<string, any>, ctx: { credential: Record<string, any> }): Promise<ToolOutcome> => {
    const started = Date.now();
    const { prompt, model = 'dall-e-3', size = '1024x1024', quality = 'standard', style = 'vivid', n = 1 } = args as GenerateParams;

    if (!prompt || typeof prompt !== 'string') {
      return errorOutcome('prompt is required and must be a string', started);
    }

    // Use the gateway endpoint from the credential or default to OpenAI
    const baseUrl = ctx.credential?.baseUrl?.trim() || 'https://api.openai.com/v1';
    const endpoint = `${baseUrl}/images/generations`;

    const body: Record<string, any> = {
      model,
      prompt,
      n: Math.min(Math.max(n, 1), 4),
      size,
      response_format: 'b64_json', // Return base64 so we can display inline
    };

    // DALL-E 3 supports quality and style
    if (model === 'dall-e-3' || model === 'gpt-image-1') {
      body.quality = quality;
      body.style = style;
    }

    const response = await callImageApi(ctx.credential, endpoint, body);

    return successOutcome({
      images: response.data.map((img) => ({
        b64_json: img.b64_json,
        revised_prompt: img.revised_prompt,
      })),
      model,
      prompt,
      revised_prompt: response.data[0]?.revised_prompt,
    }, started);
  },

  edit: async (args: Record<string, any>, ctx: { credential: Record<string, any> }): Promise<ToolOutcome> => {
    const started = Date.now();
    const { image, prompt, mask, model = 'gpt-image-1', size = '1024x1024', n = 1 } = args as EditParams;

    if (!prompt || typeof prompt !== 'string') {
      return errorOutcome('prompt is required and must be a string', started);
    }
    if (!image) {
      return errorOutcome('image is required (base64 or URL)', started);
    }

    const baseUrl = ctx.credential?.baseUrl?.trim() || 'https://api.openai.com/v1';
    const endpoint = `${baseUrl}/images/edits`;

    // Handle base64 or URL input
    let imageData: string;
    if (image.startsWith('data:')) {
      // Extract base64 from data URL
      const match = image.match(/^data:image\/[^;]+;base64,(.+)$/);
      imageData = match ? match[1] : image;
    } else if (image.startsWith('http')) {
      // For URL, we'd need to fetch it first - for now, assume base64
      return errorOutcome('URL images not yet supported; please provide base64', started);
    } else {
      imageData = image;
    }

    const body: Record<string, any> = {
      model,
      prompt,
      image: imageData,
      n: Math.min(Math.max(n, 1), 4),
      size,
      response_format: 'b64_json',
    };

    if (mask) {
      let maskData: string;
      if (mask.startsWith('data:')) {
        const match = mask.match(/^data:image\/[^;]+;base64,(.+)$/);
        maskData = match ? match[1] : mask;
      } else {
        maskData = mask;
      }
      body.mask = maskData;
    }

    const response = await callImageApi(ctx.credential, endpoint, body);

    return successOutcome({
      images: response.data.map((img) => ({
        b64_json: img.b64_json,
        revised_prompt: img.revised_prompt,
      })),
      model,
      prompt,
    }, started);
  },

  variation: async (args: Record<string, any>, ctx: { credential: Record<string, any> }): Promise<ToolOutcome> => {
    const started = Date.now();
    const { image, model = 'dall-e-2', size = '1024x1024', n = 1 } = args as VariationParams;

    if (!image) {
      return errorOutcome('image is required (base64 or URL)', started);
    }

    const baseUrl = ctx.credential?.baseUrl?.trim() || 'https://api.openai.com/v1';
    const endpoint = `${baseUrl}/images/variations`;

    let imageData: string;
    if (image.startsWith('data:')) {
      const match = image.match(/^data:image\/[^;]+;base64,(.+)$/);
      imageData = match ? match[1] : image;
    } else if (image.startsWith('http')) {
      return errorOutcome('URL images not yet supported; please provide base64', started);
    } else {
      imageData = image;
    }

    const body: Record<string, any> = {
      model,
      image: imageData,
      n: Math.min(Math.max(n, 1), 4),
      size,
      response_format: 'b64_json',
    };

    const response = await callImageApi(ctx.credential, endpoint, body);

    return successOutcome({
      images: response.data.map((img) => ({
        b64_json: img.b64_json,
      })),
      model,
    }, started);
  },
};