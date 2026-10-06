import type { CuratedProvider } from './merge'

export default {
  id: 'openai',
  name: 'OpenAI',
  models: [
    {
      id: 'o3-deep-research',
      status: 'deprecated',
      retiredAt: '2026-07-23',
      name: 'o3 Deep Research',
      description: 'Autonomous agent for exhaustive, cross-checked web research and cited reports on deep or high-stakes topics, around $10 per task',
      contextLength: 200_000,
      maxOutputTokens: 100_000,
      price: {
        tokens: 1_000_000,
        input: '$10.00',
        output: '$40.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: [],
      toolCall: false,
      research: {
        tier: 'thorough',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$10 / task',
        timeEstimate: '10–30 min',
        maxToolCalls: 60,
      },
    },
    {
      id: 'o4-mini-deep-research',
      status: 'deprecated',
      retiredAt: '2026-07-23',
      name: 'o4-mini Deep Research',
      description: 'Autonomous agent that browses the web, cross-checks sources, and writes a cited research report for around $1 per task',
      contextLength: 200_000,
      maxOutputTokens: 100_000,
      price: {
        tokens: 1_000_000,
        input: '$2.00',
        output: '$8.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: [],
      toolCall: false,
      research: {
        tier: 'quick',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$1 / task',
        timeEstimate: '5–15 min',
        maxToolCalls: 30,
      },
    },
    {
      id: 'gpt-6-sol',
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
      id: 'gpt-6-luna',
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
      id: 'gpt-5.6-sol',
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
      id: 'gpt-5.6-terra',
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
      id: 'gpt-5.6-luna',
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
      id: 'gpt-5.5',
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
      id: 'gpt-5.4',
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
      id: 'gpt-5.4-mini',
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
      id: 'gpt-5.4-nano',
      retiredAt: '2027-04-01',
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
      id: 'gpt-5.2',
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
      id: 'gpt-5.1',
      retiredAt: '2027-04-01',
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
      id: 'gpt-5',
      retiredAt: '2026-12-11',
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
      id: 'gpt-5-mini',
      retiredAt: '2026-12-11',
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
      id: 'gpt-5-nano',
      retiredAt: '2026-12-11',
      price: {
        tokens: 1_000_000,
      },
      tools: ['image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'o3',
      retiredAt: '2026-12-11',
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
      id: 'gpt-4.1',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
    },
    {
      id: 'gpt-4.1-mini',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
    },
    {
      id: 'gpt-4o',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
    },
    {
      id: 'gpt-4o-mini',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
    },
    {
      id: 'o4-mini',
      status: 'deprecated',
      retiredAt: '2026-10-23',
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
      id: 'gpt-4.1-nano',
      status: 'deprecated',
      retiredAt: '2026-10-23',
      price: {
        tokens: 1_000_000,
      },
      tools: ['web_search', 'image_generation'],
    },
    {
      id: 'o3-mini',
      status: 'deprecated',
      retiredAt: '2026-10-23',
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
      id: 'o1',
      status: 'deprecated',
      retiredAt: '2026-10-23',
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
      id: 'gpt-4-turbo',
      status: 'deprecated',
      retiredAt: '2026-10-23',
      price: {
        tokens: 1_000_000,
      },
      tools: [],
    },
    {
      id: 'gpt-4',
      status: 'deprecated',
      retiredAt: '2026-10-23',
      price: {
        tokens: 1_000_000,
      },
      tools: [],
    },
    {
      id: 'gpt-3.5-turbo',
      status: 'deprecated',
      retiredAt: '2026-10-23',
      price: {
        tokens: 1_000_000,
      },
      tools: [],
    },
    {
      id: 'gpt-image-2.5-sunburst',
      name: 'GPT Image 2.5 Sunburst',
      description: 'Image model for precise, prompt-driven image editing and visual design workflows',
      contextLength: 0,
      maxOutputTokens: 0,
      releaseDate: '2026-09-08',
      modalities: {
        input: ['text', 'image'],
        output: ['image'],
      },
      price: {
        tokens: 1,
        display: '$30 / 1M image output tokens, plus input',
      },
      tools: [],
      toolCall: false,
      imageGeneration: {
        controllerModel: 'gpt-6-luna',
        costEstimate: '~$0.010–$0.013 / medium image',
      },
    },
    {
      id: 'gpt-image-2.5-flare',
      name: 'GPT Image 2.5 Flare',
      description: 'Fast image model for everyday prompt-driven generation and visual design workflows',
      contextLength: 0,
      maxOutputTokens: 0,
      releaseDate: '2026-09-08',
      modalities: {
        input: ['text', 'image'],
        output: ['image'],
      },
      price: {
        tokens: 1,
        display: '$30 / 1M image output tokens, plus input',
      },
      tools: [],
      toolCall: false,
      imageGeneration: {
        controllerModel: 'gpt-6-luna',
        costEstimate: '~$0.010–$0.013 / medium image',
      },
    },
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      price: {
        tokens: 1,
        display: '$0.041–$0.053 / medium image, plus input',
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gpt-6-luna',
      },
    },
  ],
} satisfies CuratedProvider
