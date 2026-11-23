import {
  GOOGLE_BYO_CAPABILITIES,
  getGoogleByoScopes,
} from '#shared/utils/google-byo'
import type { GoogleByoCapability } from '#shared/utils/google-byo'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import type { GoogleScope } from '#shared/utils/google-scopes'

export const GOOGLE_BYO_GUIDE_SUMMARY = 'How to set up your own Google client'

const GOOGLE_CLOUD_CONSOLE_ORIGIN = 'https://console.cloud.google.com'

export interface GoogleByoGuideLink {
  label: string
  url: string
}

export const GOOGLE_CLOUD_CONSOLE_LINKS = {
  createProject: {
    label: 'Create a project',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/projectcreate`,
  },
  branding: {
    label: 'Branding',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/auth/branding`,
  },
  audience: {
    label: 'Audience',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/auth/audience`,
  },
  dataAccess: {
    label: 'Data access',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/auth/scopes`,
  },
  clients: {
    label: 'Clients',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/auth/clients`,
  },
} as const satisfies Record<string, GoogleByoGuideLink>

export interface GoogleByoGuideApi extends GoogleByoGuideLink {
  capabilities: readonly GoogleByoCapability[]
}

export const GOOGLE_BYO_GUIDE_APIS: readonly GoogleByoGuideApi[] = [
  {
    label: 'Gmail API',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/apis/library/gmail.googleapis.com`,
    capabilities: ['gmail-read', 'gmail-compose'],
  },
  {
    label: 'Google Calendar API',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/apis/library/calendar-json.googleapis.com`,
    capabilities: ['calendar'],
  },
  {
    label: 'Google Drive API',
    url: `${GOOGLE_CLOUD_CONSOLE_ORIGIN}/apis/library/drive.googleapis.com`,
    capabilities: ['drive-read', 'drive-write'],
  },
]

export const GOOGLE_BYO_GUIDE_SIGN_IN_SCOPES: readonly GoogleScope[] = [
  GOOGLE_SCOPES.openid,
  GOOGLE_SCOPES.email,
]

const GOOGLE_BYO_GUIDE_CAPABILITY_LABELS: Readonly<
  Record<GoogleByoCapability, string>
> = {
  'drive-read': 'Google Drive, read only',
  'drive-write': 'Google Drive, change files',
  'gmail-read': 'Gmail, read only',
  'gmail-compose': 'Gmail drafts',
  'calendar': 'Google Calendar (both scopes)',
}

export interface GoogleByoGuideScopeGroup {
  capability: GoogleByoCapability
  label: string
  scopes: GoogleScope[]
}

/**
 * The scopes the guide lists per capability, taken from the same map the
 * start route uses, so the guide cannot name a scope Besidka does not ask
 * for or leave one out.
 */
export function getGoogleByoGuideScopeGroups(): GoogleByoGuideScopeGroup[] {
  return GOOGLE_BYO_CAPABILITIES.map((capability) => {
    return {
      capability,
      label: GOOGLE_BYO_GUIDE_CAPABILITY_LABELS[capability],
      scopes: getGoogleByoScopes([capability]),
    }
  })
}
