# iOS Keyboard Debugging Guide

## What was added

Manual debugging helpers were added to the app:

- `app/components/DeviceKeyboardObserver.client.vue`
- `app/components/DeviceKeyboardDebug.client.vue`
- `app/composables/device-keyboard.ts`

These are not test-only helpers.

They are meant for real-device debugging too, especially on iPhone Safari and
installed PWA mode.

## How to enable the debug overlay

Open the app with this query param:

```text
?keyboard-debug=1
```

Examples:

```text
/chats/new?keyboard-debug=1
/chats/history?keyboard-debug=1
/chats/projects?keyboard-debug=1
```

If you are already on a page with query params, append it with `&`:

```text
/chats/new?projectId=abc&keyboard-debug=1
```

## Where the overlay appears

The overlay is rendered in the top-left area of the screen.

It is intentionally small and non-interactive:

- dark background
- white text
- `pointer-events: none`

So it should stay visible while you type without blocking taps.

## What the overlay shows

- `keyboard`
  - `open` or `closed`
- `height`
  - computed keyboard height in px
- `vvh`
  - visual viewport height
- `vv offset top`
  - visual viewport top offset
- `lvh`
  - layout viewport height
- `focus top`
  - top of the currently focused editable element
- `focus bottom`
  - bottom of the currently focused editable element

## What the values mean

### `keyboard: open`

This means:

- an editable element is focused
- computed keyboard height is above the threshold used by the app

### `height`

This is calculated roughly as:

```text
layout viewport height - (visual viewport height + visual viewport offset top)
```

If Safari shrinks the visual viewport when the keyboard opens, this value should
increase.

### `focus bottom`

This is the most useful number for overlap debugging.

If `focus bottom` is larger than the visible bottom edge of the visual
viewport, the focused control is effectively under the keyboard or too close to
it.

## Recommended manual test flow

### 1. Test Safari first

Open:

```text
/chats/new?keyboard-debug=1
```

Then:

- tap the chat textarea
- watch whether `keyboard` changes to `open`
- see whether `height` becomes non-zero
- see whether the textarea remains visible without manual scroll

### 2. Test the affected dialogs

Open with `?keyboard-debug=1`, then try:

- rename chat
- create project
- rename project
- rename file

For each one:

- open the dialog
- wait for the input to auto-focus
- see if the bottom sheet stays above the keyboard
- if not, check the overlay values

### 3. Test installed PWA mode

Repeat the same tests from the installed app icon on iPhone.

That matters because iOS PWA behavior can differ from Safari tab behavior.

## What to record while testing

If the bug still happens, note:

- page and interaction
- Safari or installed PWA
- device model
- whether the overlay said `keyboard: open`
- `height`
- `vvh`
- `focus bottom`
- whether manual scrolling fixed it

## Current limitation

The overlay helps confirm whether the browser resized the visual viewport and
where the focused field ended up.

It does not automatically prove the root cause by itself.

It is mainly for:

- reproducing the issue consistently
- comparing Safari vs PWA behavior
- checking whether a code change actually improved the keyboard geometry
