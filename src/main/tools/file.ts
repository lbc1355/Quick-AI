import { ToolDefinition } from './types'
import { fileDiffTool } from './fileDiff'
import { fileOperationTools } from './fileOperations'
import { fileSearchTools } from './fileSearch'
import { codeSymbolTool } from './codeSymbolTool'
import { fileReadTool } from './fileReadTool'
import { imageReadTool } from './imageReadTool'
import { fileMutationTools } from './fileMutationTools'

export const fileTools: Record<string, ToolDefinition> = {
  file_read: fileReadTool,
  image_read: imageReadTool,
  code_symbol_read: codeSymbolTool,
  ...fileSearchTools,
  ...fileMutationTools,
  ...fileOperationTools,
  file_diff: fileDiffTool
}
