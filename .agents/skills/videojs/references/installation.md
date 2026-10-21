# Installation

Read this before installing Video.js, switching install method, or explaining
the choices to a user. The `agents init` command owns the current options,
defaults, compatibility rules, and decision order; this file adds what the
command cannot know and the wording to use with the user.

## Get version-matched instructions

Run the command from the app directory, the one whose `package.json` lists or
will list the player package. In a monorepo, change into the app first; from
the workspace root the command cannot see the app's framework, lockfile, or
installed version.

| Situation | Command |
| --- | --- |
| Any project, or none yet | `npx @videojs/cli agents init` |
| The page loads the CDN | `npx @videojs/cli@<version> agents init --method cdn --project existing --template none`, with the version from its script URL |

The bare command prints every option and its "Decide in this order" section.
It prints instructions and changes nothing. Follow that order, confirm the
choices with the user once, then run the command again with every resolved
choice as a flag until the plan's "Defaulted options" says none. Follow the
plan for implementation tasks; for explanation-only requests, summarize it.
Add `--json` if structured output is easier to consume.

The plan reports where each default came from, including the package manager
it detected. When it shows a version mismatch, follow that note. If
`agents init` is not recognized, the project has a Video.js package or CLI
from before the command existed: upgrade the Video.js packages, or use the
live docs below.

If commands cannot run, read `https://videojs.org/docs/framework/<html|react>/llms.txt`,
open the Installation page it lists, and use any query parameters that page
documents. Bundled `.md` files are static; do not add query parameters to them.

## What the command cannot decide

**Starting point.** In a folder with no app, ask what the user is building
before choosing `--project new`. A single page or embed can use CDN with
`--project existing --template none`, which works from a plain `index.html`.
For an app, ask which framework, and offer the framework's default app setup
from the command output as the suggestion.

**Detected values.** The command reads the framework, app setup, and package
manager from the project and names the source of each under "Defaulted
options". Check them against the project before confirming. When it reports
that no app setup was detected, or the project is one the command does not
read, choose the `--template` value yourself from the command output. Astro
projects with React islands can take either the React or the HTML route; ask
which the player will live in.

**Existing Shadcn.** If `components.json` exists in the app directory (or the
app workspace in a monorepo), the project already uses shadcn: lead with the
Shadcn method and pass the styling recorded there.

**Custom UI.** When the user wants a custom UI, says so, or the intended UI is
clear from what they are asking for, do not build from bare UI components:
start from the Shadcn installation of the closest preset and skin, then edit
the installed source toward their design. Bare UI components are the fallback
when no skin is close. Ask them to commit first so every added or replaced
file is reviewable.

**Extensions.** Pass extensions with `--extensions`; the command output lists
the ones each player supports, such as Google Cast. For Mux sources the plan
adds Mux Data by default. Say so in the proposal and follow
`references/hosting.md` before keeping it; if the user declines, pass
`--extensions none`, or list only the extensions they want.

## Propose once

Put every choice in one message, marking each as detected or a default, for
example: "Looks like an existing Next.js app using pnpm, so I'll use the
Packaged method with the Video player, Default skin, and HLS media. Want a
different skin or the editable Shadcn source instead?" Proceed on a yes, or
when the user already asked for exactly this setup.

When changing an existing Video.js setup, detect the current method, skin, and
media from the project first, and change only what the user asked for.

## Say it this way

Present install methods as alternatives, not steps. The command output lists
which methods each framework offers.

- **Packaged**: "Install packages and use a ready-made skin." The default
  recommendation: smallest decision surface, the skin updates with the package,
  and the user can add the skin source later without starting over.
- **Shadcn**: "Add editable skin source to your project." Recommend it when the
  user wants to add, remove, rearrange, or deeply restyle controls.
- **CDN**: "Load the HTML player from jsDelivr with no package manager or build
  step." Plain HTML only; for static pages, CMS embeds, and prototypes.

Presets are use cases: "Which kind of player is this?"

Skins vary along three axes: features (minimal to feature complete), styling
(unopinionated to opinionated), and how broadly the player must work across
browsers. Ask about styling first: "Do you want to apply your brand to a
finished design, or build your own from a foundation?" Building their own
follows **Custom UI** above. The command output lists the skins each method
and preset offer.

- **Default**: feature complete; the opinionated, distinctly Video.js design.
- **Neutral**: feature complete; an opinionated design that is easy to brand.
- **Compat**: minimal features, unbranded, and built for broad browser
  support; a polished step above native controls.

If the user has no streaming source yet, asks where to host, or asks about
analytics, read `references/hosting.md`.

## Composing beyond the default example

The selected `agents init` plan or queried Installation Guide returns the
complete combination. Use the deeper docs to verify or extend it:

1. Preset entry point for the player and skin: quote the Import section of the
   selected Installation Guide, the Presets concept page, or the preset's skin
   reference. Do not derive import paths from the use-case name.
2. Media component and its playback adapter, from the component's reference
   page Import section.
3. Extensions the user asked for that `--extensions` does not offer, from
   their reference pages.
4. Framework wiring from the Vue or Svelte guide: `isCustomElement` for Vue,
   static imports and mount-time access for Nuxt and SvelteKit.

## Next steps by skin

End the handoff with the next step for the skin that was installed:

- **Neutral**: "Set your brand tokens": `--media-accent-color` and its text
  color, from Customize skins.
- **Compat**: "Check the Browser support page against your targets."
- **Default**: "You're done. Bump the Video.js version to get design updates."

When the skin was added as skin source, say "You own this source now" instead
of the Default line: version bumps no longer update it.
