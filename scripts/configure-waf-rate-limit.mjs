import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const wranglerPath = path.join(projectRoot, 'wrangler.toml');

const RULE_DESCRIPTION = 'H3C API rate limit for /api/*';
const RULE_EXPRESSION = '(http.request.uri.path starts_with "/api/")';
const RULE_ACTION = 'block';
const RULESET_PHASE = 'http_ratelimit';

const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;

function assertEnv() {
  if (!token) {
    throw new Error('缺少环境变量 CLOUDFLARE_API_TOKEN');
  }

  if (!zoneId) {
    throw new Error('缺少环境变量 CLOUDFLARE_ZONE_ID');
  }
}

async function cfRequest(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  const json = await response.json();

  if (!response.ok || !json?.success) {
    const detail = json?.errors?.map((item) => item?.message || JSON.stringify(item)).join('; ') || response.statusText;
    throw new Error(`Cloudflare API 请求失败: ${detail}`);
  }

  return json.result;
}

async function getEntrypointRuleset() {
  const result = await cfRequest(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/phases/${RULESET_PHASE}/entrypoint`,
    { method: 'GET' }
  );

  if (!result?.id) {
    throw new Error('未获取到 http_ratelimit 入口 ruleset');
  }

  return result;
}

function buildRulePayload() {
  return {
    description: RULE_DESCRIPTION,
    expression: RULE_EXPRESSION,
    action: RULE_ACTION,
    enabled: true,
    ratelimit: {
      characteristics: ['ip.src', 'cf.colo.id'],
      period: 60,
      requests_per_period: 90,
      mitigation_timeout: 60,
      requests_to_origin: false
    }
  };
}

function equalRule(existing, expected) {
  if (!existing) return false;
  const r = existing.ratelimit || {};
  const e = expected.ratelimit || {};

  const sortedA = Array.isArray(r.characteristics) ? [...r.characteristics].sort().join(',') : '';
  const sortedB = Array.isArray(e.characteristics) ? [...e.characteristics].sort().join(',') : '';

  return (
    existing.description === expected.description &&
    existing.expression === expected.expression &&
    existing.action === expected.action &&
    Boolean(existing.enabled) === Boolean(expected.enabled) &&
    sortedA === sortedB &&
    Number(r.period) === Number(e.period) &&
    Number(r.requests_per_period) === Number(e.requests_per_period) &&
    Number(r.mitigation_timeout) === Number(e.mitigation_timeout)
  );
}

async function createRule(rulesetId, payload) {
  return cfRequest(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/${rulesetId}/rules`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function updateRule(rulesetId, ruleId, payload) {
  return cfRequest(`https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

function readProjectName() {
  try {
    const content = readFileSync(wranglerPath, 'utf-8');
    const match = content.match(/^\s*name\s*=\s*"([^"]+)"\s*$/m);
    return match?.[1] || 'h3c-batch-query-tool';
  } catch {
    return 'h3c-batch-query-tool';
  }
}

async function main() {
  assertEnv();

  const projectName = readProjectName();
  console.log(`🔐 配置 WAF Rate Limiting: ${projectName}`);

  const entrypoint = await getEntrypointRuleset();
  const expected = buildRulePayload();

  const existing = (entrypoint.rules || []).find((rule) => rule?.description === RULE_DESCRIPTION);

  if (existing && equalRule(existing, expected)) {
    console.log('✅ 已存在相同限流规则，无需更新。');
    return;
  }

  if (existing?.id) {
    await updateRule(entrypoint.id, existing.id, expected);
    console.log('✅ 已更新现有限流规则。');
    return;
  }

  await createRule(entrypoint.id, expected);
  console.log('✅ 已创建限流规则。');
}

main().catch((error) => {
  console.error('❌ 配置失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
