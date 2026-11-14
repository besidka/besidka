import type { SkillTemplate } from '#shared/utils/skills/templates/types'

export const translateWithGlossaryTemplate: SkillTemplate = {
  id: 'translate-with-glossary',
  title: 'Translate with a glossary',
  summary: 'A command that translates text and keeps your preferred terms.',
  name: 'translate-with-glossary',
  description:
    'Translate text and keep my preferred terms from the glossary. Use when I give a target language and some text.',
  modelInvocable: false,
  slashCommand: true,
  argumentHint: 'Target language, then the text',
  files: [
    {
      path: 'SKILL.md',
      content: `---
name: translate-with-glossary
description: Translate text and keep my preferred terms from the glossary. Use when I give a target language and some text.
---

# Translate with a glossary

The input starts with the target language and is followed by the text to
translate.

$ARGUMENTS

1. Read references/glossary.md. Use its translation for every term it lists.
2. Translate the text. Keep the meaning, the tone and the formatting.
3. Leave names, numbers and code unchanged.
4. Give the translation first. If you were unsure about a term, list it after
   the translation with the options you considered.
`,
    },
    {
      path: 'references/glossary.md',
      content: `# Glossary

One term per line, in the form: source term = preferred translation.

- workspace = (add your translation)
- invoice = (add your translation)
`,
    },
  ],
}
