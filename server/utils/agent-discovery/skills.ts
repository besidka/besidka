export const AGENT_SKILLS_SCHEMA_URL
  = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'

export const AGENT_SKILLS_PATH = '/.well-known/agent-skills'

export interface AgentSkillIndexEntry {
  name: string
  type: 'skill-md'
  description: string
  url: string
  digest: string
}

export interface AgentSkillsIndex {
  $schema: string
  skills: AgentSkillIndexEntry[]
}

interface RegisteredSkill {
  name: string
  description: string
}

function listRegisteredSkills(): RegisteredSkill[] {
  const { agentDiscoverySkills } = useRuntimeConfig()

  return (agentDiscoverySkills?.skills ?? []) as RegisteredSkill[]
}

function toBytes(raw: unknown): Uint8Array | null {
  if (typeof raw === 'string') {
    return new TextEncoder().encode(raw)
  }

  if (raw instanceof Uint8Array) {
    return raw
  }

  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw)
  }

  return null
}

export function isRegisteredSkill(name: string): boolean {
  return listRegisteredSkills().some((skill) => {
    return skill.name === name
  })
}

export async function readSkillMarkdown(
  name: string,
): Promise<Uint8Array | null> {
  if (!isRegisteredSkill(name)) {
    return null
  }

  const raw = await useStorage('assets:agentSkills').getItemRaw(
    `${name}/SKILL.md`,
  )

  return toBytes(raw)
}

export async function sha256Digest(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  const hex = Array.from(new Uint8Array(buffer), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')

  return `sha256:${hex}`
}

export async function buildAgentSkillsIndex(
  origin: string,
): Promise<AgentSkillsIndex> {
  const skills: AgentSkillIndexEntry[] = []

  for (const skill of listRegisteredSkills()) {
    const bytes = await readSkillMarkdown(skill.name)

    if (!bytes) {
      continue
    }

    skills.push({
      name: skill.name,
      type: 'skill-md',
      description: skill.description,
      url: `${origin}${AGENT_SKILLS_PATH}/${skill.name}/SKILL.md`,
      digest: await sha256Digest(bytes),
    })
  }

  return {
    $schema: AGENT_SKILLS_SCHEMA_URL,
    skills,
  }
}
