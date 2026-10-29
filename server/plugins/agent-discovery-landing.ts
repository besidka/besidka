import { queryCollection } from '@nuxt/content/server'
import { buildLandingBody } from '~~/server/utils/agent-discovery/landing-markdown'
import type {
  GuideLink,
  LandingPage,
} from '~~/server/utils/agent-discovery/landing-markdown'

const LANDING_PATH = '/'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('agent-discovery:document', async (event, page) => {
    const landingPage = page as LandingPage & { path?: string }

    if (landingPage.path !== LANDING_PATH) {
      return
    }

    if (!Array.isArray(landingPage.body?.value)) {
      return
    }

    const keyGuidePages = await queryCollection(event, 'keyGuides')
      .select('path', 'title')
      .order('stem', 'ASC')
      .all()
    const keyGuides: GuideLink[] = keyGuidePages.map((keyGuide) => {
      return { title: keyGuide.title, path: keyGuide.path }
    })

    landingPage.body.value = buildLandingBody(landingPage, keyGuides)
  })
})
