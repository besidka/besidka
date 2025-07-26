// eslint-disable-next-line @stylistic/max-len
/** @param {import('@actions/github-script').AsyncFunctionArguments} AsyncFunctionArguments */
export async function setLabels({ github, context }) {
  const { pull_request: pr } = context.payload

  if (!pr) {
    return
  }

  const commits = await github.rest.pulls.listCommits({
    ...context.repo,
    pull_number: pr.number,
  })

  const messages = commits.data.map(c => c.commit.message).join('\n')
  const labels: Array<'feat' | 'fix' | 'docs'> = []

  if (/^feat\b/i.test(messages)) {
    labels.push('feat')
  } else if (/^fix\b/i.test(messages)) {
    labels.push('fix')
  } else if (/^docs\b/i.test(messages)) {
    labels.push('docs')
  }

  if (labels?.length) {
    await github.rest.issues.addLabels({
      issue_number: pr.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      labels,
    })
  }
}
