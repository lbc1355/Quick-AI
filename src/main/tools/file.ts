import { ToolDefinition } from './types'
import { fileDiffTool } from './fileDiff'
import { fileOperationTools } from './fileOperations'
import { fileSearchTools } from './fileSearch'
import { codeSymbolTool } from './codeSymbolTool'
import { fileReadTool } from './fileReadTool'
import { imageReadTool } from './imageReadTool'
import { fileWriteTool } from './fileWriteTool'
import { fileEditTool } from './fileEditTool'
import { multiEditTool } from './multiEditTool'

export const fileTools: Record<string, ToolDefinition> = {
  file_read: fileReadTool,
  image_read: imageReadTool,
  code_symbol_read: codeSymbolTool,
  file_write: fileWriteTool,
  file_edit: fileEditTool,
  multi_edit: multiEditTool,
  ...fileSearchTools,
  ...fileOperationTools,
  file_diff: fileDiffTool
}
