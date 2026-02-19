import { mkdir } from 'node:fs/promises'
import { expect, test as setup } from '@playwright/test'
import {
  authenticateUserByApi,
  createUniqueUser,
} from './helpers/auth'

const AUTH_STATE_PATH = '.playwright/auth-user.json'

setup.setTimeout(30_000)

setup('create authenticated state', async ({ page }) => {
  const user = createUniqueUser('playwright-auth')

  await authenticateUserByApi(page, user, '/chats/new')
  await expect(page).toHaveURL('/chats/new')
  await mkdir('.playwright', { recursive: true })
  await page.context().storageState({ path: AUTH_STATE_PATH })
})
