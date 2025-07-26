import type { AsyncFunctionArguments } from '@actions/github-script'

export async function updatePR(
  { context }: AsyncFunctionArguments,
) {
  const { pull_request: pr } = context.payload

  if (!pr) {
    return
  }

  const scriptsPath = `${context.payload.workspace}/.github/scripts`
  const [
    labelsModule,
    assigneesModule,
    milestoneModule,
    projectModule,
  ] = await Promise.all([
    import(`${scriptsPath}/labels.ts`),
    import(`${scriptsPath}/assignees.ts`),
    import(`${scriptsPath}/milestone.ts`),
    import(`${scriptsPath}/project.ts`),
  ])

  await Promise.all([
    labelsModule.setLabels(),
    assigneesModule.setAssignees(),
    milestoneModule.setMilestone(),
    projectModule.setProject(),
  ])
}
