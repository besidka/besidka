import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { describe, expect, it, vi } from 'vitest'
import {
  compactCodeExecutionInput,
  compactCodeExecutionOutput,
} from '~~/server/utils/code-execution/compact'
import {
  collectAnthropicContainerFileRefs,
  readOpenAiContainerFileCitation,
} from '~~/server/utils/code-execution/container-files'
import { appendAnthropicContainerUploads } from '~~/server/utils/code-execution/send'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function captureFetch(responseBody: unknown) {
  const requests: Array<{ url: string, body: Record<string, any> }> = []
  type FetchInput = string | URL | Request
  const fetcher = vi.fn(async (url: FetchInput, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? '{}')),
    })

    return jsonResponse(responseBody)
  })

  return { fetcher: fetcher as unknown as typeof fetch, requests }
}

describe('the request the AI SDK builds for code execution', () => {
  it('sends the Anthropic tool and turns a reference file part into a container_upload block', async () => {
    const { fetcher, requests } = captureFetch({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const anthropic = createAnthropic({ apiKey: 'test', fetch: fetcher })
    const messages = appendAnthropicContainerUploads(
      [{ role: 'user', content: [{ type: 'text', text: 'plot it' }] }],
      ['file_up_1'],
    )

    await generateText({
      model: anthropic('claude-haiku-5-5'),
      messages,
      tools: { code_execution: anthropic.tools.codeExecution_20260120() },
    })

    const body = requests[0]?.body

    expect(body?.tools).toEqual([
      expect.objectContaining({
        type: 'code_execution_20260120',
        name: 'code_execution',
      }),
    ])
    expect(body?.messages[0].content).toContainEqual({
      type: 'container_upload',
      file_id: 'file_up_1',
    })
    expect(JSON.stringify(body?.messages)).not.toContain('"document"')
    expect(JSON.stringify(body?.messages)).not.toContain('"image"')
  })

  it('sends the OpenAI code interpreter with the uploaded files and no network policy', async () => {
    const { fetcher, requests } = captureFetch({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'gpt-5-mini',
      status: 'completed',
      output: [],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })
    const openai = createOpenAI({ apiKey: 'test', fetch: fetcher })

    await generateText({
      model: openai.responses('gpt-5-mini'),
      messages: [{ role: 'user', content: 'plot it' }],
      tools: {
        code_execution: openai.tools.codeInterpreter({
          container: { fileIds: ['file-a'] },
        }),
      },
    })

    const body = requests[0]?.body
    const tool = body?.tools?.find((candidate: { type: string }) => {
      return candidate.type === 'code_interpreter'
    })

    expect(tool).toEqual({
      type: 'code_interpreter',
      container: { type: 'auto', file_ids: ['file-a'] },
    })
    expect(JSON.stringify(body)).not.toMatch(/network/i)
    expect(body?.include).toContain('code_interpreter_call.outputs')
  })

  it('maps an Anthropic bash result to the shapes the stream transform reads', async () => {
    const { fetcher } = captureFetch({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_1',
          name: 'bash_code_execution',
          input: { command: 'python plot.py' },
        },
        {
          type: 'bash_code_execution_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: {
            type: 'bash_code_execution_result',
            stdout: 'done',
            stderr: '',
            return_code: 0,
            content: [{
              type: 'bash_code_execution_output',
              file_id: 'file_chart',
            }],
          },
        },
        { type: 'text', text: 'Saved.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const anthropic = createAnthropic({ apiKey: 'test', fetch: fetcher })
    const result = await generateText({
      model: anthropic('claude-haiku-5-5'),
      messages: [{ role: 'user', content: 'plot' }],
      tools: { code_execution: anthropic.tools.codeExecution_20260120() },
    })
    const call = result.content.find(part => part.type === 'tool-call')
    const output = result.content.find(part => part.type === 'tool-result')

    expect(call).toMatchObject({
      toolName: 'code_execution',
      providerExecuted: true,
    })
    expect(compactCodeExecutionInput((call as { input: unknown }).input))
      .toEqual({ language: 'bash', code: 'python plot.py' })
    expect(
      collectAnthropicContainerFileRefs((output as { output: unknown }).output),
    ).toEqual([{ provider: 'anthropic', fileId: 'file_chart' }])
    expect(
      compactCodeExecutionOutput((output as { output: unknown }).output).output,
    ).toEqual({ stdout: 'done', stderr: '', returnCode: 0 })
  })

  it('maps an OpenAI code interpreter call and its file citation to the shapes the stream transform reads', async () => {
    const { fetcher } = captureFetch({
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      model: 'gpt-5-mini',
      status: 'completed',
      output: [
        {
          type: 'code_interpreter_call',
          id: 'ci_1',
          status: 'completed',
          container_id: 'cntr_1',
          code: 'print(1)',
          outputs: [{ type: 'logs', logs: '1' }],
        },
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{
            type: 'output_text',
            text: 'Saved out.csv',
            annotations: [{
              type: 'container_file_citation',
              container_id: 'cntr_1',
              file_id: 'cfile_1',
              filename: 'out.csv',
              start_index: 0,
              end_index: 5,
            }],
          }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })
    const openai = createOpenAI({ apiKey: 'test', fetch: fetcher })
    const result = await generateText({
      model: openai.responses('gpt-5-mini'),
      messages: [{ role: 'user', content: 'csv' }],
      tools: { code_execution: openai.tools.codeInterpreter({}) },
    })
    const call = result.content.find(part => part.type === 'tool-call')
    const output = result.content.find(part => part.type === 'tool-result')
    const source = result.content.find(part => part.type === 'source') as {
      title?: string
      filename?: string
      providerMetadata?: unknown
    }

    expect(call).toMatchObject({ toolName: 'code_execution' })
    expect(
      compactCodeExecutionOutput((output as { output: unknown }).output).output,
    ).toEqual({ stdout: '1', stderr: '', returnCode: null })
    expect(readOpenAiContainerFileCitation(source)).toEqual({
      provider: 'openai',
      fileId: 'cfile_1',
      containerId: 'cntr_1',
      filename: 'out.csv',
    })
  })

  it('sends the Gemini code execution tool', async () => {
    const { fetcher, requests } = captureFetch({
      candidates: [{
        content: { role: 'model', parts: [{ text: 'ok' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    })
    const google = createGoogleGenerativeAI({ apiKey: 'test', fetch: fetcher })

    await generateText({
      model: google('gemini-3.8-flash'),
      messages: [{ role: 'user', content: 'sum 1..10' }],
      tools: { code_execution: google.tools.codeExecution({}) },
    })

    expect(requests[0]?.body.tools).toEqual([{ codeExecution: {} }])
  })
})
