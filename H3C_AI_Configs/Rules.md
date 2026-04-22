# 项目全局规则 (AI Rules / .cursorrules)

**使用场景**：在项目根目录创建 `.cursorrules` 或 `.windsurfrules` 文件，并将此文本粘贴进去，作为 AI 的全局长效记忆约束。

---

## Global AI Rules

### 1. 架构与边界设定 (Architecture Boundaries)
- **永远保持前后端并发隔离**：绝对禁止在后端 (Cloudflare Worker/API 路由) 编写接收数组并执行高并发抓取（如 `Promise.all`）的代码。后端的单一 API `/api/query-sn` 只能处理单个序列号的查询。
- **并发控制归属**：所有关于“批量查询”、“排队处理”、“进度条更新”的逻辑，必须且只能在前端 React 组件中实现。
- **边缘运行时 (Edge Runtime) 限制**：后端代码运行在 Cloudflare V8 Isolate 环境中，**严禁引入**任何依赖 Node.js C++ addon 的库。网络请求必须使用标准 Web API `fetch`。

### 2. 代码生成规范 (Code Standards)
- **缓存优先 (Cache-First)**：编写后端 API 时，每一次针对目标数据源的外部 HTTP 请求，都必须包裹在 KV 缓存检查逻辑中。只有 KV `miss` 或者数据过期时，才能发起真正的外部网络请求。
- **防御性编程**：在解析第三方 API (H3C JSON) 时，必须对返回的数据结构进行空值和类型校验，严防 `Cannot read properties of undefined`。
- **幂等性原则**：所有自动化脚本（如创建 KV/D1 绑定）必须是幂等的。如果资源已存在，直接返回其 ID 并更新配置，不得报错中断。

### 3. UI 与样式规范 (UI/UX Guidelines)
- **极简极客风**：默认使用暗色主题 (Dark Mode)。
- **Tailwind 偏好**：多用 `backdrop-blur` (毛玻璃), 细边框 (`border-white/10`), 柔和的渐变色背景。
- **过渡动画**：所有状态切换（如按钮点击、数据加载、列表渲染）必须带有微动画（使用 Tailwind 的 `transition-all duration-300` 或 Framer Motion）。

### 4. 报错行为准则
- 当你遇到类型错误或部署失败时，**不要**盲目猜测并提供毫无根据的 Patch。必须先利用你的工具查阅官方文档（Astro 或 Cloudflare 官方文档），特别是针对 Edge 环境兼容性的问题。
