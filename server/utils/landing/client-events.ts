import { z } from 'zod'
import type {
  AnalyticsSurface,
  ClientEventTrigger,
  ClientLandingEventName,
  LandingEventData,
} from '#shared/types/analytics.d'
import { providerMeta } from '#shared/utils/provider-meta'

export const CLIENT_ALLOWED_EVENTS = new Set<ClientLandingEventName>([
  'landing_page_view',
  'cta_click',
  'header_cta_click',
  'footer_link_click',
  'video_play',
  'video_complete',
  'github_click',
  'key_guide_open',
  'key_guide_video_play',
  'guide_video_play',
  'video_watch',
])

export const DEMO_VIDEO_TARGET = 'demo'

export const EXPLAINER_VIDEO_TARGETS: ReadonlySet<string> = new Set([
  'memory',
])

const PROVIDER_TARGET_EVENTS = new Set<ClientLandingEventName>([
  'key_guide_open',
  'key_guide_video_play',
])

const EXPLAINER_TARGET_EVENTS = new Set<ClientLandingEventName>([
  'guide_video_play',
])

const VIDEO_TRIGGER_EVENTS = new Set<ClientLandingEventName>([
  'video_play',
  'key_guide_video_play',
  'guide_video_play',
  'video_watch',
])

const KEY_GUIDE_OPEN_EVENT: ClientLandingEventName = 'key_guide_open'

const HAS_TRIGGER_EVENTS = new Set<ClientLandingEventName>([
  ...VIDEO_TRIGGER_EVENTS,
  KEY_GUIDE_OPEN_EVENT,
])

const SURFACE_BY_PATH = new Map<string, AnalyticsSurface>([
  ['/', 'home'],
  ['/byok', 'byok'],
  ['/memory', 'memory'],
  ['/profile/keys', 'keys'],
  ['/privacy-policy', 'legal'],
  ['/terms-of-use', 'legal'],
  ['/cookie-policy', 'legal'],
])

const GUIDE_PATH_PATTERN = /^\/guides\/[a-z0-9-]{1,64}$/

const MAX_VIDEO_SECONDS = 86400

const WATCHED_SECONDS_TOLERANCE = 1

const SECONDS_PRECISION = 10

const LOGGABLE_TARGET_PATTERN = /^[a-z0-9/_#.:-]{1,100}$/

const VALIDATED_TARGET_EVENTS = new Set<ClientLandingEventName>([
  ...PROVIDER_TARGET_EVENTS,
  ...EXPLAINER_TARGET_EVENTS,
  'video_watch',
])

function stripTrailingSlash(path: unknown): unknown {
  if (typeof path === 'string' && path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1)
  }

  return path
}

export function resolveSurface(
  path: string | undefined,
): AnalyticsSurface | undefined {
  if (!path) {
    return undefined
  }

  if (GUIDE_PATH_PATTERN.test(path)) {
    return 'guide'
  }

  return SURFACE_BY_PATH.get(path)
}

export const clientPathSchema = z.preprocess(
  stripTrailingSlash,
  z.string().refine((path) => {
    return resolveSurface(path) !== undefined
  }),
)

export const videoTriggerSchema = z.enum(['autoplay', 'user'])

export const keyGuideOpenTriggerSchema = z.enum(['auto', 'user'])

export const clientTriggerSchema = z.union([
  videoTriggerSchema,
  keyGuideOpenTriggerSchema,
])

export const videoWatchEndReasonSchema = z.enum([
  'pause',
  'ended',
  'hidden',
  'offscreen',
  'unmount',
])

export const videoSecondsSchema = z.number()
  .finite()
  .min(0)
  .max(MAX_VIDEO_SECONDS)

export const completionPercentSchema = z.number().int().min(0).max(100)

export function isProviderTarget(target: string | undefined): boolean {
  return !!target && Object.hasOwn(providerMeta, target)
}

export function isExplainerVideoTarget(target: string | undefined): boolean {
  return !!target && EXPLAINER_VIDEO_TARGETS.has(target)
}

export function validateClientEventTarget(
  name: ClientLandingEventName,
  target: string | undefined,
): string | undefined {
  if (PROVIDER_TARGET_EVENTS.has(name) && !isProviderTarget(target)) {
    return `Event "${name}" needs a known provider id as its target`
  }

  if (EXPLAINER_TARGET_EVENTS.has(name) && !isExplainerVideoTarget(target)) {
    return `Event "${name}" needs a known explainer page as its target`
  }

  if (
    name === 'video_watch'
    && target !== DEMO_VIDEO_TARGET
    && !isProviderTarget(target)
    && !isExplainerVideoTarget(target)
  ) {
    return `Event "${name}" needs "${DEMO_VIDEO_TARGET}", a known provider id or a known explainer page as its target`
  }

  return undefined
}

export function validateClientEventTrigger(
  name: ClientLandingEventName,
  trigger: ClientEventTrigger | undefined,
): string | undefined {
  if (trigger === undefined) {
    return undefined
  }

  if (name === KEY_GUIDE_OPEN_EVENT) {
    return keyGuideOpenTriggerSchema.safeParse(trigger).success
      ? undefined
      : `Event "${name}" accepts trigger "auto" or "user"`
  }

  if (VIDEO_TRIGGER_EVENTS.has(name)) {
    return videoTriggerSchema.safeParse(trigger).success
      ? undefined
      : `Event "${name}" accepts trigger "autoplay" or "user"`
  }

  return undefined
}

export function validateVideoWatchFields(
  name: ClientLandingEventName,
  data: LandingEventData,
): string | undefined {
  if (name !== 'video_watch') {
    return undefined
  }

  const missingFields = [
    'trigger',
    'watchedSeconds',
    'durationSeconds',
    'completionPercent',
    'endReason',
  ].filter((field) => {
    return data[field as keyof LandingEventData] === undefined
  })

  if (missingFields.length) {
    return `Event "${name}" is missing: ${missingFields.join(', ')}`
  }

  if (
    data.watchedSeconds! > data.durationSeconds! + WATCHED_SECONDS_TOLERANCE
  ) {
    return `Event "${name}" reports more watched seconds than the video duration`
  }

  return undefined
}

function roundSeconds(seconds: number): number {
  return Math.round(seconds * SECONDS_PRECISION) / SECONDS_PRECISION
}

function resolveLoggableTarget(
  name: ClientLandingEventName,
  target: string | undefined,
): string | undefined {
  if (!target) {
    return undefined
  }

  if (VALIDATED_TARGET_EVENTS.has(name)) {
    return target
  }

  return LOGGABLE_TARGET_PATTERN.test(target) ? target : undefined
}

export function buildClientEventAttributes(
  name: ClientLandingEventName,
  data: LandingEventData,
): Record<string, unknown> {
  const isWatchEvent = name === 'video_watch'
  const target = resolveLoggableTarget(name, data.target)
  const surface = resolveSurface(data.path)

  return {
    ...(target && { target }),
    ...(surface && { surface }),
    ...(data.path && { path: data.path }),
    ...(HAS_TRIGGER_EVENTS.has(name) && data.trigger && {
      trigger: data.trigger,
    }),
    ...(isWatchEvent && data.watchedSeconds !== undefined && {
      watchedSeconds: roundSeconds(data.watchedSeconds),
    }),
    ...(isWatchEvent && data.durationSeconds !== undefined && {
      durationSeconds: roundSeconds(data.durationSeconds),
    }),
    ...(isWatchEvent && data.completionPercent !== undefined && {
      completionPercent: data.completionPercent,
    }),
    ...(isWatchEvent && data.endReason && { endReason: data.endReason }),
  }
}
