# Feature: web-research

> 状态: `待审`

网络研究：搜索、URL 抓取与正文提取、PDF/图片文档解析。

## 业务契约

| 项目     | 内容                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 触发     | 模型调用 webSearch/webFetch/pdfRead/imageRead 工具(含加载页面的 PDF/图片解析)                                                            |
| 结果     | 成功:返回搜索结果、页面正文/标题、PDF 文本、图片解析结果;失败:URL 非法、抓取超时、解析失败,返回错误且不落脏缓存                          |
| 范围     | 搜索(多引擎解析), URL 抓取与正文提取, PDF 文本抽取, 图片读取, URL 安全校验                                                               |
| 不负责   | 结果缓存策略(→缓存层), 搜索引擎后端实现                                                                                                  |
| 关键约束 | URL 必须通过 validatePublicHttpUrl(防 SSRF/内网探测), 抓取必须遵守超时与大小上限,防止资源耗尽, 搜索/抓取结果必须格式化为模型可消费的结构 |
| 支撑链路 | web-search, web-fetch, pdf-read, image-read                                                                                              |

## 执行链路

### Flow: image-read

图片读取解析（独立叶子工具）

1. D-Git-Quick-Ai.src.main.tools.imageReadTool.imageReadTool [✓] — 图片读取解析工具

### Flow: pdf-read

PDF 文档解析（独立叶子工具）

1. D-Git-Quick-Ai.src.main.tools.pdfReadTool.pdfReadTool [✓] — PDF 文本提取工具

### Flow: web-fetch

网页抓取：抓取工具获取公开文本并提取正文

1. D-Git-Quick-Ai.src.main.tools.webFetchTool.webFetchTool [✓] — 抓取工具定义（模型可调用入口）
2. D-Git-Quick-Ai.src.main.webTools.fetchUrl [✓] — URL 抓取：SSRF 校验 + 重定向检查 + 正文提取
3. D-Git-Quick-Ai.src.main.webTools.fetchPublicText [✓] — 拉取公开文本（限流/编码处理）

### Flow: web-search

网页搜索：搜索工具调用详细的搜索实现

1. D-Git-Quick-Ai.src.main.tools.webSearchTool.webSearchTool [✓] — 搜索工具定义（模型可调用入口）
2. D-Git-Quick-Ai.src.main.webTools.webSearchDetailed [✓] — 多引擎搜索与结果解析
