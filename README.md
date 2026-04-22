# H3C 服务器配置批量查询工具

Phase 1 + Phase 2 已完成：
- Astro + `@astrojs/cloudflare`（SSR）
- React + TailwindCSS（暗色极简 UI）
- 后端单 SN 查询接口 `/api/query-sn`（KV 缓存优先 + D1 日志）
- 前端并发池批量查询、进度条、结果排序、CSV/Excel 导出
- Cloudflare KV / D1 幂等初始化脚本
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

## 一键部署（CI）

当代码 push 到 `main` 时，`.github/workflows/deploy.yml` 会自动执行：
1. `npm ci`
2. `npm run cf:setup`
3. `npm run build`
4. `wrangler pages deploy ./dist --project-name h3c-batch-query-tool`

---

> 架构纪律：后端仅提供单 SN 接口 `/api/query-sn`，批量并发调度严格放在前端实现，不在 Worker 端执行数组批量并发请求。
