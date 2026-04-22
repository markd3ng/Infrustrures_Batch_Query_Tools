# [PRD] H3C 服务器配置批量查询工具 (AI 辅助开发专用)

## 1. 项目背景与目标
本项目旨在构建一个现代化的 Web 工具，允许用户批量输入 H3C 服务器的序列号，通过自动化方式快速查询并结构化展示服务器的详细组件配置信息。
系统必须保证高可用性、极快的响应速度，并最大限度地避免被目标数据源（H3C 官网）实施 IP 封禁或速率限制（Rate Limiting）。

## 2. 核心技术栈强制规定
*   **前端框架**: Astro (主路由与静态/SSR底座) + React (复杂交互组件)
*   **样式方案**: TailwindCSS (追求现代化、极简、玻璃拟物化设计风格)
*   **后端运行环境**: Cloudflare Workers (Edge Runtime)
*   **缓存层**: Cloudflare KV (键值对高频读取缓存)
*   **持久化层**: Cloudflare D1 (Serverless SQLite，用于历史数据沉淀与分析)
*   **部署平台**: Cloudflare Pages / Workers

## 3. 核心架构约束 (AI 开发纪律)
**⚠️ 致 AI 开发者：在编写代码时，必须严格遵守以下架构和请求流转规则，不容妥协。**

### 3.1 前后端并发隔离原则（最关键）
*   **绝对禁止**：严禁在后端 Cloudflare Worker 提供接收数组的批量查询 API，更严禁在 Worker 内部使用 `Promise.all` 瞬间并发拉取几十个 H3C 接口。
*   **必须执行**：
    *   **后端 API** 必须设计为**无状态的单一序列号查询接口** (`/api/query?sn=xxx`)。
    *   **批量并发控制必须在前端 React 组件中完成**。前端使用并发池（如 `p-limit`，限制并发数 max: 3-5）来循环调用后端单查询 API。

### 3.2 边缘运行时 (Edge Runtime) 兼容性纪律
*   后端逻辑必须完全兼容 Cloudflare Workers 环境。
*   严禁引入依赖 Node.js 原生 C++ 模块的 npm 包。
*   网络请求统一使用原生的 `fetch` API。

### 3.3 缓存优先策略 (Cache-First)
所有进入后端的查询请求必须遵循以下链路：
1. `GET /api/query?sn=xxx`
2. 检查 Cloudflare KV (`key: SN_xxx`)
3. 若命中缓存且未过期（TTL），直接返回 JSON。
4. 若未命中，发起向 H3C API 的真正 `fetch` 请求。
5. 拿到结果后，异步写入 KV，再返回给客户端。（不要让写入操作阻塞响应）

## 4. 功能需求描述

### 4.1 前端交互与 UI
*   **输入区**: 提供一个支持多行输入的 Textarea 文本框，用户可以粘贴多行序列号（自动按换行符、逗号、空格分割并去重去空）。
*   **控制区**: 一个“开始批量查询”的醒目按钮。点击后按钮变为“正在查询...”。
*   **进度反馈区**: 必须提供实时的进度指示器（Progress Bar），展示 `成功数量 / 失败数量 / 总数量`。
*   **结果展示区**: 使用现代化的大型数据表格（Table）展示解析回来的数据。
    *   支持表格加载骨架屏（Skeleton）。
    *   支持按“配置品类”、“数量”等字段进行前端排序。
    *   支持“一键导出 CSV/Excel”功能。
*   **UI 审美要求**: 使用偏向暗色模式的极简极客风（Dark Mode by default），运用适当的渐变色和阴影，界面过渡必须有微动画（Micro-interactions）。

### 4.2 后端 API 职责与异常处理
*   **目标接口**: `GET https://www.h3c.com/cn/WebCMSApi/api/BOM/GetComponentsListBySN?sn={SN}`
*   **请求伪装**: 必须携带合理的 `User-Agent` 和 `Referer` Header。
*   **异常处理纪律**:
    *   如果目标 API 返回非 200，或者返回的 JSON 判定无结果，后端应明确返回 `404` 或约定的业务错误码，不允许直接抛出 `500` 导致前端崩溃。
    *   对传入的 `sn` 参数进行基础正则校验（去除非法字符），拦截恶意请求。

## 5. 核心接口契约 (API Schema)

**内部通信接口: `/api/query-sn`**
*   **Method**: `GET`
*   **Query Params**: `sn` (String, Required)
*   **Response (Success - 200)**:
    ```json
    {
      "success": true,
      "sn": "210235A3THH205000242",
      "source": "kv", // or "h3c_api"
      "data": [
        {
          "category": "CPU",
          "partNumber": "...",
          "description": "...",
          "quantity": 2
        }
      ]
    }
    ```
*   **Response (Error - 404/500)**:
    ```json
    {
      "success": false,
      "sn": "INVALID_SN",
      "message": "查无此序列号或目标接口限流"
    }
    ```

## 6. 数据存储结构 (Schema)

### 6.1 KV Store
*   **Namespace**: `H3C_BOM_CACHE`
*   **Key**: `SN:{序列号}`
*   **Value**: 序列化后的 JSON Array (即 H3C 返回的组件列表)。
*   **TTL**: 建议设置过期时间为 30 天 (2592000 秒)，保持数据相对新鲜。

### 6.2 D1 Database (用于审计与统计)
*   **Table**: `query_logs`
*   **Columns**:
    *   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
    *   `sn` (TEXT NOT NULL)
    *   `query_time` (TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
    *   `status` (TEXT) // 'success' or 'fail'
    *   `client_ip` (TEXT) // 可选，用于防刷

## 7. 自动化部署与 CI/CD 纪律 (GitHub -> Cloudflare)
**⚠️ 致 AI 开发者：必须实现完全自动化的部署流水线，彻底免除用户在控制台的手动配置。**

*   **部署架构**: 采用 GitHub Actions 对接 Cloudflare。用户只需 push 代码到 `main` 分支，即可全自动触发部署。
*   **基础设施自动化 (IaC) 与自动创建**:
    *   **严禁**要求用户去 Cloudflare Dashboard 手动点击创建 KV 和 D1。
    *   **必须**在 CI/CD 流程中或项目内提供一个自动化初始化脚本（如 `scripts/setup-cf.mjs` 或 bash 脚本）。
    *   **逻辑要求**：脚本必须使用 `wrangler` CLI 判断 KV `H3C_BOM_CACHE` 和 D1 `query_logs` 是否存在；若不存在则自动执行 `wrangler kv:namespace create` 和 `wrangler d1 create`，并自动抓取生成的 `id`，将其无缝注入/更新到 `wrangler.toml` 中完成绑定，最后再执行 deploy。
*   **安全注入**: 指导用户通过 GitHub Secrets 配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。

## 8. 上线前 Checklist
*   [ ] 编写并跑通包含 KV/D1 自动创建逻辑的 `.github/workflows/deploy.yml`。
*   [ ] 确保自动化创建脚本具备**幂等性**（重复运行不会报错，也不会覆盖已有的有效绑定）。
*   [ ] 为 API 路由 `/api/*` 提出 Cloudflare WAF Rate Limiting 的建议或脚本配置（防止自身接口被滥刷）。
*   [ ] 确保前端包含友好的全局 Error Boundary。
