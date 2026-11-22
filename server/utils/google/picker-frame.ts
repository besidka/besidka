import type { H3EventContext } from 'h3'
import {
  evaluateFeature,
  isFeatureActive,
} from '~~/server/utils/features/evaluate'
import type { FeatureRequestContext } from '~~/server/utils/features/context'

const GOOGLE_DRIVE_FLAG = 'google.drive'

/**
 * Whether a chat document may frame Google's Picker. Needs the public Picker
 * key (without it the Picker cannot run). The page render has usually loaded
 * the user's feature state already (the SSR features plugin calls
 * `/api/v1/features` with the page's event context, which memoizes it on
 * `event.context.features`), so when it is there the answer is read from
 * memory: the source is sent only to a user whose `google.drive` flag is
 * active, with no extra D1 or KV read. When the render left no feature state
 * on the event (not confirmed for every render path), the answer falls back
 * to the key alone; this function never loads the state itself, so the
 * per-request cost stays zero either way. A state that cannot be read or
 * evaluated answers no.
 */
export async function isGooglePickerFrameAllowed(
  event: { context: unknown },
  apiKey: unknown,
): Promise<boolean> {
  if (typeof apiKey !== 'string' || apiKey === '') {
    return false
  }

  const memoized = (event.context as H3EventContext).features as
    | Promise<FeatureRequestContext>
    | undefined

  if (!memoized) {
    return true
  }

  try {
    const featureContext = await memoized
    const resolution = await evaluateFeature(GOOGLE_DRIVE_FLAG, featureContext)

    return isFeatureActive(
      GOOGLE_DRIVE_FLAG,
      resolution,
      featureContext.userState,
    )
  } catch {
    return false
  }
}
