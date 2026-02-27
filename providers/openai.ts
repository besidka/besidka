export default {
  id: 'openai',
  name: 'OpenAI',
  models: [
    // {
    //   id: 'gpt-5-pro',
    //   name: 'GPT-5 Pro',
    //   description:
    //    'Version of GPT-5 that produces smarter and more precise responses',
    //   contextLength: 400_000,
    //   maxOutputTokens: 272_000,
    //   price: {
    //     tokens: 1_000_000,
    //     input: '$15.00',
    //     output: '$120.00',
    //   },
    //   modalities: {
    //     input: ['text', 'image'],
    //     output: ['text'],
    //   },
    //   tools: ['web_search'],
    //   reasoning: {
    //     mode: 'levels',
    //     levels: ['low', 'medium', 'high'],
    //   },
    // },
    {
      id: 'gpt-5.2',
      name: 'GPT-5.2',
      description: 'The best model for coding and agentic tasks across industries',
      contextLength: 400_000,
      maxOutputTokens: 128_000,
      price: {
        tokens: 1_000_000,
        input: '$1.75',
        output: '$14.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5.1',
      name: 'GPT-5.1',
      description: 'The best model for coding and agentic tasks with configurable reasoning effort',
      contextLength: 400_000,
      maxOutputTokens: 128_000,
      price: {
        tokens: 1_000_000,
        input: '$1.25',
        output: '$10.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5',
      name: 'GPT-5',
      description: 'The best model for coding and agentic tasks across domains',
      contextLength: 400_000,
      maxOutputTokens: 128_000,
      price: {
        tokens: 1_000_000,
        input: '$1.25',
        output: '$10.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5-mini',
      name: 'GPT-5 mini',
      description: 'A faster, more cost-efficient version of GPT-5 for well-defined tasks',
      contextLength: 400_000,
      maxOutputTokens: 128_000,
      price: {
        tokens: 1_000_000,
        input: '$0.25',
        output: '$2.00',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: ['web_search'],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
    {
      id: 'gpt-5-nano',
      name: 'GPT-5 nano',
      description: 'Fastest, most cost-efficient version of GPT-5',
      contextLength: 1_047_576,
      maxOutputTokens: 128_000,
      price: {
        tokens: 1_000_000,
        input: '$0.05',
        output: '$0.40',
      },
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
      tools: [],
      reasoning: {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      },
    },
  ],
}
