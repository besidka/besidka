import type { SkillTemplate } from '#shared/utils/skills/templates/types'

export const meetingNotesTemplate: SkillTemplate = {
  id: 'meeting-notes',
  title: 'Meeting notes',
  summary: 'A command that turns raw notes into a summary, decisions and actions.',
  name: 'meeting-notes',
  description:
    'Turn raw meeting notes into a short summary, the decisions and the action items.',
  modelInvocable: false,
  slashCommand: true,
  argumentHint: 'Paste the raw notes',
  files: [
    {
      path: 'SKILL.md',
      content: `---
name: meeting-notes
description: Turn raw meeting notes into a short summary, the decisions and the action items.
---

# Meeting notes

Turn the notes below into a clean record of the meeting.

$ARGUMENTS

Answer in this format:

## Summary

Three sentences at most.

## Decisions

A bullet for each decision. Write "None" if there were none.

## Action items

A bullet for each item: what, who, and by when. Write "Unassigned" when the
notes do not say who. Do not invent owners or dates.

## Open questions

Anything the notes leave unresolved.
`,
    },
  ],
}
