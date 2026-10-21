# Send feedback upstream, with consent

Read this when you are about to offer, draft, or submit a bug report, docs
feedback, or friction log about Video.js 10. The maintainers read these; a
clear report from an agent-assisted session is useful to them. The user
decides whether any user or project data leaves the machine.

## Consent rules

1. **Offer once, at a stopping point.** After the task works, or when you are
   blocked by the library or its docs. Not mid-task, and not again if declined.
2. **Draft locally first.** Write the full report, then show it. The user reads
   the exact text that would be sent.
3. **Redact before showing.** Remove tokens, signing keys, Mux environment
   keys, private playback IDs, internal hostnames, customer data, and
   proprietary code. Reproduce with the docs' demo media where possible. Ask
   before including any snippet from the user's own repository.
4. **Ask a direct question.** "May I submit this to `<destination>`, or would
   you rather submit it yourself?" Proceed only on an explicit yes.
   Silence, "sounds good", or approval of the draft's content is not consent
   to send.
5. **Prefer handing the user the submit button.** A prefilled GitHub URL lets
   them review and press submit. Use `gh` only when they ask you to send it,
   and confirm `gh auth status` shows the account they expect, since the
   report will carry that account's name.
6. **Say what happened.** Return the URL of what was created, or the prefilled
   link if they are submitting, or "nothing was sent" if they declined.

## Where each kind of report goes

Search first: `gh issue list --repo videojs/v10 --search "<keywords>" --state all`
and the Discussions search. Use generic terms only: component names, error
codes, doc page titles. Never put full error text, file paths, URLs, or project
identifiers into a search. Comment on an existing thread instead of opening a
duplicate.

| Kind | Destination | Template or category |
| --- | --- | --- |
| Reproducible wrong behavior in a package | videojs/v10 issue | Bug Report |
| A doc page contradicts the code, an example fails, an Import section is missing, a bundled `.md` link is broken | videojs/v10 issue | Docs Feedback |
| Small enhancement | videojs/v10 issue | Feature Request |
| Substantial feature or design proposal | videojs/v10 discussion | Ideas |
| Friction log: where you had to guess, what took several tries, what a page should have said | videojs/v10 discussion | Ideas, or General |
| A question with no clear answer in the docs | videojs/v10 discussion | Q&A |
| This skill fired wrongly, routed to the wrong page, or stated something false | videojs/skills issue | none |

Confirm the current template names at
https://github.com/videojs/v10/issues/new/choose and the discussion categories
at https://github.com/videojs/v10/discussions before building a link. Follow
the template as written; do not add labels or a title prefix unless it asks,
since repository automation handles triage. Do not report user mistakes or
unsupported setups as bugs.

## Prefilled links

The issue templates are GitHub issue forms, so a `body` parameter is ignored.
Prefill `title` and each text field by its `id`; the user picks the dropdowns
and checkboxes themselves. Read the template filenames and field ids from the
YAML under `.github/ISSUE_TEMPLATE/` in videojs/v10 (for example with
`gh api repos/videojs/v10/contents/.github/ISSUE_TEMPLATE`), not from memory.
URL-encode every value.

```text
https://github.com/videojs/v10/issues/new?template=<file>.yml&title=<title>&<field-id>=<value>&<field-id>=<value>
```

Discussions take a category slug, title, and body:

```text
https://github.com/videojs/v10/discussions/new?category=<slug>&title=<title>&body=<body>
```

Long reports can exceed URL limits. If so, give the user the bare `new` link
for the right template plus the Markdown to paste into each field.

With permission to send directly, submit a plain issue and leave labels and
type to repository automation:

```bash
gh issue create --repo videojs/v10 --title "<title>" --body-file report.md
```

For a discussion, recent `gh` versions can create one directly; check
`gh discussion create --help` first and use the prefilled link if it is
missing:

```bash
gh discussion create --repo videojs/v10 --category "<category>" --title "<title>" --body-file report.md
```

The web form is still the better default: it keeps the template's structure
and the user presses submit.

## Report template

Keep each report to one independently closable outcome. Fill what applies:

```markdown
## What happened
<one paragraph: observed behavior, or the friction>

## Expected
<what the docs or API led you to expect>

## Reproduction
<smallest markup or component that shows it, using demo media>
<steps, if any>

## Environment
- Packages: @videojs/<name>@<version> (from package.json or node_modules)
- Framework and install method: <React | HTML | Vue | Svelte>, <Packaged | Shadcn | CDN>
- Browser and OS, if relevant
- Docs consulted: <page titles, bundled or videojs.org>

## Workaround
<what unblocked the task, or "none">

---
Drafted with an AI coding agent using the Video.js skill and reviewed by the reporter.
```

The attribution line stays. It tells maintainers how the report was produced
and is not a disclaimer to hide.

## A friction log is not a bug report

A friction log records the experience of building with the library: the page
you expected to exist, the name you guessed wrong, the example that covered
the default case only. Keep it factual and specific, one entry per point of
friction, with the doc page or API involved. It goes to Discussions, not
Issues, unless one entry is a reproducible defect on its own.
