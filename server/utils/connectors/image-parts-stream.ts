import type { UIMessageChunk } from 'ai'
import {
  buildConnectorImagePartId,
  CONNECTOR_IMAGE_PART_TYPE,
} from '#shared/utils/connector-image-parts'
import type { ConnectorImageSaver } from '~~/server/utils/connectors/image-saver'

/**
 * Adds one `data-connector-image` chunk for each saved image of a connector
 * call right after that call's output, so the client shows the images on the
 * step while the reply streams and the stored message keeps them. A call's
 * images are announced once.
 */
export function withConnectorImageParts(
  stream: ReadableStream<UIMessageChunk>,
  saver: Pick<ConnectorImageSaver, 'partsFor'>,
): ReadableStream<UIMessageChunk> {
  const announced = new Set<string>()

  return stream.pipeThrough(new TransformStream<
    UIMessageChunk,
    UIMessageChunk
  >({
    transform(chunk, controller) {
      controller.enqueue(chunk)

      if (
        chunk.type !== 'tool-output-available'
        || announced.has(chunk.toolCallId)
      ) {
        return
      }

      const parts = saver.partsFor(chunk.toolCallId)

      if (parts.length === 0) {
        return
      }

      announced.add(chunk.toolCallId)

      parts.forEach((data, index) => {
        controller.enqueue({
          type: CONNECTOR_IMAGE_PART_TYPE,
          id: buildConnectorImagePartId(chunk.toolCallId, index),
          data,
        })
      })
    },
  }))
}
