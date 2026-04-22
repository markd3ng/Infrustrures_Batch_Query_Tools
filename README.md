# H3C 服务器配置批量查询工具

Phase 1 + Phase 2 已完成：
- Astro + `@astrojs/cloudflare`（SSR）
- React + TailwindCSS（暗色极简 UI）
- 后端单 SN 查询接口 `/api/query-sn`（KV 缓存优先 + D1 日志）
- 前端并发池批量查询、进度条、结果排序、CSV/Excel 导出
- Cloudflare KV / D1 幂等初始化脚本
- Cloudflare WAF `/api/*` Rate Limiting 幂等配置脚本
- 前端全局 Error Boundary（异常降级与重试）
- GitHub Actions 自动部署流程

## 本地开发

```bash
npm install
npm run dev
```

## 初始化 Cloudflare 资源（幂等）

```bash
npm run cf:setup
```

该命令会通过 Wrangler 自动检查/创建：
- KV: `H3C_BOM_CACHE`
- D1: `query_logs`

并把真实 ID 回写到 `wrangler.toml` 的 `kv_namespaces` 与 `d1_databases` 绑定段。

## Windows PowerShell 代理（如需）

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7890"
$env:HTTPS_PROXY="http://127.0.0.1:7890"
```

## GitHub Actions 所需 Secrets

在仓库 Settings → Secrets and variables → Actions 中配置：
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 配置 `/api/*` WAF Rate Limiting（幂等）

先准备 Cloudflare Zone ID（站点级别）：
- `CLOUDFLARE_ZONE_ID`

然后执行：

```bash
npm run cf:waf
```

脚本会调用 Cloudflare API，在 `http_ratelimit` 阶段为 `/api/*` 创建或更新规则（重复执行不会重复创建）。


## 一键部署（CI）

当代码 push 到 `main` 时，`.github/workflows/deploy.yml` 会自动执行：
1. 校验必需 Secrets（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）
2. `npm ci`
3. `npm run cf:setup`
4. （可选）若存在 `CLOUDFLARE_ZONE_ID`，自动执行 `npm run cf:waf`
5. `npm run build`
6. 上传 `dist` 构建产物到 Actions Artifact（保留 7 天）
7. `npm run deploy:pages`


---

> 架构纪律：后端仅提供单 SN 接口 `/api/query-sn`，批量并发调度严格放在前端实现，不在 Worker 端执行数组批量并发请求。
