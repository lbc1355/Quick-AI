import { defineConfig } from 'vitest/config'
import { join } from 'path'
import { tmpdir } from 'os'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    maxWorkers: 2,
    env: {
      QUICKAI_WORKSPACE_ROOT: join(tmpdir(), 'quickai-vitest-workspace')
    },
    globals: false
  }
})
