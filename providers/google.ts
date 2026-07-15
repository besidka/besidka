export default {
  id: 'google',
  name: 'Google AI Studio',
  models: [
    {
      id: 'gemini-3.1-pro-preview',
      name: 'Gemini 3.1 Pro',
      price: {
        tokens: 1_000_000,
        input: 'from $2.00',
        output: 'from $12.00',
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-3.1-flash-lite-preview',
      name: 'Gemini 3.1 Flash Lite',
      price: {
        tokens: 1_000_000,
        input: '$0.25',
        output: '$1.50',
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
      name: 'Gemini 3 Pro',
      price: {
        tokens: 1_000_000,
        input: 'from $2.00',
        output: 'from $12.00',
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'high'],
      },
    },
    {
      id: 'gemini-3-flash-preview',
      name: 'Gemini 3 Flash',
      price: {
        tokens: 1_000_000,
        input: '$0.50',
        output: '$3.00',
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      price: {
        tokens: 1_000_000,
        input: 'from $1.25',
        output: 'from $10.00',
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      price: {
        tokens: 1_000_000,
        input: '$0.30',
        output: '$2.50',
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
      name: 'Gemini 2.5 Flash-Lite',
      price: {
        tokens: 1_000_000,
        input: '$0.10',
        output: '$0.40',
      },
      tools: ['web_search', 'image_generation'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gemini-3.1-flash-image',
      name: 'Gemini 3.1 Flash Image',
      description: 'High-quality, low-latency image generation and editing for interactive and high-volume workflows',
      contextLength: 131_072,
      maxOutputTokens: 32_768,
      price: {
        tokens: 1,
        input: '',
        output: '',
        display: '$0.067 / 1K image, plus input',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text', 'image'],
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
    {
      id: 'gemini-3.1-flash-lite-image',
      name: 'Gemini 3.1 Flash Lite Image',
      description: 'Ultra-low-latency, cost-efficient image generation and editing optimized for 1K output',
      contextLength: 65_536,
      maxOutputTokens: 4_096,
      price: {
        tokens: 1,
        input: '',
        output: '',
        display: '$0.0336 / 1K image, plus input',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text', 'image'],
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
    {
      id: 'gemini-3-pro-image',
      name: 'Gemini 3 Pro Image',
      description: 'Professional-grade image generation and editing for complex design, mockups, and data visualization',
      contextLength: 65_536,
      maxOutputTokens: 32_768,
      price: {
        tokens: 1,
        input: '',
        output: '',
        display: '$0.134 / 1K or 2K image, plus input',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text', 'image'],
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
    {
      id: 'gemini-2.5-flash-image',
      name: 'Gemini 2.5 Flash Image',
      description: 'Fast native image generation and conversational editing for high-volume creative workflows',
      contextLength: 65_536,
      maxOutputTokens: 32_768,
      price: {
        tokens: 1,
        input: '',
        output: '',
        display: '$0.039 / 1K image, plus input',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text', 'image'],
      },
      tools: [],
      imageGeneration: {
        controllerModel: 'gemini-2.5-flash-lite',
      },
    },
  ],
}
