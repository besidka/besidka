import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowStep {
  id?: string
  name?: string
  if?: string
  uses?: string
  run?: string
  with?: Record<string, string>
}

interface WorkflowJob {
  needs?: string | string[]
  if?: string
  environment?: string
  concurrency?: { 'group': string, 'cancel-in-progress': boolean }
  steps: WorkflowStep[]
}

interface Workflow {
  jobs: Record<string, WorkflowJob>
}

const workflow = parse(
  readFileSync('.github/workflows/production.yml', 'utf8'),
) as Workflow

const satellites = workflow.jobs['deploy-satellites'] as WorkflowJob
const deploy = workflow.jobs.deploy as WorkflowJob

function toList(value: string | string[] | undefined): string[] {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function findStep(name: string): WorkflowStep {
  const step = satellites.steps.find(candidate => candidate.name === name)

  if (!step) {
    throw new Error(`Step not found: ${name}`)
  }

  return step
}

describe('production.yml satellite Workers', () => {
  it('runs after the same test gates as the app deploy', () => {
    expect(toList(satellites.needs)).toEqual([
      'gate',
      'static',
      'unit',
      'integration',
      'build',
      'e2e',
    ])
  })

  it('makes the app deploy wait for the satellites', () => {
    expect(toList(deploy.needs)).toContain('deploy-satellites')
  })

  it('never runs on a dry run and only on main', () => {
    expect(satellites.if).toContain('github.ref == \'refs/heads/main\'')
    expect(satellites.if).toContain('inputs.dry-run != true')
  })

  it('does not gate the job on the artifacts runtime variable', () => {
    expect(satellites.if).not.toContain('ARTIFACTS_RUNTIME_DEPLOY_ENABLED')
  })

  it('gates every artifacts runtime step on its variable', () => {
    for (const name of [
      'Build the artifacts runtime',
      'Deploy the artifacts runtime',
    ]) {
      expect(findStep(name).if).toContain(
        'vars.ARTIFACTS_RUNTIME_DEPLOY_ENABLED == \'true\'',
      )
    }
  })

  it('serialises satellite deploys in one concurrency group', () => {
    expect(satellites.concurrency).toEqual({
      'group': 'satellites-besidka',
      'cancel-in-progress': false,
    })
  })

  it('deploys the production and the preview renderer on every run', () => {
    const production = findStep('Deploy the document renderer')
    const preview = findStep('Deploy the document renderer for previews')

    for (const step of [production, preview]) {
      expect(step.if).toBeUndefined()
      expect(step.uses).toMatch(/^cloudflare\/wrangler-action@[0-9a-f]{40}$/)
      expect(step.with?.workingDirectory).toBe('workers/doc-renderer')
      expect(step.with?.wranglerVersion).toBe('4.151.1')
    }

    expect(production.with?.command).toBe('deploy')
    expect(preview.with?.command).toBe('deploy --env preview')
  })

  it('has no change detection that could leave the binding target missing', () => {
    expect(satellites.steps.some(step => step.id === 'renderer-changes'))
      .toBe(false)
  })

  it('sets the project up before any deploy step, without a condition', () => {
    const names = satellites.steps.map(step => step.name)

    expect(findStep('Setup project').if).toBeUndefined()
    expect(names.indexOf('Setup project'))
      .toBeLessThan(names.indexOf('Deploy the document renderer'))
  })

  it('deploys the app only when the satellites succeeded or were skipped', () => {
    expect(deploy.if).toContain(
      '&& (needs.deploy-satellites.result == \'success\' '
      + '|| needs.deploy-satellites.result == \'skipped\')',
    )
  })
})
