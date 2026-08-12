'use strict'
// Builds the ManagedProcessInfo list reported over `processes:list`.
// Pure function: service is a ServiceSupervisor (or null), ptys is the
// terminal map (ptyId -> { pty, backendId, ... }), backends is the
// { backends, defaultId } object from lib/backends.
function collectProcesses(service, ptys, backends) {
  const out = []
  if (service) {
    out.push({
      id: 'python-host',
      kind: 'service',
      name: 'python-host',
      running: service.running,
      pid: service.child ? service.child.pid : undefined,
      detail: {
        url: service.url,
        healthy: service.lastCheck ? service.lastCheck.ok : false,
        error: service.lastCheck?.error ?? service.lastError ?? undefined,
      },
    })
  }

  const byId = new Map((backends?.backends ?? []).map((b) => [b.id, b]))
  for (const [ptyId, entry] of ptys) {
    const backend = entry.backendId ? byId.get(entry.backendId) : undefined
    out.push({
      id: ptyId,
      kind: 'terminal',
      name: backend ? backend.name : ptyId,
      running: true,
      pid: entry.pty ? entry.pty.pid : undefined,
      detail: { backendId: entry.backendId },
    })
  }
  return out
}

module.exports = { collectProcesses }
