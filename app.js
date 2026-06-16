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
const MAX_UPDATE_FUNDS = 2000;
const THEME_STORAGE_KEY = "fund-simulator:theme";
const FALLBACK_DATA_SOURCE = "本地内置候选池 data/funds.js（window.FUND_UNIVERSE，月度净值样本，可替换为真实基金净值数据）";

const $ = (selector) => document.querySelector(selector);

function initialTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

document.documentElement.dataset.theme = initialTheme();

const elements = {
  startBtn: $("#startBtn"),
  updateDataBtn: $("#updateDataBtn"),
  saveBtn: $("#saveBtn"),
  exportReportBtn: $("#exportReportBtn"),
  themeToggleBtn: $("#themeToggleBtn"),
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
  entryFilterInput: $("#entryFilterInput"),
  minEntryReturnInput: $("#minEntryReturnInput"),
  minPositiveBreadthInput: $("#minPositiveBreadthInput"),
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
  decisionCards: $("#decisionCards"),
  decisionCount: $("#decisionCount"),
  tradeTable: $("#tradeTable"),
  tradeCount: $("#tradeCount"),
  fundModal: $("#fundModal"),
  fundModalTitle: $("#fundModalTitle"),
  fundModalMeta: $("#fundModalMeta"),
  fundModalStats: $("#fundModalStats"),
  fundModalClose: $("#fundModalClose"),
  fundNavChart: $("#fundNavChart"),
  fundChartTooltip: $("#fundChartTooltip"),
  decisionModal: $("#decisionModal"),
  decisionModalTitle: $("#decisionModalTitle"),
  decisionModalMeta: $("#decisionModalMeta"),
  decisionModalBody: $("#decisionModalBody"),
  decisionModalClose: $("#decisionModalClose"),
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

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  elements.themeToggleBtn.setAttribute("aria-label", nextTheme === "dark" ? "切换白天模式" : "切换夜间模式");
  elements.themeToggleBtn.setAttribute("aria-pressed", String(nextTheme === "dark"));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", cssColor("--accent"));

  if (currentSimulation) drawChart(currentSimulation);
  if (activeFundChart) {
    renderFundNavChart(activeFundChart.fund, activeFundChart.stats);
  }
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

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

function readBoundedPercentInput(input, fallback, min, max) {
  const raw = Number.parseFloat(input.value);
  const value = Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : fallback;
  input.value = String(value);
  return value / 100;
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
    entryFilterEnabled: elements.entryFilterInput.checked,
    minEntryReturn: readBoundedPercentInput(elements.minEntryReturnInput, 0, -20, 20),
    minPositiveBreadth: readBoundedPercentInput(elements.minPositiveBreadthInput, 35, 0, 100),
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

function allocationScoreBreakdown(item, index, allocationMode, sectorSeen, strategy) {
  const sameSectorCount = sectorSeen.get(item.fund.sector) ?? 0;
  const baseScore = allocationMode === "equal" ? 1 : Math.max(1, strategy.topN - item.rank + 1);
  const drawdown = allocationMode === "riskAdjusted" ? Math.abs(maxDrawdown(item.fund, index, 6)) : 0;
  const vol = allocationMode === "riskAdjusted" ? volatility(item.fund, index, 6) : 0;
  const drawdownFactor = allocationMode === "riskAdjusted" ? 1 / (1 + drawdown * 4) : 1;
  const volatilityFactor = allocationMode === "riskAdjusted" ? 1 / (1 + vol * 8) : 1;
  const sectorFactor = allocationMode === "riskAdjusted" && sameSectorCount > 0 ? 0.82 : 1;
  const allocationScore = Math.max(0.01, baseScore * drawdownFactor * volatilityFactor * sectorFactor);

  sectorSeen.set(item.fund.sector, sameSectorCount + 1);
  return {
    baseScore,
    allocationScore,
    drawdown,
    volatility: vol,
    drawdownFactor,
    volatilityFactor,
    sectorFactor,
  };
}

function applyAllocationWeights(selectedItems, index, allocationMode, strategy = getStrategyOptions()) {
  if (selectedItems.length === 0) return [];
  const sectorSeen = new Map();
  const scored = selectedItems.map((item) => {
    const breakdown = allocationScoreBreakdown(item, index, allocationMode, sectorSeen, strategy);
    return { ...item, ...breakdown };
  });
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

function evaluateMarketTiming(ranked, topCandidates, strategy) {
  const returns = ranked.map((item) => item.monthlyReturn).filter(Number.isFinite);
  const bestReturn = topCandidates[0]?.monthlyReturn ?? null;
  const topAverage =
    topCandidates.length > 0
      ? topCandidates.reduce((sum, item) => sum + item.monthlyReturn, 0) / topCandidates.length
      : null;
  const positiveBreadth =
    returns.length > 0 ? returns.filter((value) => value > 0).length / returns.length : 0;

  const reasons = [];
  if (!strategy.entryFilterEnabled) {
    return {
      shouldEnter: true,
      bestReturn,
      topAverage,
      positiveBreadth,
      reasons: ["入场过滤已关闭，卖出后按排名继续买入。"],
    };
  }
  if (bestReturn === null || bestReturn < strategy.minEntryReturn) {
    reasons.push(`榜首基金当月收益 ${bestReturn === null ? "-" : percent(bestReturn)}，低于最低入场收益 ${percent(strategy.minEntryReturn)}`);
  }
  if (topAverage === null || topAverage < strategy.minEntryReturn) {
    reasons.push(`前 ${strategy.topN} 平均收益 ${topAverage === null ? "-" : percent(topAverage)}，低于最低入场收益 ${percent(strategy.minEntryReturn)}`);
  }
  if (positiveBreadth < strategy.minPositiveBreadth) {
    reasons.push(`全市场正收益占比 ${percent(positiveBreadth)}，低于阈值 ${percent(strategy.minPositiveBreadth)}`);
  }

  return {
    shouldEnter: reasons.length === 0,
    bestReturn,
    topAverage,
    positiveBreadth,
    reasons: reasons.length ? reasons : ["市场强度满足入场条件。"],
  };
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

function fundDecisionSnapshot(item) {
  return {
    code: item.fund.code,
    name: item.fund.name,
    sector: item.fund.sector,
    type: item.fund.type || "未知",
    rank: item.rank,
    monthlyReturn: item.monthlyReturn,
  };
}

function analyzeMonthlyRotationDecision(funds, index, strategy, allocationMode) {
  const ranked = monthlyReturnRank(funds, index);
  const topCandidates = ranked.slice(0, strategy.topN);
  const timing = evaluateMarketTiming(ranked, topCandidates, strategy);
  const preferred = [...topCandidates].sort((a, b) => {
    if (a.fund.type === "C" && b.fund.type !== "C") return -1;
    if (a.fund.type !== "C" && b.fund.type === "C") return 1;
    return a.rank - b.rank;
  });

  const sectorCount = new Map();
  const selected = [];
  const excludedBySector = [];
  const excludedByCapacity = [];
  for (const item of preferred) {
    const sectorHoldings = sectorCount.get(item.fund.sector) ?? 0;
    if (selected.length >= strategy.maxHoldings) {
      excludedByCapacity.push({
        ...fundDecisionSnapshot(item),
        reason: `最多持有 ${strategy.maxHoldings} 只，本月名额已满`,
      });
      continue;
    }
    if (sectorHoldings >= strategy.maxSameSector) {
      excludedBySector.push({
        ...fundDecisionSnapshot(item),
        reason: `${item.fund.sector} 板块已达到 ${strategy.maxSameSector} 只上限`,
      });
      continue;
    }
    selected.push(item);
    sectorCount.set(item.fund.sector, sectorHoldings + 1);
  }

  const allocated = timing.shouldEnter ? applyAllocationWeights(selected, index, allocationMode, strategy) : [];
  return {
    timing,
    topCandidates: topCandidates.map(fundDecisionSnapshot),
    selectedItems: allocated,
    selected: allocated.map((item) => ({
      ...fundDecisionSnapshot(item),
      allocation: item.allocation,
      baseScore: item.baseScore,
      allocationScore: item.allocationScore,
      drawdown: item.drawdown,
      volatility: item.volatility,
      drawdownFactor: item.drawdownFactor,
      volatilityFactor: item.volatilityFactor,
      sectorFactor: item.sectorFactor,
      riskLowered:
        allocationMode === "riskAdjusted" &&
        (item.drawdownFactor < 0.999 || item.volatilityFactor < 0.999 || item.sectorFactor < 0.999),
    })),
    excludedBySector,
    excludedByCapacity,
  };
}

function portfolioValue(cash, holdings, index) {
  return (
    cash +
    holdings.reduce((sum, holding) => {
      return sum + holding.shares * navAt(holding.fund, index);
    }, 0)
  );
}

function createTrade({ date, action, fund, buyAmount = 0, sellAmount = 0, balance = 0, shares = 0, note = "", decisionId = "" }) {
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
    decisionId,
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

function buyRotationPortfolio({ date, index, cash, selectedItems, trades, allocationMode, strategy, decisionId = "" }) {
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
        decisionId,
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
      const decisionId = `decision-${date}`;
      const decisionAnalysis = analyzeMonthlyRotationDecision(funds, index, strategy, allocationMode);
      const beforeValue = portfolioValue(cash, holdings, index);
      ({ cash, holdings } = buyRotationPortfolio({
        date,
        index,
        cash,
        selectedItems: decisionAnalysis.selectedItems,
        trades,
        allocationMode,
        strategy,
        decisionId,
      }));
      decisions.push({
        id: decisionId,
        date,
        action: decisionAnalysis.timing.shouldEnter ? "monthly-top10-rotation" : "wait-market",
        beforeValue,
        allocationMode,
        allocationModeLabel: ALLOCATION_MODE_LABELS[allocationMode],
        topN: strategy.topN,
        maxHoldings: strategy.maxHoldings,
        maxSameSector: strategy.maxSameSector,
        entryFilterEnabled: strategy.entryFilterEnabled,
        minEntryReturn: strategy.minEntryReturn,
        minPositiveBreadth: strategy.minPositiveBreadth,
        timing: decisionAnalysis.timing,
        topCandidates: decisionAnalysis.topCandidates,
        selected: decisionAnalysis.selected,
        excludedBySector: decisionAnalysis.excludedBySector,
        excludedByCapacity: decisionAnalysis.excludedByCapacity,
        funds: decisionAnalysis.timing.shouldEnter
          ? decisionAnalysis.selected.map(
              (item) => `${item.name}(${item.sector}) 第${item.rank}名 ${percent(item.monthlyReturn)} 权重${percent(item.allocation)}`
            )
          : decisionAnalysis.timing.reasons,
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
      entryFilterEnabled: strategy.entryFilterEnabled,
      minEntryReturn: strategy.minEntryReturn,
      minPositiveBreadth: strategy.minPositiveBreadth,
      preference: `周期轮动：持有约 ${strategy.holdingMonths} 个月，到期卖出，再从刚结束月份收益率前 ${strategy.topN} 的基金中优先选择 C 类基金，最多持有 ${strategy.maxHoldings} 只，同板块最多 ${strategy.maxSameSector} 只；${strategy.entryFilterEnabled ? `入场过滤要求榜首和前 ${strategy.topN} 平均收益不低于 ${percent(strategy.minEntryReturn)}，全市场正收益占比不低于 ${percent(strategy.minPositiveBreadth)}` : "入场过滤关闭"}`,
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

function renderDecisions(result) {
  elements.decisionCards.innerHTML = "";
  const actionable = (result.decisions || []).filter((decision) => decision.id);
  elements.decisionCount.textContent = `${actionable.length} 条`;
  if (actionable.length === 0) {
    const empty = document.createElement("p");
    empty.className = "decision-empty";
    empty.textContent = "暂无择时决策记录。";
    elements.decisionCards.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const decision of actionable) {
    const card = document.createElement("article");
    const isWait = decision.action === "wait-market";
    card.className = `decision-card ${isWait ? "wait" : "enter"}`;
    const bestReturn = decision.timing?.bestReturn;
    const breadth = decision.timing?.positiveBreadth;
    card.innerHTML = `
      <div>
        <span>${decision.date}</span>
        <strong>${isWait ? "空仓等待" : `买入 ${decision.selected?.length || 0} 只`}</strong>
        <small>榜首 ${bestReturn === null || bestReturn === undefined ? "-" : percent(bestReturn)} · 正收益占比 ${breadth === null || breadth === undefined ? "-" : percent(breadth)}</small>
      </div>
      <button class="decision-link" type="button" data-decision-id="${decision.id}">查看决策</button>
    `;
    fragment.appendChild(card);
  }
  elements.decisionCards.appendChild(fragment);
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
      } else if (index === 9 && trade.decisionId) {
        const text = document.createElement("span");
        text.textContent = value;
        const button = document.createElement("button");
        button.className = "decision-link";
        button.type = "button";
        button.dataset.decisionId = trade.decisionId;
        button.textContent = "查看决策";
        cell.append(text, button);
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

function findDecisionById(id) {
  return currentSimulation?.decisions?.find((decision) => decision.id === id) || null;
}

function renderDecisionTable(title, rows, columns, emptyText) {
  const section = document.createElement("section");
  section.className = "decision-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);

  if (!rows || rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "decision-empty";
    empty.textContent = emptyText;
    section.appendChild(empty);
    return section;
  }

  const table = document.createElement("table");
  table.className = "decision-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      td.textContent = column.render(row);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

function allocationFormulaText(item) {
  const base = item.baseScore?.toFixed(2) ?? "-";
  if (currentSimulation?.assumptions?.allocationMode !== "riskAdjusted") {
    return `${base} / 入选基金得分合计，归一化后应用单只上限`;
  }
  return `${base} × 回撤${item.drawdownFactor.toFixed(2)} × 波动${item.volatilityFactor.toFixed(2)} × 板块${item.sectorFactor.toFixed(2)} = ${item.allocationScore.toFixed(2)}，再归一化并应用单只上限`;
}

function openDecisionModal(decisionId) {
  const decision = findDecisionById(decisionId);
  if (!decision) {
    addLog(`没有找到决策记录：${decisionId}`);
    return;
  }

  elements.decisionModalTitle.textContent = `${decision.date} 买入决策解释`;
  elements.decisionModalMeta.textContent = `收益排名前 ${decision.topN}，最多持有 ${decision.maxHoldings} 只，同板块最多 ${decision.maxSameSector} 只，分配方式：${decision.allocationModeLabel}`;
  elements.decisionModalBody.innerHTML = "";

  const topColumns = [
    { label: "排名", render: (row) => String(row.rank) },
    { label: "基金", render: (row) => `${row.name}（${row.code}）` },
    { label: "板块", render: (row) => row.sector },
    { label: "份额", render: (row) => row.type },
    { label: "当月收益", render: (row) => percent(row.monthlyReturn) },
  ];
  const selectedColumns = [
    ...topColumns,
    { label: "最终权重", render: (row) => percent(row.allocation) },
    { label: "权重计算", render: allocationFormulaText },
  ];
  const excludedColumns = [
    ...topColumns,
    { label: "排除原因", render: (row) => row.reason },
  ];
  const timingRows = [
    ["榜首收益", decision.timing?.bestReturn === null || decision.timing?.bestReturn === undefined ? "-" : percent(decision.timing.bestReturn)],
    [`前 ${decision.topN} 平均收益`, decision.timing?.topAverage === null || decision.timing?.topAverage === undefined ? "-" : percent(decision.timing.topAverage)],
    ["全市场正收益占比", decision.timing?.positiveBreadth === null || decision.timing?.positiveBreadth === undefined ? "-" : percent(decision.timing.positiveBreadth)],
    ["入场结论", decision.timing?.shouldEnter ? "满足条件，允许买入" : "不满足条件，保持现金空仓"],
    ["原因", (decision.timing?.reasons || []).join("；")],
  ].map(([label, value]) => ({ label, value }));
  const lowered = (decision.selected || []).filter((row) => row.riskLowered);

  elements.decisionModalBody.append(
    renderDecisionTable("入场判断", timingRows, [
      { label: "项目", render: (row) => row.label },
      { label: "结果", render: (row) => row.value },
    ], "没有入场判断记录。"),
    renderDecisionTable(`当月收益排名前 ${decision.topN}`, decision.topCandidates, topColumns, "本月没有可用排名数据。"),
    renderDecisionTable("实际买入", decision.selected, selectedColumns, "本月没有买入基金。"),
    renderDecisionTable("因同板块限制被排除", decision.excludedBySector, excludedColumns, "没有基金因为同板块限制被排除。"),
    renderDecisionTable("因风险惩罚导致仓位降低", lowered, selectedColumns, "当前分配方式下没有基金被风险惩罚降低权重。"),
    renderDecisionTable("因持仓数量限制未买入", decision.excludedByCapacity, excludedColumns, "没有基金因为持仓数量限制被排除。")
  );

  elements.decisionModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDecisionModal() {
  elements.decisionModal.hidden = true;
  document.body.classList.remove("modal-open");
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
  const borderColor = cssColor("--chart-grid");
  const softGridColor = cssColor("--chart-grid-soft");
  const mutedColor = cssColor("--muted");
  const textColor = cssColor("--text");
  const accentColor = cssColor("--accent");
  const greenColor = cssColor("--green");
  const redColor = cssColor("--red");
  const surfaceColor = cssColor("--surface");

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = mutedColor;
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
    ctx.strokeStyle = softGridColor;
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.stroke();
    ctx.fillStyle = mutedColor;
    ctx.fillText(points[index].date.slice(0, 7), Math.min(x, width - padding.right - 54), height - 16);
  }

  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, document.documentElement.dataset.theme === "dark" ? "rgba(79, 163, 191, 0.22)" : "rgba(23, 107, 135, 0.18)");
  gradient.addColorStop(1, document.documentElement.dataset.theme === "dark" ? "rgba(79, 163, 191, 0.03)" : "rgba(23, 107, 135, 0.02)");
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

  ctx.strokeStyle = stats.return >= 0 ? accentColor : redColor;
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

  ctx.fillStyle = stats.return >= 0 ? greenColor : redColor;
  ctx.beginPath();
  ctx.arc(xFor(points.length - 1), yFor(points[points.length - 1].nav), 4, 0, Math.PI * 2);
  ctx.fill();

  if (hoverIndex !== null && points[hoverIndex]) {
    const point = points[hoverIndex];
    const x = xFor(hoverIndex);
    const y = yFor(point.nav);
    ctx.strokeStyle = textColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, height - padding.bottom);
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = surfaceColor;
    ctx.strokeStyle = stats.return >= 0 ? accentColor : redColor;
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
  const borderColor = cssColor("--chart-grid");
  const mutedColor = cssColor("--muted");
  const accentColor = cssColor("--accent");
  const redColor = cssColor("--red");

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.fillStyle = mutedColor;
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

  ctx.strokeStyle = redColor;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(padding.left, yFor(initialCapital));
  ctx.lineTo(width - padding.right, yFor(initialCapital));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = accentColor;
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
  renderDecisions(result);
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
  elements.exportReportBtn.disabled = true;
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
    addLog(`入场过滤：${strategy.entryFilterEnabled ? `启用，最低入场收益 ${percent(strategy.minEntryReturn)}，正收益占比阈值 ${percent(strategy.minPositiveBreadth)}` : "关闭，卖出后按排名继续买入"}。`);
    elements.etaText.textContent = "预计耗时：约 4 秒";
    elements.runMeta.textContent = `${period.startMonth} 至 ${period.endMonth}，正在模拟`;
    addLog(`模拟区间：${period.startMonth} 至 ${period.endMonth}。`);
    addLog(`数据来源：${dataSourceLabel()}。`);
    addLog("加载基金候选池，优先筛选 C 类基金。");
    await sleep(450);

    const funds = normalizedFunds();
    const dates = funds[0].nav.map((point) => point.date);
    const selectedRange = resolvePeriodIndices(dates, period.startMonth, period.endMonth);
    if (selectedRange.actualStartMonth > period.startMonth) {
      throw new Error(`当前缓存最早净值是 ${selectedRange.actualStartMonth}，无法从 ${period.startMonth} 开始模拟。请先按所选区间点击“更新全市场净值”。`);
    }
    if (selectedRange.actualEndMonth < period.endMonth) {
      addLog(`当前缓存实际可用净值只到 ${selectedRange.actualEndMonth}，晚于该月份的区间会自动忽略。`);
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
    elements.exportReportBtn.disabled = false;
  } catch (error) {
    elements.runMeta.textContent = "模拟失败";
    elements.etaText.textContent = "预计耗时：-";
    addLog(`模拟失败：${error.message}`);
    elements.saveBtn.disabled = currentSimulation === null;
    elements.exportReportBtn.disabled = currentSimulation === null;
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function downloadTextFile(filename, content, type = "text/html;charset=utf-8") {
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

function reportFundDetails(result) {
  const usedCodes = new Set(result.trades.map((trade) => trade.code));
  return normalizedFunds()
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

function buildHtmlReport(result) {
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
        allocationFormulaText(item),
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
    ["数据来源", assumptions.dataSource || dataSourceLabel()],
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
  ${reportTable(["代码", "基金", "板块", "份额类型", "起始净值", "最新净值", "区间收益", "最大回撤"], reportFundDetails(result))}
</body>
</html>`;
}

function exportReport() {
  if (!currentSimulation) return;
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const filename = `fund-backtest-report-${date}.html`;
  downloadTextFile(filename, buildHtmlReport(currentSimulation));
  addLog(`已导出回测报告：${filename}`);
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
    if (typeof currentSimulation.assumptions?.entryFilterEnabled === "boolean") {
      elements.entryFilterInput.checked = currentSimulation.assumptions.entryFilterEnabled;
    }
    if (currentSimulation.assumptions?.minEntryReturn !== undefined) {
      elements.minEntryReturnInput.value = String(Math.round(currentSimulation.assumptions.minEntryReturn * 1000) / 10);
    }
    if (currentSimulation.assumptions?.minPositiveBreadth !== undefined) {
      elements.minPositiveBreadthInput.value = String(Math.round(currentSimulation.assumptions.minPositiveBreadth * 1000) / 10);
    }
    renderAll(currentSimulation);
    elements.saveBtn.disabled = false;
    elements.exportReportBtn.disabled = false;
    elements.runMeta.textContent = "已恢复上次模拟";
    addLog("已从浏览器本地缓存恢复上次模拟结果。");
  } catch {
    localStorage.removeItem("fund-simulator:last-result");
  }
}

elements.startBtn.addEventListener("click", runSimulation);
elements.updateDataBtn.addEventListener("click", updateFundData);
elements.saveBtn.addEventListener("click", saveSimulation);
elements.exportReportBtn.addEventListener("click", exportReport);
elements.themeToggleBtn.addEventListener("click", toggleTheme);
for (const button of elements.annualModeButtons) {
  button.addEventListener("click", () => setAnnualValueMode(button.dataset.annualMode));
}
elements.initialCapitalInput.addEventListener("change", getInitialCapital);
elements.initialCapitalInput.addEventListener("input", () => {
  const raw = Number.parseFloat(elements.initialCapitalInput.value);
  if (Number.isFinite(raw) && raw > 0) elements.initialCapital.textContent = money(raw);
});
elements.tradeTable.addEventListener("click", (event) => {
  const decisionButton = event.target.closest(".decision-link");
  if (decisionButton) {
    openDecisionModal(decisionButton.dataset.decisionId);
    return;
  }
  const button = event.target.closest(".fund-link");
  if (button) openFundModal(button.dataset.code);
});
elements.decisionCards.addEventListener("click", (event) => {
  const decisionButton = event.target.closest(".decision-link");
  if (decisionButton) openDecisionModal(decisionButton.dataset.decisionId);
});
elements.decisionModalClose.addEventListener("click", closeDecisionModal);
elements.decisionModal.addEventListener("click", (event) => {
  if (event.target === elements.decisionModal) closeDecisionModal();
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
    closeDecisionModal();
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
  applyTheme(document.documentElement.dataset.theme);
  getInitialCapital();
  setupPeriodInputs();
  renderDataQuality();
  renderMarketTicker();
  await loadSavedFundData();
  restoreLastResult();
}

initialize();
