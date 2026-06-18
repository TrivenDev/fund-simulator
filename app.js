import {
  ALLOCATION_MODE_LABELS,
  DEFAULT_INITIAL_CAPITAL,
  FALLBACK_DATA_SOURCE,
  MAX_HOLDINGS,
  MAX_SAME_SECTOR,
  MAX_SINGLE_ALLOCATION,
  MAX_UPDATE_FUNDS,
  PERIOD_MAX_MONTH,
  PERIOD_MIN_MONTH,
  ROTATION_TOP_N,
  TARGET_ANNUAL_RETURN,
  THEME_STORAGE_KEY,
} from "./js/config.js";
import {
  $,
  compactSignedMoney,
  cssColor,
  money,
  monthLabel,
  monthOf,
  normalizeNavPoint,
  percent,
  signedMoney,
  sleep,
} from "./js/format.js";
import {
  allocationFormulaText,
  fundNavStats,
  navAt,
  performanceMetrics,
  resolvePeriodIndices,
  simulate,
} from "./js/strategy.js";
import { buildHtmlReport, downloadTextFile } from "./js/report.js";

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
  equityChartTooltip: $("#equityChartTooltip"),
  yearCards: $("#yearCards"),
  decisionCards: $("#decisionCards"),
  decisionCount: $("#decisionCount"),
  decisionSummary: $("#decisionSummary"),
  toggleDecisionListBtn: $("#toggleDecisionListBtn"),
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
let decisionListExpanded = false;
const DECISION_COLLAPSED_LIMIT = 12;

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

function currentRawFunds() {
  return activeFundPayload.funds?.length ? activeFundPayload.funds : window.FUND_UNIVERSE;
}

function normalizedFunds() {
  return (currentRawFunds() || [])
    .map((fund) => ({
      ...fund,
      nav: (fund.nav || [])
        .map(normalizeNavPoint)
        .filter((point) => point.date && Number.isFinite(point.nav) && point.nav > 0)
        .sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .filter((fund) => fund.nav.length > 0);
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
  elements.decisionSummary.innerHTML = "";
  const actionable = (result.decisions || []).filter((decision) => decision.id);
  const enterCount = actionable.filter((decision) => decision.action !== "wait-market").length;
  const waitCount = actionable.length - enterCount;
  const enterRatio = actionable.length ? enterCount / actionable.length : 0;
  const waitRatio = actionable.length ? waitCount / actionable.length : 0;
  elements.decisionCount.textContent = `${actionable.length} 条`;
  elements.toggleDecisionListBtn.hidden = actionable.length <= DECISION_COLLAPSED_LIMIT;
  elements.toggleDecisionListBtn.textContent = decisionListExpanded ? "收起" : "展开全部";
  elements.decisionCards.classList.toggle("expanded", decisionListExpanded);
  if (actionable.length === 0) {
    const empty = document.createElement("p");
    empty.className = "decision-empty";
    empty.textContent = "暂无择时决策记录。";
    elements.decisionCards.appendChild(empty);
    return;
  }

  const summaryItems = [
    ["买入决策", `${enterCount} 次`, percent(enterRatio), "enter"],
    ["空仓等待", `${waitCount} 次`, percent(waitRatio), "wait"],
  ];
  for (const [label, count, ratio, type] of summaryItems) {
    const item = document.createElement("article");
    item.className = `decision-summary-item ${type}`;
    item.innerHTML = `<span>${label}</span><strong>${count}</strong><small>占比 ${ratio}</small>`;
    elements.decisionSummary.appendChild(item);
  }

  const fragment = document.createDocumentFragment();
  const visibleDecisions = decisionListExpanded ? actionable : actionable.slice(0, DECISION_COLLAPSED_LIMIT);
  for (const decision of visibleDecisions) {
    const card = document.createElement("article");
    const isWait = decision.action === "wait-market";
    card.className = `decision-card ${isWait ? "wait" : "enter"}`;
    const bestReturn = decision.timing?.bestReturn;
    const breadth = decision.timing?.positiveBreadth;
    card.innerHTML = `
      <div>
        <div class="decision-card-top">
          <span>${decision.date}</span>
          <span class="decision-badge ${isWait ? "wait" : "enter"}">${isWait ? "空仓" : "买入"}</span>
        </div>
        <strong>${isWait ? "空仓等待" : `买入 ${decision.selected?.length || 0} 只`}</strong>
        <small>榜首 ${bestReturn === null || bestReturn === undefined ? "-" : percent(bestReturn)} · 正收益占比 ${breadth === null || breadth === undefined ? "-" : percent(breadth)}</small>
      </div>
      <button class="decision-link" type="button" data-decision-id="${decision.id}">查看决策</button>
    `;
    fragment.appendChild(card);
  }
  if (!decisionListExpanded && actionable.length > visibleDecisions.length) {
    const more = document.createElement("div");
    more.className = "decision-more";
    more.textContent = `已收起 ${actionable.length - visibleDecisions.length} 条历史决策，点击右上角“展开全部”查看。`;
    fragment.appendChild(more);
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
    { label: "权重计算", render: (row) => allocationFormulaText(row, decision.allocationMode) },
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

function drawChart(result, hoverIndex = null) {
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
  const textColor = cssColor("--text");
  const accentColor = cssColor("--accent");
  const redColor = cssColor("--red");
  const surfaceColor = cssColor("--surface");

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

  if (hoverIndex !== null && points[hoverIndex]) {
    const point = points[hoverIndex];
    const x = xFor(hoverIndex);
    const y = yFor(point.value);
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
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function nearestEquityPointIndex(mouseX, result) {
  const rect = elements.equityChart.getBoundingClientRect();
  const padding = { top: 26, right: 22, bottom: 34, left: 64 };
  const count = result.equity.length;
  const left = padding.left;
  const right = rect.width - padding.right;
  const ratio = Math.max(0, Math.min(1, (mouseX - left) / Math.max(1, right - left)));
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}

function showEquityChartTooltip(index) {
  if (!currentSimulation || !currentSimulation.equity[index]) return;
  const rect = elements.equityChart.getBoundingClientRect();
  const padding = { top: 26, right: 22, bottom: 34, left: 64 };
  const points = currentSimulation.equity;
  const point = points[index];
  const initialCapital = currentSimulation.assumptions?.initialCapital ?? DEFAULT_INITIAL_CAPITAL;
  const values = points.map((item) => item.value);
  const min = Math.min(...values, initialCapital) * 0.94;
  const max = Math.max(...values, initialCapital) * 1.04;
  const x = padding.left + (index / Math.max(1, points.length - 1)) * (rect.width - padding.left - padding.right);
  const y = padding.top + (1 - (point.value - min) / (max - min)) * (rect.height - padding.top - padding.bottom);
  const pointReturn = point.value / initialCapital - 1;

  elements.equityChartTooltip.innerHTML = `
    <strong>${point.date}</strong>
    <span>账户资产：${money(point.value)}</span>
    <span>累计收益：${percent(pointReturn)}</span>
    <span>现金：${money(point.cash ?? 0)}</span>
  `;
  elements.equityChartTooltip.hidden = false;

  const tooltipWidth = 164;
  const left = x > rect.width - tooltipWidth - 24 ? x - tooltipWidth - 12 : x + 12;
  const top = Math.max(10, y - 46);
  elements.equityChartTooltip.style.left = `${left}px`;
  elements.equityChartTooltip.style.top = `${top}px`;
}

function handleEquityChartMove(event) {
  if (!currentSimulation) return;
  const rect = elements.equityChart.getBoundingClientRect();
  const index = nearestEquityPointIndex(event.clientX - rect.left, currentSimulation);
  drawChart(currentSimulation, index);
  showEquityChartTooltip(index);
}

function handleEquityChartLeave() {
  if (!currentSimulation) return;
  elements.equityChartTooltip.hidden = true;
  drawChart(currentSimulation);
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
    }, { ...period, initialCapital, allocationMode, strategy, dataSource: dataSourceLabel() });

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

function exportReport() {
  if (!currentSimulation) return;
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const filename = `fund-backtest-report-${date}.html`;
  downloadTextFile(filename, buildHtmlReport(currentSimulation, {
    funds: normalizedFunds(),
    dataSource: dataSourceLabel(),
  }));
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
elements.toggleDecisionListBtn.addEventListener("click", () => {
  decisionListExpanded = !decisionListExpanded;
  if (currentSimulation) renderDecisions(currentSimulation);
});
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
elements.equityChart.addEventListener("mousemove", handleEquityChartMove);
elements.equityChart.addEventListener("mouseleave", handleEquityChartLeave);
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


