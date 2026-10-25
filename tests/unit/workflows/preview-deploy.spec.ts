import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowStep {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

interface Workflow {
  jobs: Record<string, {
    permissions?: Record<string, string>
    steps: Array<WorkflowStep>
  }>
}

const DEFAULT_BRANCH_REF = '${{ github.event.repository.default_branch }}'
const FULL_COMMIT_SHA = /@[0-9a-f]{40}$/

const SECRET_BEARING_WORKFLOWS = [
  'preview-deploy.yml',
  'preview-cleanup.yml',
  'production.yml',
  'claude.yml',
  'claude-code-review.yml',
  'update.yml',
]

function readWorkflow(fileName: string): Workflow {
  const content = readFileSync(`.github/workflows/${fileName}`, 'utf8')

  return parse(content) as Workflow
}

function getAllSteps(workflow: Workflow): Array<WorkflowStep> {
  return Object.values(workflow.jobs).flatMap(job => job.steps)
}

function findStepIndex(
  steps: Array<WorkflowStep>,
  predicate: (step: WorkflowStep) => boolean,
): number {
  return steps.findIndex(predicate)
}

function findStepIndexByName(
  steps: Array<WorkflowStep>,
  name: string,
): number {
  return findStepIndex(steps, step => step.name === name)
}

function findDownloadStep(
  steps: Array<WorkflowStep>,
  artifactName: string,
): WorkflowStep | undefined {
  return steps.find((step) => {
    return step.uses?.startsWith('actions/download-artifact')
      && step.with?.name === artifactName
  })
}

const deployJob = readWorkflow('preview-deploy.yml').jobs.deploy
const deploySteps = deployJob.steps

describe('preview-deploy workflow', () => {
  it('checks out only the default branch without persisting credentials', () => {
    const checkoutSteps = deploySteps.filter((step) => {
      return step.uses?.startsWith('actions/checkout')
    })

    expect(checkoutSteps.length).toBeGreaterThan(0)

    for (const step of checkoutSteps) {
      expect(step.with?.ref).toBe(DEFAULT_BRANCH_REF)
      expect(step.with?.['persist-credentials']).toBe(false)
    }
  })

  it('never selects a checkout ref from the PR head sha', () => {
    for (const step of deploySteps) {
      expect(String(step.with?.ref ?? '')).not.toContain(
        'steps.pr.outputs.sha',
      )
    }
  })

  it('downloads the build artifact into .output/', () => {
    const step = findDownloadStep(deploySteps, 'preview-build')

    expect(step?.with?.path).toBe('.output/')
  })

  it('downloads the drizzle artifact into .drizzle/', () => {
    const step = findDownloadStep(deploySteps, 'preview-drizzle')

    expect(step?.with?.path).toBe('.drizzle/')
  })

  it('never downloads an artifact into the workspace root', () => {
    const downloadSteps = deploySteps.filter((step) => {
      return step.uses?.startsWith('actions/download-artifact')
    })

    expect(downloadSteps.length).toBeGreaterThan(0)

    for (const step of downloadSteps) {
      expect(['.', './']).not.toContain(step.with?.path)
    }
  })

  it('removes default-branch migrations before the drizzle download', () => {
    const removeIndex = findStepIndex(deploySteps, (step) => {
      return step.run?.trim() === 'rm -rf .drizzle'
    })
    const downloadIndex = findStepIndex(deploySteps, (step) => {
      return step.uses?.startsWith('actions/download-artifact') === true
        && step.with?.name === 'preview-drizzle'
    })

    expect(removeIndex).toBeGreaterThanOrEqual(0)
    expect(downloadIndex).toBeGreaterThanOrEqual(0)
    expect(removeIndex).toBeLessThan(downloadIndex)
  })

  it('verifies artifact confinement after both downloads and before install', () => {
    const verifyIndex = findStepIndexByName(
      deploySteps,
      'Verify artifacts stayed inside .output and .drizzle',
    )
    const buildDownloadIndex = findStepIndex(deploySteps, (step) => {
      return step.with?.name === 'preview-build'
    })
    const drizzleDownloadIndex = findStepIndex(deploySteps, (step) => {
      return step.with?.name === 'preview-drizzle'
    })
    const installIndex = findStepIndexByName(
      deploySteps,
      'Install dependencies',
    )

    expect(verifyIndex).toBeGreaterThan(buildDownloadIndex)
    expect(verifyIndex).toBeGreaterThan(drizzleDownloadIndex)
    expect(verifyIndex).toBeLessThan(installIndex)
  })

  it('fails the integrity check on files outside the artifact folders', () => {
    const verifyStep = deploySteps.find((step) => {
      return step.name === 'Verify artifacts stayed inside .output and .drizzle'
    })

    expect(verifyStep?.run).toContain('--ignored')
    expect(verifyStep?.run).toContain('--untracked-files=all')
    expect(verifyStep?.run).toContain(':(exclude).output')
    expect(verifyStep?.run).toContain(':(exclude).drizzle')
    expect(verifyStep?.run).toContain('exit 1')
  })

  it('does not use the cloudflare wrangler action', () => {
    for (const step of deploySteps) {
      expect(step.uses ?? '').not.toContain('cloudflare/wrangler-action')
    }
  })

  it('exposes secrets only after dependencies are installed', () => {
    const installIndex = findStepIndexByName(
      deploySteps,
      'Install dependencies',
    )
    const secretStepIndexes = deploySteps.flatMap((step, index) => {
      const referencesSecrets = Object.values(step.env ?? {}).some((value) => {
        return String(value).includes('secrets.')
      })

      return referencesSecrets ? [index] : []
    })

    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(secretStepIndexes.length).toBeGreaterThan(0)

    for (const index of secretStepIndexes) {
      expect(index).toBeGreaterThan(installIndex)
    }
  })

  it('does not request an OIDC token', () => {
    expect(deployJob.permissions).not.toHaveProperty('id-token')
  })
})

describe('workflows that reference secrets', () => {
  it.each(SECRET_BEARING_WORKFLOWS)(
    'pins every non-actions step in %s to a full commit sha',
    (fileName) => {
      const steps = getAllSteps(readWorkflow(fileName))
      const thirdPartyUses = steps
        .map(step => step.uses)
        .filter((uses): uses is string => {
          return typeof uses === 'string' && !uses.startsWith('actions/')
        })

      for (const uses of thirdPartyUses) {
        expect(uses).toMatch(FULL_COMMIT_SHA)
      }
    },
  )
})
