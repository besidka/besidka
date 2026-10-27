export function isChatSearchToolEnabled(settings: {
  chatSearchEnabled: boolean
}): boolean {
  return settings.chatSearchEnabled
}

export function isMemoryToolsEnabled(settings: {
  memoryEnabled: boolean
}): boolean {
  return settings.memoryEnabled
}
