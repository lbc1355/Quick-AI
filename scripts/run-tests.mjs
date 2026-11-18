import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const testHome = mkdtempSync(join(tmpdir(), 'quickai-tests-'))
const vitestEntry = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs')

try {
  // npm postinstall builds SQLite for Electron. Fail here instead of silently skipping DB tests.
  const commands = [
    [
      '-e',
      "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close(); " +
        "console.log('Test runtime: Electron ' + process.versions.electron + ', Node ABI ' + process.versions.modules)"
    ],
    [vitestEntry, ...process.argv.slice(2)]
  ]
  for (const args of commands) {
    const result = spawnSync(electronPath, args, {
      cwd: projectRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', QUICKAI_HOME: testHome },
      stdio: 'inherit',
      windowsHide: true
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
    if (process.exitCode !== 0) break
  }
} finally {
  rmSync(testHome, { recursive: true, force: true })
}
