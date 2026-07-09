---
version: 'alpha'
name: 'QuickAI Design System'
description: '中性简约桌面 AI 工作台设计系统单源信赖文件'
colors:
  # 暗色模式 (Dark Theme Base Tokens)
  primary: '#b8b0a3'
  primaryHover: '#d2cabe'
  accent: '#a8a29e'
  danger: '#f85149'
  warning: '#d29922'
  success: '#3fb950'
  info: '#64748b'
  statusMuted: '#94a3b8'
  bgDarker: '#111111'
  bgHeader: '#151515'
  bgMain: '#181818'
  panel: '#1b1b1b'
  panelSoft: '#202020'
  border: '#2a2a2a'
  borderStrong: '#333333'
  borderFocus: '#2f6f8f'
  text: '#d7dde7'
  textTitle: '#eef2f8'
  textMuted: '#9aa3ad'
  textFaint: '#707986'
  cardBg: '#242424'
  cardBgHover: '#2d2d2d'
  inputSectionBg: '#1b1b1b'
  inputContainerBg: '#202020'
  inlineCodeBg: '#242424'
  codeBlockBg: '#151515'
  codeBlockText: '#d7dde7'
  codeBlockBorder: '#333333'

typography:
  xs:
    size: '11px'
    lineHeight: '1.25'
  sm:
    size: '12px'
    lineHeight: '1.4'
  base:
    size: '13px'
    lineHeight: '1.5'
  lg:
    size: '15px'
    lineHeight: '1.6'

rounded:
  xs: '3px'
  sm: '5px'
  md: '7px'
  lg: '8px'
  pill: '999px'

spacing:
  1: '4px'
  2: '8px'
  3: '12px'
  4: '16px'
  6: '24px'
  8: '32px'

components:
  app-shell:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
  app-header:
    backgroundColor: '{colors.bgHeader}'
    textColor: '{colors.textMuted}'
    height: '34px'
  sidebar:
    backgroundColor: '{colors.bgDarker}'
    textColor: '{colors.textMuted}'
  conversation-panel:
    backgroundColor: '{colors.bgMain}'
    textColor: '{colors.text}'
  settings-section:
    backgroundColor: '{colors.panelSoft}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
  surface-card:
    backgroundColor: '{colors.cardBg}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
  surface-card-hover:
    backgroundColor: '{colors.cardBgHover}'
    textColor: '{colors.textTitle}'
  icon-button:
    backgroundColor: 'transparent'
    textColor: '{colors.textMuted}'
    rounded: '{rounded.md}'
    size: '24px'
  icon-button-hover:
    backgroundColor: '{colors.cardBgHover}'
    textColor: '{colors.textTitle}'
  input-section:
    backgroundColor: '{colors.inputSectionBg}'
    textColor: '{colors.textMuted}'
  input-container:
    backgroundColor: '{colors.inputContainerBg}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
    padding: '12px'
  message-user:
    backgroundColor: '{colors.cardBgHover}'
    textColor: '{colors.textTitle}'
    rounded: '{rounded.lg}'
    padding: '12px'
  message-assistant:
    backgroundColor: 'transparent'
    textColor: '{colors.text}'
  inline-code:
    backgroundColor: '{colors.inlineCodeBg}'
    textColor: '{colors.textTitle}'
    rounded: '{rounded.sm}'
    padding: '4px'
  code-block:
    backgroundColor: '{colors.codeBlockBg}'
    textColor: '{colors.codeBlockText}'
    rounded: '{rounded.md}'
  code-block-border:
    backgroundColor: '{colors.codeBlockBorder}'
    textColor: '{colors.text}'
  tool-chip:
    backgroundColor: '{colors.inlineCodeBg}'
    textColor: '{colors.text}'
    rounded: '{rounded.sm}'
    padding: '6px'
  status-info:
    backgroundColor: '{colors.info}'
    textColor: '#ffffff'
  status-muted:
    backgroundColor: '{colors.statusMuted}'
    textColor: '{colors.bgDarker}'
  status-success:
    backgroundColor: '{colors.success}'
    textColor: '{colors.bgDarker}'
  status-warning:
    backgroundColor: '{colors.warning}'
    textColor: '{colors.bgDarker}'
  status-danger:
    backgroundColor: '{colors.danger}'
    textColor: '{colors.bgDarker}'
  accent-badge:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.bgDarker}'
    rounded: '{rounded.pill}'
  primary-action:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.bgDarker}'
    rounded: '{rounded.md}'
  primary-action-hover:
    backgroundColor: '{colors.primaryHover}'
    textColor: '{colors.bgDarker}'
  divider:
    backgroundColor: '{colors.border}'
    textColor: '{colors.textTitle}'
  divider-strong:
    backgroundColor: '{colors.borderStrong}'
    textColor: '{colors.textTitle}'
  focus-ring:
    backgroundColor: '{colors.borderFocus}'
    textColor: '{colors.textTitle}'
  faint-label:
    backgroundColor: 'transparent'
    textColor: '{colors.textFaint}'

modes:
  light:
    colors:
      primary: '#3f3d39'
      primaryHover: '#2f2e2b'
      accent: '#706d66'
      danger: '#dc2626'
      warning: '#b45309'
      success: '#0f9f6e'
      info: '#706d66'
      statusMuted: '#85827a'
      bgDarker: '#eeeeeb'
      bgHeader: '#f7f7f5'
      bgMain: '#fbfbfa'
      panel: '#ffffff'
      panelSoft: '#f6f6f3'
      border: '#deded9'
      borderStrong: '#c9c9c2'
      borderFocus: '#a7a29a'
      text: '#252522'
      textTitle: '#171716'
      textMuted: '#686761'
      textFaint: '#96948d'
      cardBg: '#f4f4f1'
      cardBgHover: '#e9e9e4'
      inputSectionBg: '#ffffff'
      inputContainerBg: '#ffffff'
      inlineCodeBg: '#eeeeea'
      codeBlockBg: '#f5f5f2'
      codeBlockText: '#242421'
      codeBlockBorder: '#deded9'
---

## Brand & Style

QuickAI 采用中性、简约、桌面原生的工作台风格。界面应像 IDE、文件管理器或本地工具一样克制可靠，而不是营销式 AI 聊天产品。

核心气质：

- 信息优先，装饰退后。
- 使用白色、近白色、米白和深灰构成主视觉。
- 避免蓝紫渐变、大面积品牌色、漂浮卡片堆叠和过度圆角。
- Agent、工具调用、记忆和设置都应呈现为清晰的工作流界面，而不是娱乐化对话界面。

## Colors

支持双主题色盘，但亮色主题是默认视觉方向：

- 亮色主题以 `#fbfbfa`、`#ffffff`、`#f6f6f3` 和 `#252522` 为核心。
- 选中态和 hover 态使用浅灰/米灰，不使用蓝色填充。
- 主要操作按钮使用深灰或中性灰，不使用高饱和品牌色。
- 蓝色不作为主视觉色；仅可用于真实链接或不可替代的系统语义。
- 成功、警告、失败颜色只用于真实状态，小面积使用，不作为装饰背景。
- 工具调用、状态行和标签默认使用中性色，运行中可用轻微米灰强调。

## Typography

- **基准字体**：系统 Sans-serif 字体家族，界面文字采用平滑的抗锯齿效果。
- **等宽/代码字体**：统一采用 `Consolas, 'SFMono-Regular', monospace`，用以展示文件路径、代码片段及 Agent 内部调用。
- 标题保持克制，主要标题通常为 18-22px；面板标题和列表标题通常为 12-15px。
- 不使用夸张 hero 字号；QuickAI 是工具界面，不是落地页。

## Layout & Spacing

布局应体现桌面工作台的稳定结构：

- 左侧栏用于项目、会话和导航，应稳定、低装饰、信息密度高。
- 主对话区使用大留白承载内容，但消息和工具步骤不能漂浮成大量独立卡片。
- 输入框固定在底部，像 command composer，使用细边框和极轻阴影。
- 设置页、记忆管理和模型管理优先使用两栏布局与 row-based 设置项。
- 工具调用默认使用紧凑行，不使用大块彩色卡片。

间距必须使用 4px / 8px 阶梯：

- **`spacing-1` (4px)**: 微小间距，如图标与文字间距。
- **`spacing-2` (8px)**: 标准内边距，如列表行、工具行。
- **`spacing-3` (12px)**: 组件间距，如消息间距、输入框内边距。
- **`spacing-4` (16px)**: 大间距，如面板边缘。
- **`spacing-6` (24px)**: 页面级留白。

## Elevation & Depth

QuickAI 默认不依赖阴影建立层级：

- 普通区域使用 1px 细边框和背景层次区分。
- 阴影只用于浮层、弹窗、悬浮提示和底部输入框的轻微深度。
- 页面区块不做浮动卡片；重复项、弹窗和真正需要框定的工具区才可以使用卡片。
- 禁止装饰性渐变、光晕、orb、bokeh、强玻璃拟态。

## Shapes

圆角保持桌面工具感，避免过度“胶囊化”：

- **`xs` (3px)**: 极小元素，如微型状态标记。
- **`sm` (5px)**: 行内芯片、紧凑工具标签。
- **`md` (7px)**: 按钮、列表项、设置行。
- **`lg` (8px)**: 输入框、弹窗、工具详情框。
- **`pill` (999px)**: 仅用于开关、小状态徽章和极少量统计 pill。

## Components

- **App shell / header / sidebar**: 使用中性 panel 和 header surface；避免装饰性渐变和营销式 hero 构图。
- **Icon buttons**: 默认 24px 紧凑按钮，普通态只用 muted text，hover/active 使用浅灰背景。
- **Messages**: user message 使用浅灰气泡且不过度突出；assistant message 默认无框，重点放在内容排版。
- **Composer**: 底部输入框使用白底、细边框、轻阴影；发送按钮用深灰/中性灰，小面积强调。
- **Tool events**: 默认是紧凑日志行；工具名、摘要、状态、耗时并列呈现。只有错误/拒绝/警告可使用状态色。
- **Subagent route panel**: 子 agent 详情作为右侧上下文路由页，而不是全屏浮窗；内容保持和主对话一致的 Markdown 与工具行风格。
- **Settings / Memory / MCP**: 优先使用两栏结构和 row-based 表单；重复项目可卡片化，但页面 section 不做大浮动卡片。
- **Code and markdown**: 代码块使用近白背景和细边框；inline code 使用轻灰底；表格使用细线和低对比表头。

## Do's and Don'ts

Do:

- 使用白色、米白、浅灰、深灰建立主视觉。
- 用细线、留白、字号和字重建立层级。
- 保持工具调用和状态信息紧凑、可扫描。
- 把颜色留给真实状态，不用于普通装饰。

Don't:

- 不要使用大面积蓝色、紫色、蓝紫渐变或高饱和品牌色。
- 不要把页面 section 做成漂浮卡片。
- 不要把普通按钮做成大胶囊 CTA。
- 不要用阴影替代结构边界。
- 不要用可爱化、娱乐化或营销化文案包装工作流界面。
