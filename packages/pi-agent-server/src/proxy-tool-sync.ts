export interface ProxyDefinition {
  name: string
  description: string
  inputSchema: unknown
}

/** Only reuse definitions already registered with this SDK session. No private SDK APIs. */
export function activateProxySubset(
  session: { getActiveToolNames(): string[]; setActiveToolsByName(names: string[]): void },
  registered: readonly ProxyDefinition[],
  desired: readonly ProxyDefinition[],
): boolean {
  const known = new Map(registered.map(tool => [tool.name, JSON.stringify(tool)]))
  if (desired.some(tool => known.get(tool.name) !== JSON.stringify(tool))) return false
  const proxies = new Set(registered.map(tool => tool.name))
  const names = [...session.getActiveToolNames().filter(name => !proxies.has(name)), ...desired.map(tool => tool.name)]
  session.setActiveToolsByName([...new Set(names)])
  return true
}
