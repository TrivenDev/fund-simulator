import {
  ALLOCATION_MODE_LABELS,
  DEFAULT_INITIAL_CAPITAL,
  MAX_SINGLE_ALLOCATION,
  TARGET_ANNUAL_RETURN,
  defaultStrategyOptions,
} from "./config.js";
import { monthOf, percent } from "./format.js";

export function capAllocations(items, maxSingleAllocation = MAX_SINGLE_ALLOCATION) {
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

export function navAt(fund, index) {
  return fund.nav[index]?.nav ?? fund.nav[fund.nav.length - 1].nav;
}

export function fundReturn(fund, currentIndex, lookbackMonths) {
  const startIndex = currentIndex - lookbackMonths;
  if (startIndex < 0) return null;
  return navAt(fund, currentIndex) / navAt(fund, startIndex) - 1;
}

export function maxDrawdown(fund, currentIndex, months) {
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

export function volatility(fund, currentIndex, months) {
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

export function allocationScoreBreakdown(item, index, allocationMode, sectorSeen, strategy) {
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

export function applyAllocationWeights(selectedItems, index, allocationMode, strategy = defaultStrategyOptions()) {
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

export function resolvePeriodIndices(dates, startMonth, endMonth) {
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

export function monthlyReturnRank(funds, index) {
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

export function evaluateMarketTiming(ranked, topCandidates, strategy) {
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

export function analyzeMonthlyRotationDecision(funds, index, strategy, allocationMode) {
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

export function portfolioValue(cash, holdings, index) {
  return (
    cash +
    holdings.reduce((sum, holding) => {
      return sum + holding.shares * navAt(holding.fund, index);
    }, 0)
  );
}

export function createTrade({ date, action, fund, buyAmount = 0, sellAmount = 0, balance = 0, shares = 0, note = "", decisionId = "" }) {
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

export function liquidateAll({ date, index, cash, holdings, trades, action, note }) {
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

export function buyRotationPortfolio({ date, index, cash, selectedItems, trades, allocationMode, strategy, decisionId = "" }) {
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

export function simulate(funds, onStep, options = {}) {
  const dates = funds[0].nav.map((point) => point.date);
  const {
    startMonth = monthOf(dates[0]),
    endMonth = monthOf(dates[dates.length - 1]),
    initialCapital = DEFAULT_INITIAL_CAPITAL,
    allocationMode = "riskAdjusted",
    strategy = defaultStrategyOptions(),
    dataSource = "",
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
      dataSource,
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

export function performanceMetrics(equity, initialCapital) {
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

export function annualStats(equity, initialCapital = DEFAULT_INITIAL_CAPITAL) {
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

export function fundNavStats(fund) {
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

export function allocationFormulaText(item, allocationMode = "riskAdjusted") {
  const base = item.baseScore?.toFixed(2) ?? "-";
  if (allocationMode !== "riskAdjusted") {
    return `${base} / 入选基金得分合计，归一化后应用单只上限`;
  }
  return `${base} × 回撤${item.drawdownFactor.toFixed(2)} × 波动${item.volatilityFactor.toFixed(2)} × 板块${item.sectorFactor.toFixed(2)} = ${item.allocationScore.toFixed(2)}，再归一化并应用单只上限`;
}
