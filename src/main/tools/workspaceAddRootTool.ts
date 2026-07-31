import { promises as fs } from 'fs'
import { basename, isAbsolute, parse, resolve } from 'path'
import { ToolArgs } from '../../shared/types'
import { getRun } from '../agent/AgentRunContext'
import { isSensitiveDirectoryForRoot } from '../agent/pathPolicy'
import { createToolResult } from './result'
import { ToolDefinition, ToolExecutionContext } from './types'

const normalizeRootPath = (value: string): string => resolve(value)

export const workspaceAddRootTool: ToolDefinition = {
  name: 'workspace_add_root',
  title: 'Add Reference Root',
  description:
    'Adds an existing directory as an additional file-tool root for this conversation. After adding it, file_read, image_read, code_symbol_read, workspace_search, workspace_list_files, and file mutation tools can use absolute paths under that directory without being blocked as outside the workspace/project.',
  tags: ['file', 'workspace', 'root', 'reference', 'directory', 'project', 'access'],
  category: 'file',
  risk: 'high',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Existing directory path to add as a reference root. Use an absolute path for directories outside the current workspace/project.'
      },
      label: {
        type: 'string',
        description: 'Optional short label explaining what this root is, such as the project name.'
      }
    },
    required: ['path']
  },
  execute: async (args: ToolArgs, ctx: ToolExecutionContext) => {
    const inputPath = typeof args.path === 'string' ? args.path.trim() : ''
    if (!inputPath) throw new Error('Missing or invalid path parameter')
    if (!isAbsolute(inputPath)) {
      throw new Error('workspace_add_root requires an absolute directory path.')
    }

    const run = ctx.reqId ? getRun(ctx.reqId) : undefined
    if (!run) throw new Error('No active agent run context is available.')

    const resolvedPath = normalizeRootPath(inputPath)
    let realPath: string
    try {
      realPath = await fs.realpath(resolvedPath)
    } catch {
      throw new Error('Directory does not exist: ' + inputPath)
    }

    const stats = await fs.stat(realPath)
    if (!stats.isDirectory()) throw new Error('Path is not a directory: ' + inputPath)

    const parsed = parse(realPath)
    if (realPath.replace(/[\\/]+$/, '') === parsed.root.replace(/[\\/]+$/, '')) {
      throw new Error('Refusing to add a filesystem drive/root directory as an agent root.')
    }
    if (basename(realPath).toLowerCase() === '.git') {
      throw new Error(
        'Refusing to add a .git directory as an agent root. Add the project root instead.'
      )
    }
    if (isSensitiveDirectoryForRoot(realPath)) {
      throw new Error(
        'Refusing to add a sensitive directory (home/credential directory or OS system zone) as an agent root.'
      )
    }

    const label = typeof args.label === 'string' ? args.label : undefined
    const added = run.addAdditionalRoot(realPath, label)
    const roots = run.getAdditionalRoots()

    const rootLines = roots.map(
      (root, index) => String(index + 1) + '. ' + (root.label ? root.label + ': ' : '') + root.path
    )
    const resultForModel = [
      'Added reference root: ' + added.path,
      added.label ? 'Label: ' + added.label : '',
      '',
      'Accessible roots for this conversation:',
      ...rootLines,
      '',
      'Use absolute paths under these roots with file tools. For workspace_search/workspace_list_files, pass the added directory as the optional path parameter.'
    ]
      .filter((line) => line !== undefined)
      .join('\n')

    return createToolResult({
      resultForModel,
      title: 'Add Reference Root',
      summary: 'Added reference root ' + added.path,
      details: resultForModel,
      items: roots.map((root) => ({
        title: root.label || root.path,
        url: 'file:///' + root.path.replace(/\\/g, '/'),
        snippet: root.path,
        source: 'workspace_add_root'
      }))
    })
  }
}
