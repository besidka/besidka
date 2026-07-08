import type { UIMessage } from 'ai'

export function formatResearchElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function hasResearchMetaPart(
  message: Pick<UIMessage, 'parts'>,
): boolean {
  return message.parts.some((part) => {
    return part.type === 'data-research'
  })
}
