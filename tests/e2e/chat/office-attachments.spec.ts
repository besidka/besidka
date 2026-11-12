import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import * as XLSX from 'xlsx'
import { getDocumentFileName } from '../../../shared/utils/documents'
import { TEST_DOCUMENT_TITLE } from '../../../server/utils/chats/test/document-fixture'
import {
  authenticateUserByApi,
  createUniqueUser,
  waitForHydration,
} from '../helpers/auth'

const E2E_ADMIN_EMAIL = 'e2e-admin@example.com'
const DOCUMENT_URL = '/chats/test?scenario=document&messages=1'
const GENERATED_FILE_NAME = getDocumentFileName(TEST_DOCUMENT_TITLE, 'docx')
const SPREADSHEET_NAME = 'e2e-budget.xlsx'
const LEGACY_SPREADSHEET_NAME = 'e2e-legacy.xls'
const CONVERTED_SPREADSHEET_BASE_NAME = 'e2e-jira-export'
const CONVERTED_SPREADSHEET_NAME = `${CONVERTED_SPREADSHEET_BASE_NAME}.xlsx`
const CONVERTED_NOTE = 'Converted from .xls'
const BLANK_DOCUMENT_NAME = 'e2e-blank.docx'
const SAVE_AS_HINT = 'Save it as .xlsx / .docx / .pptx and upload again.'
const SENT_AS_TEXT = 'Sent as text'
const READY_TIMEOUT = 60_000
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const NS_SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NS_RELATIONSHIPS
  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PACKAGE_RELATIONSHIPS
  = 'http://schemas.openxmlformats.org/package/2006/relationships'
const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument'
  + '.spreadsheetml.sheet'

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 1440, height: 900 },
})

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.beforeEach(async ({ context, page }) => {
  await page.route('**/api/v1/profiles/keys**', async (route) => {
    await route.fulfill({
      json: {
        keys: [{ provider: 'google', hasKey: true }],
      },
    })
  })
  await context.addCookies([
    {
      name: 'cookies_consent',
      value: encodeURIComponent(JSON.stringify({
        v: 2,
        granted: ['necessary', 'preferences'],
        id: 'e2e-consent',
        date: new Date().toISOString(),
      })),
      domain: 'localhost',
      path: '/',
    },
  ])
})

function buildSpreadsheet(): Buffer {
  const sharedStrings = ['Region', 'Revenue', 'North', 'South']
  const rows = [
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c></row>',
    '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>950</v></c></row>',
  ].join('')
  const archive = zipSync({
    '[Content_Types].xml': strToU8(
      `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_RELATIONSHIPS}">`
      + `<Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/>`
      + '</Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      `${XML_HEADER}<workbook xmlns="${NS_SHEET}" xmlns:r="${NS_RELATIONSHIPS}">`
      + '<workbookPr/><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_RELATIONSHIPS}">`
      + `<Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/worksheet" Target="worksheets/sheet1.xml"/>`
      + `<Relationship Id="rId2" Type="${NS_RELATIONSHIPS}/sharedStrings" Target="sharedStrings.xml"/>`
      + '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${XML_HEADER}<worksheet xmlns="${NS_SHEET}"><sheetData>${rows}</sheetData></worksheet>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `${XML_HEADER}<sst xmlns="${NS_SHEET}">${
        sharedStrings.map(value => `<si><t>${value}</t></si>`).join('')
      }</sst>`,
    ),
  })

  return Buffer.from(archive)
}

function buildLegacySpreadsheet(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Key', 'Summary', 'Estimate'],
    ['BES-370', 'Convert xls in the browser', 5],
    ['BES-371', 'Quarterly update', 8],
  ])
  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(workbook, sheet, 'Issues')

  return Buffer.from(XLSX.write(workbook, {
    bookType: 'biff8',
    type: 'buffer',
  }))
}

function buildBlankDocument(): Buffer {
  const archive = zipSync({
    '[Content_Types].xml': strToU8(
      `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${XML_HEADER}<Relationships xmlns="${NS_PACKAGE_RELATIONSHIPS}">`
      + `<Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/officeDocument" Target="word/document.xml"/>`
      + '</Relationships>',
    ),
    'word/document.xml': strToU8(
      `${XML_HEADER}<w:document xmlns:w="${NS_WORD}"><w:body><w:p/></w:body></w:document>`,
    ),
  })

  return Buffer.from(archive)
}

function markEmailVerified(email: string) {
  execFileSync('pnpm', [
    'exec',
    'wrangler',
    'd1',
    'execute',
    'DB',
    '--local',
    '--command',
    `update users set email_verified = 1 where email = '${email}'`,
  ], { stdio: 'ignore' })
}

async function signInWithOfficeAttachments(page: Page) {
  const admin = {
    ...createUniqueUser('e2e-admin'),
    name: 'E2E Admin',
    email: E2E_ADMIN_EMAIL,
  }

  await authenticateUserByApi(page, admin)
  markEmailVerified(E2E_ADMIN_EMAIL)

  const features = await page.request.get('/api/v1/features')

  expect((await features.json()).features['files.office']).toMatchObject({
    active: true,
  })
}

async function openFilesModal(
  page: Page,
  tab: 'Upload new files' | 'Select existing files',
): Promise<void> {
  const actionTestId = tab === 'Upload new files'
    ? 'tools-action-attach'
    : 'tools-action-library'

  await expect(page.getByTestId('files-modal')).toBeAttached({
    timeout: 10_000,
  })
  await page.getByTestId('chat-input-tools-trigger').click()

  const action = page
    .getByTestId('chat-input-tools-panel')
    .getByTestId(actionTestId)

  await expect(action).toBeVisible()
  await action.click()
  await expect(page.getByTestId('files-modal')).toBeVisible()
  await page.getByRole('radio', { name: tab, exact: true }).check()
}

async function openNewChat(page: Page): Promise<void> {
  await page.goto('/chats/new')
  await waitForHydration(page)
  await expect(page.getByTestId('chat-input-textarea')).toBeVisible()
}

test.describe('Office attachments', () => {
  test('lists Word, Excel and PowerPoint as allowed file types', async ({
    page,
  }) => {
    await signInWithOfficeAttachments(page)
    await openNewChat(page)
    await openFilesModal(page, 'Upload new files')

    const formats = page.getByTestId('files-upload-formats')

    await expect(formats).toContainText('Word, Excel, PowerPoint')
    await expect(formats).not.toContainText('vnd.openxmlformats')

    const accept = await page.getByTestId('files-upload-input')
      .getAttribute('accept')

    expect(accept).toContain('.docx')
    expect(accept).toContain('.xlsx')
    expect(accept).toContain('.pptx')
    expect(accept).toContain('.xls')
  })

  test('uploads an xlsx and shows that it is sent as text', async ({
    page,
  }) => {
    await signInWithOfficeAttachments(page)
    await openNewChat(page)
    await openFilesModal(page, 'Upload new files')
    await page.getByTestId('files-upload-input').setInputFiles({
      name: SPREADSHEET_NAME,
      mimeType: '',
      buffer: buildSpreadsheet(),
    })

    await expect(page.getByLabel(`Remove ${SPREADSHEET_NAME}`)).toBeVisible({
      timeout: 30_000,
    })

    const hint = page.getByTestId('files-delivery-hint')

    await expect(hint).toHaveText(SENT_AS_TEXT)
    await expect(hint).toHaveAttribute(
      'title',
      'Sent as text: images, charts and formatting aren\'t included.',
    )

    const files = await page.request.get('/api/v1/files?limit=50')
    const uploaded = (await files.json()).files.find(
      (file: { name: string }) => file.name === SPREADSHEET_NAME,
    )

    expect(uploaded.type).toBe(XLSX_MEDIA_TYPE)
  })

  test('converts a real .xls in the browser and uploads an xlsx', async ({
    page,
  }) => {
    await signInWithOfficeAttachments(page)
    await openNewChat(page)
    await openFilesModal(page, 'Upload new files')

    const uploadedNames: string[] = []

    page.on('request', (request) => {
      if (request.url().includes('/api/v1/files/upload')) {
        uploadedNames.push(
          decodeURIComponent(request.headers()['x-filename'] ?? ''),
        )
      }
    })

    await page.getByTestId('files-upload-input').setInputFiles({
      name: `${CONVERTED_SPREADSHEET_BASE_NAME}.xls`,
      mimeType: 'application/vnd.ms-excel',
      buffer: buildLegacySpreadsheet(),
    })

    await expect(
      page.getByLabel(`Remove ${CONVERTED_SPREADSHEET_NAME}`),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('files-upload-legacy-hint')).toHaveCount(0)
    await expect(page.getByTestId('files-delivery-hint'))
      .toHaveText(SENT_AS_TEXT)

    const note = page.getByTestId('files-converted-note')

    await expect(note).toHaveText(CONVERTED_NOTE)
    await expect(note).toHaveAttribute('title', /Styles, charts and macros/)
    expect(uploadedNames).toEqual([CONVERTED_SPREADSHEET_NAME])

    const files = await page.request.get('/api/v1/files?limit=50')
    const uploaded = (await files.json()).files.find(
      (file: { name: string }) => file.name === CONVERTED_SPREADSHEET_NAME,
    )

    expect(uploaded.type).toBe(XLSX_MEDIA_TYPE)
  })

  test('rejects a fake .xls with the save-as hint', async ({ page }) => {
    await signInWithOfficeAttachments(page)
    await openNewChat(page)
    await openFilesModal(page, 'Upload new files')

    let uploadRequests = 0

    page.on('request', (request) => {
      if (request.url().includes('/api/v1/files/upload')) {
        uploadRequests++
      }
    })

    await page.getByTestId('files-upload-input').setInputFiles({
      name: LEGACY_SPREADSHEET_NAME,
      mimeType: 'application/vnd.ms-excel',
      buffer: randomBytes(256),
    })

    const hint = page.getByTestId('files-upload-legacy-hint')

    await expect(hint).toBeVisible()
    await expect(hint).toContainText(LEGACY_SPREADSHEET_NAME)
    await expect(hint).toContainText(SAVE_AS_HINT)
    await expect(page.getByLabel(`Remove ${LEGACY_SPREADSHEET_NAME}`))
      .toHaveCount(0)
    expect(uploadRequests).toBe(0)
  })

  test('disables a document with no readable text and says why', async ({
    page,
  }) => {
    await signInWithOfficeAttachments(page)
    await openNewChat(page)
    await openFilesModal(page, 'Upload new files')
    await page.getByTestId('files-upload-input').setInputFiles({
      name: BLANK_DOCUMENT_NAME,
      mimeType: '',
      buffer: buildBlankDocument(),
    })
    await expect(page.getByText(/No text could be read/).first())
      .toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel(`Remove ${BLANK_DOCUMENT_NAME}`))
      .toHaveCount(0)

    await expect(page.getByTestId('files-modal')).toBeHidden()
    await openFilesModal(page, 'Select existing files')

    await page.getByTestId('files-view-mode-list').click()
    await page.getByPlaceholder('Search files...').fill(BLANK_DOCUMENT_NAME)

    const row = page.locator('tr[aria-disabled="true"]').first()

    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).toContainText(BLANK_DOCUMENT_NAME)
    await expect(row.getByTestId('files-unsupported-caption'))
      .toHaveText('No readable text')
    await expect(row).toHaveAttribute(
      'title',
      /No text could be read from this document/,
    )
    await row.click({ force: true })
    await expect(page.getByTestId('files-attach-selected')).toHaveCount(0)
  })

  test('attaches a generated DOCX and shows that it is sent as text', async ({
    page,
  }) => {
    await signInWithOfficeAttachments(page)
    await page.goto(DOCUMENT_URL)
    await waitForHydration(page)

    const input = page.locator('textarea').first()

    await input.fill('Write me a quarterly update document')
    await input.press('Enter')
    await expect(page.getByTestId('document-card')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: READY_TIMEOUT },
    )

    await openFilesModal(page, 'Select existing files')
    await page.getByTestId('files-source-assistant').click()
    await page.getByTestId('files-kind-document').click()

    const row = page.locator('[data-file-index="0"]').first()

    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row).not.toHaveAttribute('aria-disabled', 'true')
    await row.click()
    await page.getByTestId('files-attach-selected').click()

    await expect(page.getByLabel(`Remove ${GENERATED_FILE_NAME}`)).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByTestId('files-delivery-hint')).toHaveText(
      SENT_AS_TEXT,
    )
  })
})
