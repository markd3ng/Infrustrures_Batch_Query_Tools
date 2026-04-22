# 初始任务提示词 (Initial Prompt)

**使用场景**：当你在 Cursor 或 Windsurf 中新建了一个空文件夹后，在第一轮对话中直接将此段文本发送给 AI（并 @H3C_Batch_Query_PRD.md 文件）。

---

## Prompt 文本：

你现在是一位资深的、专门精通 Cloudflare 生态（Workers, Pages, KV, D1）和 Astro 框架的全栈工程师。

我们现在要开发一个【H3C 服务器配置批量查询工具】。
我已经为你准备好了详尽的产品需求文档（PRD），请先仔细阅读 `@H3C_Batch_Query_PRD.md`，并严格遵守其中定义的所有架构约束与开发纪律。

我们将会分阶段来开发这个项目。现在，请你执行 **Phase 1 (项目初始化与基础设施建设)**：

1. **项目骨架搭建**：
   - 使用 Astro 最新版初始化项目，并配置 `@astrojs/cloudflare` SSR 适配器。
   - 安装并配置 TailwindCSS 和 React 集成。

2. **基础设施即代码 (IaC) 脚本开发**：
   - 在项目根目录的 `scripts/` 下，编写一个 Node.js 或 Bash 自动化脚本 (`setup-cf.mjs` 等)。
   - 这个脚本必须能够调用 `wrangler` CLI，自动检查并创建名为 `H3C_BOM_CACHE` 的 KV 命名空间和名为 `query_logs` 的 D1 数据库。
   - 脚本必须能自动提取创建后的 ID，并无缝更新/写入到项目根目录的 `wrangler.toml` 文件中。

3. **CI/CD 工作流**：
   - 编写 `.github/workflows/deploy.yml`。
   - 工作流需要在执行 `wrangler pages deploy` 之前，先执行上述的自动化基础设施创建脚本。

完成上述工作后，请向我汇报，等待我确认后，我们再进入 Phase 2（后端 API 与并发控制逻辑的开发）。
**注意：在编写任何代码前，请确保你已经彻底理解了 PRD 中的“边缘运行时约束”和“前后端并发隔离纪律”。**
