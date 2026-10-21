import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { waitForHydration } from '../helpers/auth'

const VIEWPORT = { width: 1280, height: 800 }
const SEEDED_PROJECTS_COUNT = 35
const PAGE_SIZE = 30

test.use({ viewport: VIEWPORT })
test.describe.configure({ timeout: 90_000 })

interface SeededProjects {
  suffix: string
  knivesName: string
  carName: string
}

function createRunSuffix(): string {
  return `pk${Date.now().toString(36)}${Math.round(Math.random() * 1000)}`
}

async function createProject(page: Page, name: string): Promise<void> {
  const response = await page.request.put('/api/v1/projects', {
    data: { name },
  })

  expect(response.ok()).toBe(true)
}

async function seedProjects(page: Page): Promise<SeededProjects> {
  const suffix = createRunSuffix()
  const knivesName = `Ножі ${suffix}`
  const carName = `Вибір автівки в Польщі ${suffix}`

  await createProject(page, knivesName)
  await createProject(page, carName)

  for (let index = 0; index < SEEDED_PROJECTS_COUNT - 2; index++) {
    await createProject(page, `Filler ${index} ${suffix}`)
  }

  return { suffix, knivesName, carName }
}

function getSeededItems(dialog: Locator, suffix: string): Locator {
  return dialog
    .getByTestId('project-picker-item')
    .filter({ hasText: suffix })
}

async function scrollUntilSeededItemsLoaded(
  dialog: Locator,
  suffix: string,
): Promise<void> {
  const list = dialog.getByTestId('project-picker-list')
  const items = getSeededItems(dialog, suffix)

  await expect(async () => {
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(items).toHaveCount(SEEDED_PROJECTS_COUNT, { timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}

async function expectPickerSearchWorks(
  dialog: Locator,
  seeded: SeededProjects,
): Promise<void> {
  const searchInput = dialog.getByPlaceholder('Search projects...')
  const items = getSeededItems(dialog, seeded.suffix)

  await searchInput.fill('ножі')
  await expect(items).toHaveText([seeded.knivesName])

  await searchInput.fill('польщі')
  await expect(items).toHaveText([seeded.carName])

  await searchInput.fill('н')
  await expect(items.filter({ hasText: seeded.knivesName })).toHaveCount(1)

  await searchInput.fill('')
  await scrollUntilSeededItemsLoaded(dialog, seeded.suffix)
}

test.describe('project pickers', () => {
  test('choose picker loads every page and searches the server in any letter case', async ({
    page,
  }) => {
    const seeded = await seedProjects(page)

    await page.goto('/chats/new')
    await waitForHydration(page)
    await page.getByRole('button', { name: 'Select project' }).click()

    const dialog = page.getByTestId('project-picker-dialog')

    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('project-picker-item').first())
      .toBeVisible()

    const firstPageItems = await dialog
      .getByTestId('project-picker-item')
      .count()

    expect(firstPageItems).toBeLessThanOrEqual(PAGE_SIZE)

    await scrollUntilSeededItemsLoaded(dialog, seeded.suffix)
    await expectPickerSearchWorks(dialog, seeded)
  })

  test('move picker loads every page and searches the server in any letter case', async ({
    page,
  }) => {
    const seeded = await seedProjects(page)
    const chatTitle = `Move ${seeded.suffix}`
    const createResponse = await page.request.put('/api/v1/chats/new', {
      data: {
        parts: [{ type: 'text', text: chatTitle }],
        tools: [],
      },
    })

    expect(createResponse.ok()).toBe(true)

    const { slug } = await createResponse.json()
    const renameResponse = await page.request.patch(
      `/api/v1/chats/${slug}/rename`,
      { data: { title: chatTitle } },
    )

    expect(renameResponse.ok()).toBe(true)

    await page.goto('/chats/history')
    await waitForHydration(page)

    const row = page.locator('li.list-row').filter({ hasText: chatTitle })

    await row.hover()
    await row.getByTestId('history-chat-actions-trigger').click()
    await row.getByRole('button', { name: 'Add to project' }).click()

    const dialog = page.getByTestId('project-picker-dialog')

    await expect(dialog).toBeVisible()
    await scrollUntilSeededItemsLoaded(dialog, seeded.suffix)
    await expectPickerSearchWorks(dialog, seeded)
  })
})
