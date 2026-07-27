interface ScrollToHashOptions {
  instant?: boolean
  focusTarget?: boolean
}

const MIN_SCROLL_DURATION_MS: number = 200
const MAX_SCROLL_DURATION_MS: number = 400
const SCROLL_DURATION_MS_PER_1000PX: number = 300

// Distance-proportional with a cap, not fixed: NN/g places perceptible-but
// -not-jarring UI motion at roughly 200-400ms and calls 500ms+ "a real drag"
// (nngroup.com/articles/animation-duration), and a fixed duration can't
// satisfy both ends of this app's page lengths -- a short in-page hop needs
// the 200ms floor to read as motion at all, while a jump the length of the
// ~10 000px privacy-policy page needs the 400ms ceiling or it crawls at the
// UA-defined pace native `scrollIntoView({behavior:'smooth'})` used to pick.
// The 300ms-per-1000px scaling factor and easeInOutCubic (accelerate into
// the jump, decelerate into the landing) both match the everyday defaults
// real anchor-scroll libraries ship for this exact case (e.g.
// cferdinandi/smooth-scroll's `speed` option and its default easing).
function getScrollDuration(distance: number): number {
  const proportional = (Math.abs(distance) / 1000)
    * SCROLL_DURATION_MS_PER_1000PX

  return Math.min(
    MAX_SCROLL_DURATION_MS,
    Math.max(MIN_SCROLL_DURATION_MS, proportional),
  )
}

function easeInOutCubic(progress: number): number {
  if (progress < 0.5) {
    return 4 * progress * progress * progress
  }

  return 1 - (-2 * progress + 2) ** 3 / 2
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface InFlightScrollAnimation {
  frameId: number
  previousBehavior: string
}

const inFlightScrollAnimations
  = new WeakMap<HTMLElement, InFlightScrollAnimation>()

function cancelScrollAnimation(scroller: HTMLElement): void {
  const inFlight = inFlightScrollAnimations.get(scroller)

  if (!inFlight) {
    return
  }

  cancelAnimationFrame(inFlight.frameId)
  scroller.style.scrollBehavior = inFlight.previousBehavior
  inFlightScrollAnimations.delete(scroller)
}

// A second anchor click while this is in flight calls this again for the
// same scroller -- cancelling the previous rAF loop and restarting from
// whatever scrollTop it left off at (rather than the interrupted target)
// is what makes the second click win cleanly instead of the two fighting.
function animateScrollTop(scroller: HTMLElement, targetTop: number): void {
  cancelScrollAnimation(scroller)

  const startTop = scroller.scrollTop
  const distance = targetTop - startTop
  const duration = getScrollDuration(distance)
  const startTime = performance.now()
  // The container carries `motion-safe:scroll-smooth` (app.vue), and per
  // CSSOM-View assigning scrollTop honours `scroll-behavior` -- each frame
  // would start its own smooth scroll that the next frame interrupts, so the
  // rAF loop has to own the scrolling outright while it runs.
  const previousBehavior = scroller.style.scrollBehavior

  scroller.style.scrollBehavior = 'auto'

  function step(now: number) {
    const progress = Math.min(1, (now - startTime) / duration)

    scroller.scrollTop = startTop + distance * easeInOutCubic(progress)

    if (progress >= 1) {
      scroller.style.scrollBehavior = previousBehavior
      inFlightScrollAnimations.delete(scroller)

      return
    }

    inFlightScrollAnimations.set(scroller, {
      frameId: requestAnimationFrame(step),
      previousBehavior,
    })
  }

  inFlightScrollAnimations.set(scroller, {
    frameId: requestAnimationFrame(step),
    previousBehavior,
  })
}

function getScrollMarginTopPx(target: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0
}

// Mirrors what native `scrollIntoView({block: 'start'})` on a scrollable
// ancestor already does for free, since hand-rolling the scroll means
// losing that for free -- read the resolved `scroll-margin-top` (whether it
// comes from `prose-headings:scroll-mt-24` or the `landing-anchor` utility's
// runtime `--landing-header-offset` var) rather than assuming either one, so
// the target still lands below the sticky header instead of behind it.
function getScrollTargetTop(
  scroller: HTMLElement,
  target: HTMLElement,
): number {
  const offsetWithinScroller = target.getBoundingClientRect().top
    - scroller.getBoundingClientRect().top

  const rawTargetTop = scroller.scrollTop + offsetWithinScroller
    - getScrollMarginTopPx(target)

  return Math.max(
    0,
    Math.min(rawTargetTop, scroller.scrollHeight - scroller.clientHeight),
  )
}

// vue-router's hash scrollBehavior calls window.scrollTo, a no-op since
// html/body are `position: fixed` -- scroll the real `.overflow-y-auto`
// ancestor (app.vue) directly instead.
export function scrollToHash(
  hash: string,
  options: ScrollToHashOptions = {},
): boolean {
  if (!hash || hash.length < 2) {
    return false
  }

  const target = document.getElementById(decodeURIComponent(hash.slice(1)))

  if (!target) {
    return false
  }

  const scroller = target.closest<HTMLElement>('.overflow-y-auto')
  const instant = options.instant || prefersReducedMotion()

  if (!scroller) {
    target.scrollIntoView({ block: 'start' })
  } else if (instant) {
    cancelScrollAnimation(scroller)

    const previousBehavior = scroller.style.scrollBehavior

    scroller.style.scrollBehavior = 'auto'
    target.scrollIntoView({ block: 'start' })
    scroller.style.scrollBehavior = previousBehavior || ''
  } else {
    animateScrollTop(scroller, getScrollTargetTop(scroller, target))
  }

  if (options.focusTarget) {
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1')
    }

    target.focus({ preventScroll: true })
  }

  return true
}

function getSameHashHref(element: EventTarget | null): string | null {
  const anchor = (element as HTMLElement | null)?.closest?.('a[href^="#"]')
  const href = anchor?.getAttribute('href')

  return href && href.length > 1 ? href : null
}

interface UseHashAnchorScrollReturn {
  onAnchorClick: (event: MouseEvent) => Promise<void>
}

// Bind with `@click.capture`. Once scrollToHash adds tabindex="-1" to a
// target, NuxtLink's own handler (`getElementById(hash)?.focus()`, no
// preventScroll) turns live and fights this scroll -- it must lose the race
// to this listener.
export function useHashAnchorScroll(): UseHashAnchorScrollReturn {
  const router = useRouter()
  const route = useRoute()

  watch(() => route.hash, (hash) => {
    scrollToHash(hash, { focusTarget: true })
  })

  onMounted(async () => {
    await nextTick()

    if (route.hash) {
      scrollToHash(route.hash, { instant: true, focusTarget: true })
    }
  })

  async function onAnchorClick(event: MouseEvent) {
    const hash = getSameHashHref(event.target)

    if (!hash) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (hash === route.hash) {
      scrollToHash(hash, { focusTarget: true })

      return
    }

    // Best-effort guard against a known race: the browser can scroll the
    // container to wherever the clicked anchor itself sits in the document
    // (a deferred "scroll the newly-focused element into view" side effect)
    // moments after this handler runs, which would otherwise overwrite the
    // entry we're leaving with that transient position. This repairs it
    // when the deferred jump lands before this call; it does not when the
    // jump is delayed past it -- see the scroll-restoration note in
    // app/router.options.ts for the characterized (not fully fixed) case.
    reassertLastSettledScrollPosition()

    try {
      await router.push(hash)
    } catch {
      scrollToHash(hash, { focusTarget: true })
    }
  }

  return { onAnchorClick }
}

// app.vue marks the real scroll container with this aria attribute pair
// whenever the route isn't the chat page (which owns its own container --
// see chat-scroll-spacer.ts). Falling back to `.overflow-y-auto` keeps this
// working even if that marker is ever renamed, since the wrapper is always
// the first such element in document order (an ancestor of every nested
// `.overflow-y-auto` scroller, and rendered before the ClientOnly siblings
// in app.vue).
export function getMainScrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="region"][aria-label="Page content"]',
  ) || document.querySelector<HTMLElement>('.overflow-y-auto')
}

interface ScrollHistoryState {
  scrollKey?: number
}

// vue-router (and even native anchor-jump history entries it never
// touched) keeps whatever we stash in `history.state` per entry, restoring
// it verbatim on back/forward -- so tagging each entry ourselves here
// sidesteps vue-router's own `position` bookkeeping entirely (which isn't
// guaranteed for entries it didn't create) as the key for
// containerScrollPositions below.
let scrollKeySequence: number = 0

function getOrAssignScrollKey(): number {
  const state = (window.history.state || null) as ScrollHistoryState | null

  if (typeof state?.scrollKey === 'number') {
    return state.scrollKey
  }

  scrollKeySequence += 1

  window.history.replaceState(
    { ...state, scrollKey: scrollKeySequence },
    '',
  )

  return scrollKeySequence
}

const containerScrollPositions = new Map<number, number>()
let isTrackingContainerScroll: boolean = false

// Debounced "quiet" scrollTop, distinct from containerScrollPositions'
// live-per-scroll-event bookkeeping -- see reassertLastSettledScrollPosition
// below for why a transient (not-yet-settled) position must never be read
// back through this one.
let lastSettledScrollTop: number = 0
let settleTimeoutId: ReturnType<typeof setTimeout> | null = null
const SETTLE_DEBOUNCE_MS: number = 150

// Lazily attaches a single scroll listener the first time the container
// exists. Safe to call on every navigation -- app.vue's wrapper div is a
// stable DOM node across in-app navigation (only its class/attrs change
// reactively), so one listener covers the whole session.
export function trackContainerScrollPosition(): void {
  if (isTrackingContainerScroll) {
    return
  }

  const container = getMainScrollContainer()

  if (!container) {
    return
  }

  isTrackingContainerScroll = true
  lastSettledScrollTop = container.scrollTop

  container.addEventListener('scroll', () => {
    containerScrollPositions.set(getOrAssignScrollKey(), container.scrollTop)

    if (settleTimeoutId !== null) {
      clearTimeout(settleTimeoutId)
    }

    settleTimeoutId = setTimeout(() => {
      lastSettledScrollTop = container.scrollTop
      settleTimeoutId = null
    }, SETTLE_DEBOUNCE_MS)
  }, { passive: true })
}

// See onAnchorClick's caller-side comment: this repairs the entry being
// left often enough to be worth keeping, but is not a complete fix.
function reassertLastSettledScrollPosition(): void {
  containerScrollPositions.set(getOrAssignScrollKey(), lastSettledScrollTop)
}

// Forcing the inline style (rather than trusting the explicit `behavior:
// 'instant'` scrollTo option alone) matters here: a hash click just before
// a back/forward navigation can leave a CSS `scroll-smooth`-driven animation
// still converging on the old target, and it otherwise keeps winning the
// next couple of frames -- the same race scrollToHash's `instant` option
// already guards against.
function scrollContainerInstant(container: HTMLElement, top: number): void {
  cancelScrollAnimation(container)

  const previousBehavior = container.style.scrollBehavior

  container.style.scrollBehavior = 'auto'
  container.scrollTo({ top, behavior: 'instant' })
  container.style.scrollBehavior = previousBehavior || ''
}

export function restoreContainerScrollPosition(): boolean {
  const container = getMainScrollContainer()

  if (!container) {
    return false
  }

  const state = (window.history.state || null) as ScrollHistoryState | null

  if (typeof state?.scrollKey !== 'number') {
    return false
  }

  const scrollTop = containerScrollPositions.get(state.scrollKey)

  if (scrollTop === undefined) {
    return false
  }

  scrollContainerInstant(container, scrollTop)

  return true
}

export function scrollContainerToTop(): boolean {
  const container = getMainScrollContainer()

  if (!container) {
    return false
  }

  scrollContainerInstant(container, 0)

  return true
}
