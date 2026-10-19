export const TEST_MERMAID_MESSAGE: string = [
  'Here is the flow:',
  '',
  '```mermaid',
  'flowchart LR',
  '  A[Start] --> B{Valid?}',
  '  B -->|yes| C[Render diagram]',
  '  B -->|no| D[Show code]',
  '```',
  '',
  'That is the whole flow.',
].join('\n')
