import { exec } from 'child_process'
import { existsSync } from 'fs'
import { homedir, release } from 'os'
import { join } from 'path'
import { getWorkspaceRoot } from './helpers'

/**
 * Read-only machine-environment probe. The agent calls this once (via the inspect_environment
 * tool) to learn what tools/interpreters/folders exist instead of blind-guessing through the
 * shell — which is slower and triggers permission prompts. Probing is best-effort: a missing
 * tool is reported as "not found", never an error. Directory probes report existence and path
 * only — never their contents — so the snapshot leaks no personal file listings.
 */

export type ProbeSection = 'os' | 'tools' | 'envs' | 'dirs'

export interface ToolProbe {
  name: string
  found: boolean
  version?: string
}

export interface DirProbe {
  name: string
  path: string
  exists: boolean
}

export interface EnvironmentSnapshot {
  os: {
    platform: string
    release: string
    shell: string
    homedir: string
    workspaceRoot: string
  }
  tools: ToolProbe[]
  defaultPython?: string
  condaEnvs?: string
  dirs: DirProbe[]
}

/** Tools worth probing, with the flag that prints their version. */
const PROBE_TOOLS: Array<{ name: string; versionArg: string }> = [
  { name: 'git', versionArg: '--version' },
  { name: 'node', versionArg: '--version' },
  { name: 'npm', versionArg: '--version' },
  { name: 'pnpm', versionArg: '--version' },
  { name: 'yarn', versionArg: '--version' },
  { name: 'python', versionArg: '--version' },
  { name: 'python3', versionArg: '--version' },
  { name: 'pip', versionArg: '--version' },
  { name: 'conda', versionArg: '--version' },
  { name: 'java', versionArg: '-version' }, // java prints to stderr and uses single-dash
  { name: 'go', versionArg: 'version' },
  { name: 'docker', versionArg: '--version' },
  { name: 'rustc', versionArg: '--version' },
  { name: 'cargo', versionArg: '--version' }
]

const STANDARD_DIRS = ['Desktop', 'Documents', 'Downloads']

const PROBE_TIMEOUT_MS = 3000

function shellName(): string {
  if (process.platform === 'win32') return 'cmd.exe'
  if (process.platform === 'darwin') return 'zsh'
  return 'bash'
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((l) => l.trim().length > 0) || '').trim()
}

/** Run one probe command. Never rejects: resolves { ok:false } on missing tool, error, or timeout. */
function runProbe(command: string, signal?: AbortSignal): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolvePromise) => {
    exec(
      command,
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024, signal, windowsHide: true },
      (error, stdout, stderr) => {
        const out = `${stdout || ''}${stderr || ''}`
        resolvePromise({ ok: !error, out })
      }
    )
  })
}

/** Probe the live machine and return a structured snapshot. Best-effort, time-bounded. */
export async function probeEnvironment(signal?: AbortSignal): Promise<EnvironmentSnapshot> {
  const home = homedir()

  const toolResults = await Promise.all(
    PROBE_TOOLS.map(async (t) => {
      const { ok, out } = await runProbe(`${t.name} ${t.versionArg}`, signal)
      const probe: ToolProbe = { name: t.name, found: ok }
      if (ok) {
        const v = firstLine(out)
        if (v) probe.version = v
      }
      return probe
    })
  )

  const hasPython = toolResults.some(
    (t) => (t.name === 'python' || t.name === 'python3') && t.found
  )
  const hasConda = toolResults.some((t) => t.name === 'conda' && t.found)

  let defaultPython: string | undefined
  if (hasPython) {
    const locate = process.platform === 'win32' ? 'where python' : 'command -v python'
    const { ok, out } = await runProbe(locate, signal)
    if (ok) {
      const p = firstLine(out)
      if (p) defaultPython = p
    }
  }

  let condaEnvs: string | undefined
  if (hasConda) {
    const { ok, out } = await runProbe('conda env list', signal)
    if (ok && out.trim()) condaEnvs = out.trim()
  }

  const dirs: DirProbe[] = STANDARD_DIRS.map((name) => {
    const path = join(home, name)
    return { name, path, exists: existsSync(path) }
  })

  return {
    os: {
      platform: process.platform,
      release: release(),
      shell: shellName(),
      homedir: home,
      workspaceRoot: getWorkspaceRoot()
    },
    tools: toolResults,
    defaultPython,
    condaEnvs,
    dirs
  }
}

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
