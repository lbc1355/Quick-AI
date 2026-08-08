# QuickAI 功能业务契约(Feature Business Contracts)

> 与 `.feature-doc-graph/graph.db` 中的功能文档图对应(14 Feature / 29 Flow / 63 Symbol)。
> 本文档记录静态图无法推导的业务语义:触发事件、终态、边界与硬性约束。
> 状态约定:`draft` → `proposed` → `reviewed`,由人工审阅后更新。

---

## 1. chat(聊天对话)

- **触发事件**:用户在输入框提交消息、选择重新生成、编辑消息后重发,或通过 `/` 指令/`@` 技能触发发送。
- **终态**:
  - 成功:流式回复完整展示并写入会话记录;
  - 中止:用户取消、窗口失焦策略触发或运行被中止,已生成部分保留;
  - 失败:模型调用异常/API Key 缺失,界面提示错误且不产生半条消息。
- **负责范围**:消息发送、提示词组装(`prepareChatAgentMessages`)、协调一次运行(`startCoordinatedRun`)、Agent 主循环调度、会话忙碌互斥。
- **不负责**:模型服务商配置(→ model-providers)、会话持久化细节(→ session-management)、工具执行策略(→ agent-run)。
- **硬性约束**:
  - 发送前必须确保所选模型服务商的 API Key 已配置;
  - 会话忙碌(`isSessionBusy`)时禁止重复提交;
  - 分支/重新生成必须保留原运行的执行状态与行动日志。

## 2. agent-run(Agent 智能体执行)

- **触发事件**:一次协调运行被启动(`startCoordinatedRun`);模型回复中出现工具调用(tool_calls)。
- **终态**:
  - 完成:模型产出最终回复,运行切片持久化,事件流关闭;
  - 中止:超时、loopGuard 触发、用户中止,checkpoint 已落盘可恢复;
  - 失败:模型调用连续失败触发重试策略耗尽。
- **负责范围**:运行前准备(`prepareAgentRun`)、ReAct 主循环、工具调用规划(`prepareToolCalls`)与工具回合执行(`runToolTurn`)、事件流与运行生命周期。
- **不负责**:具体工具的内部实现(→ file-operations 等)、会话 UI(→ chat)。
- **硬性约束**:
  - 每次运行必须受 loopGuard 限制,禁止无限循环;
  - 工具执行前必须经过权限校验(allow/ask/deny)与命令安全评级;
  - 每步执行后必须更新 checkpoint,保证中断可恢复且不重放有副作用的成功工具。

## 3. session-management(会话管理)

- **触发事件**:新建会话、启动一次运行(create-run)、应用启动时恢复被中断的运行、用户在历史消息上分支/重生成。
- **终态**:
  - 创建:run 上下文与 manifest 建立,checkpoint 首次落盘;
  - 恢复:从 checkpoint 载入进度、合并事件日志后继续执行;
  - 分支:克隆会话的 checkpoint 与事件日志复制完成,可无副作用探索。
- **负责范围**:AgentRunContext 生命周期、runManifest 记录、checkpoint 持久化/加载/删除/复制、Agent 事件日志写入与恢复合并。
- **不负责**:聊天 UI 交互(→ chat)、SQLite 会话表的具体存储(→ 存储层)。
- **硬性约束**:
  - 恢复时已成功执行的有副作用工具不得重放;
  - 分支派生必须同步复制 checkpoint、事件日志与行动日志,否则视为不完整分支;
  - checkpoint 与日志文件带版本号,解析失败必须安全降级(视为无 checkpoint)。

## 4. file-operations(文件操作)

- **触发事件**:模型在运行中调用文件类工具(fileRead/fileWrite/fileEdit/multiEdit/fileCopy/fileMove/fileDelete/directoryCreate)。
- **终态**:
  - 成功:返回文件内容或变更结果(含 diff/校验信息);
  - 拒绝:路径越界、敏感文件命中、写入冲突等,返回明确错误且不产生副作用。
- **负责范围**:文件读/写/编辑/多编辑/复制/移动/删除/建目录、结果归一化。
- **不负责**:路径授权策略(→ agent-run 的 toolCallPlanning)、工作区根管理。
- **硬性约束**:
  - 所有路径必须通过路径安全校验(防逃逸到 workspace/project 根之外);
  - 敏感文件(`.env`、`.pem`、凭据类)读取必须升级阻断;
  - 写入/编辑必须返回可被模型消费的结果(校验、diff、新内容窗口)。

## 5. web-research(网络研究)

- **触发事件**:模型调用 webSearch / webFetch / pdfRead / imageRead 工具(含加载页面的 PDF/图片解析)。
- **终态**:
  - 成功:返回搜索结果、页面正文/标题、PDF 文本、图片解析结果;
  - 失败:URL 非法、抓取超时、解析失败,返回错误且不落脏缓存。
- **负责范围**:搜索(多引擎解析)、URL 抓取与正文提取、PDF 文本抽取、图片读取、URL 安全校验。
- **不负责**:结果缓存策略(→ 缓存层)、搜索引擎后端实现。
- **硬性约束**:
  - URL 必须通过 `validatePublicHttpUrl`(防 SSRF、防内网探测);
  - 抓取必须遵守超时与大小上限,防止资源耗尽;
  - 搜索/抓取结果必须格式化为模型可消费的结构。

## 6. shell-execution(Shell 执行)

- **触发事件**:模型调用 shell 工具或后台 shell 工具(start/read/stop/list)。
- **终态**:
  - 成功:命令输出(stdout/stderr)返回;后台任务启动并可被读取/停止;
  - 拒绝:命令命中危险评级/黑名单,`assertCommandNotDangerous` 抛出阻断;
  - 失败:超时、输出超限、进程异常退出。
- **负责范围**:命令词法危险度评级、前台/后台命令执行、后台任务生命周期与持久化、输出窗口读取。
- **不负责**:权限询问交互(→ agent-run)。
- **硬性约束**:
  - 危险命令(评级/黑名单命中)必须无条件阻断;
  - 前台命令必须有时限与输出上限;后台任务必须持久化状态以便跨运行读取;
  - 命令输出需要兼容 Windows 编码(GBK 处理)。

## 7. skill-management(技能管理)

- **触发事件**:应用启动扫描技能目录;用户/模型调用技能工具(create/install/validate/remove/list/load/read)。
- **终态**:
  - 成功:技能列表/加载/安装/校验/移除完成并返回结果;
  - 失败:包结构非法、路径无效、覆盖冲突,返回校验错误。
- **负责范围**:技能目录发现(`loadSkillsFromFolders`)、SKILL.md 解析、技能工具暴露(读取/加载)、生命周期管理(创建/安装/校验/移除)。
- **不负责**:技能在 Agent 提示词中的注入策略(→ agent-run 的消息构建)。
- **硬性约束**:
  - 安装前必须校验包结构(SKILL.md 存在、元数据合法);
  - 系统技能目录受保护,不允许移除/覆盖;
  - 重复安装必须显式确认覆盖语义,不允许静默覆盖。

## 8. long-term-memory(长期记忆)

- **触发事件**:Agent 运行产生可沉淀知识时写入;用户/模型主动读取记忆;应用启动加载常驻记忆。
- **终态**:
  - 成功:记忆条目(always/task_group/rollout/raw)写入或读取完成,索引刷新;
  - 版本化:每次变更自动 Git 提交,可追溯历史。
- **负责范围**:记忆文件读写、Task Group 管理、摘要索引重建、Git 版本化(ensureRepo/commit)。
- **不负责**:记忆内容注入提示词(→ agent-run 的 memoryContext/messageBuilder)。
- **硬性约束**:
  - 只写入稳定、可复用的知识;禁止记录一次性上下文或未验证猜测;
  - 敏感信息(密钥/一次性路径)不得写入记忆;
  - Git 不可用时必须降级为普通文件写入,不阻塞主流程。

## 9. model-providers(模型服务商配置)

- **触发事件**:应用启动初始化设置;用户在设置界面增删改服务商、切换 API Key、触发模型列表发现。
- **终态**:
  - 成功:提供商/模型目录就绪,模型发现结果写入缓存;
  - 失败:发现失败时保留上次有效缓存,并记录错误状态供 UI 提示。
- **负责范围**:设置初始化(`initSettings`)、provider 注册校验、模型发现策略与缓存(成功/失败分支)。
- **不负责**:实际模型 API 调用(→ agent-run 的 modelCallRuntime)。
- **硬性约束**:
  - 核心预置服务商必须存在,缺失时自动补齐;
  - API Key 存储必须安全,UI 只读掩码展示;
  - 模型发现失败必须走缓存降级,不得阻塞会话发送。

## 10. mcp-integration(MCP 集成)

- **触发事件**:应用启动加载 MCP 配置;用户通过设置界面增删/重载服务器。
- **终态**:
  - 成功:stdio 客户端连接建立,工具列表拉取并注册进工具注册表;
  - 失败:连接超时/进程异常,清理客户端并移除该服务器工具,不影响其他服务器。
- **负责范围**:MCP 服务器连接(`connectServer`)、工具列表同步、配置读写(`readConfigRaw`/`writeConfigRaw`)、连接超时与失败清理。
- **不负责**:外部 MCP 服务器的内部实现;工具在 Agent 中的权限策略(→ agent-run)。
- **硬性约束**:
  - 连接必须有超时保护,失败必须清理半连接状态;
  - 配置写入前必须 JSON 校验,非法配置拒绝保存;
  - 服务器工具变更须刷新工具注册表,避免残留失效工具声明。

---

## 11. reasoning(推理控制)

- **触发事件**:每次 Agent 运行启动时解析推理偏好(含 resume 继承与模型能力适配)。
- **终态**:解析并适配出模型可用的推理偏好,写入运行生命周期供模型请求编码使用。
- **负责范围**:运行级推理偏好解析、resume 继承、按模型能力适配(`fitReasoningPreference`)、偏好归一化。
- **不负责**:UI 推理选择器(→ renderer ReasoningLevelSelector)、模型请求的具体编码(→ agent-run model request)。
- **硬性约束**:
  - 偏好必须归一化为合法取值;
  - 适配必须受模型能力约束,不支持推理的模型强制 auto。

## 12. file-snapshot(工作区文件快照)

- **触发事件**:运行开始捕获基线;副作用工具批次落定后增量 checkpoint。
- **终态**:工作区文件树快照捕获完成,变更清单(`file_changes`)发出,支持回滚与两级恢复。
- **负责范围**:运行级文件快照、副作用批次 checkpoint、变更清单生成、回滚支撑。
- **不负责**:具体文件工具实现(→ file-operations)。
- **硬性约束**:
  - 快照需在副作用批次后立即捕获,避免丢失中间态;
  - 快照失败需安全降级,不得阻塞主循环。

## 13. session-clear(会话清除与撤销)

- **触发事件**:用户执行 `/clear` 指令或点击清空历史按钮。
- **终态**:
  - 成功:会话消息/标题/资源被清空且可撤销;
  - 撤销:还原 pre-clear 会话;
  - 提交:下一条提示词丢弃 undo 快照并清理孤儿资源缓存。
- **负责范围**:会话清除暂存(`clearedDraft`)、撤销清除(`handleUndoClear`)、延迟的资源缓存清理(commit 时)、被取代暂存态的即时清理。
- **不负责**:会话分支/恢复(→ session-management)、会话消息渲染(→ chat)。
- **硬性约束**:
  - 清除可撤销直到下一条提示词提交(与 revert 一致);
  - 撤销必须完整还原消息/标题/资源;
  - 资源缓存清理延迟到提交时,按孤儿资源计算;
  - 不得误删其他会话仍引用的共享缓存。

---

## 14. context-compaction(上下文压缩)

- **触发事件**:用户执行 `/compact` 指令或点击压缩按钮。
- **终态**:
  - 成功:模型摘要拼接进历史,contextEpoch +1,toast 反馈已总结条数;
  - 取消:AbortError 干净回滚且无错误提示;
  - 失败:错误 toast + 状态还原。
- **负责范围**:压缩触发与可压缩性校验、模型摘要生成(`compactContextWithModel`)、结果拼接(`applyCompactionResult`)、压缩 dock 状态与计时、取消压缩(`cancelCompaction`/`abortCompaction`)。
- **不负责**:运行中的 stale 工具结果修剪(→ agent-run)、自动上下文裁剪(→ agent-run contextManager)。
- **硬性约束**:
  - 压缩期间会话忙(阻止并发发送);
  - 取消经 AbortController 中止主进程模型调用;
  - 摘要插入到压缩边界之后,历史中间。

---

## 变更记录

| 日期 | 变更 | 状态 |
| --- | --- | --- |
| 2026-08-06 | 首次编写 10 个功能的业务契约 | draft |
| 2026-08-08 | 契约与图同步为 13 个功能;新增 reasoning、file-snapshot、session-clear | draft |
| 2026-08-08 | 契约与图同步为 14 个功能;新增 context-compaction | draft |
