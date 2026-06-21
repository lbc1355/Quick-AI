export function buildMessageNavPreview(
  content: string,
  files?: Array<{ name: string; content: string; type: string }>
): string {
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^\s*\[[^\]]+\]\s*/gm, ' ')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (text) return text.length > 88 ? `${text.slice(0, 85)}...` : text

  const fileNames = files?.map((file) => file.name).filter(Boolean) || []
  if (fileNames.length > 0) {
    const shown = fileNames.slice(0, 2).join(', ')
    return fileNames.length > 2 ? `附件：${shown} 等 ${fileNames.length} 个文件` : `附件：${shown}`
  }

  return '空消息'
}
