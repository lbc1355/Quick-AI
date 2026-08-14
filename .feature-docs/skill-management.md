# Feature: skill-management

> 状态: `待审`

技能管理：技能目录发现、SKILL.md 解析、安装/校验/移除生命周期。

## 业务契约

| 项目     | 内容                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 触发     | 应用启动扫描技能目录;用户/模型调用技能工具(create/install/validate/remove/list/load/read)                                        |
| 结果     | 成功:技能列表/加载/安装/校验/移除完成并返回结果;失败:包结构非法、路径无效、覆盖冲突,返回校验错误                                 |
| 范围     | 技能目录发现(loadSkillsFromFolders), SKILL.md 解析, 技能工具暴露(读取/加载), 生命周期管理(创建/安装/校验/移除)                   |
| 不负责   | 技能在 Agent 提示词中的注入策略(→agent-run messageBuilder)                                                                       |
| 关键约束 | 安装前必须校验包结构(SKILL.md 存在、元数据合法), 系统技能目录受保护,不允许移除/覆盖, 重复安装必须显式确认覆盖语义,不允许静默覆盖 |
| 支撑链路 | discover-skills, skill-install                                                                                                   |

## 执行链路

### Flow: discover-skills

技能发现：扫描技能目录并逐文件夹解析 SKILL.md

1. D-Git-Quick-Ai.src.main.skillManager.loadSkillsFromFolders [✓] — 扫描技能目录并解析 SKILL.md
2. D-Git-Quick-Ai.src.main.skillManager.loadFolderSkill [✓] — 加载单个技能文件夹
3. D-Git-Quick-Ai.src.shared.skillParser.parseSkillMarkdown [✓] — 解析 SKILL.md 元数据

### Flow: skill-install

技能安装：校验包结构并复制技能目录

1. D-Git-Quick-Ai.src.main.tools.skillInstallTool.createInstallSkillTool [✓] — 技能安装工具：路径校验与冲突检测
2. D-Git-Quick-Ai.src.main.tools.skillLifecycleShared.copySkillDirectory [✓] — 复制技能目录到安装根
