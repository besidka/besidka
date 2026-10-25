import { buildAboutMeDescription } from '#shared/utils/memory-about-me'
import type { MemoryEntryInitialValues } from '~/types/memory-entries.d'

const LEGACY_ABOUT_ME_TITLE = 'About me'

export function buildLegacyAboutMeEntryValues(
  aboutMe: string,
  hasProfileEntry: boolean,
): MemoryEntryInitialValues {
  return {
    title: LEGACY_ABOUT_ME_TITLE,
    description: buildAboutMeDescription(aboutMe),
    body: aboutMe,
    category: hasProfileEntry ? 'topics' : 'profile',
  }
}
