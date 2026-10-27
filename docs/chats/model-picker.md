# Chat input: the model picker

The model button in the chat input toolbar opens the picker. At
`min-width: 48rem` it is a dropdown above the button. Below that it is a
bottom sheet that matches the "+" tools sheet
(`docs/chats/chat-input-tools-menu.md`).

## Components

| Piece | File |
|---|---|
| Trigger, dropdown shell, bottom sheet shell | `app/components/ChatInput/ModelsTrigger.vue` |
| Search, filters, rails, list, gateway row (both shells) | `app/components/ChatInput/ModelsTrigger/Panel.vue` |
| Desktop filter dropdown | `ModelsTrigger/FilterDropdown.vue` |
| Sheet filter chips | `ModelsTrigger/FilterSection.vue` |
| Provider rail (vertical) or chip row (sheet) | `ModelsTrigger/ProviderRail.vue`, `ModelsTrigger/GatewayProviderRail.vue` |
| Gateway row | `ModelsTrigger/GatewayRail.vue` |
| Keyboard height | `app/composables/visual-viewport-inset.ts` |

`Panel.vue` also runs inside the memory settings model modal
(`Profile/Memory/ModelPicker.client.vue`). Every sheet difference sits behind
its `layout` prop (`'popover' | 'sheet'`, default `'popover'`), so that modal
and the desktop dropdown render exactly as before.

## Layout switch

Both menus call `useMediaQuery('(min-width: 48rem)')`. The query is written
out in `ModelsTrigger.vue` and `ToolsMenu.client.vue` rather than shared,
because the tools menu was being changed in parallel. Change both together,
or extract one composable, so the two menus never flip at different widths.
Crossing the breakpoint while the picker is open (rotation, a resized
window) closes it.

## The sheet

- A `<dialog class="modal modal-bottom">` opened with `showModal()`: focus is
  trapped, the page is inert and scroll-locked (daisyUI). The box has the
  tools sheet chrome: grab handle, a "Models" title that labels the dialog,
  a close button, `rounded-t-box rounded-b-none`.
- Its height is fixed at `85dvh`, not a max height. With a max height the
  sheet shrank from the top while a search narrowed the list, so the search
  field moved down under the finger.
- The box itself is focused on open (`autofocus` + `tabindex="-1"`), never
  the search field. Focusing the field would open the iOS keyboard over most
  of the list before the user has seen it. The dropdown keeps focusing search
  on desktop devices.
- Fixed header: search with the filter toggle, the inline filter chips when
  open, and the provider chip row. Only the model list scrolls
  (`overscroll-contain`, edge fades from `useScrollEdgeFade`). The gateway
  row is a fixed footer, padded for the iOS safe area, so it is always
  reachable; at 375 px its buttons scroll sideways and fade at the hidden
  edge.
- The keyboard highlight (the gray row that arrow keys and Enter act on)
  shows only while the search field has focus. Without it, a gray row next
  to the accent-colored selected row read as a second selection on touch.
  The dropdown keeps showing it.
- `dvh` follows the browser toolbars but not the on-screen keyboard. While
  the visual viewport is at least 120 px shorter than the window
  (`useVisualViewportInset`), the box is lifted by the covered height, sized
  to 85% of what stays visible, and the footer drops its safe-area padding.
  The viewport meta was not changed to `interactive-widget=resizes-content`:
  it is global and `ChatInput.client.vue` already moves itself for the
  keyboard. This lift has not been tried on a real iOS device yet.

### Filters

The desktop filter is a nested `<details>` dropdown. In the sheet it would be
clipped by the scroll area, depend on hover and close on outside clicks, so
the sheet shows a toggle button instead. It opens an inline row of chips
under the search (categories, Vision only, gateway capabilities, Clear) that
pushes the list down. Chips toggle in place and the row stays open until the
toggle is tapped again, so several filters can be combined. The test ids
match the dropdown items.

### Provider rail

The vertical rail with count badges becomes one horizontal, scrollable row of
`btn-sm` chips (icon plus count, a dot for a missing key, a star for
favorites), faded at the edge that hides chips. As on desktop, it hides while
a search is active.

### What closes it

Only the backdrop, the close button, Escape (or the Android back gesture) and
picking a model. All of them return focus to the model button.

- Escape and back both arrive as the dialog's `cancel` event. The panel first
  unwinds an open model detail, then the filter chips, then the search
  (`Panel.handleEscape()`), and calls `preventDefault()` only when it did
  something. Chrome makes a repeated `cancel` without new user activation
  uncancelable, so the back gesture can never be trapped.
- The window-level Escape handler and the outside-click handler only act in
  dropdown mode. Filter changes, the keyboard opening and resizes do not
  close the sheet.
- The picker and the tools menu share `useState('chat-input:open-popover')`,
  so opening one closes the other.

Model details (the info button) render inline under their row, so they
scroll with the list and are never clipped.

## Tests

- `tests/unit/components/ChatInput/ModelsTrigger.sheet.spec.ts`: sheet
  chrome, no search focus, inline filters, every close path, the cancel
  unwinding, the breakpoint flip, the keyboard lift.
- `tests/unit/components/ChatInput/ModelsTrigger/FilterSection.spec.ts` and
  the `sheet layout` blocks in the Panel and rail specs.
- `tests/e2e/chat/models-picker.spec.ts`: dropdown at 1280 px, sheet at
  375 px (filters, search, Escape, close button, backdrop, model pick).
