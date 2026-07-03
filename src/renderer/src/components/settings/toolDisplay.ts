import type { AgentToolInfo } from '../../../../shared/types'

export type ToolDisplayLanguage = 'zh' | 'en'

const toolTranslations: Record<string, { title: string; description: string }> = {
  ask_user_choice: {
    title: '询问用户选择',
    description: '弹出选项让用户做决定，适合需要用户确认方案、工具、数据库等分支选择的场景。'
  },
  cancel_reminder: {
    title: '取消提醒',
    description: '根据提醒 ID 取消一个尚未触发的桌面提醒。'
  },
  click_link: {
    title: '打开页面链接',
    description: '从已抓取网页中的编号链接继续打开目标页面，并把目标页面缓存到当前对话。'
  },
  code_symbol_read: {
    title: '读取代码符号',
    description: '按函数、类、方法、类型等符号名定位代码块，并返回附近上下文。'
  },
  create_skill: {
    title: '创建 Skill',
    description: '在本地创建一个 QuickAI Skill，包括说明文档和可选的展示元数据。'
  },
  delete_memory: {
    title: '删除记忆',
    description: '从记忆库中删除指定任务组或持久记忆条目。'
  },
  directory_create: {
    title: '创建目录',
    description: '在工作区或当前项目内创建目录，可按需创建父级目录。'
  },
  fetch_url: {
    title: '抓取网页',
    description: '抓取公开 HTTP/HTTPS 网页内容，返回标题、正文和提取到的链接。'
  },
  file_copy: {
    title: '复制文件',
    description: '在工作区或当前项目内复制文件，支持按需创建目标父目录。'
  },
  file_delete: {
    title: '删除文件或目录',
    description: '删除工作区或当前项目内的文件；删除目录需要显式开启递归参数。'
  },
  file_diff: {
    title: '比较文件',
    description: '对比两个文件内容并返回简短 diff，用于审查改动或定位差异。'
  },
  file_edit: {
    title: '编辑文件',
    description: '对已读取过的文件执行精确字符串替换，成功后返回简短 diff。'
  },
  file_move: {
    title: '移动文件或目录',
    description: '移动或重命名工作区/当前项目内的文件或目录。'
  },
  file_read: {
    title: '读取本地文件',
    description: '读取工作区或当前项目内的文本文件，支持行号、范围、尾部和 around 上下文读取。'
  },
  file_write: {
    title: '写入本地文件',
    description: '写入或创建工作区/当前项目内的文件，可选择是否覆盖已有文件。'
  },
  find_in_page: {
    title: '页内查找',
    description: '在已缓存网页的完整文本中搜索关键词，返回匹配行和上下文。'
  },
  get_past_action: {
    title: '查看历史工具详情',
    description: '根据 callId 读取当前对话中过去某次工具调用的详细记录。'
  },
  image_read: {
    title: '读取本地图片',
    description: '读取工作区或当前项目内的图片，并作为多模态视觉上下文传给模型。'
  },
  pdf_read: {
    title: '读取 PDF',
    description:
      '读取本地、公网 PDF 或含 PDF 链接的论文页面，arXiv 摘要链接会自动转 PDF，支持按字符 offset 分段继续读取。'
  },
  inspect_environment: {
    title: '检查本机环境',
    description: '一次性读取系统、Shell、常用开发工具版本和标准目录存在情况，避免反复 shell 探测。'
  },
  install_skill: {
    title: '安装 Skill',
    description: '从本地文件夹或 Markdown 文件安装 QuickAI Skill。'
  },
  list_cached_resources: {
    title: '列出缓存资源',
    description: '列出当前对话可用的网页、文件、文档等缓存资源 ID 和可读取偏移。'
  },
  list_memory: {
    title: '列出记忆',
    description: '查看记忆库中的常驻记忆、摘要索引、原始记忆或任务组列表。'
  },
  list_past_actions: {
    title: '列出历史工具操作',
    description: '列出当前对话中过去执行过的工具调用，便于恢复上下文而不重放全部结果。'
  },
  list_reminders: {
    title: '列出提醒',
    description: '查看当前仍未触发或未取消的桌面提醒。'
  },
  list_skills: {
    title: '列出已安装 Skills',
    description: '列出已安装的 QuickAI Skills，可按需要查看某个 Skill 的详细信息。'
  },
  load_skill: {
    title: '加载 Skill',
    description: '加载指定 Skill 的 SKILL.md 指令和辅助文件清单，供当前任务使用。'
  },
  multi_edit: {
    title: '批量编辑文件',
    description: '对已读取过的文件按顺序执行多处精确替换，成功后返回汇总 diff。'
  },
  notify: {
    title: '桌面通知',
    description: '发送系统桌面通知，用于长任务完成、重要结果或需要用户查看时提醒。'
  },
  read_cached_resource: {
    title: '读取缓存资源',
    description: '根据 resourceId 和 offset 读取之前抓取或缓存资源的文本片段。'
  },
  read_memory: {
    title: '读取记忆',
    description: '读取常驻记忆、摘要索引、原始记忆或指定任务组内容。'
  },
  read_skill_resource: {
    title: '读取 Skill 辅助文件',
    description: '按需读取某个 Skill 包内列出的辅助文件，避免一次性加载过多上下文。'
  },
  read_tool_output: {
    title: '读取截断工具输出',
    description: '读取之前因上下文限制被截断保存的完整工具输出，可按 offset 分页。'
  },
  remove_skill: {
    title: '移除 Skill',
    description: '从本地安装目录移除指定 QuickAI Skill。'
  },
  schedule_reminder: {
    title: '创建提醒',
    description: '创建一个桌面提醒，可按延迟秒数、标题和消息内容触发通知。'
  },
  search_cached_resource: {
    title: '搜索缓存资源',
    description: '在某个缓存资源中搜索关键词，返回匹配片段和可继续读取的 offset。'
  },
  shell: {
    title: '执行 Shell 命令',
    description: '在工作区根目录执行单条命令，并流式返回 stdout/stderr 输出。'
  },
  shell_background_start: {
    title: '后台启动 Shell 命令',
    description: '启动开发服务器、watcher、npm run dev 等长时间运行命令，立即返回后台进程 ID。'
  },
  shell_background_read: {
    title: '读取后台 Shell 输出',
    description: '按后台进程 ID 读取已缓冲的 stdout/stderr 日志，支持 offset 分页。'
  },
  shell_background_stop: {
    title: '停止后台 Shell 进程',
    description: '按后台进程 ID 停止命令；Windows 下会终止进程树，避免 dev server 残留。'
  },
  shell_background_list: {
    title: '列出后台 Shell 进程',
    description: '列出当前应用会话中启动过的后台 Shell 进程、状态、PID 和输出大小。'
  },
  subagent: {
    title: '派生子 Agent',
    description:
      '把独立的读取、检索或代码巡检子任务交给隔离子 agent，默认只开放低风险读工具，完成后返回摘要给主 agent。'
  },
  task: {
    title: '任务计划',
    description: '创建或更新当前任务清单状态，帮助 agent 跟踪复杂任务进度。'
  },
  validate_skill: {
    title: '校验 Skill',
    description: '校验一个或全部已安装 Skill 的结构、元数据和可用性。'
  },
  web_search: {
    title: '网络搜索',
    description: '搜索网页并返回结果摘要，必要时再配合 fetch_url 读取具体页面。'
  },
  workspace_list_files: {
    title: '列出工作区文件',
    description: '按 glob 模式列出工作区或当前项目内的文件路径。'
  },
  workspace_search: {
    title: '搜索工作区',
    description: '在工作区或当前项目内搜索文本匹配，跳过构建产物和依赖目录。'
  },
  write_memory: {
    title: '写入记忆',
    description: '把可复用事实、任务组或长期偏好写入记忆库。'
  }
}

export function getToolDisplay(
  tool: AgentToolInfo,
  language: ToolDisplayLanguage
): { title: string; description: string } {
  if (language === 'zh') {
    return toolTranslations[tool.name] || { title: tool.title, description: tool.description }
  }
  return { title: tool.title, description: tool.description }
}

export function getInitialToolLanguage(): ToolDisplayLanguage {
  try {
    return window.localStorage.getItem('quickai.agentToolLanguage') === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}
