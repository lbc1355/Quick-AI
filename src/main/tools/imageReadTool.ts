import { promises as fs } from 'fs'
import { extname } from 'path'
import { ToolArgs } from '../../shared/types'
import { ROOT_PARAMETER, getRootArg, resolveExistingSafePath } from './filePathSafety'
import { ToolDefinition } from './types'

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export const imageReadTool: ToolDefinition = {
  name: 'image_read',
  title: 'Read Image',
  description:
    'Reads a local image inside the global workspace or current project root and attaches it to the next multimodal model call. Use this instead of file_read for PNG, JPEG, WebP, or GIF images.',
  tags: ['file', 'read', 'image', 'vision', 'multimodal', 'local', '图片', '本地图片', '视觉'],
  category: 'file',
  risk: 'low',
  implemented: true,
  discoverable: true,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The relative or absolute path to the image file.' },
      root: ROOT_PARAMETER
    },
    required: ['path']
  },
  execute: async (args: ToolArgs, ctx) => {
    const imagePath = args.path
    if (typeof imagePath !== 'string' || !imagePath) {
      throw new Error('Missing or invalid path parameter')
    }

    const target = await resolveExistingSafePath(imagePath, ctx, 'Path', getRootArg(args))
    const extension = extname(target.realPath).toLowerCase()
    const mime = IMAGE_MIME_BY_EXTENSION[extension]
    if (!mime) {
      throw new Error(
        `Unsupported image type "${extension || '(none)'}". Supported types: PNG, JPEG, WebP, GIF.`
      )
    }

    const stats = await fs.stat(target.realPath)
    if (stats.isDirectory()) {
      throw new Error('Path is a directory, not an image file.')
    }

    const MAX_IMAGE_BYTES = 5 * 1024 * 1024
    if (stats.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is too large (${formatBytes(stats.size)}). Max supported size is ${formatBytes(MAX_IMAGE_BYTES)}.`
      )
    }

    const buffer = await fs.readFile(target.realPath)
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
    const fileUrl = `file:///${target.realPath.replace(/\\/g, '/')}`

    return {
      resultForModel: [
        'Image loaded for multimodal context.',
        `Root (${target.rootKind}): ${target.root}`,
        `File: ${target.relPath}`,
        `MIME: ${mime}`,
        `Size: ${formatBytes(stats.size)}`,
        'The image itself is attached to the next model call. Inspect the attached image directly rather than treating the file path as visible content.'
      ].join('\n'),
      resultForUi: {
        title: `Read Image: ${target.relPath}`,
        url: fileUrl,
        summary: `Loaded ${target.relPath} (${mime}, ${formatBytes(stats.size)}) for multimodal context`
      },
      modelAttachments: [{ type: 'image_url', image_url: { url: dataUrl } }]
    }
  }
}
