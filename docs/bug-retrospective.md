# Quick AI Bug 复盘笔记

用于复习项目中实际遇到并修复的问题。后续每次修复 bug，按相同结构追加；验证结果只记录实际执行的检查。

## BUG-001 · 2026-10-19 · 孤立代理项导致网关返回 503

### 现象

模型请求失败，界面显示 `API Error: 503`。网关返回的底层错误是：

```text
UnicodeEncodeError: 'utf-8' codec can't encode character '\ud83c': surrogates not allowed
```

503 是网关对内部转发异常的包装。日志表明，网关处理的文本包含无法按严格 UTF-8 编码的孤立 UTF-16 代理项；这类错误通常无法通过重试相同请求解决。

### 触发条件与根因

JavaScript 字符串按 UTF-16 编码。例如 `🌟` 占两个 UTF-16 单元：`\ud83c\udf1f`。`slice()` 按 UTF-16 单元取范围，截断点落在两者之间就会留下“半个字符”。

```ts
'🌟'.slice(0, 1) // 孤立的高代理项 \ud83c
```

`JSON.stringify()` 会把孤立代理项转义成 `\ud83c`，但不会修复它。网关解析 JSON 后会再次得到孤立代理项，后续严格编码 UTF-8 时就可能抛错。

代码复核确认：上下文摘要的正文和附件截断、旧工具结果裁剪、缓存读取和网页输出裁剪都存在按 UTF-16 任意位置截断的风险。UTF-8 字节裁剪原本能保护默认首尾，但显式传入落在代理对中间的偏移时仍可能输出半个字符。

已复现与错误日志相同的 `\ud83c`。由于没有该次请求的完整快照，尚不能认定是哪一个截断入口触发了这次生产错误；外部工具或已有历史本身也可能带入非法字符串。

### 修复方案

1. 在 `src/shared/unicodeText.ts` 提供安全截断和孤立代理项修复函数。截断仍按原来的 UTF-16 偏移计数，边界落在代理对内部时排除被切开的字符；正常 emoji 和中文保持原样。
2. 将上下文摘要、旧工具输出、技能附件、工具结果预览、网页结果和缓存读取的关键截断入口改为安全截断。缓存续读偏移按实际返回文本计算，保持续读位置一致。
3. 修正 `src/main/agent/utf8Text.ts` 的显式起止偏移边界。
4. 在 `src/main/agent/serializeModelRequest.ts` 统一处理请求体中的字符串值和对象键，仅将孤立代理项替换为 Unicode 替代字符 `�`。Chat Completions 和 Responses 两个发送入口都使用它，因此普通回复、工具后续步骤、恢复执行和摘要请求均有发送边界保护。
5. 原始会话和缓存不因发送而被改写；正常请求的序列化字节与原来的 `JSON.stringify()` 一致。代码示例里的字面量 `\\ud83c` 不会被误改。

### 验证

- 新增两个协议的 mock HTTP 回归测试，检查实际发送的请求体覆盖历史文本、多模态文本块、工具调用和结果、工具描述、自定义字段，且原始输入不被修改。
- 单测覆盖孤立高/低代理项、合法 emoji/中文、请求对象键、压缩正文和附件截断、UTF-8 显式偏移、缓存续读及网页续读偏移。
- 相关回归测试：15 个文件、104 个测试全部通过，包含现有服务商适配和相关工具测试。
- Node 和 Web 两端 TypeScript 检查通过；本次修改涉及的 TypeScript 文件 ESLint 零错误、零警告。
- 验证使用本地单测和 mock HTTP，没有调用真实第三方网关，也没有该次生产请求的完整快照。

### 复习要点

- JavaScript 的 `length` / `slice()` 计数单位是 UTF-16 单元，不能据此认定截断后一定是合法 Unicode 文本。
- UTF-8 字节预算与 UTF-16 字符偏移是两回事。避免切开代理对，不等于必须改变已有偏移协议。
- `JSON.stringify()` 能生成可解析的 JSON，不代表 JSON 中每个字符串都能被其他语言严格编码为 UTF-8。
- 同时修复产生问题的截断入口，并在统一请求出口兼容已有历史和外部输入。
- 对合法输入的安全截断避免产生孤立代理项；它不承诺保留完整的组合字形，例如含多个码点的旗帜、肤色和 ZWJ emoji。

## BUG-002 · 2026-10-20 · 新对话首轮等待缺少分段计时

### 现象与已知证据

用户反馈新对话第一次发送后要等几秒，不确定在等待本地初始化还是供应商。

2026-10-19 的一个真实样本中，从前端生成请求 ID 到记录模型请求约 8.95 秒，随后到完整回答返回约 2.45 秒。其他两个首轮样本的本地准备分别约 2.83 秒和 2.71 秒。原有日志没有首个输出的独立时间点，完整回答耗时不能当成首 token 延迟。

### 根因与覆盖边界

已确认的诊断缺口是：原日志从 Agent 准备完成后才记录运行开始，未分别记录前端保存、Agent 准备、快照等待和捕获、HTTP 响应头及首个有效输出。因此可以证明有本地延迟，但无法把它准确分配到具体模块。

`src/main/agent/agentLoop.ts` 会在请求模型前等待文件快照；快照使用全局串行队列，首次使用工作目录还可能初始化独立 Git 仓库。它是主要嫌疑，但本次只补齐测量能力，尚未通过新运行证明它占了那 8.95 秒中的多少，也没有声称发送速度已经改善。

### 诊断实现

- `src/renderer/src/hooks/useChatCompletion.ts` 测量等待绘制和会话保存；普通发送和技能运行从发送准备开始计时。队列消费从本次运行的持久化开始，恢复运行从发送前保存开始，不包含用户排队等候时间。
- `src/preload/index.ts` 在实际发送 IPC 前打时间戳，主进程可测量 IPC 及进入运行函数前的处理等待。
- `src/main/agent/runTiming.ts` 为每个会话和运行独立关联计时；无合法前端时间戳时，以主进程入口为起点，并明确记录 `origin: main`。
- `src/main/agent/agentFileSnapshot.ts` 区分快照队列等待和实际 Git 捕获；`file_snapshot` 是包括 pending ref 创建在内的外层总耗时。
- `src/main/agent/modelTiming.ts` 为每次 HTTP 尝试记录有限个边界点；Chat Completions 和 Responses 均接入，普通聊天、Agent 回合及强制最终回答均可记录供应商阶段。
- `src/main/agent/sessionLogger.ts` 把记录写入原有会话的 Markdown 和 JSONL 日志，不增加聊天消息。计时字段不发送给供应商，不参与 prompt 前缀。记录不包含请求正文或密钥，记录失败不阻断模型调用或文件快照。

### 怎样查看

更新运行中的应用后，新建对话并发一条短消息。日志位于：

```text
%USERPROFILE%\.quickai\logs\session-<sessionId>.md
%USERPROFILE%\.quickai\logs\session-<sessionId>.jsonl
```

Markdown 搜索 `[Timing]`，JSONL 筛选 `type: run_timing`。同一轮按 `runId` 关联，模型回合按 `step`、重试按 `model.attempt` 区分。

| 阶段                             | 含义                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| `renderer_startup`               | 前端准备至保存完成的总时间；详情中有 `paintWaitMs` 和 `persistenceMs` |
| `main_received`                  | 进入主进程运行函数；详情中的 `ipcWaitMs` 位于 `renderer_startup` 记录 |
| `agent_prepare` / `chat_prepare` | Agent 消息、技能、记忆等准备，或普通聊天的记忆注入                    |
| `agent_setup`                    | Agent 日志、manifest、运行上下文等初始化                              |
| `snapshot_queue`                 | 等待全局快照队列                                                      |
| `snapshot_capture`               | 实际 Git 快照捕获，包括需要时的仓库初始化、扫描和暂存                 |
| `file_snapshot`                  | 本轮启动快照的总耗时，包含上面两个子阶段                              |
| `request_prepare`                | 工具声明、上下文策略、请求 journal/checkpoint 等模型调用前工作        |
| `http_request`                   | 即将调用 fetch；累计调用时间可反映请求体准备及此前重试退避            |
| `response_headers`               | 收到 HTTP 响应头，附带 HTTP 状态码                                    |
| `first_body_chunk`               | 首个非空流数据块，可能只有 SSE 心跳或元数据                           |
| `first_model_output`             | 首条有效正文、思考或工具调用，`outputKind` 区分类别                   |
| `model_complete`                 | 此次 HTTP 尝试完成，标记成功或失败                                    |

本地 `durationMs` 是对应阶段耗时；`elapsedMs` 是相对本轮起点的累计时间。供应商记录中的 `attemptElapsedMs` 是相对该次 fetch 尝试的累计时间，`callElapsedMs` 还包含调用准备和重试退避。累计时间点不能相加，`file_snapshot` 也不能与它的子阶段重复相加。

若 `snapshot_capture` 大，重点检查工作目录扫描和 Git；若 `snapshot_queue` 大，重点检查并发快照排队；若 `persistenceMs` 大，重点检查前端会话克隆、保存队列、IPC 和数据库保存；若本地很快而 `first_model_output` 大，重点检查网络、供应商和输入量。此指标不包含首条输出到前端真正绘制之间的延迟。

### 验证

- 43 个相关测试文件、331 个测试通过，覆盖 renderer 全套及相关主进程测试。
- Agent Loop 定向集成测试 1 个通过，验证准备、快照和请求准备阶段按同一运行 ID 记录；该命令按名称选择用例，其余 29 个未执行。
- 两端 typecheck 和本次计时改动涉及的 ESLint 检查通过。
- 实际 Git 快照集成测试 9 个通过，验证回退行为和快照队列、捕获计时仍然正常；合计 45 个文件、341 个相关测试通过。
- 没有调用真实供应商来复现首轮等待；真实运行中的各阶段占比，需要更新应用后再次发送才能确认。

### 复习要点

- 先区分本地准备、网络等待和模型输出，再讨论优化哪一段；不能用整个请求耗时推断快照耗时。
- HTTP 200、首个数据块、首条模型输出和完整回答是不同边界，SSE 心跳不代表模型已经开始回答。
- 并发场景要按运行和重试分别关联计时；单个全局秒表会把不同会话混在一起。
- 使用单调时钟测量阶段时长；跨进程起点使用壁钟时间，缺失或不合法时明确回退计时范围。
- 诊断记录只保留少量阶段标记，不能在每个 token 上同步写日志。

## BUG-003 · 2026-11-16 · 后台快照维护阻塞首轮模型请求

### 现象与触发条件

首条消息提交后长时间没有模型输出。重新检查已存在的真实计时日志发现，2026-11-03 的一次运行在快照队列中等待约 30.717 秒，实际快照捕获约 1.722 秒，快照总耗时约 32.545 秒。该样本的前端准备约 0.941 秒，不能把全部等待归因于供应商。

### 已验证的根因

- `src/main/index.ts` 在启动 30 秒后运行快照维护。系统日志显示，该次维护处理了 21 个仓库、114 个受保护引用，结束时间与前台 `snapshot_queue` 等待结束时间吻合。
- `src/main/agent/agentFileSnapshot.ts` 的维护与前台捕获共用串行队列；维护原先还为每个有效引用无条件启动 `git update-ref`，即使引用值没有变化。
- `src/main/agent/agentLoop.ts` 在调用模型前无条件等待基线快照，即使最终只回复文本也会排队。新增回归用例在修复前确实失败：快照未完成时，模型调用次数为零。
- 上述证据定位了这个真实样本的本地等待路径，不代表已经证明 BUG-002 中较早的每次等待都有相同原因。

### 修复方案

- `src/main/agent/agentLoop.ts` 将快照初始化延迟至首个工具回合之前。纯文本轮次不进入快照队列，记录 `file_snapshot_skipped` / `no_tool_calls`；模型可先规划并产生输出。
- 工具仍须等待快照准备完成才能执行，并在等待结束后再次检查取消状态，防止用户取消后继续写入。后续变更检查点、最终差异和回滚清单继续保留。
- `src/main/agent/agentFileSnapshot.ts` 一次读取引用名称与目标对象，只修复缺失或不匹配的保护引用，跳过不变引用的 Git 更新进程。引用维护与 GC 继续串行，保持对象保护顺序。
- `ARCHITECTURE.md` 同步说明新的基线时机和跳过计时语义。

### 验证结果

- 修复前，纯文本不捕获快照、模型先于快照准备、等待期间取消保护这三个定向用例失败；修复后纳入全量回归并通过。
- 使用 Electron 自带 Node（ABI 140）运行 Vitest，限制为两个 worker：172 个文件、1159 项测试全部通过，无跳过。覆盖实际 Git 快照与文件回滚，并新增维护恢复缺失保护引用的验证。
- 当前系统 Node 的 ABI 为 137，与已有 `better-sqlite3` 原生模块不匹配；改用 Electron 运行测试解决了此前数据库测试跳过的问题，没有重编译或替换应用原生模块。
- 两端 TypeScript 检查、上述四个修改过的 TypeScript 文件 ESLint 检查、Electron Vite 生产构建均通过。
- 本地 Python 严格 UTF-8 HTTP 网关的跨语言验收通过：直接发送旧式 `JSON.stringify` 请求会复现 HTTP 503；同一非法代理项经项目的 Chat Completions、Responses 传输分别得到正常的 `OK` 流式回复。这是本地兼容性验收，不是真实供应商的成功回复。
- 隔离的 Electron 引擎运行中，只读读取已有服务商配置，使用合成文本、不加载用户历史或个人记忆。当前服务商在约 114 毫秒进入首次 HTTP 调用，三次返回 429；DeepSeek 对照返回 402，OpenCode 对照返回 401。三个尝试都记录了 `file_snapshot_skipped`，所有发送字符串均为合法 Unicode，但尚不能据此声称外部网关成功验收。该时间从引擎入口计算，不包含真实桌面的前端保存和绘制耗时。
- 用户随后指定本地 `127.0.0.1:8788` 的 `deepseek-v4.1-flash`。应用数据库没有该端口的服务商连接，本次隔离验证复用已有同模型 WORKBUDDY 配置的认证信息，并仅在验证进程中覆盖 API 地址。完整 Unicode 请求三次返回 HTTP 503；直接发送无非法代理项的最小 `hi` 请求同样返回 503，结构化错误为 `server_error` / `503`，错误正文提及上游与配额。已验证该入口存在独立服务端阻断；未确认具体上游账号、配额状态或本地代理是否要求不同的专用 Key，因此仍不能记录真实成功回复验收通过。未修改应用中的服务商选择或配置。
- 2026-11-17 按用户要求再次测试同一 `8788` 入口、同一模型和认证配置：最小 `hi` 请求返回 HTTP 200，收到 36 字符正文，耗时约 2.040 秒；随后实际项目 `runAgentLoop` 在隔离 Electron 进程中一次请求成功，HTTP 200，完整运行约 2.334 秒，最终正文为预期的 `OK`，运行状态为 `completed`。合成输入包含中文、合法 emoji 和孤立代理项；发送内容全部为合法 Unicode，替换字符确实发送，且记录了 `first_model_output`、成功的 `model_complete` 和 `file_snapshot_skipped`。本次已取得真实代理入口的成功回复，先前 503 是历史失败结果；代理恢复的具体原因及实际上游身份未验证。该验证未启动桌面 UI，也未覆盖工具执行或 Responses 协议；耗时不含前端保存和绘制。

### 覆盖边界与复习要点

- 真实服务商和桌面交互的验收结果需单独记录，不能把 mock 传输或源代码检查当作生产验收。
- 首个工具回合仍会等待串行队列中的快照维护；本次移除了模型首轮和纯文本回复对快照的依赖，没有宣称所有工具任务的总耗时都缩短了 30 秒。
- 文件回滚基线现在是首个工具回合之前，而非用户提交消息的瞬间；模型规划期间的外部编辑因此不会被误计为本轮工具改动。
- 优先消除没有依赖关系的等待，再减少后台重复工作；优化时必须保留“写入之前已有基线”的约束。

## BUG-004 · 2026-11-16 · 应用包意外收录本地开发配置与日志

### 现象与触发条件

制作本地 Windows 免安装包后，检查 `app.asar` 的路径清单，发现归档包含 `opencode.json`、`.agents`、`.claude`、`.test_action_logs`、功能图数据库和开发文档等非运行时文件。已确认这些路径被打包；未展开配置和日志内容，不能声称它们一定包含有效凭据，也没有对外发布该包。

### 根因

`electron-builder.yml` 的 `files` 原来只有排除规则。electron-builder 在这种情况下默认先包含所有项目文件，少数排除项无法覆盖后续新增的本地开发文件。

### 修复方案

- `electron-builder.yml` 改为只收录 `out/**`、`resources/**`、`package.json`，生产依赖继续由 electron-builder 收集。
- 新增 `scripts/check-package-contents.mjs` 和 `npm run check:package`：验证包内顶层路径只能属于运行时目录，检查 main、preload、renderer 入口，以及 SQLite 原生模块及其解包文件是否存在。

### 已执行的验证

- 新检查确实拦截了修复前的应用包，错误信息列出混入的开发目录。
- 新脚本 ESLint 检查通过。
- 修改白名单后重新制作 Windows 未签名免安装包，`npm run check:package` 通过：归档 9031 个条目，顶层仅含运行时目录与 `package.json`，main / preload / renderer 入口和 SQLite 原生模块及其解包文件完整。

### 可复用经验

- 打包成功不等于打包内容正确；应读取实际归档清单，并检查关键入口和原生依赖。
- 发布边界优先使用运行时文件白名单，避免逐个追补本地配置、日志和开发工具目录的黑名单。
- 本地 Windows 打包的签名辅助工具解压遇到符号链接权限限制，本次使用命令行 `--config.win.signAndEditExecutable=false` 制作未签名免安装包；这不代表常规签名安装包流程已通过。

## 测试维护 · 2026-11-17 · 第一轮去重与归并

### 原因与范围

静态扫描和人工核对确认，部分模块拆分后，旧测试仍直接调用已迁出的同一函数，重复覆盖相同场景；七个文件操作工具测试还各自维护一套相同的工作区准备与清理代码。本轮只整理测试，没有修改业务实现。

### 处理与保留的验证

- 将 `src/main/tools/` 下的 `fileWriteTool.test.ts`、`fileEditTool.test.ts`、`multiEditTool.test.ts`、`directoryCreateTool.test.ts`、`fileCopyTool.test.ts`、`fileMoveTool.test.ts`、`fileDeleteTool.test.ts` 合并为 `src/main/tools/fileMutationTools.test.ts`。七个原有场景全部保留，共用环境准备，每个用例使用独立临时目录。
- 删除 `src/main/tools/file.test.ts` 中重复的成功编辑场景，将其独有的 `Diff:` 断言并入合并后的编辑用例。该文件中的错误位置和歧义匹配验证继续保留。
- Shell 编码验证集中到 `src/main/tools/shellEncoding.test.ts`；错误前缀识别集中到 `src/shared/agentEventReducer.test.ts`，删除旧入口中的重复用例。
- URL 分页与私有 IP 验证集中到 `src/main/web/urlSafety.test.ts`，保留原有私有地址、公网地址、非法输入及分页边界样例，合并旧文件里相同的场景。
- 将 `src/renderer/src/hooks/useChatCompletion.test.ts` 中重复的恢复、会话时间戳场景合并到各自所属模块测试。消息 ID、正文及思考清理、错误标记清理断言保留在 `src/shared/agentEventReducer.test.ts`；其他会话的分支元数据断言保留在 `src/renderer/src/features/chat/sessionSnapshot.test.ts`。

### 实际验证与边界

- 整理前使用 Electron 自带 Node、两个 worker 运行涉及的 16 个测试文件：123 项全部通过；整理后对应 10 个文件：116 项全部通过，无跳过。净合并 7 个重复用例。
- 全项目测试文件从 172 个减少到 166 个，测试代码从 28446 行减少到 28140 行，净减少 306 行；行数包含空行与注释。
- 两端 TypeScript 检查、九个新增或修改过的测试文件 ESLint 检查、Prettier 检查和 `git diff --check` 通过。
- 本轮未运行全量测试、桌面 UI 或真实服务商请求，未采集覆盖率；不能把本次相关回归通过表述为全量验收通过，也不能仅凭用例减少推断覆盖率下降或运行速度提升。

### 可复用经验

模块迁移时同步迁移测试，先核对独有断言再删除重复用例；同类工具可共享简短的环境准备代码，同时保持用例之间的临时目录隔离。按保护的行为决定保留哪些测试，不按目标数量裁剪。

## BUG-005 · 2026-11-17 · 默认测试入口与 SQLite 原生模块运行时不匹配

### 现象、触发条件与根因

应用安装依赖后，`postinstall` 会为 Electron 准备 SQLite 原生模块，但原有 `npm test` 直接使用宿主 Node 启动 Vitest。当前机器的宿主 Node ABI 为 137，应用使用的 Electron ABI 为 140；本轮直接尝试在宿主 Node 打开内存数据库，确实得到原生模块 ABI 不匹配错误。`src/main/testSupport/nativeSqlite.ts` 会把加载失败转换为 `describe.skip`，因此旧入口可能跳过数据库集成测试，不能把其余测试通过当作数据库验收通过。

### 修复与 CI 配置

- 新增 `scripts/run-tests.mjs`，统一通过 Electron 的 `ELECTRON_RUN_AS_NODE` 模式运行测试。先打开并关闭内存 SQLite 数据库，检查失败则直接返回失败，不再通过跳过数据库测试掩盖环境问题；随后运行 Vitest，并保留其失败退出码。
- `package.json` 的 `test`、`test:watch` 使用同一入口；每轮创建独立临时数据目录，在子进程退出后清理。`vitest.config.ts` 默认使用两个 worker，沿用已经实际验证的并发规模。
- 新增 `.github/workflows/ci.yml`：推送到 `main` / `master`、Pull Request 和手动触发时，在 Windows runner 上使用 Node 22，执行锁定依赖安装、代码与 CSS 令牌检查、类型检查及生产构建、全量测试；使用 npm 缓存、只读仓库权限，并取消同一分支上过时的运行。该流程不调用真实模型服务商，不需要配置 API Key。
- `README.md` 说明本地定向测试、监听模式和 CI 触发方式。运行模式依据见 [Electron 环境变量文档](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)。

### 已执行的验证与边界

- 新入口的数据库、文件操作和 Unicode 定向验证：3 个文件、23 项测试全部通过。
- 使用新的 `npm test` 运行全量：166 个文件、1152 项全部通过，无跳过，Vitest 记录耗时约 135.38 秒；实际测试运行时为 Electron 39.8.10、ABI 140。
- 使用不存在的测试筛选条件执行负向检查，Vitest 返回 1，启动脚本与 npm 同样返回 1，确认失败会传递给 CI。
- `npm run lint` 通过，包含全项目 ESLint 和 CSS 令牌检查；`npm run build` 通过，包含主进程和前端类型检查及生产构建。新增脚本和 Vitest 配置的 Prettier 检查，以及工作流 YAML 解析通过。依赖声明与锁文件一致；测试结束后本轮创建的临时数据目录已清理。
- 尚未提交或推送工作流，也没有在 GitHub runner 上实际执行；本地验证使用现有依赖，没有验证云端全新 `npm ci` 的下载与安装过程。本轮没有进行真实模型、桌面 UI 或签名安装包验收。

### 可复用经验

CI 应先验证测试运行时和原生依赖可用，环境失败必须让流水线失败。统一本地与 CI 的测试入口，并明确区分本地命令验证、全新依赖安装及云端工作流运行这三类证据。

## 测试维护 · 2026-11-17 · 第二轮归并与 AI 交接约定

### 原因与范围

继续核对模块拆分后遗留在上层入口的纯函数测试，将其集中到所属模块，合并重复的准备和执行逻辑。本轮仅修改五个测试文件及协作记录，没有修改业务实现、测试运行器或 CI。

### 覆盖接替关系

| 原有位置与场景                                                                                    | 保留位置与处理                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/webTools.test.ts` 的标签清理、实体解码，与模块测试重叠                                  | 归到 `src/main/web/htmlExtract.test.ts`；保留标签、脚本内容排除和 amp / lt / gt 解码断言，使用精确正文断言，同时检查 style 内容排除。正文提取、无可信正文返回 null 两个用例原样迁入。 |
| `src/main/webTools.test.ts` 和 `src/main/web/searchParsers.test.ts` 的 Bing / DuckDuckGo 成功解析 | 集中到后者；保留多结果、来源、标题标签清理、摘要实体解码、重定向、属性顺序和空结果等断言；模型结果格式断言合入 DuckDuckGo 场景，并改为精确文本比较。                                  |
| `src/main/webTools.test.ts` 的 Sogou 相对重定向与绝对链接                                         | 迁入 `src/main/web/searchParsers.test.ts`，合并为一次解析，同时保留两种链接的断言；空结果场景保留。                                                                                   |
| `src/renderer/src/hooks/useChatCompletion.test.ts` 的错误消息识别                                 | 归到 `src/shared/agentEventReducer.test.ts`；旧版英文错误前缀并入现有前缀样例，显式错误标记和正常正文反例分别保留。                                                                   |

`AGENTS.md` 新增测试维护和 AI 交接约定：按行为判断重复，删除前提供覆盖接替关系，禁止削弱断言或跳过失败制造通过，明确相关回归、全量检查和真实验收的证据边界。规则用于约束交付，不能保证任何 AI 的判断一定正确。

### 实际验证与边界

- 整理前执行 `npm test -- src/main/webTools.test.ts src/main/web/htmlExtract.test.ts src/main/web/searchParsers.test.ts src/shared/agentEventReducer.test.ts src/renderer/src/hooks/useChatCompletion.test.ts`：5 个文件、51 项通过；整理后执行同一命令：5 个文件、45 项通过，无跳过。净归并 6 个用例，保留其不同输入与断言所保护的行为。
- 全项目测试文件数保持 166 个，测试代码从 28140 行减少到 28079 行，净减少 61 行；行数包含空行与注释。这轮重点是集中维护位置，未以减少文件数为目标。
- `npm run typecheck` 的主进程和前端检查通过，五个修改过的测试文件 ESLint 检查通过。
- 本轮没有重跑全量测试、GitHub 云端 CI、真实服务商或桌面 UI，没有采集覆盖率或证明运行速度提升。此前全量通过结果属于上一轮验证，不能冒充本轮全量结果。

## 测试维护 · 2026-11-17 · 第三轮：按断言级重复定位归并

### 原因与范围

前两轮按"模块迁移后旧测试仍调用同一函数"和"同名用例"归并。本轮改用两种机械判据复核全部 166 个测试文件：一是用例体相似度（1130 个用例两两比对，跨文件 Jaccard 最高仅 0.600），二是断言级去重（3275 条断言中仅 28 条跨文件完全相同）。结论是套件本身已较紧，真正的重复集中在两处：`fileTools.test.ts` 里对 `isSensitiveFile` 的独立断言组，以及 `system.test.ts` 里与技能模块同址测试重叠的场景。本轮只改测试，未改业务实现、运行器或 CI。

### 覆盖接替关系

| 原有位置与场景                                                                                                       | 保留位置与处理                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/fileTools.test.ts` 的 `describe('isSensitiveFile')`：环境配置、私钥证书、凭据库、密钥目录、普通文件共 5 例 | 删除整组。`src/main/tools/helpers.ts` 的 `isSensitiveFile` 是 `src/main/agent/pathPolicy.ts` 中 `isSensitiveFileName` 的一行纯委托，无路径归一化；`src/main/agent/pathPolicy.test.ts` 已覆盖同样的判定语义。原组独有的 `.env.production` 与 `.key` 扩展名两条断言并入该文件的"dotenv、私钥与证书"用例。 |
| `src/main/tools/system.test.ts` 的"按 @trigger 加载技能并列出资源"                                                   | 删除。8 条断言中的 7 条与 `src/main/tools/skillReadTools.test.ts` 的加载用例逐条相同；剩下的技能提示词回显由本文件保留的"创建→校验→加载"用例覆盖。                                                                                                                                                      |
| `src/main/tools/system.test.ts` 的"按需读取技能附资源"                                                               | 删除。`skillReadTools.test.ts` 的分页用例已断言 `Skill Resource:`、`Path:`、分页元数据；原用例独有的"资源正文被投递"改为在该用例中精确断言 `Content:\n` 加窗口正文，断言强于原 `toContain`。                                                                                                            |
| `src/main/tools/system.test.ts` 的"安装技能并保留附资源"（与模块测试同名）                                           | 删除。安装消息与附资源落盘已由 `skillLifecycleTools.test.ts` 同名用例覆盖；原用例独有的"安装后能被加载器发现"两条断言（`Path: references/notes.md`、资源正文）并入该用例，通过同一 `loadSkillsFromFolders` 装配 `createSkillReadTools` 后断言。                                                         |
| `src/main/tools/system.test.ts` 的"删除目录技能"                                                                     | 删除。`skillLifecycleTools.test.ts` 的"创建并删除目录技能"已同时断言 `Removed QuickAI skill` 与目录消失。                                                                                                                                                                                               |
| `src/main/tools/system.test.ts` 的"无技能时的提示"                                                                   | 删除。`skillListResult.test.ts` 对同一格式化函数用 `toBe('No custom skills installed.')` 与 `toBe('0 skills installed')` 做了更严格断言，原用例只是 `toContain` 的弱化重复。                                                                                                                            |

刻意保留、未按"调用同一函数"删除的重复候选：

- `fileTools.test.ts` 的写入/编辑成功路径与 `fileMutationTools.test.ts` 行为相同，但前者传绝对路径走 `ToolRegistry`，后者传相对路径加 `root: 'workspace'` 直调工具对象。绝对路径解析与注册表装配是不同输入边界，保留。
- `fileTools.test.ts` 的 `workspace_list_files` 用例走默认根解析，`workspaceListFilesTool.test.ts` 显式传 `root`。根解析分支不同，保留。
- `fileTools.test.ts` 的 `searchToolDefinitions`、`file_diff`、`isPathInWorkspace` 三组在本轮复核中确认没有其他测试覆盖，保留。
- `system.test.ts` 保留的"真实磁盘技能列表/详情"用例：`list_skills` 已被 `skillListTool.test.ts` 用注入桩覆盖，但真实 `$QUICKAI_HOME` 目录扫描到格式化输出的装配链路只在该文件覆盖。

### 实际验证与边界

- 相关回归：整理前 8 个文件、105 项全部通过；整理后同一命令 8 个文件、95 项全部通过，无跳过。`fileTools.test.ts` 由 57 例减为 52 例，`system.test.ts` 由 21 例减为 16 例，`pathPolicy.test.ts`、`skillReadTools.test.ts`、`skillLifecycleTools.test.ts` 用例数不变但断言增强。
- 全项目测试文件数保持 166 个，用例数从 1146 减为 1136（净减 10），测试代码从 28245 行减为 28087 行（净减 158 行，含空行与注释）；5 个文件合计 20 增 178 删。
- `npm run typecheck` 主进程与前端均通过；5 个改动文件 ESLint 通过。
- 全量 `npm test` 实测 166 个文件、1136 项：1133 通过、3 失败，**未取得全绿**。失败均在本轮未触碰的两个文件：`agentLoop.test.ts:1631` 超时（单跑 3838ms，默认预算 5000ms）并连带使同文件下一例权限断言得到 0 次调用；`agentFileSnapshot.test.ts` 的 `reverts and restores several Agent runs as one session transaction` 超时（20047ms，自带预算 20000ms）。两个文件单独运行时分别 32/32、9/9 通过，且本轮改动前（整理前的全量基线）已出现同一 `agentLoop.test.ts:1631` 失败，故判定为**既有的负载敏感问题，不是本轮引入**。按协作约定没有通过放宽超时、加重试或跳过使其变绿。
- 未运行 GitHub 云端 CI、真实服务商请求、桌面 UI 与打包验收；未采集覆盖率，也未测量运行速度变化。上述"相关回归通过"不等于全量验收通过。

### 可复用经验

- 用例名相同、调用同一函数都不足以判定重复；先看断言是否逐条重合，再看输入边界（绝对/相对路径、默认根/显式根、注入桩/真实磁盘）是否真的相同。
- 纯委托函数（一行转发）不必各自成组测试，在真实实现所在模块覆盖一次即可；删除前要把被删组里独有的一两条边界断言搬到保留位置。
- 超时失败要先看是不是自带预算：`agentFileSnapshot.test.ts` 的用例各自声明了 20s 预算，本机实测单项 5–20s，这类临界用例在并行满载时会随机失败，且被杀死后可能污染后续用例，不能当作业务回归。

## BUG-006 · 2026-11-17 · Agent 循环与文件快照测试间歇失败

### 现象与定位

- 第三轮清理的独立评审复跑全量时，`src/main/agent/agentLoop.test.ts` 和 `src/main/agent/agentFileSnapshot.test.ts` 共出现 10 项超时和 1 项权限断言失败。随后单独复跑两个文件，Agent 循环 32 项通过，快照出现 `EBUSY`，错误指向删除固定的 `source-git-project` 目录。无法从当时的日志确定锁的持有者，也无法确认权限断言失败是否由前序超时引起。
- 本轮运行 `npm test --` 并筛选上述两个文件，使用 Git Trace2 记录子进程。定向基线 41 项通过，但普通工具回合的权限、取消和对话用例也在创建真实 Git 快照。权限前缀用例耗时 4.656 秒，跨轮快照回滚与恢复耗时 18.846 秒，接近原有的 5 秒、20 秒上限。两个测试文件都复用了固定数据路径，旧操作未结束或并行启动另一轮时可能互相影响。

### 修复方案

- `src/main/agent/agentLoop.test.ts` 默认替换快照入口，保留真实的 Agent 流程、权限与事件断言。延迟快照和取消场景继续用受控的快照句柄验证时序。实际快照用例显式恢复 Git 实现，仍检查 `file_changes` 事件和运行清单。每个用例创建独立数据目录，结束后删除，并重置模型桩实现。
- `src/main/agent/agentFileSnapshot.test.ts` 每个用例在独立临时目录下创建真实 Git 仓库，使用短目录名前缀为 Windows Git 的内部路径留出空间。快照、冲突拒绝、回滚、恢复及引用维护的断言和超时限制均保留。

### 已执行的验证与边界

- 改造后的同一组定向回归 41 项通过。Git Trace2 启动记录从 901 条降到 619 条。按夹具路径匹配，Agent 循环相关记录从 313 条降到 31 条，文件快照相关记录保持 574 条。权限前缀用例耗时 0.388 秒，跨轮快照用例耗时 16.963 秒。这是本机的一次前后测量，实际 Git 用例仍可能受系统负载影响。
- 第一次全量验证使用了较深的临时路径，Windows Git 报告 `GIT_DIR too big`，9 个快照用例失败。在工作区内缩短验证进程的 `TEMP` / `TMP` 路径，并缩短快照夹具目录前缀后，再运行 `npm test`，166 个文件、1136 项全部通过，无跳过，Vitest 耗时 119.61 秒。
- 本轮只调整测试夹具。此前 `EBUSY` 在本轮未复现，生产应用中 Git 卡住或长路径问题的触发条件未单独验收。没有运行云端 CI 或桌面 UI。

### 可复用经验

流程测试可以用受控依赖验证调用顺序，真实 Git 测试则验证落盘、回滚和系统边界。诊断间歇失败时记录启动次数、单例耗时和具体错误，区分超时、目录锁、路径长度以及业务断言失败。

## BUG-007 · 2026-11-18 · 后台 Shell 完成提示在重启后出现在聊天记录

后台 Shell 完成后，应用把一条内部消息交给 Agent 处理。该消息在本次运行的界面中正确隐藏，但历史会话从 SQLite 恢复后，它会显示成一条用户消息。

`src/renderer/src/features/chat/sessionPromptQueue.ts` 创建的消息带有 `isInternal` 和 `isSynthetic`。旧版 `src/main/database/schema.ts` 和 `src/main/database/sessionStore.ts` 没有读写这两个字段，重启后界面丢失了隐藏依据。

- 数据库通过新增列保存两个标记，保存时的会话变更检测也包含它们。`src/main/database/migration.ts` 导入旧 JSON 时保留已有标记。
- `src/shared/backgroundResultSource.ts` 统一定义后台提示的生成 ID。恢复旧历史时，按用户角色和这个保留前缀识别后台提示。`src/renderer/src/features/chat/messageVisibility.ts` 用同一规则过滤界面，消息仍保留在会话和模型上下文。用户输入相同文字时照常显示，后台任务的正常助手回复也照常显示。
- 修复前，重开 SQLite、使用无标记的旧数据库、从 JSON 导入及界面过滤的相关回归共 4 项失败。修复后，定向回归 10 个文件、78 项全部通过，覆盖旧库升级、重开数据库、后台任务投递和模型上下文。类型检查、改动文件 ESLint 和 Prettier 检查通过。
- 使用 Electron 测试入口执行全量 `npm test`，166 个文件、1138 项全部通过，无跳过。
- 本次使用合成数据验证，没有在用户实际使用的桌面应用和数据库上复现。以后增加影响历史展示的消息字段时，应同时检查写入、读取、旧格式导入和界面加载后的行为。

## BUG-008 · 2026-11-18 · 等待保存的队列请求可能在会话换代后发起生成

`src/renderer/src/hooks/useChatCompletion.ts` 原来在领取队列请求后检查会话上下文版本，随后等待保存会话，再发起生成。如果用户在保存期间回退会话，渲染进程在发起生成前没有再次核对版本。主进程的 `src/main/sessionCoordinator.ts` 已有过期版本检查，本次复现的是渲染进程仍尝试启动的分支。

- 将领取、准备、保存和启动提取到 `src/renderer/src/features/chat/queuedPromptRunner.ts`。同一会话在处理期间只领取一次，复用会话保存队列。保存完成后重新读取会话，若会话已移除或版本改变，就取消已领取的请求并清理本地运行登记。保存失败时，将仍有效的请求退回队列。
- 添加保存后检查前，`npm test -- src/renderer/src/features/chat/queuedPromptRunner.test.ts` 的 5 项中有 1 项失败，未调用取消接口。修复后，对领取、保存、流式启动、SQLite 队列和 IPC 的定向回归共 7 个文件、63 项通过。
- 默认 `npm test` 有 1144 项通过，`src/main/agent/agentFileSnapshot.test.ts` 的跨轮回滚与恢复用例再次触发 20 秒超时。用 `npm test -- --maxWorkers=1` 复跑全量，168 个文件、1145 项全部通过。原有测试断言及超时设置均保留。
- `npm run typecheck`、改动文件的 ESLint 和 Prettier 检查均通过。用 `npm run build -- --outDir <临时目录>` 验证主进程、预加载脚本和渲染进程构建，均通过。
- 以后遇到异步操作间共享会话状态的流程，应在实际发起操作前重新读取上下文版本。这里使用合成用例控制时序，未在桌面界面或真实服务商上验收。
