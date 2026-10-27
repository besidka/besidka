# Chat input: the "+" tools menu and setting tiles

The chat input toolbar holds only the model picker, one "+" button and send.
Everything else (files, web search, reasoning, image creation, project,
memory) lives in one menu behind "+", and any setting that differs from its
default shows as a tile at the start of the attachments row.

## Components

| Piece | File |
|---|---|
| Shell, state and all mutation logic | `app/components/ChatInput.client.vue` |
| "+" button, desktop popover, mobile bottom sheet | `app/components/ChatInput/ToolsMenu.client.vue` |
| The one section list used by both shells | `app/components/ChatInput/ToolsMenu/Content.vue` |
| Rows and controls | `ToolsMenu/Section.vue`, `ActionRow.vue`, `ToggleRow.vue`, `Segmented.vue`, `InfoNote.vue`, `InlineButton.vue` |
| Animated show/hide wrapper | `ToolsMenu/Reveal.vue` |
| Reveal guard and focus rescue | `app/composables/reveal-guard.ts`, `app/composables/tools-menu-focus-rescue.ts` |
| Web search and reasoning sections | `ToolsMenu/WebSearchSection.vue` (renders its own `Section`, so the price badge can sit in the section header), `ToolsMenu/ReasoningSection.vue` |
| A setting tile | `app/components/ChatInput/SettingTile.vue` |
| The row that holds tiles, files and Detach all | `app/components/ChatInput/Files/Attached/Preview.client.vue` |
| Which tiles show, and their copy | `app/utils/chat-input-tiles.ts` (`buildChatInputTiles`) |
| Types | `app/types/chat-input-tools.d.ts` |

`ChatInput.client.vue` builds one `ChatInputToolsState` object. The menu and
the tile builder only read it; every change goes back through ChatInput's
existing handlers (`selectWebSearchProvider`, `toggleImageGeneration`, the
clamp and restore watchers), so capability gating has one owner.

## Shells

- At `min-width: 48rem` (`useMediaQuery`, so a narrowed desktop window gets
  the sheet too) the menu is a popover above "+": `role="dialog"`,
  `aria-modal="false"`, Escape and an outside click close it, focus returns
  to the element that opened it, and tabbing out closes it. Its max height is
  the space above "+" minus a 12 px margin, so the full menu fits a normal
  window; when it cannot, the scroll area fades at whichever edge hides rows
  (`useScrollEdgeFade`), so no row is ever cut without a fade.
- Below that it is a `<dialog class="modal modal-bottom">` opened with
  `showModal()`, which traps focus and makes the page inert. Its header
  repeats the active tiles as small chips with full text and a remove button,
  on one line that fades at the right when it overflows; with no tiles the
  chip row is not rendered, and when it appears or goes the scroll offset
  absorbs its height so the tapped control stays put. The scroll area pads
  its bottom by at least the iOS safe area.
- Radios and toggles keep the menu open. Rows that open a modal (attach,
  library, generated images, project) close it first.
- The menu and the model picker share `useState('chat-input:open-popover')`,
  so opening one closes the other.
- Clicking a tile opens the menu at that tile's section, scrolls it into
  view and highlights it briefly.
- Focus depends on how the menu was opened. From the keyboard it goes to the
  first control, or to the section's checked radio. From a pointer or touch it
  goes to the panel or sheet container (`tabindex="-1"`, no outline), so no
  item looks focused after a tap.

## Tiles

Tiles use the file tile geometry (`size-16 rounded-box`, `gap-1.5`, the 16 px
remove button at `top-1 right-1`). With no tiles and no files the row is not
rendered. The row scrolls sideways (a vertical mouse wheel scrolls it too),
and when more is hidden on the right it fades out there, unless the sticky
Detach all button already marks that edge. Order and rules:

| Tile | Shown when | Remove (x) |
|---|---|---|
| Project | a project is attached | clears the project |
| Memory off (neutral gray, `lucide:book-x`) | a new chat excludes memory | turns memory back on |
| Deep research | the model is a deep research model | none |
| Image | image creation is on or required | turns it off, none when required |
| Web search | a provider is selected; the icon is the provider, "Auto search" plus a sparkle badge while Auto is active | turns search off (and saves Off as the new-chat default, as before) |
| Reasoning | the level differs from the effective default (below) | none, tapping opens the Reasoning section |

No tile renders until `isModelCapabilityResolved` is true, and the search and
reasoning tiles follow their sections' visibility (hidden for deep research
and while image creation is on or required). This keeps the race-sampler
guarantee in `tests/e2e/chat/gateway-image-generation.spec.ts`.

## Default reasoning level

Picking a level in the menu changes only the current chat and does not
write `settings_reasoning_level`. The effective default is
`resolveInitialReasoningLevel(useUserSetting().defaultReasoningLevel,
legacy localStorage value)`, the same helper `chats/new.vue`,
`composables/chat.ts` and the Preferences page use. When nothing is saved it
resolves to the product default, Off.

- The Reasoning tile compares the level the model will actually use against
  that effective default. A model that cannot honour the default (for
  example one that cannot stop reasoning while the default is Off) therefore
  shows the tile. That is intended: it is the case where the tile tells the
  user something.
- Settings load asynchronously, so on a full page load the page seeds the
  level before the saved default is known. ChatInput follows the default
  when it arrives, until the user picks a level for this chat.
- The Reasoning section offers "Save X as default" as an inline link in a
  fixed-height caption under the level segments (see "Reasoning caption").
  Saving calls `setDefaultReasoningLevel(level)` and the tile disappears.
- "Show steps expanded" and "Auto-hide when done" are hidden until they can
  act (see "Hidden rows and animated reveals").

## Design: controls appear only when they can act

A control is revealed only when it can act. Nothing in the menu is shown
disabled to explain itself, and nothing is inserted or removed instantly.

### Decision (owner, 2026-10-27)

Hiding what cannot act was chosen over showing every row at all times,
because the always-visible design (disabled rows, an always-rendered "Save as
default" toggle and web search caption) was oversaturated. The remaining known
movement is the web search segments lifting when the Exa depth row or Auto
reveals on desktop, because the popover grows upward from "+". It is
mitigated by the 160 ms animation and the 400 ms reveal guard.

#### Rejected mitigations

- **Locking the panel height.** It leaves a large empty gap in the common Off
  state and still scrolls on small screens.
- **Anchoring the panel at the top instead of the bottom.** The popover opens
  upward from "+", so a top anchor would detach it from the trigger or need
  re-positioning on every reveal.
- **Inserting revealed rows above the control.** It breaks the reading order
  and the group's visual hierarchy.

### Hidden rows

| Row | Revealed when |
|---|---|
| Exa depth | Exa is the selected provider |
| Web search Auto | Auto is available and a provider is selected (search is not Off) |
| Show steps expanded | reasoning is not Off |
| Auto-hide when done | reasoning is not Off and steps are expanded |

The popover (above "+") and the mobile sheet are bottom-anchored, so any row
that is inserted pushes everything above it, including the control just
clicked, upward. The design therefore keeps the layout still where it can and
animates where it cannot.

### Reasoning caption

Under the reasoning segments one muted line is always rendered
(`reasoning-default-caption`, `text-xs leading-4`, `min-h-4`):

| State | Caption |
|---|---|
| level is the default | "High is your default" |
| level differs | "Your default is High · " + an inline accent button "Save Medium as default" (`reasoning-save-default-button`) |
| save in flight | "Your default is High · Saving…" (the button stays focusable but is `aria-disabled` and ignores clicks) |
| after it lands | "Medium is your default" |

Labels come from `getReasoningLevelLabel(level, isToggleMode)`, so a
toggle-mode model reads "Save On as default". The button is a real `<button>`
(`ToolsMenu/InlineButton.vue`). `setDefaultReasoningLevel` updates the server
default optimistically, so "Saving…" normally lasts a tick; a failed save
reverts the default and the offer comes back. Because the caption has a fixed height, picking
a level never inserts a row under the pointer. The line is one line at `w-80`; a very long label in a
narrow font could wrap, which would grow the caption by one line.

### Animated reveals (`Reveal`)

`ToolsMenu/Reveal.vue` wraps the rows that still come and go. It is a CSS grid
whose single row animates `0fr` to `1fr` in 160 ms (`ease-out`, off under
`motion-reduce`), with the content in a `min-h-0 overflow-hidden` child. While
closed the wrapper is `inert` and `invisible` (`visibility` is transitioned
with the rows, so it stays visible for the whole collapse and flips at the
end), which removes the content from the tab order and the accessibility tree.
The content stays mounted, so tests assert `data-open` / `inert` rather than
absence.

- **Focus.** `useToolsMenuFocusRescue` (`app/composables/tools-menu-focus-rescue.ts`)
  is the shared helper: when an element that holds focus is unmounted it moves
  focus to the nearest stable control, only if focus was really lost. That is
  the first checked, non-inert radio of the `[data-section]` the vanishing
  element sits in and outside it (the web search provider group when the Exa
  depth row collapses), then the checked radio of `.js-reasoning-level-group`
  (any checked radio as a last fallback). `ToggleRow` and the inline
  save button use it on unmount. `Reveal` calls `restoreToolsMenuFocus` with
  `force` when it closes around the focused control, because the control stays
  mounted but becomes inert.
- **Scroll fades.** `useScrollEdgeFade` observes the scroll element and its
  direct children with `ResizeObserver`. The content root changes size on
  every frame of a reveal, so the observer re-measures through the transition
  and catches the final size; no `transitionend` handler is needed.
- **Popover height.** The cap is still the space above "+" measured on open;
  revealed rows scroll inside the scroll area instead of growing the panel.

### Reveal guard

The popover grows upward from "+", so a row that appears under the segmented
control could still land under a fast second click (double-click, impatient
tap) and, for example, flip the Auto toggle.

`app/composables/reveal-guard.ts` closes that. `Content.vue` calls
`provideRevealGuardRoot()`; `ToggleRow.vue` and `Segmented.vue` call
`useRevealGuard()`. A control is guarded for `REVEAL_GUARD_DURATION_MS`
(400 ms) when either it mounts after the menu content first rendered, or the
`Reveal` it sits in opens (`provideRevealScope`, a watcher on `isOpen`, so it
keys off the reveal moment rather than the mount). Controls present and open
in the first render, which is what opening the menu renders, are never
guarded, and neither is anything rendered outside a guard root (the section
specs mount rows alone). Closing a `Reveal` drops its guard at once.

The guard exists for the pointer only, so keyboard activation is exempt: a
keyboard user cannot hit a control that moved under the pointer, and Space or
an arrow key on a just-revealed row must work at once. `useRevealGuard` returns
`shouldIgnoreActivation`, true only while guarded and when the activation is a
pointer one: a `pointerdown` was seen on the control's label since the last
`keydown`, or the click carries `detail > 0`. A guarded pointer click is
cancelled with `preventDefault()` on the input, so a checkbox or radio does
not flip and no `change` follows. A stray pointer `change` is also ignored and
the DOM state is put back to the model value. `InlineButton` has no guard (it
only ignores clicks while pending), so nothing changed there.
The menu content stays mounted after the first open, so rows present on a
later open are not guarded either.

## Icons

- Memory uses `lucide:book-user` everywhere (`CHAT_MEMORY_ICON`) and
  `lucide:book-x` for memory off (`CHAT_MEMORY_EXCLUSION_ICON`). `lucide:brain`
  stays reserved for reasoning.
- Exa has no icon in the pinned collections (`docs/nuxt-icon-collections.md`
  excludes `thesvg`, and neither `simple-icons` nor `streamline-logos` has
  it), so its mark ships as `app/assets/icons/exa.svg` (`SvgoExa`) and
  `ProviderIcon` renders it for `exa`.

## Section title icons, web search icons, the price badge and segment hover

- The web search segments carry an icon before the label: `lucide:globe` for
  Built-in, the provider logo (`ProviderIcon`, Brave and Exa) for the two
  external providers, none for Off. `SegmentedOption` takes `icon` (an Iconify
  name), `providerId` or `iconComponent` (a component name such as
  `SvgoThinkLow`); the icon inherits the segment's text colour, so it follows
  the checked, hover and disabled states with no extra rules.
- Every titled section header has an icon left of the title: Add
  `lucide:plus`, Web search `lucide:search`, Reasoning `SvgoThinkHigh` (the
  icon the High level uses; it is an SVGO component, so `Section` takes both
  `icon` for an Iconify name and `iconComponent`). Only the allowed icon
  prefixes of `docs/nuxt-icon-collections.md` are used. The header is one
  `h-7 items-center` row with a right-aligned `#title-end` slot, so a
  `badge-sm` appearing in the slot never changes the row height or the menu
  height.
- The provider segments show no price and carry only a plain `title` (the
  full provider name, plus the reason when disabled). The price lives in a small
  badge in the "Web search" header (`web-search-price-badge`, a
  `badge badge-sm badge-soft badge-info` `<button>` with a `lucide:info`
  icon at size 12), shown only while a provider is selected:

  | Selected | Badge text |
  |---|---|
  | Off | no badge, no note |
  | Built-in, known rate | "$14 / 1k searches" or "$35 / 1k prompts" (unit from `resolveBuiltInSearchPrice`) |
  | Built-in, no rate | "Billed by xAI" (the billing provider, a gateway selection names the gateway); with no provider "Model's own search" |
  | Brave | "$5 / 1k searches" |
  | Exa | the rate of the selected depth, e.g. "$7 / 1k searches" |

  A missing Brave or Exa rate shows "Price info". The badge toggles
  (`aria-expanded`, `aria-controls`) an explanation note
  (`web-search-price-note`) directly under the provider segments. The note
  holds the long description ("The model's own search from Google. Your Google key pays $14 per 1,000
  searches.", "Brave Search on your Brave key. $5 per 1,000 searches.", "Exa
  on your Exa key, Auto depth. $7 per 1,000 searches."; a missing rate drops
  the price sentence). The note only renders while a provider is selected,
  and the open state survives switching between providers. The badge costs no
  height and the note only appears on request.
- `InfoNote.vue` is the one gray note style (`rounded-box bg-base-200 text-xs
  px-2 py-1.5`), used by the Auto explanation and the web search price note.
  The row hover background of the Auto toggle is gray too and used to merge
  with the note and with the divider below, so both notes are spaced
  (`mt-1` above the Auto note, `mb-2` below each note).
- Built-in is priced for `google`, `anthropic`, `openai` and `deepseek` only
  (`resolveBuiltInSearchPrice` in `app/utils/web-search-price.ts`). Google
  picks its rate from the model id with the same helper the server bills with
  (`shared/utils/google-search-billing-unit.ts`): Gemini 3 and later per query,
  older Gemini per grounded prompt. Any other provider, any gateway or a blank
  rate shows no price; a price is never guessed. The provider comes from
  `useChatInput().selectedModelBillingProviderId`, which is the gateway id for
  a gateway send, not the vendor behind it.
- The Exa depth segments (Lite, Auto, Deep) keep their price sub-line.
- Reasoning level segments carry the per-level think icons
  (`SvgoThinkOff|Low|Medium|High`; a toggle-mode model gets Off and the one
  level's icon on "On").
- The groups are separated by one divider each (Add, Web search, Reasoning,
  then the lower rows). A divider renders only when something above it is
  visible, so a missing group never leaves a double divider.

### Why the segments had hover dead zones

The radio input is `absolute inset-0 opacity-0` and owns the click, the cursor
and the `:hover` that paints the segment (`peer-[:hover]`). Absolutely
positioned content paints above non-positioned content, so it normally sits on
top of the visual span. But any descendant that creates a stacking context is
painted in the same layer in tree order, and the visual span comes after the
input, so it wins the hit test. The Iconify `<Icon>` (a CSS `mask-image`,
Built-in's globe and Brave's logo) and the price `<small class="opacity-80">`
both create one; Exa's inline `<svg>` does not, which is why only Exa worked.
Over those children the pointer was no longer over the input: default cursor
and no hover. The visual span and every icon and sub line are now
`pointer-events-none`, so hit testing always falls through to the input, and
the `<label>` carries `cursor-pointer` (`cursor-not-allowed` when disabled).

## Not done yet

- Keyboard shortcuts (`/` to open the menu from an empty textarea, Cmd/Ctrl+U
  to attach) are a follow-up.
