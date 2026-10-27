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
| Rows and controls | `ToolsMenu/Section.vue`, `ActionRow.vue`, `ToggleRow.vue`, `Segmented.vue` |
| Web search and reasoning sections | `ToolsMenu/WebSearchSection.vue`, `ToolsMenu/ReasoningSection.vue` |
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

Picking a level in the menu changes only the current chat. It no longer
writes `settings_reasoning_level`. The effective default is
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
- The Reasoning section always shows a "Save as default" row. When the
  level differs from the default it is off and enabled ("Your default is
  X"); turning it on calls `setDefaultReasoningLevel(level)` and the tile
  disappears. When the level is the default it is off and disabled ("X is
  your default"). The row is always rendered rather than revealed, because
  the popover grows upward from "+": a row mounting under the reasoning
  segments moved the clicked level up by one row and left the pointer on the
  new toggle, so a second click would have saved the default by accident.
- "Show steps expanded" and "Auto-hide when done" show off and disabled
  while reasoning is Off, and Auto-hide also while steps are collapsed.

## Icons

- Memory uses `lucide:book-user` everywhere (`CHAT_MEMORY_ICON`) and
  `lucide:book-x` for memory off (`CHAT_MEMORY_EXCLUSION_ICON`). `lucide:brain`
  stays reserved for reasoning.
- Exa has no icon in the pinned collections (`docs/nuxt-icon-collections.md`
  excludes `thesvg`, and neither `simple-icons` nor `streamline-logos` has
  it), so its mark ships as `app/assets/icons/exa.svg` (`SvgoExa`) and
  `ProviderIcon` renders it for `exa`.

## Web search option icons, prices and the Built-in hint

- The web search segments carry an icon before the label: `lucide:globe` for
  Built-in, the provider logo (`ProviderIcon`, Brave and Exa) for the two
  external providers, none for Off. `SegmentedOption` takes `icon` (an Iconify
  name) or `providerId`; the icon inherits the segment's text colour, so it
  follows the checked, hover and disabled states with no extra rules.
- Each provider segment shows its list price on a second line (`sub`):
  Brave from `braveSearchCostPerThousandRequestsUsd`, Exa from the rate of the
  depth currently selected, Built-in from the model's own provider. Built-in is
  priced for `google`, `anthropic`, `openai` and `deepseek` only
  (`resolveBuiltInSearchPrice` in `app/utils/web-search-price.ts`). Google
  picks its rate from the model id with the same helper the server bills with
  (`shared/utils/google-search-billing-unit.ts`): Gemini 3 and later per query,
  older Gemini per grounded prompt. Any other provider, any gateway, a blank
  rate or a disabled Built-in segment shows no price; a price is never guessed.
- With Built-in selected, one line under the control says whose search it is
  and what it costs, for example "The model's own search from Google. Your
  Google key pays $14 per 1,000 searches." Without a known rate it reads "The
  model's own search from xAI, billed by xAI." (a gateway selection names the
  gateway). The same text is the Built-in segment's hover title. The provider
  comes from `useChatInput().selectedModelBillingProviderId`, which is the
  gateway id for a gateway send, not the vendor behind it.

## Not done yet

- Keyboard shortcuts (`/` to open the menu from an empty textarea, Cmd/Ctrl+U
  to attach) are a follow-up.
