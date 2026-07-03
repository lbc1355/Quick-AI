---
version: 'alpha'
name: 'QuickAI Design System'
description: 'Spotlight风格的桌面AI智能体助手设计系统单源信赖文件'
colors:
  # 暗色模式 (Dark Theme Base Tokens)
  primary: '#4fc1ff'
  primaryHover: '#74cffd'
  accent: '#3fb950'
  danger: '#f85149'
  warning: '#d29922'
  success: '#3fb950'
  info: '#3b82f6'
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
    textColor: '{colors.bgDarker}'
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
      primary: '#2563eb'
      primaryHover: '#1d4ed8'
      accent: '#0f8f78'
      danger: '#dc2626'
      warning: '#b45309'
      success: '#0f9f6e'
      info: '#2563eb'
      statusMuted: '#64748b'
      bgDarker: '#eef1f5'
      bgHeader: '#f5f6f8'
      bgMain: '#ffffff'
      panel: '#ffffff'
      panelSoft: '#f4f6f9'
      border: '#d9dee7'
      borderStrong: '#c9d1dc'
      borderFocus: '#8fb2f5'
      text: '#243042'
      textTitle: '#111827'
      textMuted: '#5f6c7b'
      textFaint: '#8792a1'
      cardBg: '#f4f6f9'
      cardBgHover: '#e9edf3'
      inputSectionBg: '#ffffff'
      inputContainerBg: '#ffffff'
      inlineCodeBg: '#eef2f7'
      codeBlockBg: '#f7f9fc'
      codeBlockText: '#243042'
      codeBlockBorder: '#d9dee7'
---

## Brand & Style

QuickAI 采用了紧凑高密度的 UI 样式，旨在为桌面用户提供像 macOS Spotlight 一样“召之即来，挥之即去”的流畅 AI 伴随体验。

## Colors

支持全套的高对比度双主题色盘：

- 暗色主题以深空灰、岩石灰为主色，搭配明亮的蓝色作为引导色，保证弱光环境下的舒适使用。
- 亮色主题以纯白、淡灰为基准，辅以深邃的孔雀蓝，保证日间强光环境下的高度可读性。
- 状态色必须仅用于真实状态：运行中、等待确认、成功、警告、失败；普通装饰不使用状态色。

## Typography

- **基准字体**：系统 Sans-serif 字体家族，界面文字采用平滑的抗锯齿效果。
- **等宽/代码字体**：统一采用 `Consolas, 'SFMono-Regular', monospace`，用以展示文件路径、代码片段及 Agent 内部调用。

## Shapes

设计系统限制并统一了边框圆角的使用，从而让整个桌面窗口更具和谐的高级感：

- **`xs` (3px)**: 极小元素，如折纸卡片角落或微型状态小标记。
- **`sm` (5px)**: 行内芯片（Chips）、徽章、小工具详情卡片。
- **`md` (7px)**: 中等尺寸组件，如输入框外边框、工具按钮、列表元素。
- **`lg` (8px)**: 主应用大卡片容器、对话面板遮罩模态框。
- **`pill` (999px)**: 仅用于开关、状态徽章和统计 pill，不用于普通卡片或页面区域。

## Spacing

所有的 Padding 与 Margin 均必须使用 4px / 8px 间距阶梯：

- **`spacing-1` (4px)**: 微小间距（如元素内部的间隙、紧凑列表上下 padding）。
- **`spacing-2` (8px)**: 标准内边距（如侧边栏列表行间距、按钮内 padding）。
- **`spacing-3` (12px)**: 组件间距（如消息气泡的间隔、设置项组间的 padding）。
- **`spacing-4` (16px)**: 大间距（如输入区边缘、卡片主 padding）。
- **`spacing-6` (24px)**: 弹窗边缘外边距、主悬浮窗首尾 padding。

## Components

- **App shell / header / sidebar**: use panel and header surfaces only; avoid decorative gradients and oversized landing-page composition.
- **Icon buttons**: stay compact at 24px, use muted text by default, and move to hover/active surfaces rather than filled labels.
- **Messages**: user messages use the hover card surface; assistant messages stay unframed unless a tool, reasoning block, or code block needs structure.
- **Tool events**: show neutral chips by default; reserve warning, danger, and success colors for actual state changes.
- **Settings and MCP cards**: use subtle/elevated surfaces and 8px max card radii; repeated items may be carded, page sections should stay unframed.
