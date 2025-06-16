export default {
  id: 'openai',
  name: 'OpenAI',
  models: [
    {
      id: 'gpt-4.1-nano',
      default: true,
      name: 'GPT-4.1 nano',
      description: 'GPT-4.1 nano is the fastest, most cost-effective GPT-4.1 model.',
      contextLength: 1_047_576,
      maxOutputTokens: 32_768,
      price: {
        tokens: 1_000_000,
        input: '$0.10',
        output: '$0.40',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: ['web_search_preview'],
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o mini',
      description: 'It is ideal for fine-tuning, and model outputs from a larger model like GPT-4o can be distilled to GPT-4o-mini to produce similar results at lower cost and latency.',
      contextLength: 128_000,
      maxOutputTokens: 16_384,
      price: {
        tokens: 1_000_000,
        input: '$0.15',
        output: '$0.60',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: ['web_search_preview'],
    },
  ],
}
