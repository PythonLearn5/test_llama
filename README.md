这是一个基于 [LlamaIndex](https://www.llamaindex.ai/) 的项目，使用 [`create-llama`](https://github.com/run-llama/LlamaIndexTS/tree/main/packages/create-llama) 脚手架创建。

## 快速开始

首先，安装依赖：

```
npm install
```

然后检查本目录下 `.env` 文件中预配置的参数。
请确保已设置 Vercel AI Gateway 的 `AI_GATEWAY_API_KEY`。

其次，为 `./data` 目录中的示例文档生成嵌入向量：

```
npm run generate
```

最后，启动开发服务器：

```
npm run dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000) 即可查看聊天界面。

## 配置 LLM 和嵌入模型

你可以在[设置文件](src/app/settings.ts)中配置 [LLM 模型](https://ts.llamaindex.ai/docs/llamaindex/modules/llms)和[嵌入模型](https://ts.llamaindex.ai/docs/llamaindex/modules/embeddings)。

## 使用场景

我们准备了一个[示例工作流](./src/app/workflow.ts)，用于智能体 RAG 场景，你可以对 [./data](./data) 目录中的示例文档提问。

你可以通过[聊天界面](http://localhost:3000)发送请求，也可以使用以下 curl 命令测试 `/api/chat` 接口：

```shell
curl --location 'localhost:3000/api/chat' \
--header 'Content-Type: application/json' \
--data '{ "messages": [{ "role": "user", "content": "What standards for a letter exist?" }] }'
```

## 弹出模式

如果你想完全自定义服务端界面和路由，可以使用 `npm eject`。它将创建一个具有与 @llamaindex/server 相同功能的普通 Next.js 项目。

```bash
npm run eject
```

## 了解更多

要了解更多关于 LlamaIndex 的信息，请查看以下资源：

- [LlamaIndex 文档](https://docs.llamaindex.ai) - 了解 LlamaIndex（Python 功能）。
- [LlamaIndexTS 文档](https://ts.llamaindex.ai/docs/llamaindex) - 了解 LlamaIndex（TypeScript 功能）。
- [Agent Workflows 简介](https://ts.llamaindex.ai/docs/llamaindex/modules/agent_workflow) - 了解 LlamaIndexTS Agent Workflows。

欢迎查看 [LlamaIndexTS GitHub 仓库](https://github.com/run-llama/LlamaIndexTS) - 期待你的反馈和贡献！


## 测试问题

### USPS 邮政手册（101.pdf）

```
信件的最小尺寸是多少？
答案：不小于 5 英寸长、3.5 英寸高、0.007 英寸厚

First-Class Mail 的最大重量是多少？
答案：不超过 13 盎司

包裹的最大重量限制是多少？
答案：不超过 70 磅
```

### Attention Is All You Need（attention is all you need.pdf）

#### 表格输出测试

```
What are the BLEU scores of the Transformer model on WMT 2014 English-to-German and English-to-French? Format as a table.
```

> LLM 会输出格式化的 Markdown 表格，包含 Transformer (Base) 和 (Big) 的 BLEU 分数。

#### 图片输出测试

```
What is the Transformer architecture? Show the architecture figure from the paper.
```

> LLM 会在回答中包含 Markdown 图片语法 `![Figure 1](http://localhost:3001/pdf-images/attention_is_all_you_need_page_3_fig_1.png)`，
> 聊天界面会渲染显示对应的插图。
>
> 图片提取采用混合策略（`npm run generate` 时自动执行）：
> - 优先提取 PDF 中嵌入的栅格图片（照片、插图等）
> - 对于矢量绘制的插图（如论文中的架构图），检测页面文本中的 "Figure" 引用，渲染该页为 PNG

## 测试脚本

按顺序运行，从底层到上层验证 RAG 流程：

```bash
npx tsx test_retrieval.ts   # 1. 向量检索 — 检查相关块是否排前
npx tsx test_query.ts       # 2. Query Engine — 检查 LLM 回答是否正确
npx tsx test_tool.ts        # 3. Agent 工具 — 检查工具返回内容
npx tsx test_agent.ts       # 4. Agent 完整流程 — 检查最终回答
```

> 终端中文可能显示为乱码（GBK 编码问题），实际内容正确。
