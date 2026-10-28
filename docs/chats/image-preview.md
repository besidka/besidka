# Image preview modal

`app/components/Chat/ImagePreview.client.vue` is the full-size image modal
opened from generated and attached images. Zoom lives in
`app/composables/image-zoom.ts` (`useImageZoom`).

## Why `@panzoom/panzoom` and not native zoom

The global viewport meta in `nuxt.config.ts` is
`width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no`.
iOS Safari tabs ignore it, but the installed home-screen PWA honours it, so
native pinch zoom works in one and not the other. The modal therefore owns
its zoom. Do not loosen the viewport meta to fix this: it is global and would
change every page.

`@panzoom/panzoom` is already a dependency (`prose/MermaidViewer.client.vue`).
It handles pointer-event pinch and pan; wheel and double-tap are added by the
composable.

## Structure

The zoom target is a surface that fills the modal body (`absolute inset-0`,
`touch-none`) and centres the `<img>` (`object-contain`). The image is not the
target, so `contain: 'outside'` clamps against the body: at fit scale the
surface equals the body, so there is nothing to pan, and zoomed in the
surface can never leave the body. `touch-action: none` is set on the surface
and its parent (the body) only, never on the header buttons.

## Gestures

| Input | Behaviour |
| --- | --- |
| Pinch (touch) | zoom, min 1 (fit), max 5 |
| Drag | pan, only while zoomed |
| Wheel / trackpad pinch (`ctrl` wheel) | zoom about the cursor |
| Double tap (touch) / double click (mouse) | fit to 2.5x on the tapped point, or back to fit when already zoomed |

Double tap and double click share one detector
(`createDoubleTapDetector`): two `pointerup` events of the same
`pointerType` within 300 ms and 25 px. It ignores secondary mouse buttons,
drags longer than 25 px, and any gesture that involved a second pointer
(pinch), so a pinch never ends in a zoom toggle. There is no `dblclick`
listener, which would double-fire on touch browsers that synthesise it.

Zooming in is instant (`zoomToPoint` cannot animate); resetting to fit
animates unless `prefers-reduced-motion: reduce` is set.

## Reset rules

Panzoom is created when the dialog becomes visible and again whenever `src`
changes (a fresh instance starts at scale 1). It is destroyed (after a
non-animated reset) when the dialog closes and on unmount, so reopening
always starts at fit.

## Known limits

- The surface is the clamp box, so the letterbox bars around a
  non-matching aspect ratio can be panned into view when zoomed; the image
  itself never leaves the viewport.
- Rotating the device while zoomed is re-clamped on the next pan, not
  immediately.
