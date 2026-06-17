export const DEFAULT_INITIAL_CAPITAL = 3000;
export const TARGET_ANNUAL_RETURN = 0.2;
export const MAX_HOLDINGS = 3;
export const MAX_SAME_SECTOR = 2;
export const STOP_LOSS = -0.12;
export const ROTATION_TOP_N = 10;
export const MAX_SINGLE_ALLOCATION = 0.6;
export const PERIOD_MIN_MONTH = "1998-01";
export const PERIOD_MAX_MONTH = "2026-12";
export const MAX_UPDATE_FUNDS = 2000;
export const THEME_STORAGE_KEY = "fund-simulator:theme";
export const FALLBACK_DATA_SOURCE = "本地内置候选池 data/funds.js（window.FUND_UNIVERSE，月度净值样本，可替换为真实基金净值数据）";

export const ALLOCATION_MODE_LABELS = {
  equal: "均等买入",
  rank: "排名加权",
  riskAdjusted: "排名加权+风险惩罚",
};

export function defaultStrategyOptions() {
  return {
    topN: ROTATION_TOP_N,
    maxHoldings: MAX_HOLDINGS,
    maxSameSector: MAX_SAME_SECTOR,
    holdingMonths: 1,
    maxSingleAllocation: MAX_SINGLE_ALLOCATION,
    entryFilterEnabled: true,
    minEntryReturn: 0,
    minPositiveBreadth: 0.35,
  };
}
