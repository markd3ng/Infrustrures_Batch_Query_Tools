import { useMemo, useState } from 'react';

type QueryStatus = 'pending' | 'loading' | 'success' | 'fail';

type ComponentItem = {
  category: string;
  partNumber: string;
  description: string;
  quantity: number;
};

type QueryResult = {
  sn: string;
  source?: 'kv' | 'h3c_api';
  status: QueryStatus;
  message?: string;
  data: ComponentItem[];
};

type FlattenedRow = ComponentItem & { sn: string; source: string };

const SPLIT_REGEX = /[\s,，;；]+/g;

function parseSerialNumbers(input: string) {
  const unique = new Set<string>();

  for (const token of input.split(SPLIT_REGEX)) {
    const sn = token.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (sn) unique.add(sn);
  }

  return Array.from(unique);
}

function downloadFile(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export default function BatchQueryApp() {
  const [rawInput, setRawInput] = useState('');
  const [concurrency, setConcurrency] = useState(4);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [sortBy, setSortBy] = useState<'category' | 'quantity'>('category');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [lastError, setLastError] = useState('');

  const sns = useMemo(() => parseSerialNumbers(rawInput), [rawInput]);
  const total = sns.length;

  const progress = useMemo(() => {
    const success = results.filter((item) => item.status === 'success').length;
    const fail = results.filter((item) => item.status === 'fail').length;
    const loading = results.filter((item) => item.status === 'loading').length;
    const completed = success + fail;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { success, fail, loading, completed, percent };
  }, [results, total]);

  const flattenedRows = useMemo<FlattenedRow[]>(() => {
    const rows = results
      .filter((item) => item.status === 'success')
      .flatMap((item) =>
        item.data.map((component) => ({
          ...component,
          sn: item.sn,
          source: item.source || 'unknown'
        }))
      );

    const sign = sortOrder === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      if (sortBy === 'quantity') {
        return (a.quantity - b.quantity) * sign;
      }
      return a.category.localeCompare(b.category, 'zh-CN') * sign;
    });
  }, [results, sortBy, sortOrder]);

  const updateResult = (sn: string, patch: Partial<QueryResult>) => {
    setResults((prev) => prev.map((row) => (row.sn === sn ? { ...row, ...patch } : row)));
  };

  const queryOne = async (sn: string) => {
    updateResult(sn, { status: 'loading', message: '' });

    try {
      const response = await fetch(`/api/query-sn?sn=${encodeURIComponent(sn)}`);
      const payload = (await response.json()) as {
        success: boolean;
        source?: 'kv' | 'h3c_api';
        message?: string;
        data?: ComponentItem[];
      };

      if (!response.ok || !payload.success) {
        updateResult(sn, {
          status: 'fail',
          message: payload.message || `请求失败 (${response.status})`,
          data: []
        });
        return;
      }

      updateResult(sn, {
        status: 'success',
        source: payload.source,
        data: Array.isArray(payload.data) ? payload.data : [],
        message: ''
      });
    } catch (error) {
      updateResult(sn, {
        status: 'fail',
        message: error instanceof Error ? error.message : '网络异常',
        data: []
      });
    }
  };

  const runPool = async (snList: string[], limit: number) => {
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, snList.length));

    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < snList.length) {
        const currentIndex = cursor;
        cursor += 1;
        const sn = snList[currentIndex];
        await queryOne(sn);
      }
    });

    await Promise.all(workers);
  };

  const handleStart = async () => {
    if (isRunning) return;

    if (sns.length === 0) {
      setLastError('请输入至少一个有效序列号。');
      return;
    }

    setLastError('');
    setIsRunning(true);
    setResults(sns.map((sn) => ({ sn, status: 'pending', data: [] })));

    try {
      await runPool(sns, concurrency);
    } finally {
      setIsRunning(false);
    }
  };

  const handleExportCsv = () => {
    if (flattenedRows.length === 0) return;

    const header = ['SN', '来源', '配置品类', '料号', '描述', '数量'];
    const lines = flattenedRows.map((row) =>
      [row.sn, row.source, row.category, row.partNumber, row.description, row.quantity].map(csvEscape).join(',')
    );
    const csv = `\uFEFF${[header.join(','), ...lines].join('\n')}`;
    downloadFile(csv, `h3c-query-${Date.now()}.csv`, 'text/csv;charset=utf-8;');
  };

  const handleExportExcel = () => {
    if (flattenedRows.length === 0) return;

    const header = ['SN', '来源', '配置品类', '料号', '描述', '数量'];
    const lines = flattenedRows.map((row) => [row.sn, row.source, row.category, row.partNumber, row.description, row.quantity].join('\t'));
    const tsv = `\uFEFF${[header.join('\t'), ...lines].join('\n')}`;
    downloadFile(tsv, `h3c-query-${Date.now()}.xls`, 'application/vnd.ms-excel;charset=utf-8;');
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 transition-all duration-300 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">批量输入序列号</h2>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span>并发数</span>
            <input
              type="number"
              min={1}
              max={8}
              value={concurrency}
              onChange={(event) => setConcurrency(Math.min(8, Math.max(1, Number(event.target.value) || 1)))}
              className="w-20 rounded-lg border border-white/15 bg-slate-950/60 px-2 py-1 text-slate-100 outline-none transition-all duration-300 focus:border-cyan-300/50"
            />
          </div>
        </div>

        <textarea
          value={rawInput}
          onChange={(event) => setRawInput(event.target.value)}
          placeholder="每行一个 SN，或使用空格/逗号分隔"
          className="h-40 w-full rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-100 outline-none transition-all duration-300 focus:border-cyan-400/50"
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleStart}
            disabled={isRunning}
            className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-all duration-300 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-cyan-800/60"
          >
            {isRunning ? '正在查询...' : '开始批量查询'}
          </button>

          <button
            type="button"
            onClick={() => {
              if (isRunning) return;
              setRawInput('');
              setResults([]);
              setLastError('');
            }}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 transition-all duration-300 hover:border-white/35 hover:bg-white/5"
          >
            清空
          </button>

          <span className="text-xs text-slate-400">已解析 {total} 个唯一 SN</span>
        </div>

        {lastError ? <p className="mt-3 text-sm text-rose-300">{lastError}</p> : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 transition-all duration-300 md:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">查询进度</h2>
          <div className="text-sm text-slate-300">
            成功 {progress.success} / 失败 {progress.fail} / 总数 {total}
            {progress.loading > 0 ? ` / 进行中 ${progress.loading}` : ''}
          </div>
        </div>

        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 transition-all duration-300 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">结果表格</h2>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-300">排序字段</label>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as 'category' | 'quantity')}
              className="rounded-lg border border-white/15 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition-all duration-300"
            >
              <option value="category">配置品类</option>
              <option value="quantity">数量</option>
            </select>

            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as 'asc' | 'desc')}
              className="rounded-lg border border-white/15 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition-all duration-300"
            >
              <option value="asc">升序</option>
              <option value="desc">降序</option>
            </select>

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={flattenedRows.length === 0}
              className="rounded-lg border border-emerald-400/40 px-3 py-1 text-xs text-emerald-200 transition-all duration-300 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              导出 CSV
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              disabled={flattenedRows.length === 0}
              className="rounded-lg border border-sky-400/40 px-3 py-1 text-xs text-sky-200 transition-all duration-300 hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              导出 Excel
            </button>
          </div>
        </div>

        {isRunning && flattenedRows.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-9 animate-pulse rounded-lg bg-slate-800/70" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80 text-left text-slate-300">
                <tr>
                  <th className="px-3 py-2">SN</th>
                  <th className="px-3 py-2">来源</th>
                  <th className="px-3 py-2">配置品类</th>
                  <th className="px-3 py-2">料号</th>
                  <th className="px-3 py-2">描述</th>
                  <th className="px-3 py-2 text-right">数量</th>
                </tr>
              </thead>
              <tbody>
                {flattenedRows.map((row, index) => (
                  <tr key={`${row.sn}-${row.partNumber}-${index}`} className="border-t border-white/5 transition-all duration-300 hover:bg-white/5">
                    <td className="px-3 py-2 align-top text-slate-200">{row.sn}</td>
                    <td className="px-3 py-2 align-top text-xs text-cyan-300">{row.source}</td>
                    <td className="px-3 py-2 align-top text-slate-100">{row.category}</td>
                    <td className="px-3 py-2 align-top text-slate-300">{row.partNumber || '-'}</td>
                    <td className="px-3 py-2 align-top text-slate-300">{row.description || '-'}</td>
                    <td className="px-3 py-2 text-right align-top text-slate-100">{row.quantity}</td>
                  </tr>
                ))}

                {!isRunning && flattenedRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                      暂无可展示数据，请先执行查询。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
          {results
            .filter((item) => item.status === 'fail')
            .map((item) => (
              <div key={item.sn} className="rounded-lg border border-rose-300/20 bg-rose-400/5 px-3 py-2 text-rose-200">
                <span className="font-semibold">{item.sn}</span>：{item.message || '查询失败'}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
