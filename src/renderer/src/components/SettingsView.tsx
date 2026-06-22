import React, { useEffect, useState } from 'react'
import {
  Bot,
  Brain,
  Boxes,
  FolderCog,
  ServerCog,
  SlidersHorizontal,
  type LucideIcon
} from 'lucide-react'
import {
  AgentToolInfo,
  ApiProvider,
  Skill,
  SkillInstallPayload,
  WebSearchProviderType
} from '../../../shared/types'
import { ProviderList } from './ProviderList'
import { ProviderEditor } from './ProviderEditor'
import { SkillManager } from './SkillManager'
import { MemoryManager } from './MemoryManager'
import { McpManagerView } from './McpManagerView'
import { CapabilitiesPanel } from './CapabilitiesPanel'

interface SettingsViewProps {
  isEditingProviderDetail: boolean
  editingProviderId: string
  activeProviderId: string
  providers: ApiProvider[]
  apiKey: string
  apiUrl: string
  selectedModel: string
  modelsList: string[]
  modelContextWindows: Record<string, number>
  manualModelInput: string
  fetchModelsUrl: string
  isFetchingModels: boolean
  refreshingModelContextId: string | null
  showAddForm: boolean
  newProviderName: string
  newProviderType: ApiProvider['type']
  systemPrompt: string
  autoHideOnBlur: boolean
  appStorePath: string
  saveSuccess: boolean
  skills: Skill[]
  activeSessionId: string | null

  setIsEditingProviderDetail: (val: boolean) => void
  setApiKey: (val: string) => void
  setSelectedModel: (val: string) => void
  setManualModelInput: (val: string) => void
  setFetchModelsUrl: (val: string) => void
  setShowAddForm: (val: boolean) => void
  setNewProviderName: (val: string) => void
  setNewProviderType: (val: ApiProvider['type']) => void
  setSystemPrompt: (val: string) => void
  setAutoHideOnBlur: (val: boolean) => void

  onSaveGlobalSettings: () => void
  onSaveProviderDetails: () => void
  onAddProvider: (name: string, type: ApiProvider['type']) => void
  onSetActiveProvider: (id: string) => void
  onStartEditingProvider: (id: string) => void
  onDeleteProvider: (id: string) => void
  onAddManualModel: () => void
  onFetchModels: () => void
  onRefreshModelContext: (modelId: string) => void
  onRemoveModel: (modelId: string) => void
  onChangeModelContextWindow: (modelId: string, value: string) => void
  onInstallSkill: (payload: SkillInstallPayload) => Promise<Skill>
  onRemoveSkill: (id: string) => Promise<void>
  onChangeEditingProviderName: (name: string) => void
  onChangeEditingProviderApiUrl: (url: string) => void
  permissions: Record<string, 'allow' | 'ask' | 'deny'>
  onChangeToolPermission: (toolName: string, policy: 'allow' | 'ask' | 'deny') => void
  webSearchProvider: WebSearchProviderType
  setWebSearchProvider: (val: WebSearchProviderType) => void
  webSearchApiKey: string
  setWebSearchApiKey: (val: string) => void
}

type SettingsSection = 'providers' | 'general' | 'agent' | 'skills' | 'memory' | 'mcp'
type ToolDisplayLanguage = 'zh' | 'en'
type SettingsGroup = 'desktop' | 'services' | 'resources'

const settingsGroups: Array<{ id: SettingsGroup; label: string }> = [
  { id: 'desktop', label: '桌面' },
  { id: 'services', label: '服务' },
  { id: 'resources', label: '资源' }
]

const settingsSections: Array<{
  id: SettingsSection
  group: SettingsGroup
  label: string
  detail: string
  icon: LucideIcon
}> = [
  {
    id: 'general',
    group: 'desktop',
    label: '通用',
    detail: '提示词与窗口',
    icon: SlidersHorizontal
  },
  { id: 'agent', group: 'desktop', label: 'Agent', detail: '工具执行策略', icon: Bot },
  { id: 'providers', group: 'services', label: '服务商', detail: 'API 与模型', icon: ServerCog },
  { id: 'mcp', group: 'services', label: 'MCP', detail: '外部工具服务', icon: FolderCog },
  { id: 'skills', group: 'resources', label: 'Skills', detail: '技能与文件夹', icon: Boxes },
  { id: 'memory', group: 'resources', label: '记忆', detail: '长期与按需记忆', icon: Brain }
]

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

function getToolDisplay(
  tool: AgentToolInfo,
  language: ToolDisplayLanguage
): { title: string; description: string } {
  if (language === 'zh') {
    return toolTranslations[tool.name] || { title: tool.title, description: tool.description }
  }
  return { title: tool.title, description: tool.description }
}

function getInitialToolLanguage(): ToolDisplayLanguage {
  try {
    return window.localStorage.getItem('quickai.agentToolLanguage') === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  isEditingProviderDetail,
  editingProviderId,
  activeProviderId,
  providers,
  apiKey,
  apiUrl,
  selectedModel,
  modelsList,
  modelContextWindows,
  manualModelInput,
  fetchModelsUrl,
  isFetchingModels,
  refreshingModelContextId,
  showAddForm,
  newProviderName,
  newProviderType,
  systemPrompt,
  autoHideOnBlur,
  appStorePath,
  saveSuccess,
  skills,
  activeSessionId,

  setIsEditingProviderDetail,
  setApiKey,
  setSelectedModel,
  setManualModelInput,
  setFetchModelsUrl,
  setShowAddForm,
  setNewProviderName,
  setNewProviderType,
  setSystemPrompt,
  setAutoHideOnBlur,

  onSaveGlobalSettings,
  onSaveProviderDetails,
  onAddProvider,
  onSetActiveProvider,
  onStartEditingProvider,
  onDeleteProvider,
  onAddManualModel,
  onFetchModels,
  onRefreshModelContext,
  onRemoveModel,
  onChangeModelContextWindow,
  onInstallSkill,
  onRemoveSkill,
  onChangeEditingProviderName,
  onChangeEditingProviderApiUrl,
  permissions,
  onChangeToolPermission,
  webSearchProvider,
  setWebSearchProvider,
  webSearchApiKey,
  setWebSearchApiKey
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('providers')
  const [agentTools, setAgentTools] = useState<AgentToolInfo[]>([])
  const [toolDisplayLanguage, setToolDisplayLanguage] =
    useState<ToolDisplayLanguage>(getInitialToolLanguage)
  const currentEditingProvider = providers.find((p) => p.id === editingProviderId)
  const activeProvider = providers.find((p) => p.id === activeProviderId)

  const setToolLanguage = (language: ToolDisplayLanguage): void => {
    setToolDisplayLanguage(language)
    try {
      window.localStorage.setItem('quickai.agentToolLanguage', language)
    } catch {
      // Display preference only; ignore storage failures.
    }
  }

  useEffect(() => {
    if (activeSection !== 'agent') return
    let cancelled = false
    window.api
      .listAgentTools()
      .then((tools) => {
        if (!cancelled) setAgentTools(tools)
      })
      .catch((error) => {
        console.error('Failed to load agent tools:', error)
        if (!cancelled) setAgentTools([])
      })
    return () => {
      cancelled = true
    }
  }, [activeSection])

  if (isEditingProviderDetail) {
    return (
      <div className="settings-container">
        <ProviderEditor
          provider={currentEditingProvider}
          apiKey={apiKey}
          apiUrl={apiUrl}
          selectedModel={selectedModel}
          modelsList={modelsList}
          modelContextWindows={modelContextWindows}
          manualModelInput={manualModelInput}
          fetchModelsUrl={fetchModelsUrl}
          isFetchingModels={isFetchingModels}
          refreshingModelContextId={refreshingModelContextId}
          onSave={onSaveProviderDetails}
          onCancel={() => setIsEditingProviderDetail(false)}
          onChangeName={onChangeEditingProviderName}
          onChangeApiKey={setApiKey}
          onChangeApiUrl={onChangeEditingProviderApiUrl}
          onChangeSelectedModel={setSelectedModel}
          onChangeManualModelInput={setManualModelInput}
          onChangeFetchModelsUrl={setFetchModelsUrl}
          onAddManualModel={onAddManualModel}
          onFetchModels={onFetchModels}
          onRefreshModelContext={onRefreshModelContext}
          onRemoveModel={onRemoveModel}
          onChangeModelContextWindow={onChangeModelContextWindow}
        />
      </div>
    )
  }

  return (
    <div className="settings-container">
      <div className="control-panel">
        <aside className="control-panel-sidebar">
          <div className="control-panel-title-block">
            <span className="control-panel-kicker">QuickAI Desktop</span>
            <span className="control-panel-title">设置</span>
          </div>

          <nav className="control-panel-nav" aria-label="Settings sections">
            {settingsGroups.map((group) => {
              const groupSections = settingsSections.filter((section) => section.group === group.id)
              return (
                <div key={group.id} className="control-panel-nav-group">
                  <span className="control-panel-nav-group-label">{group.label}</span>
                  {groupSections.map((section) => {
                    const SectionIcon = section.icon
                    return (
                      <button
                        key={section.id}
                        type="button"
                        className={`control-panel-nav-item ${
                          activeSection === section.id ? 'active' : ''
                        }`}
                        onClick={() => setActiveSection(section.id)}
                      >
                        <SectionIcon size={15} />
                        <span className="control-panel-nav-text">
                          <span>{section.label}</span>
                          <small>{section.detail}</small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          <div className="control-panel-sidebar-footer">
            <div className="control-panel-product">
              <span>QuickAI Desktop</span>
              <small>v1.0.0</small>
            </div>
            <button
              type="button"
              className={`settings-save-btn control-save-btn ${saveSuccess ? 'saved' : ''}`}
              onClick={onSaveGlobalSettings}
            >
              {saveSuccess ? '已保存' : '保存设置'}
            </button>
          </div>
        </aside>

        <main className="control-panel-content">
          {activeSection === 'providers' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>服务商</h2>
                  <p>{activeProvider ? `${activeProvider.name} / ${selectedModel}` : '未选择'}</p>
                </div>
              </header>
              <ProviderList
                providers={providers}
                activeProviderId={activeProviderId}
                showAddForm={showAddForm}
                newProviderName={newProviderName}
                newProviderType={newProviderType}
                setShowAddForm={setShowAddForm}
                setNewProviderName={setNewProviderName}
                setNewProviderType={setNewProviderType}
                onAddProvider={onAddProvider}
                onSetActiveProvider={onSetActiveProvider}
                onStartEditingProvider={onStartEditingProvider}
                onDeleteProvider={onDeleteProvider}
              />
            </section>
          )}

          {activeSection === 'general' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>通用</h2>
                  <p>System Prompt / Window</p>
                </div>
              </header>

              <div className="setting-list">
                <label className="setting-row setting-row-block">
                  <span className="setting-row-main">
                    <strong>系统预设提示词</strong>
                    <small>作为每次对话的基础行为说明，会影响 agent 的默认工作方式</small>
                  </span>
                  <textarea
                    className="settings-input settings-textarea"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                  />
                </label>

                <label className="setting-row">
                  <span className="setting-row-main">
                    <strong>失焦自动隐藏</strong>
                    <small>窗口失去焦点时自动隐藏面板</small>
                  </span>
                  <span className="setting-row-control">
                    <input
                      type="checkbox"
                      className="settings-checkbox settings-switch"
                      checked={autoHideOnBlur}
                      onChange={(e) => setAutoHideOnBlur(e.target.checked)}
                    />
                  </span>
                </label>

                <div className="setting-row">
                  <span className="setting-row-main">
                    <strong>本地数据存储路径</strong>
                    <small>会话、配置和本地缓存的保存位置</small>
                  </span>
                  <span className="setting-row-control setting-row-control-wide">
                    <input
                      type="text"
                      className="settings-input settings-path-input"
                      value={appStorePath}
                      readOnly
                      disabled
                    />
                  </span>
                </div>
              </div>
            </section>
          )}

          {activeSection === 'agent' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>Agent 权限</h2>
                  <p>Allow / Ask / Deny</p>
                </div>
              </header>

              <div className="setting-list setting-list-spaced">
                <div className="setting-row">
                  <span className="setting-row-main">
                    <strong>网络搜索引擎</strong>
                    <small>配置 API 后可获得更稳定的结果；无 Key 时回退到内置抓取</small>
                  </span>
                  <span className="setting-row-control">
                    <select
                      className="settings-select"
                      value={webSearchProvider}
                      onChange={(e) =>
                        setWebSearchProvider(e.target.value as WebSearchProviderType)
                      }
                    >
                      <option value="auto">自动</option>
                      <option value="html">内置抓取</option>
                      <option value="tavily">Tavily API</option>
                      <option value="brave">Brave Search API</option>
                    </select>
                  </span>
                </div>

                {webSearchProvider !== 'html' && (
                  <label className="setting-row">
                    <span className="setting-row-main">
                      <strong>搜索 API Key</strong>
                      <small>
                        {webSearchProvider === 'brave'
                          ? 'Brave Search 订阅令牌'
                          : webSearchProvider === 'tavily'
                            ? 'Tavily API 密钥'
                            : 'Auto 模式下默认作为 Tavily Key 使用'}
                      </small>
                    </span>
                    <span className="setting-row-control setting-row-control-wide">
                      <input
                        type="password"
                        className="settings-input"
                        placeholder={
                          webSearchProvider === 'brave'
                            ? 'Brave Search 订阅令牌'
                            : webSearchProvider === 'tavily'
                              ? 'tvly-...'
                              : 'API Key'
                        }
                        value={webSearchApiKey}
                        onChange={(e) => setWebSearchApiKey(e.target.value)}
                      />
                    </span>
                  </label>
                )}
              </div>

              <CapabilitiesPanel
                tools={agentTools}
                permissions={permissions}
                toolDisplayLanguage={toolDisplayLanguage}
                onToolDisplayLanguageChange={setToolLanguage}
                getToolDisplay={getToolDisplay}
                onChangeToolPermission={onChangeToolPermission}
              />
            </section>
          )}

          {activeSection === 'skills' && (
            <section className="control-section">
              <header className="control-section-header">
                <div>
                  <h2>Skills</h2>
                  <p>{skills.length} installed</p>
                </div>
              </header>
              <SkillManager
                skills={skills}
                onInstallSkill={onInstallSkill}
                onRemoveSkill={onRemoveSkill}
              />
            </section>
          )}

          {activeSection === 'memory' && (
            <section
              className="control-section"
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <header className="control-section-header" style={{ flexShrink: 0 }}>
                <div>
                  <h2>记忆管理</h2>
                  <p>管理全局及单会话的常态和按需记忆分类</p>
                </div>
              </header>
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <MemoryManager sessionId={activeSessionId} />
              </div>
            </section>
          )}

          {activeSection === 'mcp' && (
            <section
              className="control-section"
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <header className="control-section-header" style={{ flexShrink: 0 }}>
                <div>
                  <h2>MCP 外部工具</h2>
                  <p>通过 Model Context Protocol 协议配置外部工具服务器</p>
                </div>
              </header>
              <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
                <McpManagerView />
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
