import { describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'
import { withConnectorImageParts } from '~~/server/utils/connectors/image-parts-stream'
import type { ConnectorImagePartData } from '#shared/utils/connector-image-parts'

function imageOf(toolCallId: string, fileId: string): ConnectorImagePartData {
  return {
    toolCallId,
    fileId,
    url: `/files/connector-${fileId}.png`,
    mediaType: 'image/png',
    width: 8,
    height: 8,
    size: 75,
    name: 'doop-get_frame_screenshot.png',
  }
}

async function collect(
  chunks: UIMessageChunk[],
  parts: Record<string, ConnectorImagePartData[]>,
): Promise<UIMessageChunk[]> {
  const source = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    },
  })
  const output: UIMessageChunk[] = []
  const reader = withConnectorImageParts(source, {
    partsFor: toolCallId => parts[toolCallId] ?? [],
  }).getReader()

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      return output
    }

    output.push(value)
  }
}

describe('withConnectorImageParts', () => {
  it('adds the saved images right after the call output, once', async () => {
    const output = {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: 'framed',
    } as UIMessageChunk
    const chunks = await collect([
      output,
      { type: 'text-delta', id: 't', delta: 'Hi' } as UIMessageChunk,
      output,
    ], {
      'call-1': [imageOf('call-1', 'a'), imageOf('call-1', 'b')],
    })

    expect(chunks).toEqual([
      output,
      {
        type: 'data-connector-image',
        id: 'connector-image-call-1-0',
        data: imageOf('call-1', 'a'),
      },
      {
        type: 'data-connector-image',
        id: 'connector-image-call-1-1',
        data: imageOf('call-1', 'b'),
      },
      { type: 'text-delta', id: 't', delta: 'Hi' },
      output,
    ])
  })

  it('passes calls without saved images through unchanged', async () => {
    const chunk = {
      type: 'tool-output-available',
      toolCallId: 'call-2',
      output: 'framed',
    } as UIMessageChunk

    expect(await collect([chunk], {})).toEqual([chunk])
  })
})
