import { imageGenerationTools } from './executor';
import { PluginModule } from '../types';

export const imageGenerationPlugin: PluginModule = {
  definition: {
    slug: 'image-generation',
    name: 'Image Generation (Aurora)',
    description: 'Generate images using AI models like DALL-E, Midjourney, or Stable Diffusion.',
    category: 'Creative',
    isOfficial: true,
    authType: 'token',
    requiredCredentials: [
      { key: 'apiKey', label: 'Image Generation API Key', secret: true, placeholder: 'Paste an OpenAI/DALL-E API key' },
    ],
    tools: [
      {
        name: 'generate',
        description: 'Generate an image from a text prompt.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Detailed description of the image to generate' },
            model: { type: 'string', description: 'Model to use (dall-e-3, dall-e-2, gpt-image-1)', enum: ['dall-e-3', 'dall-e-2', 'gpt-image-1'] },
            size: { type: 'string', description: 'Image size', enum: ['1024x1024', '1792x1024', '1024x1792', '512x512', '256x256'] },
            quality: { type: 'string', description: 'Image quality', enum: ['standard', 'hd'] },
            style: { type: 'string', description: 'Image style (dall-e-3 only)', enum: ['vivid', 'natural'] },
            n: { type: 'number', description: 'Number of images to generate (1-4)' },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'edit',
        description: 'Edit an existing image with a prompt (inpainting/outpainting).',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            image: { type: 'string', description: 'Base64 encoded image or URL to edit' },
            prompt: { type: 'string', description: 'Description of the edit to make' },
            mask: { type: 'string', description: 'Base64 encoded mask image for inpainting (transparent areas will be edited)' },
            model: { type: 'string', description: 'Model to use', enum: ['dall-e-2', 'gpt-image-1'] },
            size: { type: 'string', description: 'Image size', enum: ['1024x1024', '512x512', '256x256'] },
            n: { type: 'number', description: 'Number of images to generate' },
          },
          required: ['image', 'prompt'],
        },
      },
      {
        name: 'variation',
        description: 'Create variations of an existing image.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            image: { type: 'string', description: 'Base64 encoded image or URL to create variations from' },
            model: { type: 'string', description: 'Model to use', enum: ['dall-e-2', 'gpt-image-1'] },
            size: { type: 'string', description: 'Image size', enum: ['1024x1024', '512x512', '256x256'] },
            n: { type: 'number', description: 'Number of variations to generate' },
          },
          required: ['image'],
        },
      },
    ],
  },
  tools: imageGenerationTools,
};