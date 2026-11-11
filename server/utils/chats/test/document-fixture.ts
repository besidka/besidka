export const TEST_DOCUMENT_TITLE: string = 'E2E Quarterly Update'

export const TEST_DOCUMENT_HEADINGS: readonly string[] = [
  'Quarterly update',
  'Highlights',
  'Next steps',
]

export const TEST_DOCUMENT_REPLY: string
  = 'Here is your quarterly update document.'

export const TEST_DOCUMENT_TOOL_CALL_ID: string = 'test-document-call-0'

export const TEST_DOCUMENT_SPEC_INPUT = {
  specVersion: 1,
  format: 'docx',
  title: TEST_DOCUMENT_TITLE,
  language: 'en',
  blocks: [
    { type: 'heading', level: 1, text: TEST_DOCUMENT_HEADINGS[0] },
    {
      type: 'paragraph',
      runs: [
        { text: 'Revenue grew ' },
        { text: '12 percent', bold: true },
        { text: ' this quarter.' },
      ],
    },
    { type: 'heading', level: 2, text: TEST_DOCUMENT_HEADINGS[1] },
    {
      type: 'list',
      ordered: false,
      items: [
        { runs: [{ text: 'New onboarding flow shipped' }] },
        { runs: [{ text: 'Support backlog cleared' }] },
      ],
    },
    { type: 'heading', level: 2, text: TEST_DOCUMENT_HEADINGS[2] },
    {
      type: 'table',
      header: true,
      columns: [{ text: 'Owner' }, { text: 'Task' }],
      rows: [
        [[{ text: 'Ada' }], [{ text: 'Plan the next release' }]],
        [[{ text: 'Linus' }], [{ text: 'Review the budget' }]],
      ],
    },
  ],
}
