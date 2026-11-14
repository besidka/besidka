import { describe, expect, it } from 'vitest'
import { HIDDEN_FILE_MEDIA_TYPE } from '#shared/utils/files'
import {
  CHAT_CONTEXT_MAX_ITEMS_PER_GROUP,
  MCP_CONTEXT_FILES_LIMIT,
  buildChatContext,
  summarizeChatContextForMcp,
} from '~~/server/utils/chats/context/build-chat-context'
import type { ChatContextItems } from '~~/server/utils/chats/context/build-chat-context'
import type {
  ChatContextMessage,
  ChatContextSection,
} from '~~/server/utils/chats/context/sections'

function message(
  id: string,
  role: 'user' | 'assistant',
  parts: unknown[],
  tools?: unknown,
): ChatContextMessage {
  return { id, role, parts, tools }
}

function privateContext(messages: ChatContextMessage[]): ChatContextItems {
  return buildChatContext(messages, { visibility: 'private' })
}

function publicContext(messages: ChatContextMessage[]): ChatContextItems {
  return buildChatContext(messages, { visibility: 'public' })
}

function generateImagePart(
  toolCallId: string,
  output: unknown,
  state = 'output-available',
) {
  return {
    type: 'tool-generate_image',
    toolCallId,
    state,
    input: { prompt: 'a cat' },
    output,
  }
}

describe('buildChatContext outputs', () => {
  it('collects a ready generated image from the tool output', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        generateImagePart('call-1', {
          status: 'ready',
          file: {
            id: 'file-1',
            name: 'cat.png',
            url: '/files/key-1',
            downloadUrl: '/files/key-1?download=1',
            type: 'image/png',
          },
        }),
      ]),
    ])

    expect(context.outputs).toEqual([
      {
        id: 'image:file-1',
        sectionId: 'generated-images',
        kind: 'image',
        title: 'cat.png',
        messageId: 'm1',
        meta: {
          url: '/files/key-1',
          downloadUrl: '/files/key-1?download=1',
          mediaType: 'image/png',
        },
      },
    ])
    expect(context.counts).toEqual({ outputs: 1, inputs: 0, used: 0 })
  })

  it('skips an image tool output that is not ready yet', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        generateImagePart('call-1', { status: 'pending' }, 'input-available'),
        generateImagePart('call-2', undefined, 'input-streaming'),
        generateImagePart('call-3', {
          status: 'ready',
          file: { id: 'file-3', name: 'no-url.png' },
        }),
      ]),
    ])

    expect(context.outputs).toEqual([])
  })

  it('falls back to a default title and the url for the download link', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        generateImagePart('call-1', {
          status: 'ready',
          file: { url: '/files/key-9' },
        }),
      ]),
    ])

    expect(context.outputs[0]).toMatchObject({
      id: 'image:/files/key-9',
      title: 'Generated image',
      meta: { url: '/files/key-9', downloadUrl: '/files/key-9' },
    })
  })

  it('collects an assistant image file part and ignores other media', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'file',
          url: '/files/key-2',
          mediaType: 'image/webp',
          filename: 'generated.webp',
        },
        {
          type: 'file',
          url: '/files/key-3',
          mediaType: 'application/pdf',
          filename: 'report.pdf',
        },
        {
          type: 'file',
          url: '',
          mediaType: HIDDEN_FILE_MEDIA_TYPE,
        },
      ]),
    ])

    expect(context.outputs).toHaveLength(1)
    expect(context.outputs[0]).toMatchObject({
      id: 'image:/files/key-2',
      kind: 'image',
      title: 'generated.webp',
      meta: {
        url: '/files/key-2',
        downloadUrl: '/files/key-2',
        mediaType: 'image/webp',
      },
    })
  })

  it('does not treat user image attachments as outputs', () => {
    const context = privateContext([
      message('m1', 'user', [
        {
          type: 'file',
          url: '/files/key-1',
          mediaType: 'image/png',
          filename: 'mine.png',
        },
      ]),
    ])

    expect(context.outputs).toEqual([])
    expect(context.inputs).toHaveLength(1)
  })

  it('collects a research report per message from data-research parts', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'data-research',
          data: { provider: 'openai', level: 'quick' },
        },
      ]),
      message('m2', 'assistant', [{ type: 'data-research' }]),
    ])

    expect(context.outputs).toEqual([
      {
        id: 'research:m1',
        sectionId: 'research-reports',
        kind: 'research',
        title: 'Research report',
        messageId: 'm1',
        meta: { provider: 'openai', action: 'quick' },
      },
      {
        id: 'research:m2',
        sectionId: 'research-reports',
        kind: 'research',
        title: 'Research report',
        messageId: 'm2',
        meta: { provider: undefined, action: undefined },
      },
    ])
  })

  it('deduplicates the same image seen in two messages', () => {
    const imageOutput = {
      status: 'ready',
      file: { id: 'file-1', name: 'cat.png', url: '/files/key-1' },
    }
    const context = privateContext([
      message('m1', 'assistant', [generateImagePart('call-1', imageOutput)]),
      message('m2', 'assistant', [generateImagePart('call-2', imageOutput)]),
    ])

    expect(context.outputs).toHaveLength(1)
    expect(context.outputs[0]?.messageId).toBe('m1')
  })
})

describe('buildChatContext inputs', () => {
  it('collects user file parts deduplicated by url', () => {
    const context = privateContext([
      message('m1', 'user', [
        { type: 'text', text: 'Read these' },
        {
          type: 'file',
          url: '/files/key-1',
          mediaType: 'application/pdf',
          filename: 'a.pdf',
        },
        {
          type: 'file',
          url: '/files/key-1',
          mediaType: 'application/pdf',
          filename: 'a-again.pdf',
        },
      ]),
      message('m2', 'user', [
        {
          type: 'file',
          url: '/files/key-1',
          mediaType: 'application/pdf',
          filename: 'a-third.pdf',
        },
        {
          type: 'file',
          url: '/files/key-2',
          mediaType: 'text/plain',
          name: 'notes.txt',
        },
      ]),
    ])

    expect(context.inputs).toEqual([
      {
        id: 'file:/files/key-1',
        sectionId: 'uploaded-files',
        kind: 'file',
        title: 'a.pdf',
        messageId: 'm1',
        meta: { url: '/files/key-1', mediaType: 'application/pdf' },
      },
      {
        id: 'file:/files/key-2',
        sectionId: 'uploaded-files',
        kind: 'file',
        title: 'notes.txt',
        messageId: 'm2',
        meta: { url: '/files/key-2', mediaType: 'text/plain' },
      },
    ])
  })

  it('skips hidden file parts and parts without a url', () => {
    const context = privateContext([
      message('m1', 'user', [
        { type: 'file', url: '', mediaType: HIDDEN_FILE_MEDIA_TYPE },
        {
          type: 'file',
          url: '/files/key-1',
          mediaType: HIDDEN_FILE_MEDIA_TYPE,
        },
        { type: 'file', mediaType: 'image/png' },
        { type: 'file', url: '   ', mediaType: 'image/png' },
      ]),
    ])

    expect(context.inputs).toEqual([])
  })

  it('names a file part without a filename "File"', () => {
    const context = privateContext([
      message('m1', 'user', [
        { type: 'file', url: '/files/key-1', mediaType: 'image/png' },
      ]),
    ])

    expect(context.inputs[0]?.title).toBe('File')
  })

  it('collects knowledge titles from search hits and a read result', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'tool-search_project_knowledge',
          toolCallId: 'call-1',
          state: 'output-available',
          output: {
            hits: [
              { itemId: 'item-1', title: 'Pricing sheet', excerpt: 'secret' },
              { itemId: 'item-2', title: 'Roadmap' },
              { itemId: 'item-3' },
              { title: 'No id' },
            ],
          },
        },
        {
          type: 'tool-read_project_knowledge',
          toolCallId: 'call-2',
          state: 'output-available',
          output: { itemId: 'item-1', title: 'Pricing sheet', text: 'body' },
        },
        {
          type: 'tool-read_project_knowledge',
          toolCallId: 'call-3',
          state: 'output-available',
          output: { itemId: 'item-4', title: 'Playbook', text: 'body' },
        },
      ]),
    ])

    expect(context.inputs).toEqual([
      {
        id: 'knowledge:item-1',
        sectionId: 'project-knowledge',
        kind: 'knowledge',
        title: 'Pricing sheet',
        messageId: 'm1',
      },
      {
        id: 'knowledge:item-2',
        sectionId: 'project-knowledge',
        kind: 'knowledge',
        title: 'Roadmap',
        messageId: 'm1',
      },
      {
        id: 'knowledge:item-4',
        sectionId: 'project-knowledge',
        kind: 'knowledge',
        title: 'Playbook',
        messageId: 'm1',
      },
    ])
    expect(JSON.stringify(context)).not.toContain('secret')
    expect(JSON.stringify(context)).not.toContain('body')
  })

  it('ignores knowledge tool parts without an output', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'tool-search_project_knowledge',
          toolCallId: 'call-1',
          state: 'input-available',
          input: { query: 'x' },
        },
      ]),
    ])

    expect(context.inputs).toEqual([])
  })
})

describe('buildChatContext used: memory', () => {
  function memoryPart(
    toolName: string,
    toolCallId: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      type: `tool-${toolName}`,
      toolCallId,
      state: 'output-available',
      ...extra,
    }
  }

  it('records write, read, list and forget actions without bodies', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        memoryPart('memory_write', 'call-1', {
          input: { title: 'Prefers tea', body: 'SECRET BODY' },
          output: { entry: { title: 'Prefers tea', body: 'SECRET BODY' } },
        }),
        memoryPart('memory_read', 'call-2', {
          output: { entry: { title: 'Lives in Kyiv' } },
        }),
        memoryPart('memory_list', 'call-3', {
          output: { entries: [{ title: 'a' }, { title: 'b' }] },
        }),
        memoryPart('memory_list', 'call-4', {
          output: { entries: [{ title: 'a' }] },
        }),
        memoryPart('memory_forget', 'call-5', {
          input: { title: 'Old fact' },
        }),
      ]),
    ])

    expect(context.used.map((item) => {
      return [item.kind, item.title, item.meta?.action]
    })).toEqual([
      ['memory', 'Prefers tea', 'Saved'],
      ['memory', 'Lives in Kyiv', 'Read'],
      ['memory', '2 entries', 'Listed'],
      ['memory', '1 entry', 'Listed'],
      ['memory', 'Old fact', 'Forgot'],
    ])
    expect(context.used.map((item) => {
      return item.id
    })).toEqual([
      'memory:call-1',
      'memory:call-2',
      'memory:call-3',
      'memory:call-4',
      'memory:call-5',
    ])
    expect(JSON.stringify(context)).not.toContain('SECRET BODY')
  })

  it('names an entry with no title "Memory entry"', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        memoryPart('memory_read', 'call-1', { output: {} }),
      ]),
    ])

    expect(context.used[0]?.title).toBe('Memory entry')
  })

  it('skips a memory call that ended in an error', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'tool-memory_write',
          toolCallId: 'call-1',
          state: 'output-error',
          input: { title: 'Failed write' },
          errorText: 'rejected',
        },
      ]),
    ])

    expect(context.used).toEqual([])
  })

  it('falls back to the message id and part index without a call id', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        { type: 'text', text: 'hi' },
        {
          type: 'tool-memory_forget',
          state: 'output-available',
          input: { title: 'Gone' },
        },
      ]),
    ])

    expect(context.used[0]?.id).toBe('memory:m1:1')
  })

  it('reads memory tools given as dynamic-tool parts', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'dynamic-tool',
          toolName: 'memory_write',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { title: 'Dynamic fact' },
        },
      ]),
    ])

    expect(context.used).toEqual([
      expect.objectContaining({
        id: 'memory:call-1',
        title: 'Dynamic fact',
        meta: { action: 'Saved' },
      }),
    ])
  })
})

describe('buildChatContext used: chat search', () => {
  it('records chat searches by query and past chat reads', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'tool-search_chats',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { query: 'wedding plans' },
        },
        {
          type: 'tool-search_chats',
          toolCallId: 'call-2',
          state: 'output-available',
          input: {},
        },
        {
          type: 'tool-read_chat',
          toolCallId: 'call-3',
          state: 'output-available',
          input: { query: 'ignored for reads', slug: 'abc' },
        },
      ]),
    ])

    expect(context.used.map((item) => {
      return [item.kind, item.title, item.meta?.action]
    })).toEqual([
      ['chat-search', 'wedding plans', 'Searched chats'],
      ['chat-search', 'Read a past chat', 'Searched chats'],
      ['chat-search', 'Read a past chat', 'Read chat'],
    ])
  })

  it('truncates a long query title to one line', () => {
    const query = `${'long '.repeat(80)}\nsecond line`
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'tool-search_chats',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { query },
        },
      ]),
    ])
    const title = context.used[0]?.title ?? ''

    expect(title.length).toBeLessThanOrEqual(160)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toContain('\n')
  })
})

describe('buildChatContext used: web sources', () => {
  it('collects http sources deduplicated by url and skips others', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'source-url',
          sourceId: 's1',
          url: 'https://www.example.com/a',
          title: 'Article A',
        },
        {
          type: 'source-url',
          sourceId: 's2',
          url: 'https://www.example.com/a',
          title: 'Article A again',
        },
        { type: 'source-url', sourceId: 's3', url: 'http://plain.test/b' },
        { type: 'source-url', sourceId: 's4', url: 'javascript:alert(1)' },
        { type: 'source-url', sourceId: 's5', url: 'ftp://files.test/c' },
        { type: 'source-url', sourceId: 's6', url: '/relative' },
        { type: 'source-url', sourceId: 's7' },
      ]),
    ])

    expect(context.used).toEqual([
      {
        id: 'source:https://www.example.com/a',
        sectionId: 'web-sources',
        kind: 'web-source',
        title: 'Article A',
        messageId: 'm1',
        href: 'https://www.example.com/a',
        meta: { domain: 'example.com' },
      },
      {
        id: 'source:http://plain.test/b',
        sectionId: 'web-sources',
        kind: 'web-source',
        title: 'plain.test',
        messageId: 'm1',
        href: 'http://plain.test/b',
        meta: { domain: 'plain.test' },
      },
    ])
  })

  it('ignores sources on user messages', () => {
    const context = privateContext([
      message('m1', 'user', [
        { type: 'source-url', url: 'https://example.com' },
      ]),
    ])

    expect(context.used).toEqual([])
  })

  it('counts web search per provider from tool parts', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        { type: 'tool-web_search_brave', toolCallId: 'a' },
        { type: 'tool-web_search_brave', toolCallId: 'b' },
        { type: 'tool-web_search_exa', toolCallId: 'c' },
      ]),
      message('m2', 'assistant', [
        { type: 'tool-web_search_brave', toolCallId: 'd' },
      ]),
      message('m3', 'assistant', [
        { type: 'tool-web_search', toolCallId: 'e' },
      ]),
    ])

    expect(context.used.map((item) => {
      return [item.id, item.title, item.meta?.provider, item.meta?.count]
    })).toEqual([
      ['web-search:web_search_brave', 'Brave Search', 'web_search_brave', 2],
      ['web-search:web_search_exa', 'Exa search', 'web_search_exa', 1],
      ['web-search:web_search', 'Web search', 'web_search', 1],
    ])
  })

  it('counts a provider once per message even with many calls', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        { type: 'tool-web_search_brave', toolCallId: 'a' },
        { type: 'tool-web_search_brave', toolCallId: 'b' },
        { type: 'tool-web_search_brave', toolCallId: 'c' },
      ]),
    ])

    expect(context.used).toHaveLength(1)
    expect(context.used[0]?.meta?.count).toBe(1)
  })

  it('counts provider-native web search from message.tools only with a cited source', () => {
    const source = {
      type: 'source-url',
      sourceId: 's',
      url: 'https://example.com/a',
    }
    const context = privateContext([
      message('m1', 'assistant', [source], ['web_search', 'image_generation']),
      message('m2', 'assistant', [], ['web_search']),
      message('m3', 'assistant', [], 'not-an-array'),
    ])
    const searchRows = context.used.filter((item) => {
      return item.kind === 'web-search'
    })

    expect(searchRows).toHaveLength(1)
    expect(searchRows[0]).toMatchObject({
      id: 'web-search:web_search',
      meta: { provider: 'web_search', count: 1 },
    })
  })

  it('ignores Brave and Exa listed in message.tools without their tool part', () => {
    const source = {
      type: 'source-url',
      sourceId: 's',
      url: 'https://example.com/a',
    }
    const context = privateContext([
      message('m1', 'assistant', [source], ['web_search_brave', 'web_search_exa']),
    ])

    expect(context.used.some((item) => {
      return item.kind === 'web-search'
    })).toBe(false)
  })

  it('merges part and tools signals for the same provider in a message', () => {
    const context = privateContext([
      message(
        'm1',
        'assistant',
        [{ type: 'tool-web_search_exa', toolCallId: 'a' }],
        ['web_search_exa'],
      ),
    ])

    expect(context.used[0]?.meta?.count).toBe(1)
  })

  it('does not count web search on a user message', () => {
    const context = privateContext([
      message('m1', 'user', [], ['web_search']),
    ])

    expect(context.used).toEqual([])
  })
})

describe('buildChatContext used: code execution', () => {
  function codeExecutionPart(
    toolCallId: string,
    state = 'output-available',
  ) {
    return {
      type: 'tool-code_execution',
      toolCallId,
      state,
      input: { language: 'python', code: 'print(1)' },
      output: { stdout: '1', stderr: '', returnCode: 0 },
    }
  }

  it('lists one Code execution item counting every run in Used', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        codeExecutionPart('call-1'),
        codeExecutionPart('call-2', 'output-error'),
      ]),
      message('m2', 'assistant', [codeExecutionPart('call-3')]),
    ])

    expect(context.used).toEqual([
      {
        id: 'code-execution',
        sectionId: 'code-execution',
        kind: 'code-execution',
        title: 'Code execution',
        messageId: 'm1',
        meta: { count: 3 },
      },
    ])
    expect(context.counts).toEqual({ outputs: 0, inputs: 0, used: 1 })
    expect(context.kindCounts['code-execution']).toBe(1)
  })

  it('keeps files a run produced in Outputs, not in Used', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        codeExecutionPart('call-1'),
        {
          type: 'file',
          url: '/files/chart-key',
          mediaType: 'image/png',
          filename: 'chart.png',
        },
        {
          type: 'data-code-execution-files',
          data: {
            savedCount: 1,
            skipped: [{ filename: 'huge.bin', reason: 'too-large' }],
          },
        },
      ]),
    ])

    expect(context.outputs).toHaveLength(1)
    expect(context.outputs[0]).toMatchObject({
      id: 'image:/files/chart-key',
      kind: 'image',
      title: 'chart.png',
    })
    expect(context.used.map(item => item.kind)).toEqual(['code-execution'])
  })

  it('ignores code execution parts on user messages', () => {
    const context = privateContext([
      message('m1', 'user', [codeExecutionPart('call-1')]),
    ])

    expect(context.used).toEqual([])
  })

  it('never reaches a shared chat', () => {
    const context = publicContext([
      message('m1', 'assistant', [codeExecutionPart('call-1')]),
    ])

    expect(context.used).toEqual([])
  })
})

describe('buildChatContext tool part shapes', () => {
  it('reads dynamic-tool parts like static tool parts', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        {
          type: 'dynamic-tool',
          toolName: 'generate_image',
          toolCallId: 'call-1',
          state: 'output-available',
          output: {
            status: 'ready',
            file: { id: 'file-1', name: 'dyn.png', url: '/files/key-1' },
          },
        },
        {
          type: 'dynamic-tool',
          toolName: 'search_project_knowledge',
          toolCallId: 'call-2',
          state: 'output-available',
          output: { hits: [{ itemId: 'item-1', title: 'Doc' }] },
        },
        {
          type: 'dynamic-tool',
          toolName: 'web_search_brave',
          toolCallId: 'call-3',
          state: 'output-available',
        },
        { type: 'dynamic-tool', toolCallId: 'call-4' },
      ]),
    ])

    expect(context.outputs.map((item) => {
      return item.id
    })).toEqual(['image:file-1'])
    expect(context.inputs.map((item) => {
      return item.id
    })).toEqual(['knowledge:item-1'])
    expect(context.used.map((item) => {
      return item.id
    })).toEqual(['web-search:web_search_brave'])
  })

  it('tolerates malformed parts', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        null,
        undefined,
        'text',
        42,
        [],
        {},
        { type: 42 },
        { type: 'tool-' },
      ]),
    ])

    expect(context.counts).toEqual({ outputs: 0, inputs: 0, used: 0 })
  })
})

describe('buildChatContext visibility', () => {
  const messages = [
    message('m1', 'user', [
      { type: 'file', url: '/files/key-1', mediaType: 'image/png' },
    ]),
    message('m2', 'assistant', [
      generateImagePart('call-1', {
        status: 'ready',
        file: { id: 'file-1', name: 'cat.png', url: '/files/key-2' },
      }),
      {
        type: 'file',
        url: '/files/key-5',
        mediaType: 'image/png',
        filename: 'shown.png',
      },
      { type: 'data-research', data: {} },
      { type: 'source-url', url: 'https://example.com/a', title: 'A' },
      {
        type: 'tool-memory_write',
        toolCallId: 'call-2',
        state: 'output-available',
        input: { title: 'Fact' },
      },
      {
        type: 'tool-search_chats',
        toolCallId: 'call-3',
        state: 'output-available',
        input: { query: 'q' },
      },
      {
        type: 'tool-search_project_knowledge',
        toolCallId: 'call-4',
        state: 'output-available',
        output: { hits: [{ itemId: 'item-1', title: 'Doc' }] },
      },
    ], ['web_search']),
  ]

  function collectSectionIds(context: ChatContextItems): string[] {
    return [
      ...context.outputs,
      ...context.inputs,
      ...context.used,
    ].map((item) => {
      return item.sectionId
    })
  }

  it('runs private sections for the owner', () => {
    expect(collectSectionIds(privateContext(messages))).toEqual(
      expect.arrayContaining([
        'project-knowledge',
        'memory',
        'chat-search',
      ]),
    )
  })

  it('excludes every private section from a public build', () => {
    const sectionIds = collectSectionIds(publicContext(messages))

    expect(sectionIds).not.toContain('project-knowledge')
    expect(sectionIds).not.toContain('memory')
    expect(sectionIds).not.toContain('chat-search')
    expect(sectionIds).toEqual(expect.arrayContaining([
      'generated-images',
      'research-reports',
      'uploaded-files',
      'web-sources',
    ]))
  })

  it('strips every tool part and the tools list in a public build', () => {
    const context = publicContext(messages)
    const serialized = JSON.stringify(context)

    expect(context.outputs.map((item) => {
      return item.id
    })).toEqual(['image:/files/key-5', 'research:m2'])
    expect(serialized).not.toContain('cat.png')
    expect(serialized).not.toContain('web-search:')
    expect(context.used.map((item) => {
      return item.kind
    })).toEqual(['web-source'])
  })

  it('does not run a public section over a tool part in a public build', () => {
    const toolSection: ChatContextSection = {
      id: 'tool-probe',
      group: 'used',
      visibility: 'public',
      collect(contextMessage, accumulator) {
        accumulator.add('used', {
          id: `parts:${contextMessage.id}`,
          sectionId: 'tool-probe',
          kind: 'web-search',
          title: JSON.stringify({
            parts: contextMessage.parts,
            tools: contextMessage.tools,
          }),
          messageId: contextMessage.id,
        })
      },
    }
    const probed = (visibility: 'public' | 'private') => {
      return buildChatContext(
        [
          message(
            'm1',
            'assistant',
            [
              { type: 'text', text: 'hi' },
              { type: 'tool-memory_write', toolCallId: 'a' },
              { type: 'dynamic-tool', toolName: 'x', toolCallId: 'b' },
            ],
            ['web_search'],
          ),
        ],
        { visibility, sections: [toolSection] },
      ).used[0]?.title
    }

    expect(probed('public')).toBe(JSON.stringify({
      parts: [{ type: 'text', text: 'hi' }],
    }))
    expect(probed('private')).toContain('tool-memory_write')
    expect(probed('private')).toContain('web_search')
  })

  it('reports counts that match the item lists', () => {
    const context = privateContext(messages)

    expect(context.counts).toEqual({
      outputs: context.outputs.length,
      inputs: context.inputs.length,
      used: context.used.length,
    })
    expect(context.counts.outputs).toBe(3)
    expect(context.counts.inputs).toBe(2)
    expect(context.counts.used).toBe(4)
  })

  it('returns empty lists for no messages', () => {
    expect(privateContext([])).toEqual({
      outputs: [],
      inputs: [],
      used: [],
      counts: { outputs: 0, inputs: 0, used: 0 },
      kindCounts: {},
      truncated: false,
    })
  })

  it('carries the truncated flag of the loaded window', () => {
    expect(buildChatContext([], {
      visibility: 'private',
      truncated: true,
    }).truncated).toBe(true)
    expect(buildChatContext([], {
      visibility: 'public',
      truncated: false,
    }).truncated).toBe(false)
  })
})

describe('buildChatContext item cap', () => {
  const fileParts = Array.from(
    { length: CHAT_CONTEXT_MAX_ITEMS_PER_GROUP + 30 },
    (_value, index) => {
      return {
        type: 'file',
        url: `/files/key-${index}`,
        mediaType: 'text/plain',
        filename: `file-${index}.txt`,
      }
    },
  )

  it('caps each group at 200 items but keeps the full counts', () => {
    const context = privateContext([message('m1', 'user', fileParts)])

    expect(CHAT_CONTEXT_MAX_ITEMS_PER_GROUP).toBe(200)
    expect(context.inputs).toHaveLength(CHAT_CONTEXT_MAX_ITEMS_PER_GROUP)
    expect(context.inputs[0]?.title).toBe('file-30.txt')
    expect(context.inputs.at(-1)?.title).toBe(
      `file-${CHAT_CONTEXT_MAX_ITEMS_PER_GROUP + 29}.txt`,
    )
    expect(context.kindCounts.file).toBe(CHAT_CONTEXT_MAX_ITEMS_PER_GROUP + 30)
    expect(context.counts.inputs).toBe(CHAT_CONTEXT_MAX_ITEMS_PER_GROUP + 30)
  })

  it('caps the public build the same way', () => {
    const context = publicContext([message('m1', 'user', fileParts)])

    expect(context.inputs).toHaveLength(CHAT_CONTEXT_MAX_ITEMS_PER_GROUP)
    expect(context.counts.inputs).toBe(CHAT_CONTEXT_MAX_ITEMS_PER_GROUP + 30)
  })

  it('does not cap a group that fits', () => {
    const context = privateContext([
      message('m1', 'user', fileParts.slice(0, 3)),
    ])

    expect(context.inputs).toHaveLength(3)
    expect(context.counts.inputs).toBe(3)
  })
})

describe('buildChatContext inherited property names', () => {
  it('ignores tool parts named after Object.prototype members', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        { type: 'tool-constructor', toolCallId: 'a', state: 'output-available' },
        { type: 'tool-toString', toolCallId: 'b', state: 'output-available' },
        { type: 'tool-__proto__', toolCallId: 'c', state: 'output-available' },
        { type: 'tool-hasOwnProperty', toolCallId: 'd' },
        {
          type: 'dynamic-tool',
          toolName: 'constructor',
          toolCallId: 'e',
          state: 'output-available',
        },
      ], ['constructor', 'toString', '__proto__']),
    ])

    expect(context.counts).toEqual({ outputs: 0, inputs: 0, used: 0 })
  })
})

describe('buildChatContext custom sections', () => {
  const artifactsSection: ChatContextSection = {
    id: 'artifacts',
    group: 'outputs',
    visibility: 'private',
    collect(contextMessage, accumulator) {
      accumulator.add('outputs', {
        id: `artifact:${contextMessage.id}`,
        sectionId: 'artifacts',
        kind: 'file',
        title: 'Artifact',
        messageId: contextMessage.id,
      })
      accumulator.increment('used', {
        id: 'artifact-views',
        sectionId: 'artifacts',
        kind: 'web-search',
        title: 'Views',
        messageId: contextMessage.id,
      })
    },
  }

  it('runs the given sections in message order and counts increments', () => {
    const context = buildChatContext(
      [message('m1', 'assistant', []), message('m2', 'assistant', [])],
      { visibility: 'private', sections: [artifactsSection] },
    )

    expect(context.outputs.map((item) => {
      return item.id
    })).toEqual(['artifact:m1', 'artifact:m2'])
    expect(context.used).toEqual([
      expect.objectContaining({
        id: 'artifact-views',
        meta: { count: 2 },
      }),
    ])
  })

  it('keeps the first item when the same id is added twice', () => {
    const duplicatingSection: ChatContextSection = {
      id: 'dup',
      group: 'inputs',
      visibility: 'public',
      collect(contextMessage, accumulator) {
        accumulator.add('inputs', {
          id: 'same',
          sectionId: 'dup',
          kind: 'file',
          title: `from ${contextMessage.id}`,
          messageId: contextMessage.id,
        })
      },
    }
    const context = buildChatContext(
      [message('m1', 'user', []), message('m2', 'user', [])],
      { visibility: 'public', sections: [duplicatingSection] },
    )

    expect(context.inputs).toEqual([
      expect.objectContaining({ title: 'from m1', messageId: 'm1' }),
    ])
  })

  it('skips a private custom section in a public build', () => {
    const context = buildChatContext(
      [message('m1', 'assistant', [])],
      { visibility: 'public', sections: [artifactsSection] },
    )

    expect(context.counts).toEqual({ outputs: 0, inputs: 0, used: 0 })
  })
})

describe('summarizeChatContextForMcp', () => {
  it('counts outputs, inputs, sources, images, reports and memory actions',
    () => {
      const context = privateContext([
        message('m1', 'user', [
          {
            type: 'file',
            url: '/files/key-1',
            mediaType: 'application/pdf',
            filename: 'a.pdf',
          },
        ]),
        message('m2', 'assistant', [
          generateImagePart('call-1', {
            status: 'ready',
            file: { id: 'file-1', name: 'cat.png', url: '/files/key-2' },
          }),
          { type: 'data-research', data: {} },
          { type: 'source-url', url: 'https://example.com/a' },
          { type: 'source-url', url: 'https://example.com/b' },
          {
            type: 'tool-memory_write',
            toolCallId: 'call-2',
            state: 'output-available',
            input: { title: 'Fact' },
          },
          { type: 'tool-web_search_brave', toolCallId: 'call-3' },
        ]),
      ])

      expect(summarizeChatContextForMcp(context)).toEqual({
        outputs: 2,
        inputs: 1,
        sources: 2,
        images: 1,
        researchReports: 1,
        memoryActions: 1,
        truncated: false,
        files: [{ storageKey: 'key-1', name: 'a.pdf' }],
      })
    })

  it('reads the storage key from /files urls and skips every other input',
    () => {
      const context: ChatContextItems = {
        outputs: [],
        inputs: [
          {
            id: 'file:/files/key-1?x=1',
            sectionId: 'uploaded-files',
            kind: 'file',
            title: 'with-query.png',
            messageId: 'm1',
            meta: { url: '/files/key-1?x=1' },
          },
          {
            id: 'file:https://cdn.test/other.png',
            sectionId: 'uploaded-files',
            kind: 'file',
            title: 'external.png',
            messageId: 'm1',
            meta: { url: 'https://cdn.test/other.png' },
          },
          {
            id: 'file:no-url',
            sectionId: 'uploaded-files',
            kind: 'file',
            title: 'no-url.png',
            messageId: 'm1',
          },
          {
            id: 'knowledge:item-1',
            sectionId: 'project-knowledge',
            kind: 'knowledge',
            title: 'Doc',
            messageId: 'm1',
            meta: { url: '/files/key-9' },
          },
        ],
        used: [],
        counts: { outputs: 0, inputs: 4, used: 0 },
        kindCounts: { file: 3, knowledge: 1 },
        truncated: false,
      }

      expect(summarizeChatContextForMcp(context).files).toEqual([
        { storageKey: 'key-1', name: 'with-query.png' },
      ])
    })

  it('passes the truncated flag through', () => {
    const context = buildChatContext([], {
      visibility: 'private',
      truncated: true,
    })

    expect(summarizeChatContextForMcp(context).truncated).toBe(true)
  })

  it('caps the attached files at the limit and ignores non-file inputs',
    () => {
      const fileParts = Array.from(
        { length: MCP_CONTEXT_FILES_LIMIT + 5 },
        (_value, index) => {
          return {
            type: 'file',
            url: `/files/key-${index}`,
            mediaType: 'text/plain',
            filename: `file-${index}.txt`,
          }
        },
      )
      const context = privateContext([
        message('m1', 'user', fileParts),
        message('m2', 'assistant', [
          {
            type: 'tool-search_project_knowledge',
            toolCallId: 'call-1',
            state: 'output-available',
            output: { hits: [{ itemId: 'item-1', title: 'Doc' }] },
          },
        ]),
      ])
      const summary = summarizeChatContextForMcp(context)

      expect(MCP_CONTEXT_FILES_LIMIT).toBe(20)
      expect(summary.files).toHaveLength(MCP_CONTEXT_FILES_LIMIT)
      expect(summary.files[0]).toEqual({
        storageKey: 'key-0',
        name: 'file-0.txt',
      })
      expect(summary.inputs).toBe(MCP_CONTEXT_FILES_LIMIT + 5 + 1)
    })
})

describe('artifacts section', () => {
  const artifacts = new Map([
    ['art-1', {
      title: '  Quiz\n  title  ',
      kind: 'html' as const,
      version: 2,
      latestVersion: 3,
    }],
  ])

  function artifactPart(artifactId: string, version: number) {
    return {
      type: 'data-artifact',
      data: { artifactId, version, kind: 'html', title: 'Part title' },
    }
  }

  it('lists each loaded artifact once, from its first message', () => {
    const context = buildChatContext([
      message('m1', 'assistant', [artifactPart('art-1', 1)]),
      message('m2', 'assistant', [
        artifactPart('art-1', 2),
        artifactPart('art-unknown', 1),
        { type: 'data-artifact', data: { artifactId: 'art-1' } },
      ]),
    ], { visibility: 'public', artifacts })

    expect(context.outputs).toEqual([
      {
        id: 'artifact:art-1',
        sectionId: 'artifacts',
        kind: 'artifact',
        title: 'Quiz title',
        messageId: 'm1',
        meta: {
          artifactId: 'art-1',
          artifactKind: 'html',
          version: 2,
          latestVersion: 3,
        },
      },
    ])
    expect(context.counts.outputs).toBe(1)
    expect(context.kindCounts).toEqual({ artifact: 1 })
  })

  it('lists no artifacts when the caller loads none', () => {
    const context = privateContext([
      message('m1', 'assistant', [artifactPart('art-1', 1)]),
    ])

    expect(context.outputs).toEqual([])
  })
})

describe('documents section', () => {
  function documentPart(documentId: string | null, title = 'Quarterly report') {
    return {
      type: 'data-document',
      data: {
        documentId,
        format: 'docx',
        title,
        specVersion: 1,
        status: 'spec_ready',
      },
    }
  }

  it('lists each document of an owner chat with its id and format', () => {
    const context = privateContext([
      message('m1', 'assistant', [documentPart('doc-1', '  Q3\n report  ')]),
      message('m2', 'assistant', [documentPart('doc-2')]),
    ])

    expect(context.outputs).toEqual([
      {
        id: 'document:doc-1',
        sectionId: 'documents',
        kind: 'document',
        title: 'Q3 report',
        messageId: 'm1',
        meta: { documentId: 'doc-1', documentFormat: 'docx' },
      },
      {
        id: 'document:doc-2',
        sectionId: 'documents',
        kind: 'document',
        title: 'Quarterly report',
        messageId: 'm2',
        meta: { documentId: 'doc-2', documentFormat: 'docx' },
      },
    ])
    expect(context.counts.outputs).toBe(2)
    expect(context.kindCounts).toEqual({ document: 2 })
  })

  it('falls back to a default title for an empty one', () => {
    const context = privateContext([
      message('m1', 'assistant', [documentPart('doc-1', '   ')]),
    ])

    expect(context.outputs[0]?.title).toBe('Document')
  })

  it('never lists documents for a public share', () => {
    const context = publicContext([
      message('m1', 'assistant', [documentPart('doc-1')]),
    ])

    expect(context.outputs).toEqual([])
    expect(context.counts.outputs).toBe(0)
  })

  it('skips a share-shaped part without a document id and malformed parts', () => {
    const context = privateContext([
      message('m1', 'assistant', [
        documentPart(null),
        { type: 'data-document', data: { documentId: 'doc-1' } },
        { type: 'tool-create_document', state: 'output-available' },
      ]),
    ])

    expect(context.outputs).toEqual([])
  })
})

describe('attached artifacts section', () => {
  const artifacts = new Map([
    ['art-1', {
      title: ' Library\n quiz ',
      kind: 'html' as const,
      version: 4,
      latestVersion: 4,
    }],
  ])

  function attachmentPart(artifactId: string, version: number) {
    return {
      type: 'data-artifact-attachment',
      data: { artifactId, version, kind: 'html', title: 'Part title' },
    }
  }

  it('lists an attached artifact under Inputs with the attached version',
    () => {
      const context = buildChatContext([
        message('m1', 'user', [
          { type: 'text', text: 'Use this' },
          attachmentPart('art-1', 2),
          attachmentPart('art-unknown', 1),
        ]),
        message('m2', 'user', [attachmentPart('art-1', 3)]),
      ], { visibility: 'private', artifacts })

      expect(context.inputs).toEqual([
        {
          id: 'attached-artifact:art-1',
          sectionId: 'attached-artifacts',
          kind: 'artifact',
          title: 'Library quiz',
          messageId: 'm1',
          meta: {
            artifactId: 'art-1',
            artifactKind: 'html',
            version: 2,
            latestVersion: 4,
          },
        },
      ])
      expect(context.outputs).toEqual([])
      expect(context.counts.inputs).toBe(1)
    })

  it('ignores attachment parts of assistant messages', () => {
    const context = buildChatContext([
      message('m1', 'assistant', [attachmentPart('art-1', 1)]),
    ], { visibility: 'private', artifacts })

    expect(context.inputs).toEqual([])
    expect(context.outputs).toEqual([])
  })

  it('never lists attachments on a public share', () => {
    const context = buildChatContext([
      message('m1', 'user', [attachmentPart('art-1', 1)]),
    ], { visibility: 'public', artifacts })

    expect(context.inputs).toEqual([])
    expect(context.outputs).toEqual([])
  })

  it('keeps the chat outputs separate from the attached input', () => {
    const context = buildChatContext([
      message('m1', 'user', [attachmentPart('art-1', 1)]),
      message('m2', 'assistant', [{
        type: 'data-artifact',
        data: {
          artifactId: 'art-1',
          version: 4,
          kind: 'html',
          title: 'Library quiz',
        },
      }]),
    ], { visibility: 'private', artifacts })

    expect(context.inputs.map(item => item.id))
      .toEqual(['attached-artifact:art-1'])
    expect(context.outputs.map(item => item.id))
      .toEqual(['artifact:art-1'])
  })
})

describe('skills in the used group', () => {
  it('lists an attached skill, an activation and an activate_skill call once each', () => {
    const context = privateContext([
      message('m1', 'user', [
        { type: 'text', text: 'hi' },
        {
          type: 'data-skill-invocation',
          data: { skillId: 'skl1', name: 'translate', version: 2 },
        },
      ]),
      message('m2', 'assistant', [
        {
          type: 'data-skill-activation',
          data: { skillId: 'skl1', name: 'translate', version: 2 },
        },
        {
          type: 'tool-activate_skill',
          toolCallId: 't1',
          state: 'output-available',
          output: { skillId: 'skl2', name: 'writing-style', version: 1 },
        },
        {
          type: 'tool-activate_skill',
          toolCallId: 't2',
          state: 'output-error',
          errorText: 'no',
        },
      ]),
    ])

    expect(context.used.map((item) => {
      return [item.kind, item.title, item.meta?.action]
    })).toEqual([
      ['skill', 'translate', 'Attached'],
      ['skill', 'writing-style', 'Used'],
    ])
    expect(context.kindCounts.skill).toBe(2)
  })

  it('never lists a skill on a shared chat', () => {
    const context = publicContext([
      message('m1', 'user', [{
        type: 'data-skill-invocation',
        data: { skillId: 'skl1', name: 'translate', version: 2 },
      }]),
    ])

    expect(context.used).toEqual([])
  })
})
