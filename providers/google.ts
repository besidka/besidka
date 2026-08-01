import type { CuratedProvider } from './merge'

export default {
  id: 'google',
  name: 'Google AI Studio',
  models: [
    {
      id: 'deep-research-max-preview-04-2026',
      name: 'Gemini Deep Research Max',
      description: 'Autonomous agent for exhaustive, cross-checked web research and cited reports on deep or high-stakes topics, for $3–7 per task',
      price: {
        tokens: 1_000_000,
        input: '$3–7 / task',
        output: '',
      },
      tools: [],
      research: {
        tier: 'thorough',
        assistModel: 'gemini-3.1-flash-lite-preview',
        costEstimate: '$3–7 / task',
        timeEstimate: 'up to 60 min',
      },
    },
    {
      id: 'deep-research-preview-04-2026',
      name: 'Gemini Deep Research',
      description: 'Autonomous agent that browses the web, cross-checks sources, and writes a cited research report for $1–3 per task',
      price: {
        tokens: 1_000_000,
        input: '$1–3 / task',
        output: '',
      },
      tools: [],
      research: {
        tier: 'quick',
        assistModel: 'gemini-3.1-flash-lite-preview',
        costEstimate: '$1–3 / task',
        timeEstimate: 'under 20 min',
      },
    },
    {
      id: 'gemini-3.6-flash',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-3.5-flash',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-3.1-pro-preview',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-3.1-flash-lite-preview',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
      forProjectMemory: true,
    },
    {
      id: 'gemini-3-pro-preview',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
    },
    {
      id: 'gemini-3-flash-preview',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-2.5-pro',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-2.5-flash',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-2.5-flash-lite',
      default: true,
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-3.1-flash-image',
      price: {
        tokens: 1,
        display: '$0.067 / 1K image, plus input',
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
    {
      id: 'gemini-3.1-flash-lite-image',
      price: {
        tokens: 1,
        display: '$0.0336 / 1K image, plus input',
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
    {
      id: 'gemini-3-pro-image',
      price: {
        tokens: 1,
        display: '$0.134 / 1K or 2K image, plus input',
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
    {
      id: 'gemini-2.5-flash-image',
      price: {
        tokens: 1,
        display: '$0.039 / 1K image, plus input',
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
  ],
} satisfies CuratedProvider
