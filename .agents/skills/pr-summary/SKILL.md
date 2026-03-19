---
name: pr-summary
description: Summarizes the pull request, including the title, description, and any relevant details
---

- PR diff: !`gh pr diff`
- PR title: !`gh pr view --json title -q .title`
- PR comments: !`gh pr view --json comments -q '.comments[].body'`
- Changed files: !`gh pr diff --name-only`