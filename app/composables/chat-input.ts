function replaceUserPre(input: string): string {
  return input
    .replace(/<pre>?(\r?\n+)?/, '```$1')
    .replace(/(\r?\n+)?<?\/pre>?/, '$1```')
}

export function useChatInput() {
  return {
    replaceUserPre,
  }
}
