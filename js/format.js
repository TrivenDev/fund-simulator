export const $ = (selector) => document.querySelector(selector);

export function money(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

export function signedMoney(value) {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${money(Math.abs(value))}`;
}

export function compactSignedMoney(value) {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function monthOf(date) {
  return date.slice(0, 7);
}

export function monthLabel(month) {
  const [year, monthNumber] = month.split("-");
  return `${year}年${monthNumber}月`;
}

export function normalizeNavPoint(point) {
  if (Array.isArray(point)) {
    return { date: point[0], nav: Number(point[1]) };
  }
  return { date: point.date, nav: Number(point.nav) };
}

export function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
