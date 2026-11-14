import type { SkillTemplate } from '#shared/utils/skills/templates/types'

export const writingStyleTemplate: SkillTemplate = {
  id: 'writing-style',
  title: 'Writing style',
  summary: 'Draft and rewrite text in your own voice, from a style guide you fill in.',
  name: 'writing-style',
  description:
    'Draft or rewrite text so it sounds like me. Use when I ask for an email, post or document in my own voice.',
  modelInvocable: true,
  command: null,
  argumentHint: null,
  files: [
    {
      path: 'SKILL.md',
      content: `---
name: writing-style
description: Draft or rewrite text so it sounds like me. Use when I ask for an email, post or document in my own voice.
---

# Writing in my voice

Read references/style-guide.md before you write anything.

1. Find out who the text is for and what it should achieve.
2. Draft it following the voice and the rules in the style guide.
3. Keep my sentence length and my level of formality.
4. Read the draft once more and remove anything the guide says to avoid.
5. Give me the text first. Add a short note only if you made a choice I should check.

When I paste a draft, change as little as needed to match my voice.
`,
    },
    {
      path: 'references/style-guide.md',
      content: `# My style guide

Fill in each section. The more specific it is, the better the drafts.

## Voice

- Describe how I sound in two or three lines.

## Always

- Short sentences.
- Start with the point.

## Never

- Filler openings such as "I hope this finds you well".
- Exclamation marks in work email.

## Sample sentences

- Paste three or four sentences I wrote and liked.
`,
    },
  ],
}
