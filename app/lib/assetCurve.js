/**
 * 资产曲线：用交易记录回放每天的份额，再乘以当日历史净值，得到「总资产」和「累计净投入」。
 * 纯函数，不依赖浏览器环境，便于单测。
 *
 * navByCode: { [code]: Array<{ date: 'YYYY-MM-DD', value: number }> }（按日期升序）
 */

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 生成某只基金的「份额/投入」事件：[{ date, dShare, dInvest }]，date 为生效的净值日（含）。 */
export function buildFundEvents(code, { holding, transactions, navList, addedAt }) {
  const dates = navList.map((d) => d.date);
  const firstNav = dates[0];
  const lastNav = dates[dates.length - 1];
  if (!firstNav) return [];

  // 找到 >= date 的第一个净值日；after=true 时取严格大于（下午 3 点后成交，按下一个净值日确认）
  const effectiveDate = (date, after) => {
    for (const d of dates) {
      if (after ? d > date : d >= date) return d;
    }
    return null;
  };

  const txs = (transactions?.[code] || [])
    .filter((t) => t && !t.isHistoryOnly && !t.groupId && t.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || toNum(a.timestamp) - toNum(b.timestamp));

  const events = [];
  if (txs.length) {
    for (const t of txs) {
      const eff = effectiveDate(String(t.date).slice(0, 10), !!t.isAfter3pm) || lastNav;
      const sign = t.type === 'sell' ? -1 : 1;
      events.push({ date: eff, dShare: sign * toNum(t.share), dInvest: sign * toNum(t.amount) });
    }
    return events;
  }

  // 没有交易记录、只填了持仓：按「首次买入日 / 添加日」一次性建仓
  const share = toNum(holding?.share);
  if (share > 0) {
    const startRaw = holding?.firstPurchaseDate || (addedAt ? new Date(addedAt).toISOString().slice(0, 10) : firstNav);
    const eff = effectiveDate(String(startRaw).slice(0, 10), false) || lastNav;
    events.push({ date: eff, dShare: share, dInvest: share * toNum(holding?.cost) });
  }
  return events;
}

export function buildAssetCurve({ codes, holdings, transactions, navByCode, addedAtByCode = {} }) {
  const perFund = [];
  const allDates = new Set();
  for (const code of codes) {
    const navList = navByCode[code];
    if (!navList?.length) continue;
    const events = buildFundEvents(code, {
      holding: holdings?.[code],
      transactions,
      navList,
      addedAt: addedAtByCode[code]
    });
    if (!events.length) continue;
    perFund.push({ code, navList, events });
    const first = events.reduce((m, e) => (e.date < m ? e.date : m), events[0].date);
    navList.forEach((d) => {
      if (d.date >= first) allDates.add(d.date);
    });
  }
  const dates = [...allDates].sort();
  if (!dates.length) return [];

  const state = perFund.map((f) => ({ ...f, ei: 0, navI: -1, share: 0, invest: 0 }));
  const out = [];
  for (const day of dates) {
    let value = 0;
    let invested = 0;
    for (const s of state) {
      while (s.navI + 1 < s.navList.length && s.navList[s.navI + 1].date <= day) s.navI += 1;
      s.events.sort((a, b) => a.date.localeCompare(b.date));
      while (s.ei < s.events.length && s.events[s.ei].date <= day) {
        s.share += s.events[s.ei].dShare;
        s.invest += s.events[s.ei].dInvest;
        s.ei += 1;
      }
      if (s.navI >= 0 && s.share > 0) value += s.share * s.navList[s.navI].value;
      invested += s.invest;
    }
    out.push({ date: day, value, invested });
  }
  return out;
}
