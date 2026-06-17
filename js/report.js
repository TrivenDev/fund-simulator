import { DEFAULT_INITIAL_CAPITAL } from "./config.js";
import { escapeHtml, money, percent, signedMoney } from "./format.js";
import { allocationFormulaText, fundNavStats, performanceMetrics } from "./strategy.js";

function reportTable(headers, rows) {
  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

function reportFundDetails(funds, result) {
  const usedCodes = new Set(result.trades.map((trade) => trade.code));
  return funds
    .filter((fund) => usedCodes.has(fund.code))
    .map((fund) => {
      const stats = fundNavStats(fund);
      return [
        fund.code,
        fund.name,
        fund.sector,
        fund.type || "未知",
        stats ? `${stats.start.date} / ${stats.start.nav.toFixed(4)}` : "-",
        stats ? `${stats.end.date} / ${stats.end.nav.toFixed(4)}` : "-",
        stats ? percent(stats.return) : "-",
        stats ? percent(stats.drawdown) : "-",
      ];
    });
}

export function downloadTextFile(filename, content, type = "text/html;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildHtmlReport(result, { funds = [], dataSource = "" } = {}) {
  const assumptions = result.assumptions || {};
  const metrics = result.metrics || performanceMetrics(result.equity, assumptions.initialCapital || DEFAULT_INITIAL_CAPITAL);
  const monthlyRows = [];
  for (const year of result.annual || []) {
    for (const month of year.months || []) {
      if (!month) continue;
      monthlyRows.push([
        year.year,
        `${month.month}月`,
        month.date,
        money(month.start),
        money(month.end),
        signedMoney(month.amount),
        percent(month.return),
      ]);
    }
  }

  const decisionRows = [];
  const timingRows = [];
  for (const decision of result.decisions || []) {
    if (decision.id) {
      timingRows.push([
        decision.date,
        decision.timing?.shouldEnter ? "买入" : "空仓等待",
        decision.timing?.bestReturn === null || decision.timing?.bestReturn === undefined ? "-" : percent(decision.timing.bestReturn),
        decision.timing?.topAverage === null || decision.timing?.topAverage === undefined ? "-" : percent(decision.timing.topAverage),
        decision.timing?.positiveBreadth === null || decision.timing?.positiveBreadth === undefined ? "-" : percent(decision.timing.positiveBreadth),
        (decision.timing?.reasons || []).join("；"),
      ]);
    }
    for (const item of decision.selected || []) {
      decisionRows.push([
        decision.date,
        item.rank,
        item.code,
        item.name,
        item.sector,
        percent(item.monthlyReturn),
        percent(item.allocation),
        allocationFormulaText(item, assumptions.allocationMode),
      ]);
    }
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>基金模拟交易回测报告</title>
  <style>
    body { margin: 32px; color: #17202a; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; line-height: 1.5; }
    h1 { margin: 0 0 8px; }
    h2 { margin-top: 28px; border-bottom: 1px solid #d9e0e7; padding-bottom: 8px; }
    .meta { color: #64707d; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 12px; }
    .card { border: 1px solid #d9e0e7; border-radius: 6px; padding: 12px; background: #fbfcfd; }
    .card span { display: block; color: #64707d; font-size: 13px; }
    .card strong { display: block; margin-top: 6px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th, td { border: 1px solid #d9e0e7; padding: 8px 10px; text-align: left; }
    th { background: #eef3f8; }
    tr:nth-child(even) td { background: #fbfcfd; }
  </style>
</head>
<body>
  <h1>基金模拟交易回测报告</h1>
  <p class="meta">生成时间：${escapeHtml(new Date().toLocaleString("zh-CN"))}；模拟编号：${escapeHtml(result.id)}</p>

  <h2>参数与数据来源</h2>
  ${reportTable(["项目", "值"], [
    ["模拟区间", assumptions.period || "-"],
    ["初始资金", money(assumptions.initialCapital || DEFAULT_INITIAL_CAPITAL)],
    ["买入分配", assumptions.allocationModeLabel || "-"],
    ["收益排名前 N", assumptions.topN ?? "-"],
    ["最多持有", assumptions.maxHoldings ?? "-"],
    ["同板块最多", assumptions.maxSameSector ?? "-"],
    ["持有周期（月）", assumptions.holdingMonths ?? "-"],
    ["单只仓位上限", assumptions.maxSingleAllocation ? percent(assumptions.maxSingleAllocation) : "-"],
    ["入场过滤", assumptions.entryFilterEnabled ? "启用" : "关闭"],
    ["最低入场收益", assumptions.minEntryReturn === undefined ? "-" : percent(assumptions.minEntryReturn)],
    ["正收益占比阈值", assumptions.minPositiveBreadth === undefined ? "-" : percent(assumptions.minPositiveBreadth)],
    ["数据来源", assumptions.dataSource || dataSource],
  ])}

  <h2>核心指标</h2>
  <div class="grid">
    <div class="card"><span>期末资产</span><strong>${money(result.finalValue)}</strong></div>
    <div class="card"><span>累计收益</span><strong>${percent(result.totalReturn)}</strong></div>
    <div class="card"><span>年化收益</span><strong>${percent(metrics.cagr)}</strong></div>
    <div class="card"><span>最大回撤</span><strong>${percent(metrics.maxDrawdown)}</strong></div>
    <div class="card"><span>月度胜率</span><strong>${percent(metrics.winRate)}</strong></div>
    <div class="card"><span>收益回撤比</span><strong>${metrics.returnDrawdownRatio.toFixed(2)}</strong></div>
  </div>

  <h2>年度收益</h2>
  ${reportTable(["年份", "期初资产", "期末资产", "年度收益", "是否达标"], (result.annual || []).map((year) => [
    year.year,
    money(year.start),
    money(year.end),
    percent(year.return),
    year.hitTarget ? "是" : "否",
  ]))}

  <h2>月度收益</h2>
  ${reportTable(["年份", "月份", "日期", "月初资产", "月末资产", "盈亏金额", "收益率"], monthlyRows)}

  <h2>交易记录</h2>
  ${reportTable(["日期", "操作", "基金", "代码", "板块", "买入额度", "卖出额度", "账户余额", "份额", "说明"], result.trades.map((trade) => [
    trade.date,
    trade.action,
    trade.fundName,
    trade.code,
    trade.sector,
    trade.buyAmount ? money(trade.buyAmount) : "-",
    trade.sellAmount ? money(trade.sellAmount) : "-",
    trade.balance ? money(trade.balance) : "-",
    trade.shares?.toFixed ? trade.shares.toFixed(2) : trade.shares,
    trade.note,
  ]))}

  <h2>择时决策</h2>
  ${reportTable(["日期", "结论", "榜首收益", "前N平均收益", "正收益占比", "原因"], timingRows)}

  <h2>买入决策解释</h2>
  ${reportTable(["日期", "排名", "代码", "基金", "板块", "当月收益", "最终权重", "权重计算"], decisionRows)}

  <h2>基金明细</h2>
  ${reportTable(["代码", "基金", "板块", "份额类型", "起始净值", "最新净值", "区间收益", "最大回撤"], reportFundDetails(funds, result))}
</body>
</html>`;
}
