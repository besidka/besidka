/**
 * The single gate for the cross-chat search tools. A later workstream wires
 * it to a per-user setting; until then the tools are always available.
 */
export function isChatSearchToolEnabled(): boolean {
  return true
}
