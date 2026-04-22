import type { APIRoute } from 'astro';

const H3C_API_URL = 'https://www.h3c.com/cn/WebCMSApi/api/BOM/GetComponentsListBySN';
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const SN_REGEX = /^[A-Z0-9-]{6,64}$/;

type NormalizedComponent = {
  category: string;
  partNumber: string;
  description: string;
  quantity: number;
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function sanitizeSn(raw: string) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function toSafeQuantity(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function pickFirstArray(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) {
    return input.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }

  if (!input || typeof input !== 'object') {
    return [];
  }

  const knownKeys = ['data', 'Data', 'result', 'Result', 'rows', 'Rows', 'list', 'List'];
  for (const key of knownKeys) {
    const next = (input as Record<string, unknown>)[key];
    const found = pickFirstArray(next);
    if (found.length > 0) {
      return found;
    }
  }

  const values = Object.values(input as Record<string, unknown>);
  for (const value of values) {
    const found = pickFirstArray(value);
    if (found.length > 0) {
      return found;
    }
  }

  return [];
}

function normalizeComponents(payload: unknown): NormalizedComponent[] {
  const rows = pickFirstArray(payload);

  return rows
    .map((item) => {
      const category =
        String(
          item.category ??
            item.Category ??
            item.componentCategory ??
            item.ComponentCategory ??
            item.type ??
            item.Type ??
            '未知'
        ).trim() || '未知';

      const partNumber =
        String(
          item.partNumber ?? item.PartNumber ?? item.materialCode ?? item.MaterialCode ?? item.code ?? item.Code ?? ''
        ).trim();

      const description =
        String(
          item.description ?? item.Description ?? item.name ?? item.Name ?? item.componentName ?? item.ComponentName ?? ''
        ).trim();

      const quantity = toSafeQuantity(
        item.quantity ?? item.Quantity ?? item.count ?? item.Count ?? item.number ?? item.Number ?? 0
      );

      return {
        category,
        partNumber,
        description,
        quantity
      };
    })
    .filter((item) => item.partNumber || item.description || item.category !== '未知');
}

function getClientIp(request: Request) {
  const direct = request.headers.get('cf-connecting-ip');
  if (direct) return direct;

  const forwarded = request.headers.get('x-forwarded-for');
  if (!forwarded) return '';
  return forwarded.split(',')[0]?.trim() || '';
}

function safeWaitUntil(locals: App.Locals, promise: Promise<unknown>) {
  const ctx = (locals as { runtime?: { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } })?.runtime?.ctx;
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
    return;
  }

  void promise;
}

async function writeQueryLog(locals: App.Locals, sn: string, status: 'success' | 'fail', clientIp: string) {
  const env = (locals as { runtime?: { env?: { QUERY_LOGS_DB?: D1Database } } })?.runtime?.env;
  const db = env?.QUERY_LOGS_DB;
  if (!db) return;

  const task = db
    .prepare(
      `CREATE TABLE IF NOT EXISTS query_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sn TEXT NOT NULL,
        query_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status TEXT,
        client_ip TEXT
      )`
    )
    .run()
    .then(() => db.prepare('INSERT INTO query_logs (sn, status, client_ip) VALUES (?1, ?2, ?3)').bind(sn, status, clientIp).run())
    .catch(() => undefined);

  safeWaitUntil(locals, task);
}

export const GET: APIRoute = async ({ request, url, locals }) => {
  const rawSn = url.searchParams.get('sn') || '';
  const sn = sanitizeSn(rawSn);
  const clientIp = getClientIp(request);

  if (!sn || !SN_REGEX.test(sn)) {
    await writeQueryLog(locals, sn || rawSn || 'INVALID_SN', 'fail', clientIp);
    return jsonResponse(
      {
        success: false,
        sn: rawSn || 'INVALID_SN',
        message: '序列号格式不合法'
      },
      400
    );
  }

  const env = (locals as { runtime?: { env?: { H3C_BOM_CACHE?: KVNamespace } } })?.runtime?.env;
  const kv = env?.H3C_BOM_CACHE;
  const cacheKey = `SN:${sn}`;

  if (kv) {
    const cachedText = await kv.get(cacheKey, 'text');
    if (cachedText) {
      try {
        const cachedData = JSON.parse(cachedText);
        if (Array.isArray(cachedData) && cachedData.length > 0) {
          await writeQueryLog(locals, sn, 'success', clientIp);
          return jsonResponse({
            success: true,
            sn,
            source: 'kv',
            data: cachedData
          });
        }
      } catch {
        // ignore invalid cache payload
      }
    }
  }

  const target = new URL(H3C_API_URL);
  target.searchParams.set('sn', sn);

  try {
    const response = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://www.h3c.com/'
      }
    });

    if (!response.ok) {
      await writeQueryLog(locals, sn, 'fail', clientIp);
      return jsonResponse(
        {
          success: false,
          sn,
          message: '查无此序列号或目标接口限流'
        },
        404
      );
    }

    const payload = await response.json();
    const normalized = normalizeComponents(payload);

    if (normalized.length === 0) {
      await writeQueryLog(locals, sn, 'fail', clientIp);
      return jsonResponse(
        {
          success: false,
          sn,
          message: '查无此序列号或目标接口无可用数据'
        },
        404
      );
    }

    if (kv) {
      const cacheTask = kv.put(cacheKey, JSON.stringify(normalized), {
        expirationTtl: CACHE_TTL_SECONDS
      });
      safeWaitUntil(locals, cacheTask);
    }

    await writeQueryLog(locals, sn, 'success', clientIp);

    return jsonResponse({
      success: true,
      sn,
      source: 'h3c_api',
      data: normalized
    });
  } catch {
    await writeQueryLog(locals, sn, 'fail', clientIp);
    return jsonResponse(
      {
        success: false,
        sn,
        message: '上游服务不可用，请稍后重试'
      },
      502
    );
  }
};
