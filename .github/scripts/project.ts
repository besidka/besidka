import type { AsyncFunctionArguments } from '@actions/github-script'

export async function setProject(
  { github, context }: AsyncFunctionArguments,
) {
  const { pull_request: pr, action } = context.payload

  if ((!pr || action !== 'opened') || (pr.node_id && pr.project_card)) {
    return
  }

  // https://github.com/orgs/besidka/projects/2
  const projectId = 2
  const mutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item {
          id
        }
      }
    }
  `
  await github.graphql(mutation, {
    projectId: projectId,
    contentId: pr.node_id,
  })
}
