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
  initialCapital: $("#initialCapital"),
  finalValue: $("#finalValue"),
  totalReturn: $("#totalReturn"),
  targetStatus: $("#targetStatus"),
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

function money(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
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

function allocationScore(item, index, allocationMode, sectorSeen) {
  if (allocationMode === "equal") return 1;

  let score = Math.max(1, ROTATION_TOP_N - item.rank + 1);
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

function applyAllocationWeights(selectedItems, index, allocationMode) {
  if (selectedItems.length === 0) return [];
  const sectorSeen = new Map();
  const scored = selectedItems.map((item) => ({
    ...item,
    allocationScore: allocationScore(item, index, allocationMode, sectorSeen),
  }));
  const totalScore = scored.reduce((sum, item) => sum + item.allocationScore, 0);
  if (totalScore <= 0) {
    return scored.map((item) => ({ ...item, allocation: 1 / scored.length }));
  }
  return capAllocations(scored.map((item) => ({ ...item, allocation: item.allocationScore / totalScore })));
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
    nav: fund.nav.map((point) => {
      if (Array.isArray(point)) {
        return { date: point[0], nav: Number(point[1]) };
      }
      return { date: point.date, nav: Number(point.nav) };
    }),
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

function chooseMonthlyRotationFunds(funds, index) {
  const sectorCount = new Map();
  const selected = [];
  const topTen = monthlyReturnRank(funds, index).slice(0, ROTATION_TOP_N);
  const preferred = [...topTen].sort((a, b) => {
    if (a.fund.type === "C" && b.fund.type !== "C") return -1;
    if (a.fund.type !== "C" && b.fund.type === "C") return 1;
    return a.rank - b.rank;
  });

  for (const item of preferred) {
    const count = sectorCount.get(item.fund.sector) ?? 0;
    if (count >= MAX_SAME_SECTOR) continue;
    selected.push(item);
    sectorCount.set(item.fund.sector, count + 1);
    if (selected.length === MAX_HOLDINGS) break;
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

function buyRotationPortfolio({ date, index, cash, selectedItems, trades, allocationMode }) {
  const holdings = [];
  if (selectedItems.length === 0 || cash <= 0) {
    return { cash, holdings };
  }

  const startCash = cash;
  const allocatedItems = applyAllocationWeights(selectedItems, index, allocationMode);
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
        note: `本月收益排名第 ${item.rank}/${ROTATION_TOP_N}，本月收益 ${percent(item.monthlyReturn)}，${ALLOCATION_MODE_LABELS[allocationMode]}，买入权重 ${percent(item.allocation)}，计划持有约 1 个月`,
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
  } = options;
  const { startIndex, endIndex, steps } = resolvePeriodIndices(dates, startMonth, endMonth);
  let cash = initialCapital;
  let holdings = [];
  const trades = [];
  const equity = [];
  const decisions = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const date = dates[index];
    onStep(index - startIndex + 1, steps, `正在处理 ${date} 的月度收益前 ${ROTATION_TOP_N} 轮动`);

    if (holdings.length > 0) {
      ({ cash, holdings } = liquidateAll({
        date,
        index,
        cash,
        holdings,
        trades,
        action: "轮动卖出",
        note: "持有约 1 个月，到期卖出并进入下一轮",
      }));
    }

    if (index > 0 && index < endIndex) {
      const selectedItems = chooseMonthlyRotationFunds(funds, index);
      const beforeValue = portfolioValue(cash, holdings, index);
      ({ cash, holdings } = buyRotationPortfolio({
        date,
        index,
        cash,
        selectedItems,
        trades,
        allocationMode,
      }));
      decisions.push({
        date,
        action: "monthly-top10-rotation",
        beforeValue,
        funds: applyAllocationWeights(selectedItems, index, allocationMode).map(
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
      maxHoldings: MAX_HOLDINGS,
      maxSameSector: MAX_SAME_SECTOR,
      preference: `月度轮动：每月月末卖出上月持仓，再从刚结束月份收益率前 ${ROTATION_TOP_N} 的基金中优先选择 C 类基金，最多持有 ${MAX_HOLDINGS} 只，约 1 个月后卖出`,
      dataSource: dataSourceLabel(),
      dataNote: "系统优先使用 data/funds.json 中的已更新净值数据；没有本地更新数据时回退到 data/funds.js 内置样本。",
    },
    equity,
    trades,
    decisions,
    annual: annualStats(equity, initialCapital),
    finalValue: cash,
    totalReturn: cash / initialCapital - 1,
  };
}

function annualStats(equity, initialCapital = DEFAULT_INITIAL_CAPITAL) {
  const grouped = new Map();
  for (const point of equity) {
    const year = point.date.slice(0, 4);
    if (!grouped.has(year)) grouped.set(year, []);
    grouped.get(year).push(point);
  }

  let previousYearEnd = initialCapital;
  return [...grouped.entries()].map(([year, points]) => {
    const start = previousYearEnd;
    const end = points[points.length - 1].value;
    previousYearEnd = end;
    return {
      year,
      start,
      end,
      return: end / start - 1,
      hitTarget: end / start - 1 >= TARGET_ANNUAL_RETURN,
    };
  });
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
  elements.runMeta.textContent = `${result.assumptions.period}，完成于 ${new Date(result.createdAt).toLocaleString("zh-CN")}`;
}

function renderYears(result) {
  elements.yearCards.innerHTML = "";
  for (const item of result.annual) {
    const card = document.createElement("article");
    card.className = "year-card";
    card.innerHTML = `
      <span>${item.year}</span>
      <strong class="${item.return >= TARGET_ANNUAL_RETURN ? "good" : item.return >= 0 ? "warn" : "bad"}">${percent(item.return)}</strong>
      <small>${money(item.start)} → ${money(item.end)}</small>
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

function renderFundNavChart(fund, stats) {
  const canvas = elements.fundNavChart;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  ctx.scale(scale, scale);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 24, right: 24, bottom: 38, left: 58 };
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

  for (let i = 0; i <= 4; i += 1) {
    const value = min + (range * i) / 4;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(4), 10, y + 4);
  }

  ctx.strokeStyle = stats.return >= 0 ? "#176b87" : "#bf3b3b";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.nav);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#344252";
  ctx.fillText(points[0].date.slice(0, 7), padding.left, height - 14);
  ctx.fillText(points[points.length - 1].date.slice(0, 7), Math.max(padding.left, width - padding.right - 58), height - 14);

  ctx.fillStyle = stats.return >= 0 ? "#1f7a4d" : "#bf3b3b";
  ctx.beginPath();
  ctx.arc(xFor(points.length - 1), yFor(points[points.length - 1].nav), 4, 0, Math.PI * 2);
  ctx.fill();
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
  document.body.classList.remove("modal-open");
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
      `全市场更新完成：目录 ${payload.catalogCount} 只，扫描 ${payload.scannedCount} 只，可回测 ${payload.fundCount} 只，耗时 ${payload.durationSeconds} 秒。`
    );
    addLog(`数据已保存：${payload.path}。`);
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
    addLog(`初始资金：${money(initialCapital)} 元。`);
    addLog(`买入额度分配方式：${ALLOCATION_MODE_LABELS[allocationMode]}。`);
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
    }, { ...period, initialCapital, allocationMode });

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
    if (fund && stats) renderFundNavChart(fund, stats);
  }
});

async function initialize() {
  getInitialCapital();
  setupPeriodInputs();
  await loadSavedFundData();
  restoreLastResult();
}

initialize();
