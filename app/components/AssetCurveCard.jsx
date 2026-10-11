'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { fetchFundHistory } from '../api/fund';
import { buildAssetCurve } from '../lib/assetCurve';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const RANGES = [
  { key: '1m', label: '1月', days: 31 },
  { key: '3m', label: '3月', days: 92 },
  { key: '6m', label: '半年', days: 183 },
  { key: 'all', label: '全部', days: null }
];

const fmt = (n) => Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AssetCurveCard({ funds, holdings, transactions, masked }) {
  const [range, setRange] = useState('all');

  const codes = useMemo(
    () =>
      (funds || [])
        .map((f) => f.code)
        .filter((c) => {
          const hasShare = Number(holdings?.[c]?.share) > 0;
          const hasTx = (transactions?.[c] || []).length > 0;
          return hasShare || hasTx;
        }),
    [funds, holdings, transactions]
  );

  const { data: navByCode, isLoading } = useQuery({
    queryKey: ['assetCurveNav', [...codes].sort().join(',')],
    enabled: codes.length > 0,
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const entries = await Promise.all(
        codes.map(async (code) => {
          const list = await fetchFundHistory(code, 'all');
          return [code, (list || []).map((d) => ({ date: d.date, value: Number(d.unitNetValue ?? d.value) }))];
        })
      );
      return Object.fromEntries(entries);
    }
  });

  const addedAtByCode = useMemo(() => Object.fromEntries((funds || []).map((f) => [f.code, f.addedAt])), [funds]);

  const full = useMemo(
    () => (navByCode ? buildAssetCurve({ codes, holdings, transactions, navByCode, addedAtByCode }) : []),
    [navByCode, codes, holdings, transactions, addedAtByCode]
  );

  const series = useMemo(() => {
    const r = RANGES.find((x) => x.key === range);
    if (!r?.days || !full.length) return full;
    const cutoff = new Date(Date.now() - r.days * 86400000).toISOString().slice(0, 10);
    return full.filter((p) => p.date >= cutoff);
  }, [full, range]);

  if (codes.length === 0) return null;

  const last = series[series.length - 1];
  const first = series[0];
  const profit = last ? last.value - last.invested : 0;
  const profitInRange = last && first ? last.value - first.value - (last.invested - first.invested) : 0;
  const isDark = typeof document === 'undefined' || document.documentElement.getAttribute('data-theme') !== 'light';
  const text = isDark ? '#e5e7eb' : '#0f172a';
  const grid = isDark ? 'rgba(148,163,184,0.15)' : 'rgba(100,116,139,0.18)';
  const money = (n) => (masked ? '••••' : `¥${fmt(n)}`);

  const chartData = {
    labels: series.map((p) => p.date),
    datasets: [
      {
        label: '总资产',
        data: series.map((p) => Number(p.value.toFixed(2))),
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34,211,238,0.12)',
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.2
      },
      {
        label: '累计净投入',
        data: series.map((p) => Number(p.invested.toFixed(2))),
        borderColor: '#9ca3af',
        borderDash: [5, 4],
        pointRadius: 0,
        borderWidth: 1.5,
        stepped: true
      }
    ]
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (c) => `${c.dataset.label}：${masked ? '••••' : `¥${fmt(c.parsed.y)}`}` }
      }
    },
    scales: {
      x: { ticks: { color: text, maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
      y: { display: !masked, ticks: { color: text, callback: (v) => Number(v).toLocaleString('zh-CN') }, grid: { color: grid } }
    }
  };

  return (
    <div className="glass card" style={{ gridColumn: 'span 12', marginTop: 10, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>资产曲线</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className="button"
              onClick={() => setRange(r.key)}
              style={{ padding: '2px 10px', opacity: range === r.key ? 1 : 0.55 }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="muted" style={{ padding: '32px 0', textAlign: 'center' }}>
          正在拉取历史净值…
        </div>
      ) : series.length < 2 ? (
        <div className="muted" style={{ padding: '32px 0', textAlign: 'center' }}>
          数据还不够画曲线：请先在基金里填写持仓或交易记录（定投计划会自动生成交易）。
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '10px 0' }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                总资产（截至 {last.date}）
              </div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{money(last.value)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                累计净投入
              </div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{money(last.invested)}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                累计盈亏
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: profit >= 0 ? '#f87171' : '#34d399' }}>
                {masked ? '••••' : `${profit >= 0 ? '+' : ''}${fmt(profit)}`}
              </div>
            </div>
            {range !== 'all' && (
              <div>
                <div className="muted" style={{ fontSize: 12 }}>
                  区间盈亏
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, color: profitInRange >= 0 ? '#f87171' : '#34d399' }}>
                  {masked ? '••••' : `${profitInRange >= 0 ? '+' : ''}${fmt(profitInRange)}`}
                </div>
              </div>
            )}
          </div>
          <div style={{ height: 220 }}>
            <Line data={chartData} options={options} />
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            按已确认净值回放交易记录计算，不含当日估值；红涨绿跌。
          </div>
        </>
      )}
    </div>
  );
}
