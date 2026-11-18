import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_IMAGE_PART_TYPE,
  buildConnectorImagePartId,
  collectConnectorImageFileIds,
  getConnectorImagesForToolCall,
  isConnectorImageDataPart,
} from '#shared/utils/connector-image-parts'

function imagePart(toolCallId: string, fileId: string, url?: string) {
  return {
    type: CONNECTOR_IMAGE_PART_TYPE,
    id: buildConnectorImagePartId(toolCallId, 0),
    data: {
      toolCallId,
      fileId,
      url: url ?? `/files/connector-${fileId}.png`,
      mediaType: 'image/png',
      width: 8,
      height: 8,
      size: 75,
      name: 'doop-get_frame_screenshot.png',
    },
  }
}

describe('connector image parts', () => {
  it('accepts only parts with a local file link and a raster type', () => {
    expect(isConnectorImageDataPart(imagePart('call-1', 'a'))).toBe(true)
    expect(isConnectorImageDataPart(
      imagePart('call-1', 'a', 'https://evil.example/x.png'),
    )).toBe(false)
    expect(isConnectorImageDataPart({
      ...imagePart('call-1', 'a'),
      data: { ...imagePart('call-1', 'a').data, mediaType: 'image/svg+xml' },
    })).toBe(false)
    expect(isConnectorImageDataPart({
      ...imagePart('call-1', 'a'),
      data: { ...imagePart('call-1', 'a').data, mediaType: 'text/html' },
    })).toBe(false)
    expect(isConnectorImageDataPart({ type: 'text', text: 'x' })).toBe(false)
  })

  it('returns the images of one call in order', () => {
    const parts = [
      imagePart('call-1', 'a'),
      { type: 'text', text: 'x' },
      imagePart('call-2', 'b'),
      imagePart('call-1', 'c'),
    ]

    expect(getConnectorImagesForToolCall(parts, 'call-1')
      .map(image => image.fileId)).toEqual(['a', 'c'])
    expect(getConnectorImagesForToolCall(parts, undefined)).toEqual([])
  })

  it('collects each file id once', () => {
    expect(collectConnectorImageFileIds([
      imagePart('call-1', 'a'),
      imagePart('call-2', 'a'),
      imagePart('call-3', 'b'),
    ])).toEqual(['a', 'b'])
  })
})
