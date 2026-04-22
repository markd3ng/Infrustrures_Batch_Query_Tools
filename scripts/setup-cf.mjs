import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const KV_NAME = 'H3C_BOM_CACHE';
const D1_NAME = 'query_logs';
const WRANGLER_TOML = path.join(projectRoot, 'wrangler.toml');

function runWrangler(args, allowFailure = false) {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(cmd, ['wrangler', ...args], {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf-8',
    stdio: 'pipe'
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `wrangler ${args.join(' ')} 执行失败\n${result.stderr || result.stdout || '无输出'}`
    );
  }

  return result;
}

function tryParseJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // ignore
  }

  const start = Math.min(
    ...['{', '[']
      .map((c) => trimmed.indexOf(c))
      .filter((i) => i >= 0)
  );

  if (!Number.isFinite(start)) return null;

  const candidate = trimmed.slice(start);
  for (let end = candidate.length; end > 0; end--) {
    const piece = candidate.slice(0, end).trim();
    try {
      return JSON.parse(piece);
    } catch {
      // continue
    }
  }
  return null;
}

function parseIdFromText(text, patterns) {
  for (const pattern of patterns) {
    const match = (text || '').match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function getOrCreateKvNamespace() {
  const list = runWrangler(['kv', 'namespace', 'list', '--json']);
  const listJson = tryParseJson(list.stdout);
  const existing = Array.isArray(listJson)
    ? listJson.find((item) => item?.title === KV_NAME || item?.name === KV_NAME)
    : null;

  if (existing?.id) {
    return { id: existing.id, preview_id: existing.preview_id || existing.id };
  }

  const created = runWrangler(['kv', 'namespace', 'create', KV_NAME, '--json'], true);
  let createdJson = tryParseJson(created.stdout);

  if (!createdJson || !createdJson.id) {
    const createdFallback = runWrangler(['kv', 'namespace', 'create', KV_NAME]);
    createdJson = {
      id: parseIdFromText(createdFallback.stdout + createdFallback.stderr, [
        /"id"\s*:\s*"([a-f0-9-]+)"/i,
        /id\s*=\s*"([a-f0-9-]+)"/i
      ])
    };
  }

  if (!createdJson?.id) {
    throw new Error('未能解析 KV namespace id，请检查 Wrangler 输出。');
  }

  return { id: createdJson.id, preview_id: createdJson.preview_id || createdJson.id };
}

function getOrCreateD1Database() {
  const list = runWrangler(['d1', 'list', '--json']);
  const listJson = tryParseJson(list.stdout);
  const existing = Array.isArray(listJson)
    ? listJson.find((item) => item?.name === D1_NAME || item?.database_name === D1_NAME)
    : null;

  if (existing?.uuid || existing?.database_id) {
    return { id: existing.uuid || existing.database_id };
  }

  const created = runWrangler(['d1', 'create', D1_NAME, '--json'], true);
  const parsed = tryParseJson(created.stdout);

  const id =
    parsed?.uuid ||
    parsed?.database_id ||
    parseIdFromText(created.stdout + created.stderr, [
      /"uuid"\s*:\s*"([a-f0-9-]+)"/i,
      /"database_id"\s*:\s*"([a-f0-9-]+)"/i,
      /database_id\s*=\s*"([a-f0-9-]+)"/i,
      /\b([a-f0-9]{8}-[a-f0-9-]{27})\b/i
    ]);

  if (!id) {
    throw new Error('未能解析 D1 database_id，请检查 Wrangler 输出。');
  }

  return { id };
}

function setOrAppendKey(block, key, value) {
  const keyRegex = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (keyRegex.test(block)) {
    return block.replace(keyRegex, `${key} = "${value}"`);
  }
  return `${block.trimEnd()}\n${key} = "${value}"\n`;
}

function upsertArrayTable(content, tableName, bindingValue, map) {
  const tableRegex = new RegExp(`\\[\\[${tableName}\\]\\][\\s\\S]*?(?=\\n\\[\\[|$)`, 'g');
  const matches = [...content.matchAll(tableRegex)];

  let found = false;
  let next = content;

  for (const match of matches) {
    const block = match[0];
    const binding = block.match(/^\s*binding\s*=\s*"([^"]+)"/m)?.[1] || '';
    if (binding !== bindingValue) continue;

    found = true;
    let updated = block;
    for (const [k, v] of Object.entries(map)) {
      updated = setOrAppendKey(updated, k, String(v));
    }
    next = next.replace(block, updated);
  }

  if (!found) {
    let appended = `\n[[${tableName}]]\n`;
    appended += `binding = "${bindingValue}"\n`;
    for (const [k, v] of Object.entries(map)) {
      appended += `${k} = "${v}"\n`;
    }
    next = `${next.trimEnd()}\n${appended}`;
  }

  return next;
}

function ensureWranglerToml() {
  if (existsSync(WRANGLER_TOML)) return;

  const template = `name = "h3c-batch-query-tool"
main = "@astrojs/cloudflare/entrypoints/server"
compatibility_date = "${new Date().toISOString().slice(0, 10)}"

[assets]
directory = "./dist"
binding = "ASSETS"
`;

  writeFileSync(WRANGLER_TOML, template, 'utf-8');
}

function updateWranglerToml(kv, d1) {
  ensureWranglerToml();
  let content = readFileSync(WRANGLER_TOML, 'utf-8');

  content = upsertArrayTable(content, 'kv_namespaces', 'H3C_BOM_CACHE', {
    id: kv.id,
    preview_id: kv.preview_id
  });

  content = upsertArrayTable(content, 'd1_databases', 'QUERY_LOGS_DB', {
    database_name: D1_NAME,
    database_id: d1.id
  });

  writeFileSync(WRANGLER_TOML, content, 'utf-8');
}

function ensureScriptsDir() {
  const scriptsDir = path.dirname(path.join(projectRoot, 'scripts', 'setup-cf.mjs'));
  if (!existsSync(scriptsDir)) mkdirSync(scriptsDir, { recursive: true });
}

function main() {
  ensureScriptsDir();

  console.log('🔎 检查并初始化 Cloudflare 资源...');
  const kv = getOrCreateKvNamespace();
  const d1 = getOrCreateD1Database();

  updateWranglerToml(kv, d1);

  console.log('✅ Cloudflare 资源已就绪并同步到 wrangler.toml');
  console.log(`KV: ${KV_NAME} -> ${kv.id}`);
  console.log(`D1: ${D1_NAME} -> ${d1.id}`);
}

main();
