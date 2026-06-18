import { ToolDefinition } from './types'
import { fileDiffTool } from './fileDiff'
import { fileOperationTools } from './fileOperations'
import { fileSearchTools } from './fileSearch'
import { codeSymbolTool } from './codeSymbolTool'
import { fileReadTool } from './fileReadTool'
import { fileMutationTools } from './fileMutationTools'

export const fileTools: Record<string, ToolDefinition> = {
  file_read: fileReadTool,
  code_symbol_read: codeSymbolTool,
  ...fileSearchTools,
  ...fileMutationTools,
  ...fileOperationTools,
  file_diff: fileDiffTool
}
