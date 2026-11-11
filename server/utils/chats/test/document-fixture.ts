import type { DocumentFormat } from '#shared/utils/documents'

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

export const TEST_PRESENTATION_SPEC_INPUT = {
  specVersion: 1,
  format: 'pptx',
  aspect: '16:9',
  title: 'E2E Product Roadmap',
  language: 'en',
  slides: [
    {
      layout: 'title',
      title: 'E2E Product Roadmap',
      subtitle: 'Planning for the next two quarters',
    },
    {
      layout: 'title-content',
      title: 'Highlights',
      bullets: [
        [{ text: 'New onboarding flow shipped' }],
        [{ text: 'Support backlog cleared', bold: true }],
        [{ text: 'Documents arrive in chat' }],
      ],
    },
    {
      layout: 'two-column',
      title: 'Before and after',
      columns: [
        [{
          type: 'list',
          ordered: false,
          items: [
            { runs: [{ text: 'Manual exports' }] },
            { runs: [{ text: 'Copy and paste' }] },
          ],
        }],
        [{
          type: 'list',
          ordered: false,
          items: [
            { runs: [{ text: 'One click download' }] },
            { runs: [{ text: 'Preview in the chat' }] },
          ],
        }],
      ],
    },
    { layout: 'section', title: 'Next steps' },
  ],
}

export const TEST_WORKBOOK_SPEC_INPUT = {
  specVersion: 1,
  format: 'xlsx',
  title: 'E2E Sales Workbook',
  language: 'en',
  sheets: [
    {
      name: 'Sales',
      freezeHeader: true,
      columns: [
        { header: 'Region', type: 'string', width: 16 },
        { header: 'Units', type: 'integer', width: 10 },
        { header: 'Price', type: 'currency', width: 12 },
        { header: 'Total', type: 'currency', width: 14 },
        { header: 'Share', type: 'percent', width: 10 },
      ],
      rows: [
        ['North', 120, 19.5, 2340, 0.42],
        ['South', 80, 19.5, 1560, 0.28],
        ['East', 60, 21, 1260, 0.22],
        ['West', 20, 22.5, 450, 0.08],
      ],
    },
    {
      name: 'Costs',
      columns: [
        { header: 'Item', type: 'string', width: 20 },
        { header: 'Amount', type: 'currency', width: 14 },
      ],
      rows: [
        ['Hosting', 480],
        ['Support', 920],
      ],
    },
  ],
}

export const TEST_PDF_SPEC_INPUT = {
  specVersion: 1,
  format: 'pdf',
  title: 'E2E Meeting Notes',
  language: 'en',
  pageSize: 'A4',
  blocks: [
    { type: 'heading', level: 1, text: 'Meeting notes' },
    {
      type: 'paragraph',
      runs: [
        { text: 'The team agreed to ship the ' },
        { text: 'documents', bold: true },
        { text: ' feature this month.' },
      ],
    },
    {
      type: 'list',
      ordered: true,
      items: [
        { runs: [{ text: 'Review the preview layout' }] },
        { runs: [{ text: 'Check the download names' }] },
      ],
    },
  ],
}

const TEST_DOCUMENT_SPEC_INPUTS: Record<DocumentFormat, object> = {
  docx: TEST_DOCUMENT_SPEC_INPUT,
  pptx: TEST_PRESENTATION_SPEC_INPUT,
  xlsx: TEST_WORKBOOK_SPEC_INPUT,
  pdf: TEST_PDF_SPEC_INPUT,
}

export function getTestDocumentSpecInput(
  format: DocumentFormat,
): object {
  return TEST_DOCUMENT_SPEC_INPUTS[format]
}
