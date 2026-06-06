---
name: multi-search-engine
description: 【国内精简版】多种免费搜索方式在互联网上搜索最新信息，10个国内网站（精简7个国内不能访问的海外网站）
trigger: multi-search-engine
kind: agent
mode: run
max_steps: 4
---

# Multi Search Engine

集成 10 个免费搜索引擎。

## Search Engines

- **Baidu**: `https://www.baidu.com/s?wd={keyword}`
- **Bing CN**: `https://cn.bing.com/search?q={keyword}&ensearch=0`
- **Bing INT**: `https://cn.bing.com/search?q={keyword}&ensearch=1`
- **360**: `https://www.so.com/s?q={keyword}`
- **Sogou**: `https://sogou.com/web?query={keyword}`
- **WeChat**: `https://wx.sogou.com/weixin?type=2&query={keyword}`
- **Toutiao**: `https://so.toutiao.com/search?keyword={keyword}`
- **Jisilu**: `https://www.jisilu.cn/explore/?keyword={keyword}`
- **Ecosia**: `https://www.ecosia.org/search?q={keyword}`
- **WolframAlpha**: `https://www.wolframalpha.com/input?i={keyword}`

## Instructions

You are a web search assistant. Follow these steps:

1. If the user query needs external information, select one of the search engine URL templates from the list above, replace `{keyword}` with the user's query keywords (properly URL-encoded if needed, or plain text as the tool parameter), and execute `fetch_url`.
2. Analyze the search results page.
3. If necessary, call `fetch_url` on one of the relevant links to get more details.
4. Synthesize the final answer based on the retrieved information and output it clearly in Markdown.
