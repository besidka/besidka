import { describe, expect, it } from 'vitest'
import { dynamicTool, generateText, jsonSchema, stepCountIs } from 'ai'
import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import {
  buildConnectorImageLine,
  buildConnectorModelOutput,
} from '~~/server/utils/connectors/tool-images'
import {
  RED_PNG_BASE64,
  RED_PNG_BYTES,
} from '../../../../setup/helpers/connector-images'

const SCREENSHOT_TOOL = 'mcp__doop__get_frame_screenshot'
const NOOP_TOOL = 'mcp__doop__noop'
const FRAMED_OUTPUT = '<untrusted_tool_result connector="doop" '
  + 'tool="get_frame_screenshot">\n'
  + `${buildConnectorImageLine({ mediaType: 'image/png', bytes: RED_PNG_BYTES })}`
  + '\n</untrusted_tool_result>'

type FetchFunction = typeof globalThis.fetch

function screenshotTools() {
  return {
    [SCREENSHOT_TOOL]: dynamicTool({
      description: 'Screenshot of a frame.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => FRAMED_OUTPUT,
      toModelOutput: ({ output }) => {
        return buildConnectorModelOutput({
          output,
          images: [{
            mediaType: 'image/png',
            data: RED_PNG_BASE64,
            bytes: RED_PNG_BYTES,
          }],
          connectorTitle: 'Doop',
          toolName: 'get_frame_screenshot',
        })
      },
    }),
    [NOOP_TOOL]: dynamicTool({
      description: 'Does nothing.',
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => 'ok',
    }),
  }
}

async function captureRequests(
  model: (fetch: FetchFunction) => LanguageModel,
  responses: unknown[],
): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = []
  const fakeFetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))

    const payload = responses[Math.min(bodies.length - 1, responses.length - 1)]

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as FetchFunction

  await generateText({
    model: model(fakeFetch),
    prompt: 'Look at the frame.',
    tools: screenshotTools(),
    stopWhen: stepCountIs(5),
  })

  return bodies
}

function findBase64Paths(
  value: unknown,
  path: string[] = [],
): string[][] {
  if (typeof value === 'string') {
    return value.includes(RED_PNG_BASE64) ? [path] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      return findBase64Paths(item, [...path, String(index)])
    })
  }

  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => {
      return findBase64Paths(item, [...path, key])
    })
  }

  return []
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    return (current as Record<string, unknown>)[key]
  }, value)
}

const anthropicUsage = { input_tokens: 1, output_tokens: 1 }

function anthropicMessage(id: string, content: unknown[], stopReason: string) {
  return {
    id,
    type: 'message',
    role: 'assistant',
    model: 'claude-test',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: anthropicUsage,
  }
}

const openAiUsage = {
  input_tokens: 1,
  output_tokens: 1,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens_details: { reasoning_tokens: 0 },
}

function openAiResponse(id: string, output: unknown[]) {
  return {
    id,
    object: 'response',
    created_at: 1,
    status: 'completed',
    model: 'gpt-test',
    output,
    usage: openAiUsage,
    incomplete_details: null,
  }
}

function openAiCall(id: string, name: string) {
  return {
    type: 'function_call',
    id: `fc_${id}`,
    call_id: id,
    name,
    arguments: '{}',
    status: 'completed',
  }
}

describe('connector images in provider requests', () => {
  it('Anthropic gets an image block inside the tool result', async () => {
    const bodies = await captureRequests((fetch) => {
      return createAnthropic({ apiKey: 'test', fetch })('claude-sonnet-4-5')
    }, [
      anthropicMessage('msg_1', [{
        type: 'tool_use',
        id: 'toolu_1',
        name: SCREENSHOT_TOOL,
        input: {},
      }], 'tool_use'),
      anthropicMessage('msg_2', [{
        type: 'tool_use',
        id: 'toolu_2',
        name: NOOP_TOOL,
        input: {},
      }], 'tool_use'),
      anthropicMessage('msg_3', [{ type: 'text', text: 'Red.' }], 'end_turn'),
    ])

    expect(bodies).toHaveLength(3)
    expect(findBase64Paths(bodies[0])).toEqual([])

    for (const body of bodies.slice(1)) {
      const paths = findBase64Paths(body)

      expect(paths).toHaveLength(1)
      expect(paths[0]!.at(-1)).toBe('data')
      expect(paths[0]!.at(-2)).toBe('source')

      const block = readPath(body, paths[0]!.slice(0, -2)) as Record<
        string,
        unknown
      >
      const toolResult = readPath(body, paths[0]!.slice(0, -4)) as Record<
        string,
        unknown
      >

      expect(block).toMatchObject({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png' },
      })
      expect(toolResult).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'toolu_1',
      })
      expect(
        (toolResult.content as Array<{ type: string }>).map(part => part.type),
      ).toEqual(['text', 'text', 'image'])
    }
  })

  it('OpenAI Responses gets an input_image inside function_call_output',
    async () => {
      const bodies = await captureRequests((fetch) => {
        return createOpenAI({ apiKey: 'test', fetch }).responses('gpt-5')
      }, [
        openAiResponse('resp_1', [openAiCall('call_1', SCREENSHOT_TOOL)]),
        openAiResponse('resp_2', [openAiCall('call_2', NOOP_TOOL)]),
        openAiResponse('resp_3', [{
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Red.', annotations: [] }],
        }]),
      ])

      expect(bodies).toHaveLength(3)
      expect(findBase64Paths(bodies[0])).toEqual([])

      for (const body of bodies.slice(1)) {
        const paths = findBase64Paths(body)

        expect(paths).toHaveLength(1)
        expect(paths[0]!.at(-1)).toBe('image_url')

        const block = readPath(body, paths[0]!.slice(0, -1)) as Record<
          string,
          unknown
        >
        const callOutput = readPath(body, paths[0]!.slice(0, -3)) as Record<
          string,
          unknown
        >

        expect(block).toMatchObject({
          type: 'input_image',
          image_url: `data:image/png;base64,${RED_PNG_BASE64}`,
        })
        expect(callOutput).toMatchObject({
          type: 'function_call_output',
          call_id: 'call_1',
        })
        expect(
          (callOutput.output as Array<{ type: string }>)
            .map(part => part.type),
        ).toEqual(['input_text', 'input_text', 'input_image'])
      }
    })
})
