import type { EnvironmentSnapshot, ProbeSection } from './environmentProbe'

/**
 * Render a snapshot into model-facing text. Pure (no I/O) so it is unit-testable without
 * spawning processes. `include` restricts which sections appear; default is all.
 */
export function formatEnvironmentReport(
  snapshot: EnvironmentSnapshot,
  include: ProbeSection[] = ['os', 'tools', 'envs', 'dirs']
): string {
  const want = new Set(include)
  const lines: string[] = []

  if (want.has('os')) {
    const { platform, release: rel, shell, homedir: home, workspaceRoot } = snapshot.os
    lines.push('OS:')
    lines.push(`  platform: ${platform} (${rel})`)
    lines.push(`  shell: ${shell}`)
    lines.push(`  home: ${home}`)
    lines.push(`  workspace root: ${workspaceRoot}`)
    lines.push('')
  }

  if (want.has('tools')) {
    const installed = snapshot.tools.filter((t) => t.found)
    const missing = snapshot.tools.filter((t) => !t.found)
    lines.push('Installed tools:')
    if (installed.length === 0) {
      lines.push('  (none of the probed tools were found)')
    } else {
      for (const t of installed) {
        lines.push(`  ${t.name}: ${t.version || 'present (version unknown)'}`)
      }
    }
    if (missing.length > 0) {
      lines.push(`Not found: ${missing.map((t) => t.name).join(', ')}`)
    }
    lines.push('')
  }

  if (want.has('envs')) {
    lines.push('Package environments:')
    lines.push(`  default python: ${snapshot.defaultPython || 'n/a'}`)
    if (snapshot.condaEnvs) {
      lines.push('  conda env list:')
      for (const l of snapshot.condaEnvs.split(/\r?\n/)) {
        if (l.trim()) lines.push(`    ${l.trim()}`)
      }
    } else {
      lines.push('  conda: not available')
    }
    lines.push('')
  }

  if (want.has('dirs')) {
    lines.push('Standard folders (existence only — contents not listed):')
    for (const d of snapshot.dirs) {
      lines.push(`  ${d.name}: ${d.exists ? d.path : '(not present)'}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}
