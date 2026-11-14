import type { SkillTemplate } from '#shared/utils/skills/templates/types'

export const codeReviewChecklistTemplate: SkillTemplate = {
  id: 'code-review-checklist',
  title: 'Code review checklist',
  summary: 'Review a change against a checklist you can edit.',
  name: 'code-review-checklist',
  description:
    'Review a code change against my checklist for correctness, tests and readability. Use when I paste a diff or ask for a review.',
  modelInvocable: true,
  slashCommand: false,
  argumentHint: null,
  files: [
    {
      path: 'SKILL.md',
      content: `---
name: code-review-checklist
description: Review a code change against my checklist for correctness, tests and readability. Use when I paste a diff or ask for a review.
---

# Reviewing a change

Go through references/checklist.md one section at a time.

1. Say in one sentence what the change does.
2. List problems by severity: must fix, should fix, nice to have.
3. For each problem name the file and the line, say why it matters and
   suggest a fix.
4. Say what is good about the change, briefly.
5. End with a verdict: approve, approve with comments, or request changes.

Do not rewrite the whole change. Point at the lines that need work.
`,
    },
    {
      path: 'references/checklist.md',
      content: `# Review checklist

## Correctness

- Does the code do what the description says?
- Are empty input, missing values and large input handled?
- Are errors reported to the caller and not swallowed?

## Tests

- Is there a test for the new behaviour and for the failure case?
- Would the test fail without the change?

## Readability

- Are names clear without a comment?
- Is anything duplicated that already exists elsewhere?

## Safety

- Is user input checked before it is used?
- Is anything private written to a log?
`,
    },
  ],
}
