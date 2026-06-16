const DEFAULT_INITIAL_CAPITAL = 3000;
const TARGET_ANNUAL_RETURN = 0.2;
const MAX_HOLDINGS = 3;
const MAX_SAME_SECTOR = 2;
const STOP_LOSS = -0.12;
const ROTATION_TOP_N = 10;
const MAX_SINGLE_ALLOCATION = 0.6;
const ALLOCATION_MODE_LABELS = {
  equal: "均等买入",
  rank: "排名加权",
  riskAdjusted: "排名加权+风险惩罚",
};
const PERIOD_MIN_MONTH = "1998-01";
const PERIOD_MAX_MONTH = "2026-12";
const MAX_UPDATE_FUNDS = 1000;
const FALLBACK_DATA_SOURCE = "本地内置候选池 data/funds.js（window.FUND_UNIVERSE，月度净值样本，可替换为真实基金净值数据）";

const $ = (selector) => document.querySelector(selector);

const elements = {
  startBtn: $("#startBtn"),
  updateDataBtn: $("#updateDataBtn"),
  saveBtn: $("#saveBtn"),
  startMonth: $("#startMonth"),
  endMonth: $("#endMonth"),
  startMonthButton: $("#startMonthButton"),
  endMonthButton: $("#endMonthButton"),
  startMonthPanel: $("#startMonthPanel"),
  endMonthPanel: $("#endMonthPanel"),
  startYearSelect: $("#startYearSelect"),
  endYearSelect: $("#endYearSelect"),
  startMonthGrid: $("#startMonthGrid"),
  endMonthGrid: $("#endMonthGrid"),
  maxFunds: $("#maxFunds"),
  initialCapitalInput: $("#initialCapitalInput"),
  allocationMode: $("#allocationMode"),
  topNInput: $("#topNInput"),
  maxHoldingsInput: $("#maxHoldingsInput"),
  maxSameSectorInput: $("#maxSameSectorInput"),
  holdingMonthsInput: $("#holdingMonthsInput"),
  maxSingleAllocationInput: $("#maxSingleAllocationInput"),
  initialCapital: $("#initialCapital"),
  finalValue: $("#finalValue"),
  totalReturn: $("#totalReturn"),
  targetStatus: $("#targetStatus"),
  cagrMetric: $("#cagrMetric"),
  maxDrawdownMetric: $("#maxDrawdownMetric"),
  winRateMetric: $("#winRateMetric"),
  returnDrawdownMetric: $("#returnDrawdownMetric"),
  dataQualitySource: $("#dataQualitySource"),
  dataQualityCards: $("#dataQualityCards"),
  etaText: $("#etaText"),
  progressBar: $("#progressBar"),
  activityLog: $("#activityLog"),
  runMeta: $("#runMeta"),
  equityChart: $("#equityChart"),
  yearCards: $("#yearCards"),
  tradeTable: $("#tradeTable"),
  tradeCount: $("#tradeCount"),
  fundModal: $("#fundModal"),
  fundModalTitle: $("#fundModalTitle"),
  fundModalMeta: $("#fundModalMeta"),
  fundModalStats: $("#fundModalStats"),
  fundModalClose: $("#fundModalClose"),
  fundNavChart: $("#fundNavChart"),
  fundChartTooltip: $("#fundChartTooltip"),
  marketTickerTrack: $("#marketTickerTrack"),
  marketTickerMeta: $("#marketTickerMeta"),
  annualModeButtons: document.querySelectorAll("[data-annual-mode]"),
};

let currentSimulation = null;
let activeFundPayload = {
  source: FALLBACK_DATA_SOURCE,
  updatedAt: null,
  funds: window.FUND_UNIVERSE,
  isFallback: true,
};

let monthBounds = { min: "2022-01", max: PERIOD_MAX_MONTH };
let openMonthPicker = null;
let activeFundChart = null;
let annualValueMode = "percent";

function money(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function signedMoney(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${money(Math.abs(value))}`;
}

function compactSignedMoney(value) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`;
  return `${sign}${abs.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addLog(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  ${message}`;
  elements.activityLog.appendChild(item);
  elements.activityLog.scrollTop = elements.activityLog.scrollHeight;
}

function setProgress(done, total) {
  const ratio = total === 0 ? 0 : Math.min(1, done / total);
  elements.progressBar.style.width = `${Math.round(ratio * 100)}%`;
}

function monthOf(date) {
  return date.slice(0, 7);
}

function monthLabel(month) {
  const [year, monthNumber] = month.split("-");
  return `${year}年${monthNumber}月`;
}

function currentRawFunds() {
  return activeFundPayload.funds?.length ? activeFundPayload.funds : window.FUND_UNIVERSE;
}

function normalizeNavPoint(point) {
  if (Array.isArray(point)) {
    return { date: point[0], nav: Number(point[1]) };
  }
  return { date: point.date, nav: Number(point.nav) };
}

function latestTickerItems(limit = 80) {
  const items = [];
  for (const fund of currentRawFunds() || []) {
    const nav = (fund.nav || [])
      .map(normalizeNavPoint)
      .filter((point) => point.date && Number.isFinite(point.nav) && point.nav > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (nav.length < 2) continue;

    const latest = nav[nav.length - 1];
    const previous = nav[nav.length - 2];
    const change = latest.nav / previous.nav - 1;
    if (!Number.isFinite(change)) continue;

    items.push({
      code: fund.code,
      name: fund.name,
      date: latest.date,
      nav: latest.nav,
      change,
    });
  }

  return items
    .sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}

function renderMarketTicker() {
  const items = latestTickerItems();
  elements.marketTickerTrack.innerHTML = "";
  elements.marketTickerMeta.textContent = items.length
    ? `${items[0].date} · 当前基金池 ${items.length} 条`
    : "暂无可滚动净值";

  if (items.length === 0) {
    const empty = document.createElement("span");
    empty.className = "ticker-empty";
    empty.textContent = "暂无可用基金净值，请先更新数据或检查内置样本。";
    elements.marketTickerTrack.appendChild(empty);
    return;
  }

  const createGroup = () => {
    const group = document.createElement("div");
    group.className = "ticker-group";
    for (const item of items) {
      const direction = item.change > 0 ? "up" : item.change < 0 ? "down" : "flat";
      const piece = document.createElement("span");
      piece.className = `ticker-item ${direction}`;
      piece.textContent = `${item.name} ${item.nav.toFixed(4)}（${item.change >= 0 ? "+" : ""}${percent(item.change)}）`;
      piece.title = `${item.code} · ${item.date}`;
      group.appendChild(piece);
    }
    return group;
  };

  elements.marketTickerTrack.appendChild(createGroup());
  elements.marketTickerTrack.appendChild(createGroup());
  elements.marketTickerTrack.style.setProperty("--ticker-duration", `${Math.max(36, Math.min(120, items.length * 3.2))}s`);
}

function collectAvailableMonths() {
  const monthSet = new Set();
  for (const fund of currentRawFunds() || []) {
    for (const point of fund.nav || []) {
      const date = Array.isArray(point) ? point[0] : point.date;
      if (date) monthSet.add(monthOf(date));
    }
  }
  return [...monthSet].sort();
}

function clampMonth(month, min, max) {
  if (!month || month < min) return min;
  if (month > max) return max;
  return month;
}

function pickerParts(kind) {
  return kind === "start"
    ? {
        input: elements.startMonth,
        button: elements.startMonthButton,
        panel: elements.startMonthPanel,
        yearSelect: elements.startYearSelect,
        grid: elements.startMonthGrid,
      }
    : {
        input: elements.endMonth,
        button: elements.endMonthButton,
        panel: elements.endMonthPanel,
        yearSelect: elements.endYearSelect,
        grid: elements.endMonthGrid,
      };
}

function setMonthPickerOpen(kind) {
  openMonthPicker = openMonthPicker === kind ? null : kind;
  renderMonthPickers();
}

function closeMonthPickers() {
  if (!openMonthPicker) return;
  openMonthPicker = null;
  renderMonthPickers();
}

function renderMonthPicker(kind) {
  const parts = pickerParts(kind);
  const value = parts.input.value;
  const selectedYear = value.slice(0, 4);
  const minYear = Number(monthBounds.min.slice(0, 4));
  const maxYear = Number(monthBounds.max.slice(0, 4));

  parts.button.textContent = monthLabel(value);
  parts.button.setAttribute("aria-expanded", String(openMonthPicker === kind));
  parts.panel.hidden = openMonthPicker !== kind;

  const currentYearOptions = Array.from(parts.yearSelect.options).map((option) => option.value).join(",");
  const nextYearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, index) => String(minYear + index)).join(",");
  if (currentYearOptions !== nextYearOptions) {
    parts.yearSelect.innerHTML = "";
    for (let year = minYear; year <= maxYear; year += 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = `${year}年`;
      parts.yearSelect.appendChild(option);
    }
  }
  parts.yearSelect.value = selectedYear;

  parts.grid.innerHTML = "";
  for (let monthNumber = 1; monthNumber <= 12; monthNumber += 1) {
    const month = `${selectedYear}-${String(monthNumber).padStart(2, "0")}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${monthNumber}月`;
    button.disabled = month < monthBounds.min || month > monthBounds.max;
    button.className = month === value ? "active" : "";
    button.addEventListener("click", () => {
      parts.input.value = month;
      if (elements.startMonth.value > elements.endMonth.value) {
        if (kind === "start") elements.endMonth.value = month;
        else elements.startMonth.value = month;
      }
      openMonthPicker = null;
      renderMonthPickers();
    });
    parts.grid.appendChild(button);
  }
}

function renderMonthPickers() {
  renderMonthPicker("start");
  renderMonthPicker("end");
}

function dataSourceLabel() {
  const updatedText = activeFundPayload.updatedAt ? `，更新时间 ${activeFundPayload.updatedAt}` : "";
  return `${activeFundPayload.source}${updatedText}`;
}

function setActiveFundPayload(payload, isFallback = false) {
  activeFundPayload = {
    source: payload.source || FALLBACK_DATA_SOURCE,
    updatedAt: payload.updatedAt || null,
    funds: payload.funds || window.FUND_UNIVERSE,
    isFallback,
  };
  setupPeriodInputs();
  renderDataQuality();
  renderMarketTicker();
}

function dataQualityStats() {
  const funds = currentRawFunds() || [];
  const monthSet = new Set();
  const navLengths = [];
  let fundsWithNav = 0;
  for (const fund of funds) {
    const nav = fund.nav || [];
    if (nav.length > 0) fundsWithNav += 1;
    navLengths.push(nav.length);
    for (const point of nav) {
      const date = Array.isArray(point) ? point[0] : point.date;
      if (date) monthSet.add(monthOf(date));
    }
  }
  const months = [...monthSet].sort();
  const maxLength = navLengths.length ? Math.max(...navLengths) : 0;
  const averageLength = navLengths.length
    ? navLengths.reduce((sum, value) => sum + value, 0) / navLengths.length
    : 0;
  const incompleteCount = navLengths.filter((length) => length > 0 && length < maxLength).length;
  return {
    fundCount: funds.length,
    fundsWithNav,
    monthCount: months.length,
    startMonth: months[0] || "-",
    endMonth: months[months.length - 1] || "-",
    averageLength,
    incompleteCount,
  };
}

function renderDataQuality() {
  if (!elements.dataQualityCards) return;
  const stats = dataQualityStats();
  elements.dataQualitySource.textContent = activeFundPayload.isFallback ? "当前使用内置样本" : "当前使用 AKShare 本地缓存";
  elements.dataQualityCards.innerHTML = "";
  const cards = [
    ["基金数量", `${stats.fundCount} 只`],
    ["可用净值", `${stats.fundsWithNav} 只`],
    ["净值区间", `${stats.startMonth} 至 ${stats.endMonth}`],
    ["覆盖月份", `${stats.monthCount} 个月`],
    ["平均长度", `${stats.averageLength.toFixed(1)} 条`],
    ["不完整数据", `${stats.incompleteCount} 只`],
  ];
  for (const [label, value] of cards) {
    const card = document.createElement("article");
    card.className = "quality-card";
    const labelNode = document.createElement("span");
    const valueNode = document.createElement("strong");
    labelNode.textContent = label;
    valueNode.textContent = value;
    card.append(labelNode, valueNode);
    elements.dataQualityCards.appendChild(card);
  }
}

function setupPeriodInputs() {
  const months = collectAvailableMonths();
  if (months.length === 0) return;

  const dataMin = months[0];
  const min = dataMin < PERIOD_MIN_MONTH ? dataMin : PERIOD_MIN_MONTH;
  const dataMax = months[months.length - 1];
  const max = dataMax > PERIOD_MAX_MONTH ? dataMax : PERIOD_MAX_MONTH;
  monthBounds = { min, max };
  elements.startMonth.value = clampMonth(elements.startMonth.value, min, max);
  elements.endMonth.value = clampMonth(elements.endMonth.value, min, max);
  if (elements.startMonth.value > elements.endMonth.value) {
    elements.startMonth.value = min;
    elements.endMonth.value = max;
  }
  renderMonthPickers();
}

function getSelectedPeriod() {
  const startMonth = elements.startMonth.value;
  const endMonth = elements.endMonth.value;
  if (!startMonth || !endMonth) {
    throw new Error("请选择模拟开始月份和结束月份。");
  }
  if (startMonth > endMonth) {
    throw new Error("开始月份不能晚于结束月份。");
  }
  return { startMonth, endMonth };
}

function getSelectedMaxFunds() {
  const raw = Number.parseInt(elements.maxFunds.value, 10);
  if (!Number.isFinite(raw)) return MAX_UPDATE_FUNDS;
  return Math.max(1, Math.min(MAX_UPDATE_FUNDS, raw));
}

function getInitialCapital() {
  const raw = Number.parseFloat(elements.initialCapitalInput.value);
  const value = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INITIAL_CAPITAL;
  elements.initialCapitalInput.value = String(value);
  elements.initialCapital.textContent = money(value);
  return value;
}

function getAllocationMode() {
  const mode = elements.allocationMode.value;
  return ALLOCATION_MODE_LABELS[mode] ? mode : "riskAdjusted";
}

function readBoundedInteger(input, fallback, min, max) {
  const raw = Number.parseInt(input.value, 10);
  const value = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : fallback;
  input.value = String(value);
  return value;
}

function getStrategyOptions() {
  const maxHoldings = readBoundedInteger(elements.maxHoldingsInput, MAX_HOLDINGS, 1, 10);
  const maxSameSector = readBoundedInteger(elements.maxSameSectorInput, MAX_SAME_SECTOR, 1, maxHoldings);
  return {
    topN: readBoundedInteger(elements.topNInput, ROTATION_TOP_N, 1, 50),
    maxHoldings,
    maxSameSector,
    holdingMonths: readBoundedInteger(elements.holdingMonthsInput, 1, 1, 12),
    maxSingleAllocation: readBoundedInteger(elements.maxSingleAllocationInput, Math.round(MAX_SINGLE_ALLOCATION * 100), 10, 100) / 100,
  };
}

function capAllocations(items, maxSingleAllocation = MAX_SINGLE_ALLOCATION) {
  const allocations = items.map((item) => ({ ...item }));
  let guard = 0;
  while (guard < 10) {
    guard += 1;
    const overweight = allocations.filter((item) => item.allocation > maxSingleAllocation);
    if (overweight.length === 0) break;
    const excess = overweight.reduce((sum, item) => sum + item.allocation - maxSingleAllocation, 0);
    for (const item of overweight) item.allocation = maxSingleAllocation;
    const receivers = allocations.filter((item) => item.allocation < maxSingleAllocation);
    const receiverTotal = receivers.reduce((sum, item) => sum + item.allocation, 0);
    if (receivers.length === 0 || receiverTotal <= 0) break;
    for (const item of receivers) {
      item.allocation += excess * (item.allocation / receiverTotal);
    }
  }
  const total = allocations.reduce((sum, item) => sum + item.allocation, 0);
  return allocations.map((item) => ({ ...item, allocation: total > 0 ? item.allocation / total : 0 }));
}

function allocationScore(item, index, allocationMode, sectorSeen, strategy) {
  if (allocationMode === "equal") return 1;

  let score = Math.max(1, strategy.topN - item.rank + 1);
  if (allocationMode === "riskAdjusted") {
    const drawdown = Math.abs(maxDrawdown(item.fund, index, 6));
    const vol = volatility(item.fund, index, 6);
    const drawdownFactor = 1 / (1 + drawdown * 4);
    const volatilityFactor = 1 / (1 + vol * 8);
    const sameSectorCount = sectorSeen.get(item.fund.sector) ?? 0;
    const sectorFactor = sameSectorCount > 0 ? 0.82 : 1;
    score *= drawdownFactor * volatilityFactor * sectorFactor;
  }
  sectorSeen.set(item.fund.sector, (sectorSeen.get(item.fund.sector) ?? 0) + 1);
  return Math.max(0.01, score);
}

function applyAllocationWeights(selectedItems, index, allocationMode, strategy = getStrategyOptions()) {
  if (selectedItems.length === 0) return [];
  const sectorSeen = new Map();
  const scored = selectedItems.map((item) => ({
    ...item,
    allocationScore: allocationScore(item, index, allocationMode, sectorSeen, strategy),
  }));
  const totalScore = scored.reduce((sum, item) => sum + item.allocationScore, 0);
  if (totalScore <= 0) {
    return scored.map((item) => ({ ...item, allocation: 1 / scored.length }));
  }
  return capAllocations(
    scored.map((item) => ({ ...item, allocation: item.allocationScore / totalScore })),
    strategy.maxSingleAllocation
  );
}

function resolvePeriodIndices(dates, startMonth, endMonth) {
  const startIndex = dates.findIndex((date) => monthOf(date) >= startMonth);
  let endIndex = -1;
  for (let index = dates.length - 1; index >= 0; index -= 1) {
    if (monthOf(dates[index]) <= endMonth) {
      endIndex = index;
      break;
    }
  }

  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    throw new Error("所选月份区间没有可用净值数据。");
  }

  return {
    startIndex,
    endIndex,
    steps: endIndex - startIndex + 1,
    actualStartMonth: monthOf(dates[startIndex]),
    actualEndMonth: monthOf(dates[endIndex]),
  };
}

function normalizedFunds() {
  return currentRawFunds().map((fund) => ({
    ...fund,
    nav: fund.nav.map(normalizeNavPoint),
  }));
}

function navAt(fund, index) {
  return fund.nav[index]?.nav ?? fund.nav[fund.nav.length - 1].nav;
}

function fundReturn(fund, currentIndex, lookbackMonths) {
  const startIndex = currentIndex - lookbackMonths;
  if (startIndex < 0) return null;
  return navAt(fund, currentIndex) / navAt(fund, startIndex) - 1;
}

function maxDrawdown(fund, currentIndex, months) {
  const start = Math.max(0, currentIndex - months);
  let peak = navAt(fund, start);
  let drawdown = 0;
  for (let i = start; i <= currentIndex; i += 1) {
    const value = navAt(fund, i);
    peak = Math.max(peak, value);
    drawdown = Math.min(drawdown, value / peak - 1);
  }
  return drawdown;
}

function volatility(fund, currentIndex, months) {
  const start = Math.max(1, currentIndex - months + 1);
  const returns = [];
  for (let i = start; i <= currentIndex; i += 1) {
    returns.push(navAt(fund, i) / navAt(fund, i - 1) - 1);
  }
  if (returns.length === 0) return 0;
  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function scoreFund(fund, index) {
  const oneMonth = fundReturn(fund, index, 1) ?? 0;
  const threeMonth = fundReturn(fund, index, 3) ?? oneMonth;
  const sixMonth = fundReturn(fund, index, 6) ?? threeMonth;
  const drawdown = maxDrawdown(fund, index, 6);
  const vol = volatility(fund, index, 6);
  const cBonus = fund.type === "C" ? 0.08 : 0;

  return {
    fund,
    oneMonth,
    threeMonth,
    sixMonth,
    drawdown,
    vol,
    score: threeMonth * 1.1 + sixMonth * 0.85 + oneMonth * 0.45 + drawdown * 0.55 - vol * 0.8 + cBonus,
  };
}

function chooseFunds(funds, index) {
  if (index < 1) return [];

  const sectorCount = new Map();
  const selected = [];
  const ranked = funds
    .map((fund) => scoreFund(fund, index))
    .sort((a, b) => b.score - a.score);
  const topScore = ranked.find((item) => item.score > 0)?.score ?? 0;

  for (const item of ranked) {
    if (item.score <= 0) continue;
    if (topScore > 0 && item.score < topScore * 0.55) continue;
    const count = sectorCount.get(item.fund.sector) ?? 0;
    if (count >= MAX_SAME_SECTOR) continue;
    selected.push(item.fund);
    sectorCount.set(item.fund.sector, count + 1);
    if (selected.length === MAX_HOLDINGS) break;
  }

  return selected;
}

function monthlyReturnRank(funds, index) {
  if (index < 1) return [];

  return funds
    .map((fund) => ({
      fund,
      monthlyReturn: navAt(fund, index) / navAt(fund, index - 1) - 1,
    }))
    .filter((item) => Number.isFinite(item.monthlyReturn))
    .sort((a, b) => b.monthlyReturn - a.monthlyReturn)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function chooseMonthlyRotationFunds(funds, index, strategy) {
  const sectorCount = new Map();
  const selected = [];
  const topTen = monthlyReturnRank(funds, index).slice(0, strategy.topN);
  const preferred = [...topTen].sort((a, b) => {
    if (a.fund.type === "C" && b.fund.type !== "C") return -1;
    if (a.fund.type !== "C" && b.fund.type === "C") return 1;
    return a.rank - b.rank;
  });

  for (const item of preferred) {
    const count = sectorCount.get(item.fund.sector) ?? 0;
    if (count >= strategy.maxSameSector) continue;
    selected.push(item);
    sectorCount.set(item.fund.sector, count + 1);
    if (selected.length === strategy.maxHoldings) break;
  }

  return selected;
}

function portfolioValue(cash, holdings, index) {
  return (
    cash +
    holdings.reduce((sum, holding) => {
      return sum + holding.shares * navAt(holding.fund, index);
    }, 0)
  );
}

function createTrade({ date, action, fund, buyAmount = 0, sellAmount = 0, balance = 0, shares = 0, note = "" }) {
  return {
    date,
    action,
    fundName: fund.name,
    code: fund.code,
    sector: fund.sector,
    buyAmount,
    sellAmount,
    balance,
    shares,
    note,
  };
}

function rebalance({ date, index, cash, holdings, targetFunds, trades, reason }) {
  const totalValue = portfolioValue(cash, holdings, index);
  const targetCodes = new Set(targetFunds.map((fund) => fund.code));

  for (const holding of holdings) {
    if (!targetCodes.has(holding.fund.code)) {
      const sellAmount = holding.shares * navAt(holding.fund, index);
      cash += sellAmount;
      trades.push(
        createTrade({
          date,
          action: "卖出",
          fund: holding.fund,
          sellAmount,
          balance: cash,
          shares: holding.shares,
          note: reason,
        })
      );
    }
  }

  holdings = holdings.filter((holding) => targetCodes.has(holding.fund.code));
  const currentCodes = new Set(holdings.map((holding) => holding.fund.code));
  const targetWeight = targetFunds.length > 0 ? 1 / targetFunds.length : 0;

  for (const targetFund of targetFunds) {
    const targetValue = totalValue * targetWeight;
    const existing = holdings.find((holding) => holding.fund.code === targetFund.code);
    const currentValue = existing ? existing.shares * navAt(existing.fund, index) : 0;
    const diff = targetValue - currentValue;

    if (diff > Math.max(12, totalValue * 0.025) && cash > 0) {
      const buyAmount = Math.min(diff, cash);
      const shares = buyAmount / navAt(targetFund, index);
      cash -= buyAmount;
      if (existing) {
        existing.shares += shares;
        existing.cost += buyAmount;
      } else if (!currentCodes.has(targetFund.code)) {
        holdings.push({ fund: targetFund, shares, cost: buyAmount });
        currentCodes.add(targetFund.code);
      }
      trades.push(
        createTrade({
          date,
          action: "买入",
          fund: targetFund,
          buyAmount,
          balance: cash + portfolioValue(0, holdings, index),
          shares,
          note: reason,
        })
      );
    }
  }

  return { cash, holdings };
}

function applyStopLoss({ date, index, cash, holdings, trades }) {
  const kept = [];
  for (const holding of holdings) {
    const value = holding.shares * navAt(holding.fund, index);
    const pnl = value / holding.cost - 1;
    if (pnl <= STOP_LOSS) {
      cash += value;
      trades.push(
        createTrade({
          date,
          action: "止损卖出",
          fund: holding.fund,
          sellAmount: value,
          balance: cash,
          shares: holding.shares,
          note: `持仓亏损 ${percent(pnl)}`,
        })
      );
    } else {
      kept.push(holding);
    }
  }
  return { cash, holdings: kept };
}

function liquidateAll({ date, index, cash, holdings, trades, action, note }) {
  for (const holding of holdings) {
    const sellAmount = holding.shares * navAt(holding.fund, index);
    cash += sellAmount;
    trades.push(
      createTrade({
        date,
        action,
        fund: holding.fund,
        sellAmount,
        balance: cash,
        shares: holding.shares,
        note,
      })
    );
  }
  return { cash, holdings: [] };
}

function buyRotationPortfolio({ date, index, cash, selectedItems, trades, allocationMode, strategy }) {
  const holdings = [];
  if (selectedItems.length === 0 || cash <= 0) {
    return { cash, holdings };
  }

  const startCash = cash;
  const allocatedItems = applyAllocationWeights(selectedItems, index, allocationMode, strategy);
  for (const item of allocatedItems) {
    const buyAmount = Math.min(startCash * item.allocation, cash);
    const nav = navAt(item.fund, index);
    if (buyAmount <= 0 || nav <= 0) continue;

    const shares = buyAmount / nav;
    cash -= buyAmount;
    holdings.push({
      fund: item.fund,
      shares,
      cost: buyAmount,
      signalRank: item.rank,
      signalReturn: item.monthlyReturn,
      buyIndex: index,
    });
    trades.push(
      createTrade({
        date,
        action: "轮动买入",
        fund: item.fund,
        buyAmount,
        balance: cash + portfolioValue(0, holdings, index),
        shares,
        note: `本月收益排名第 ${item.rank}/${strategy.topN}，本月收益 ${percent(item.monthlyReturn)}，${ALLOCATION_MODE_LABELS[allocationMode]}，买入权重 ${percent(item.allocation)}，计划持有约 ${strategy.holdingMonths} 个月`,
      })
    );
  }

  return { cash, holdings };
}

function simulate(funds, onStep, options = {}) {
  const dates = funds[0].nav.map((point) => point.date);
  const {
    startMonth = monthOf(dates[0]),
    endMonth = monthOf(dates[dates.length - 1]),
    initialCapital = DEFAULT_INITIAL_CAPITAL,
    allocationMode = "riskAdjusted",
    strategy = getStrategyOptions(),
  } = options;
  const { startIndex, endIndex, steps } = resolvePeriodIndices(dates, startMonth, endMonth);
  let cash = initialCapital;
  let holdings = [];
  const trades = [];
  const equity = [];
  const decisions = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const date = dates[index];
    onStep(index - startIndex + 1, steps, `正在处理 ${date} 的月度收益前 ${strategy.topN} 轮动`);

    const holdingAge = holdings.length > 0 ? index - holdings[0].buyIndex : 0;
    const shouldRotate = holdings.length > 0 && (holdingAge >= strategy.holdingMonths || index === endIndex);
    if (shouldRotate) {
      ({ cash, holdings } = liquidateAll({
        date,
        index,
        cash,
        holdings,
        trades,
        action: "轮动卖出",
        note: `持有约 ${Math.max(1, holdingAge)} 个月，到期卖出并进入下一轮`,
      }));
    }

    if (holdings.length === 0 && index > 0 && index < endIndex) {
      const selectedItems = chooseMonthlyRotationFunds(funds, index, strategy);
      const beforeValue = portfolioValue(cash, holdings, index);
      ({ cash, holdings } = buyRotationPortfolio({
        date,
        index,
        cash,
        selectedItems,
        trades,
        allocationMode,
        strategy,
      }));
      decisions.push({
        date,
        action: "monthly-top10-rotation",
        beforeValue,
        funds: applyAllocationWeights(selectedItems, index, allocationMode, strategy).map(
          (item) => `${item.fund.name}(${item.fund.sector}) 第${item.rank}名 ${percent(item.monthlyReturn)} 权重${percent(item.allocation)}`
        ),
      });
    } else if (index === 0) {
      decisions.push({
        date,
        action: "wait-signal",
        beforeValue: cash,
        funds: ["首月缺少上一月净值，等待形成月度收益排名信号"],
      });
    }

    equity.push({
      date,
      value: portfolioValue(cash, holdings, index),
      cash,
      holdings: holdings.map((holding) => ({
        code: holding.fund.code,
        name: holding.fund.name,
        sector: holding.fund.sector,
        value: holding.shares * navAt(holding.fund, index),
      })),
    });
  }

  const lastIndex = endIndex;
  const lastDate = dates[lastIndex];
  if (holdings.length > 0) {
    ({ cash, holdings } = liquidateAll({
      date: lastDate,
      index: lastIndex,
      cash,
      holdings,
      trades,
      action: "期末卖出",
      note: "模拟结束清仓；最后一轮持有不足 1 个月",
    }));
  }
  equity[equity.length - 1] = {
    ...equity[equity.length - 1],
    value: cash,
    cash,
    holdings: [],
  };

  return {
    id: `simulation-${Date.now()}`,
    createdAt: new Date().toISOString(),
    assumptions: {
      initialCapital,
      period: `${startMonth} 至 ${endMonth}`,
      startMonth,
      endMonth,
      targetAnnualReturn: TARGET_ANNUAL_RETURN,
      allocationMode,
      allocationModeLabel: ALLOCATION_MODE_LABELS[allocationMode],
      topN: strategy.topN,
      maxHoldings: strategy.maxHoldings,
      maxSameSector: strategy.maxSameSector,
      holdingMonths: strategy.holdingMonths,
      maxSingleAllocation: strategy.maxSingleAllocation,
      preference: `周期轮动：持有约 ${strategy.holdingMonths} 个月，到期卖出，再从刚结束月份收益率前 ${strategy.topN} 的基金中优先选择 C 类基金，最多持有 ${strategy.maxHoldings} 只，同板块最多 ${strategy.maxSameSector} 只`,
      dataSource: dataSourceLabel(),
      dataNote: "系统优先使用 data/funds.json 中的已更新净值数据；没有本地更新数据时回退到 data/funds.js 内置样本。",
    },
    equity,
    trades,
    decisions,
    annual: annualStats(equity, initialCapital),
    metrics: performanceMetrics(equity, initialCapital),
    finalValue: cash,
    totalReturn: cash / initialCapital - 1,
  };
}

function performanceMetrics(equity, initialCapital) {
  if (equity.length === 0) {
    return { cagr: 0, maxDrawdown: 0, winRate: 0, returnDrawdownRatio: 0 };
  }

  const finalValue = equity[equity.length - 1].value;
  const startDate = new Date(equity[0].date);
  const endDate = new Date(equity[equity.length - 1].date);
  const years = Math.max(1 / 12, (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000));
  const cagr = (finalValue / initialCapital) ** (1 / years) - 1;

  let peak = equity[0].value;
  let maxDrawdownValue = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.value);
    maxDrawdownValue = Math.min(maxDrawdownValue, point.value / peak - 1);
  }

  const monthlyReturns = [];
  for (let index = 1; index < equity.length; index += 1) {
    const previous = equity[index - 1].value;
    if (previous > 0) monthlyReturns.push(equity[index].value / previous - 1);
  }
  const winRate =
    monthlyReturns.length === 0 ? 0 : monthlyReturns.filter((value) => value > 0).length / monthlyReturns.length;
  const returnDrawdownRatio = Math.abs(maxDrawdownValue) > 0 ? (finalValue / initialCapital - 1) / Math.abs(maxDrawdownValue) : 0;

  return {
    cagr,
    maxDrawdown: maxDrawdownValue,
    winRate,
    returnDrawdownRatio,
  };
}

function annualStats(equity, initialCapital = DEFAULT_INITIAL_CAPITAL) {
  const grouped = new Map();
  for (const point of equity) {
    const year = point.date.slice(0, 4);
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(point);
  }

  let previousValue = initialCapital;
  return [...grouped.entries()].map(([year, points]) => {
    const start = previousValue;
    const monthMap = new Map();
    const orderedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));
    for (const point of orderedPoints) {
      const monthNumber = Number(point.date.slice(5, 7));
      const amount = point.value - previousValue;
      const monthReturn = previousValue > 0 ? point.value / previousValue - 1 : 0;
      monthMap.set(monthNumber, {
        month: monthNumber,
        date: point.date,
        start: previousValue,
        end: point.value,
        amount,
        return: monthReturn,
      });
      previousValue = point.value;
    }
    const end = orderedPoints[orderedPoints.length - 1].value;
    return {
      year,
      start,
      end,
      return: end / start - 1,
      hitTarget: end / start - 1 >= TARGET_ANNUAL_RETURN,
      months: Array.from({ length: 12 }, (_, index) => monthMap.get(index + 1) || null),
    };
  });
}

function setAnnualValueMode(mode) {
  annualValueMode = mode === "amount" ? "amount" : "percent";
  for (const button of elements.annualModeButtons) {
    button.classList.toggle("active", button.dataset.annualMode === annualValueMode);
  }
  if (currentSimulation) renderYears(currentSimulation);
}

function renderSummary(result) {
  const initialCapital = result.assumptions?.initialCapital ?? DEFAULT_INITIAL_CAPITAL;
  elements.initialCapital.textContent = money(initialCapital);
  elements.finalValue.textContent = money(result.finalValue);
  elements.totalReturn.textContent = percent(result.totalReturn);
  elements.totalReturn.className = result.totalReturn >= 0 ? "good" : "bad";
  const hitYears = result.annual.filter((item) => item.hitTarget).length;
  elements.targetStatus.textContent = `${hitYears}/${result.annual.length} 年`;
  elements.targetStatus.className = hitYears === result.annual.length ? "good" : "warn";
  const metrics = result.metrics ?? performanceMetrics(result.equity, initialCapital);
  elements.cagrMetric.textContent = percent(metrics.cagr);
  elements.cagrMetric.className = metrics.cagr >= TARGET_ANNUAL_RETURN ? "good" : metrics.cagr >= 0 ? "warn" : "bad";
  elements.maxDrawdownMetric.textContent = percent(metrics.maxDrawdown);
  elements.maxDrawdownMetric.className = Math.abs(metrics.maxDrawdown) <= 0.2 ? "good" : Math.abs(metrics.maxDrawdown) <= 0.35 ? "warn" : "bad";
  elements.winRateMetric.textContent = percent(metrics.winRate);
  elements.winRateMetric.className = metrics.winRate >= 0.55 ? "good" : metrics.winRate >= 0.45 ? "warn" : "bad";
  elements.returnDrawdownMetric.textContent = metrics.returnDrawdownRatio.toFixed(2);
  elements.returnDrawdownMetric.className = metrics.returnDrawdownRatio >= 2 ? "good" : metrics.returnDrawdownRatio >= 1 ? "warn" : "bad";
  elements.runMeta.textContent = `${result.assumptions.period}，完成于 ${new Date(result.createdAt).toLocaleString("zh-CN")}`;
}

function renderYears(result) {
  elements.yearCards.innerHTML = "";
  for (const item of result.annual) {
    const card = document.createElement("article");
    card.className = "year-card";
    const yearlyClass = item.return >= TARGET_ANNUAL_RETURN ? "good" : item.return >= 0 ? "warn" : "bad";
    const months = item.months || [];
    const monthCells = months
      .map((month, index) => {
        if (!month) {
          return `<div class="month-return-cell empty"><span>${index + 1}月</span><strong>-</strong></div>`;
        }
        const valueClass = month.return > 0 ? "up" : month.return < 0 ? "down" : "flat";
        const displayValue =
          annualValueMode === "amount" ? compactSignedMoney(month.amount) : `${month.return >= 0 ? "+" : ""}${percent(month.return)}`;
        const title = `${item.year}年${index + 1}月：${signedMoney(month.amount)} 元，收益率 ${percent(month.return)}，${money(month.start)} → ${money(month.end)}`;
        return `<div class="month-return-cell ${valueClass}" title="${title}"><span>${index + 1}月</span><strong>${displayValue}</strong></div>`;
      })
      .join("");

    card.innerHTML = `
      <div class="year-card-summary">
        <div>
          <span>${item.year}</span>
          <small>${money(item.start)} → ${money(item.end)}</small>
        </div>
        <strong class="${yearlyClass}">${percent(item.return)}</strong>
      </div>
      <div class="month-return-grid">${monthCells}</div>
    `;
    elements.yearCards.appendChild(card);
  }
}

function renderTrades(result) {
  elements.tradeTable.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const trade of result.trades) {
    const row = document.createElement("tr");
    const cells = [
      trade.date,
      trade.action,
      "",
      trade.code,
      trade.sector,
      trade.buyAmount ? money(trade.buyAmount) : "-",
      trade.sellAmount ? money(trade.sellAmount) : "-",
      trade.sellAmount ? money(trade.balance) : "-",
      trade.shares.toFixed(2),
      trade.note,
    ];
    for (const [index, value] of cells.entries()) {
      const cell = document.createElement("td");
      if (index === 2) {
        const button = document.createElement("button");
        button.className = "fund-link";
        button.type = "button";
        button.dataset.action = "open-fund";
        button.dataset.code = trade.code;
        button.textContent = trade.fundName;
        button.addEventListener("click", () => openFundModal(trade.code));
        cell.appendChild(button);
      } else {
        cell.textContent = value;
      }
      row.appendChild(cell);
    }
    fragment.appendChild(row);
  }
  elements.tradeTable.appendChild(fragment);
  elements.tradeCount.textContent = `${result.trades.length} 条`;
}

function findFundByCode(code) {
  return normalizedFunds().find((fund) => fund.code === code);
}

function fundNavStats(fund) {
  const nav = fund.nav.filter((point) => Number.isFinite(point.nav) && point.nav > 0);
  if (nav.length === 0) return null;
  let peak = nav[0].nav;
  let drawdown = 0;
  for (const point of nav) {
    peak = Math.max(peak, point.nav);
    drawdown = Math.min(drawdown, point.nav / peak - 1);
  }
  const start = nav[0];
  const end = nav[nav.length - 1];
  return {
    start,
    end,
    return: end.nav / start.nav - 1,
    drawdown,
    nav,
  };
}

function chartLayout(rect) {
  return {
    width: rect.width,
    height: rect.height,
    padding: { top: 26, right: 28, bottom: 46, left: 62 },
  };
}

function renderFundNavChart(fund, stats, hoverIndex = null) {
  const canvas = elements.fundNavChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  ctx.scale(scale, scale);

  const { width, height, padding } = chartLayout(rect);
  const points = stats.nav;
  const values = points.map((point) => point.nav);
  const min = Math.min(...values) * 0.96;
  const max = Math.max(...values) * 1.04;
  const range = Math.max(0.0001, max - min);
  const xFor = (index) =>
    padding.left + (index / Math.max(1, points.length - 1)) * (width - padding.left - padding.right);
  const yFor = (value) =>
    padding.top + (1 - (value - min) / range) * (height - padding.top - padding.bottom);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64707d";
  ctx.font = "12px Microsoft YaHei, sans-serif";

  for (let i = 0; i <= 6; i += 1) {
    const value = min + (range * i) / 6;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(4), 10, y + 4);
  }

  const verticalTicks = Math.min(8, Math.max(2, points.length - 1));
  for (let i = 0; i <= verticalTicks; i += 1) {
    const index = Math.round((i / verticalTicks) * (points.length - 1));
    const x = xFor(index);
    ctx.strokeStyle = "#edf1f5";
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.fillStyle = "#64707d";
    ctx.fillText(points[index].date.slice(0, 7), Math.min(x, width - padding.right - 54), height - 16);
  }

  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, "rgba(23, 107, 135, 0.18)");
  gradient.addColorStop(1, "rgba(23, 107, 135, 0.02)");
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.nav);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(xFor(points.length - 1), height - padding.bottom);
  ctx.lineTo(xFor(0), height - padding.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = stats.return >= 0 ? "#176b87" : "#bf3b3b";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.nav);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = stats.return >= 0 ? "#1f7a4d" : "#bf3b3b";
  ctx.beginPath();
  ctx.arc(xFor(points.length - 1), yFor(points[points.length - 1].nav), 4, 0, Math.PI * 2);
  ctx.fill();

  if (hoverIndex !== null && points[hoverIndex]) {
    const point = points[hoverIndex];
    const x = xFor(hoverIndex);
    const y = yFor(point.nav);
    ctx.strokeStyle = "#344252";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = stats.return >= 0 ? "#176b87" : "#bf3b3b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  activeFundChart = {
    fund,
    stats,
    padding,
    width,
    height,
    xFor,
    yFor,
  };
}

function openFundModal(code) {
  const fund = findFundByCode(code);
  if (!fund) {
    addLog(`没有找到基金 ${code} 的净值数据。`);
    return;
  }
  const stats = fundNavStats(fund);
  if (!stats) {
    addLog(`基金 ${fund.name} 没有可绘制的净值数据。`);
    return;
  }

  elements.fundModalTitle.textContent = fund.name;
  elements.fundModalMeta.textContent = `${fund.code} · ${fund.sector} · ${fund.type || "未知份额"} · ${stats.nav.length} 条月度净值`;
  elements.fundModalStats.innerHTML = "";
  const statItems = [
    ["起始净值", `${stats.start.date} / ${stats.start.nav.toFixed(4)}`],
    ["最新净值", `${stats.end.date} / ${stats.end.nav.toFixed(4)}`],
    ["区间收益", percent(stats.return)],
    ["最大回撤", percent(stats.drawdown)],
  ];
  for (const [label, value] of statItems) {
    const item = document.createElement("div");
    const labelNode = document.createElement("span");
    const valueNode = document.createElement("strong");
    labelNode.textContent = label;
    valueNode.textContent = value;
    item.append(labelNode, valueNode);
    elements.fundModalStats.appendChild(item);
  }
  elements.fundModal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => renderFundNavChart(fund, stats));
}

function closeFundModal() {
  elements.fundModal.hidden = true;
  elements.fundChartTooltip.hidden = true;
  activeFundChart = null;
  document.body.classList.remove("modal-open");
}

function nearestFundPointIndex(mouseX, chart) {
  const { stats, padding, width } = chart;
  const count = stats.nav.length;
  const left = padding.left;
  const right = width - padding.right;
  const ratio = Math.max(0, Math.min(1, (mouseX - left) / Math.max(1, right - left)));
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}

function showFundChartTooltip(index) {
  if (!activeFundChart || !activeFundChart.stats.nav[index]) return;
  const { stats, xFor, yFor, width } = activeFundChart;
  const point = stats.nav[index];
  const startNav = stats.start.nav;
  const pointReturn = point.nav / startNav - 1;
  const x = xFor(index);
  const y = yFor(point.nav);

  elements.fundChartTooltip.innerHTML = `
    <strong>${point.date}</strong>
    <span>单位净值：${point.nav.toFixed(4)}</span>
    <span>较起点：${percent(pointReturn)}</span>
  `;
  elements.fundChartTooltip.hidden = false;

  const tooltipWidth = 152;
  const left = x > width - tooltipWidth - 24 ? x - tooltipWidth - 12 : x + 12;
  const top = Math.max(10, y - 38);
  elements.fundChartTooltip.style.left = `${left}px`;
  elements.fundChartTooltip.style.top = `${top}px`;
}

function handleFundChartMove(event) {
  if (!activeFundChart) return;
  const rect = elements.fundNavChart.getBoundingClientRect();
  const index = nearestFundPointIndex(event.clientX - rect.left, activeFundChart);
  renderFundNavChart(activeFundChart.fund, activeFundChart.stats, index);
  showFundChartTooltip(index);
}

function handleFundChartLeave() {
  if (!activeFundChart) return;
  elements.fundChartTooltip.hidden = true;
  renderFundNavChart(activeFundChart.fund, activeFundChart.stats);
}

function drawChart(result) {
  const canvas = elements.equityChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  ctx.scale(scale, scale);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 26, right: 22, bottom: 34, left: 64 };
  const points = result.equity;
  const values = points.map((point) => point.value);
  const initialCapital = result.assumptions?.initialCapital ?? DEFAULT_INITIAL_CAPITAL;
  const min = Math.min(...values, initialCapital) * 0.94;
  const max = Math.max(...values, initialCapital) * 1.04;
  const xFor = (index) =>
    padding.left + (index / Math.max(1, points.length - 1)) * (width - padding.left - padding.right);
  const yFor = (value) =>
    padding.top + (1 - (value - min) / (max - min)) * (height - padding.top - padding.bottom);

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64707d";
  ctx.font = "12px Microsoft YaHei, sans-serif";

  for (let i = 0; i <= 4; i += 1) {
    const value = min + ((max - min) * i) / 4;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(money(value), 10, y + 4);
  }

  ctx.strokeStyle = "#bf3b3b";
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(padding.left, yFor(initialCapital));
  ctx.lineTo(width - padding.right, yFor(initialCapital));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#176b87";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#176b87";
  points.forEach((point, index) => {
    if (index % 12 !== 0 && index !== points.length - 1) return;
    const x = xFor(index);
    const y = yFor(point.value);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(point.date.slice(0, 7), Math.min(x, width - 78), height - 12);
  });
}

function renderAll(result) {
  renderSummary(result);
  renderYears(result);
  renderTrades(result);
  drawChart(result);
}

async function loadSavedFundData() {
  try {
    const response = await fetch("/api/fund-data");
    if (!response.ok) return false;
    const payload = await response.json();
    if (!payload.ok || !Array.isArray(payload.funds) || payload.funds.length === 0) return false;
    setActiveFundPayload(payload, false);
    addLog(`已读取本地更新净值数据：${payload.fundCount || payload.funds.length} 只基金。`);
    addLog(`数据来源：${dataSourceLabel()}。`);
    return true;
  } catch {
    return false;
  }
}

async function pollUpdateJob(jobId) {
  let lastMessage = "";
  while (true) {
    const response = await fetch(`/api/update-fund-data/status?jobId=${encodeURIComponent(jobId || "")}`);
    const status = await response.json();
    if (!response.ok || !status.ok) {
      throw new Error(status.error || "读取更新进度失败");
    }

    const progress = Math.max(0, Math.min(100, Number(status.progress || 0)));
    setProgress(progress, 100);
    if (status.message && status.message !== lastMessage) {
      addLog(status.message);
      lastMessage = status.message;
    }
    if (status.total > 0) {
      elements.etaText.textContent = `更新进度：${progress}%（${status.scanned || 0}/${status.total}）`;
    } else {
      elements.etaText.textContent = `更新进度：${progress}%`;
    }

    if (status.status === "complete") {
      return status.result;
    }
    if (status.status === "error") {
      throw new Error(status.error || status.message || "更新失败");
    }

    await sleep(1500);
  }
}

async function updateFundData() {
  elements.updateDataBtn.disabled = true;
  elements.startBtn.disabled = true;
  setProgress(0, 1);

  try {
    const period = getSelectedPeriod();
    const maxFunds = getSelectedMaxFunds();
    elements.maxFunds.value = String(maxFunds);
    elements.etaText.textContent = "正在启动更新任务";
    elements.runMeta.textContent = "正在通过 AKShare 扫描全市场基金";
    addLog(`准备通过 AKShare 更新全市场基金净值，区间：${period.startMonth} 至 ${period.endMonth}。`);
    addLog(`本次最多抓取并缓存 ${maxFunds} 只基金。`);
    addLog("数据来源：AKShare 全市场公募基金接口，后端抓取后保存到 data/funds.json。");
    addLog("为避免 AKShare 依赖崩溃，后端会在独立 worker 进程中串行扫描全市场基金。");

    let startPayload;
    try {
      const response = await fetch("/api/update-fund-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...period, maxFunds }),
      });
      startPayload = await response.json();
      if (!response.ok || !startPayload.ok) {
        throw new Error(startPayload.error || "启动更新任务失败");
      }
    } catch (error) {
      throw new Error(`无法连接后端更新接口：${error.message}`);
    }

    addLog(`后台更新任务已启动：${startPayload.jobId || "当前任务"}。`);
    const payload = await pollUpdateJob(startPayload.jobId);
    if (!payload || !payload.ok) {
      throw new Error("更新任务结束，但没有返回结果摘要。");
    }

    addLog(
      `全市场更新完成：目录 ${payload.catalogCount} 只，扫描 ${payload.scannedCount} 只，缓存命中 ${payload.cachedCount || 0} 只，可回测 ${payload.fundCount} 只，耗时 ${payload.durationSeconds} 秒。`
    );
    addLog(`数据已保存：${payload.path}。`);
    if (payload.databasePath) {
      addLog(`SQLite 主缓存：${payload.databasePath}。`);
    }
    if (payload.excludedMoneyFundCount > 0) {
      addLog(`已排除 ${payload.excludedMoneyFundCount} 只货币/现金/理财类基金。`);
    }
    if (payload.warningCount > 0) {
      addLog(`有 ${payload.warningCount} 条抓取/对齐警告，系统会使用已成功更新的基金继续模拟。`);
    }

    const loaded = await loadSavedFundData();
    if (!loaded) {
      throw new Error("已保存数据，但前端重新读取失败。");
    }
    setProgress(1, 1);
    elements.etaText.textContent = "净值数据已更新";
    elements.runMeta.textContent = "净值数据已更新";
  } catch (error) {
    elements.etaText.textContent = "更新失败";
    elements.runMeta.textContent = "继续使用当前数据";
    addLog(`更新净值数据失败：${error.message}`);
    addLog(`当前仍使用：${dataSourceLabel()}。`);
  } finally {
    elements.updateDataBtn.disabled = false;
    elements.startBtn.disabled = false;
  }
}

async function runSimulation() {
  elements.startBtn.disabled = true;
  elements.updateDataBtn.disabled = true;
  elements.saveBtn.disabled = true;
  elements.activityLog.innerHTML = "";
  setProgress(0, 1);

  try {
    const period = getSelectedPeriod();
    const initialCapital = getInitialCapital();
    const allocationMode = getAllocationMode();
    const strategy = getStrategyOptions();
    addLog(`初始资金：${money(initialCapital)} 元。`);
    addLog(`买入额度分配方式：${ALLOCATION_MODE_LABELS[allocationMode]}。`);
    addLog(`策略参数：前 ${strategy.topN} 名，最多持有 ${strategy.maxHoldings} 只，同板块最多 ${strategy.maxSameSector} 只，持有 ${strategy.holdingMonths} 个月，单只上限 ${percent(strategy.maxSingleAllocation)}。`);
    elements.etaText.textContent = "预计耗时：约 4 秒";
    elements.runMeta.textContent = `${period.startMonth} 至 ${period.endMonth}，正在模拟`;
    addLog(`模拟区间：${period.startMonth} 至 ${period.endMonth}。`);
    addLog(`数据来源：${dataSourceLabel()}。`);
    addLog("加载基金候选池，优先筛选 C 类基金。");
    await sleep(450);

    const funds = normalizedFunds();
    const dates = funds[0].nav.map((point) => point.date);
    const selectedRange = resolvePeriodIndices(dates, period.startMonth, period.endMonth);
    if (selectedRange.actualStartMonth !== period.startMonth || selectedRange.actualEndMonth !== period.endMonth) {
      addLog(`当前缓存实际可用净值区间：${selectedRange.actualStartMonth} 至 ${selectedRange.actualEndMonth}。如需更早历史，请先按所选区间更新 AKShare 净值数据。`);
    }
    addLog(`已载入 ${funds.length} 只候选基金，本次覆盖 ${selectedRange.steps} 个净值月份。`);

    const start = performance.now();
    let lastMessage = "";
    const result = simulate(funds, (done, total, message) => {
      if (message !== lastMessage && (done === 1 || done % 4 === 0 || done === total)) {
        addLog(message);
        lastMessage = message;
      }
      setProgress(done, total);
      const elapsed = performance.now() - start;
      const remaining = done > 0 ? Math.max(0, (elapsed / done) * (total - done)) : 0;
      elements.etaText.textContent = `预计剩余：${(remaining / 1000).toFixed(1)} 秒`;
    }, { ...period, initialCapital, allocationMode, strategy });

    await sleep(500);
    addLog("生成资产曲线、年度收益和完整交易记录。");
    renderAll(result);
    currentSimulation = result;
    localStorage.setItem("fund-simulator:last-result", JSON.stringify(result));
    setProgress(1, 1);
    elements.etaText.textContent = "预计剩余：0.0 秒";
    addLog(`模拟完成，期末资产 ${money(result.finalValue)} 元，累计收益 ${percent(result.totalReturn)}。`);
    elements.saveBtn.disabled = false;
  } catch (error) {
    elements.runMeta.textContent = "模拟失败";
    elements.etaText.textContent = "预计耗时：-";
    addLog(`模拟失败：${error.message}`);
    elements.saveBtn.disabled = currentSimulation === null;
  } finally {
    elements.startBtn.disabled = false;
    elements.updateDataBtn.disabled = false;
  }
}

async function saveSimulation() {
  if (!currentSimulation) return;
  elements.saveBtn.disabled = true;
  addLog("正在保存本次模拟方案到本地 JSON 文件。");
  try {
    const response = await fetch("/api/save-simulation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentSimulation),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "保存失败");
    }
    addLog(`保存成功：${payload.filename}`);
  } catch (error) {
    addLog(`保存失败：${error.message}`);
  } finally {
    elements.saveBtn.disabled = false;
  }
}

function restoreLastResult() {
  const raw = localStorage.getItem("fund-simulator:last-result");
  if (!raw) return;
  try {
    currentSimulation = JSON.parse(raw);
    if (currentSimulation.assumptions?.startMonth && currentSimulation.assumptions?.endMonth) {
      elements.startMonth.value = currentSimulation.assumptions.startMonth;
      elements.endMonth.value = currentSimulation.assumptions.endMonth;
    }
    if (currentSimulation.assumptions?.initialCapital) {
      elements.initialCapitalInput.value = String(currentSimulation.assumptions.initialCapital);
    }
    if (currentSimulation.assumptions?.allocationMode) {
      elements.allocationMode.value = currentSimulation.assumptions.allocationMode;
    }
    if (currentSimulation.assumptions?.topN) elements.topNInput.value = String(currentSimulation.assumptions.topN);
    if (currentSimulation.assumptions?.maxHoldings) elements.maxHoldingsInput.value = String(currentSimulation.assumptions.maxHoldings);
    if (currentSimulation.assumptions?.maxSameSector) elements.maxSameSectorInput.value = String(currentSimulation.assumptions.maxSameSector);
    if (currentSimulation.assumptions?.holdingMonths) elements.holdingMonthsInput.value = String(currentSimulation.assumptions.holdingMonths);
    if (currentSimulation.assumptions?.maxSingleAllocation) {
      elements.maxSingleAllocationInput.value = String(Math.round(currentSimulation.assumptions.maxSingleAllocation * 100));
    }
    renderAll(currentSimulation);
    elements.saveBtn.disabled = false;
    elements.runMeta.textContent = "已恢复上次模拟";
    addLog("已从浏览器本地缓存恢复上次模拟结果。");
  } catch {
    localStorage.removeItem("fund-simulator:last-result");
  }
}

elements.startBtn.addEventListener("click", runSimulation);
elements.updateDataBtn.addEventListener("click", updateFundData);
elements.saveBtn.addEventListener("click", saveSimulation);
for (const button of elements.annualModeButtons) {
  button.addEventListener("click", () => setAnnualValueMode(button.dataset.annualMode));
}
elements.initialCapitalInput.addEventListener("change", getInitialCapital);
elements.initialCapitalInput.addEventListener("input", () => {
  const raw = Number.parseFloat(elements.initialCapitalInput.value);
  if (Number.isFinite(raw) && raw > 0) elements.initialCapital.textContent = money(raw);
});
elements.tradeTable.addEventListener("click", (event) => {
  const button = event.target.closest(".fund-link");
  if (button) openFundModal(button.dataset.code);
});
elements.fundModalClose.addEventListener("click", closeFundModal);
elements.fundModal.addEventListener("click", (event) => {
  if (event.target === elements.fundModal) closeFundModal();
});
elements.fundNavChart.addEventListener("mousemove", handleFundChartMove);
elements.fundNavChart.addEventListener("mouseleave", handleFundChartLeave);
elements.startMonthButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setMonthPickerOpen("start");
});
elements.endMonthButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setMonthPickerOpen("end");
});
elements.startYearSelect.addEventListener("change", () => {
  elements.startMonth.value = clampMonth(`${elements.startYearSelect.value}-${elements.startMonth.value.slice(5, 7)}`, monthBounds.min, monthBounds.max);
  if (elements.startMonth.value > elements.endMonth.value) elements.endMonth.value = elements.startMonth.value;
  renderMonthPickers();
});
elements.endYearSelect.addEventListener("change", () => {
  elements.endMonth.value = clampMonth(`${elements.endYearSelect.value}-${elements.endMonth.value.slice(5, 7)}`, monthBounds.min, monthBounds.max);
  if (elements.startMonth.value > elements.endMonth.value) elements.startMonth.value = elements.endMonth.value;
  renderMonthPickers();
});
document.addEventListener("click", (event) => {
  const fundButton = event.target.closest('[data-action="open-fund"]');
  if (fundButton) {
    event.preventDefault();
    openFundModal(fundButton.dataset.code);
    return;
  }
  if (!event.target.closest(".month-picker")) closeMonthPickers();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMonthPickers();
    closeFundModal();
  }
});
window.addEventListener("resize", () => {
  if (currentSimulation) drawChart(currentSimulation);
  if (!elements.fundModal.hidden) {
    const code = elements.fundModalMeta.textContent.split(" · ")[0];
    const fund = findFundByCode(code);
    const stats = fund ? fundNavStats(fund) : null;
    elements.fundChartTooltip.hidden = true;
    if (fund && stats) renderFundNavChart(fund, stats);
  }
});

async function initialize() {
  getInitialCapital();
  setupPeriodInputs();
  renderDataQuality();
  renderMarketTicker();
  await loadSavedFundData();
  restoreLastResult();
}

initialize();
