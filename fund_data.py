from __future__ import annotations

import calendar
import json
import re
from datetime import datetime

from config import (
    AKSHARE_INDICATOR,
    DATA_DIR,
    EXCLUDE_NAME_KEYWORDS,
    FUND_DATA_PATH,
    ONLINE_DATA_SOURCE,
)
from storage import (
    cached_fund_from_db,
    connect_fund_db,
    init_fund_db,
    mark_fund_failed,
    save_fund_to_db,
    save_update_run,
)


def import_akshare():
    """Import AKShare lazily so the app can still open without the dependency installed."""
    try:
        import akshare as ak  # type: ignore
    except Exception as exc:
        raise RuntimeError("没有找到 AKShare。请先运行：python -m pip install akshare") from exc

    missing = [name for name in ("fund_name_em", "fund_open_fund_info_em") if not hasattr(ak, name)]
    if missing:
        raise RuntimeError(
            "当前 AKShare 包不可用或版本异常，缺少接口："
            + ", ".join(missing)
            + "。请重新安装或升级：python -m pip install -U akshare"
        )
    return ak


def pick_column(columns: list[str], candidates: tuple[str, ...], contains: tuple[str, ...] = ()) -> str | None:
    """Pick a DataFrame column by exact names first, then by required substrings."""
    for candidate in candidates:
        if candidate in columns:
            return candidate
    if contains:
        for column in columns:
            if all(token in column for token in contains):
                return column
    return None


def parse_float(value: object) -> float | None:
    """Parse numeric values returned by AKShare while tolerating placeholders."""
    try:
        text = str(value).strip().replace(",", "")
        if not text or text == "--" or text.lower() == "nan":
            return None
        return float(text)
    except ValueError:
        return None


def normalize_code(value: object) -> str | None:
    """Extract the six-digit Chinese fund code from mixed AKShare values."""
    text = str(value).strip()
    match = re.search(r"\d{6}", text)
    return match.group(0) if match else None


def infer_share_class(name: str) -> str:
    """Infer A/C/E share class from the fund name when the catalog omits it."""
    stripped = re.sub(r"\s+", "", name.upper())
    if re.search(r"(?:A|A类)$", stripped):
        return "A"
    if re.search(r"(?:C|C类)$", stripped):
        return "C"
    if re.search(r"(?:E|E类)$", stripped):
        return "E"
    return "未知"


def classify_sector(name: str, fund_type: str) -> str:
    """Classify funds into broad sectors using deterministic keyword rules."""
    text = f"{name}{fund_type}"
    rules = [
        ("医药医疗", ("医药", "医疗", "生物", "创新药", "中药", "疫苗")),
        ("新能源", ("新能源", "光伏", "电池", "碳中和", "环保", "电力设备", "风电", "储能")),
        ("人工智能", ("人工智能", "AI", "云计算", "计算机", "软件", "数字经济", "数据")),
        ("半导体科技", ("半导体", "芯片", "电子", "科技", "通信", "5G", "信息技术")),
        ("消费", ("消费", "白酒", "食品", "饮料", "家电", "农业", "畜牧")),
        ("传媒游戏", ("传媒", "游戏", "动漫", "影视", "文娱")),
        ("金融地产", ("金融", "银行", "证券", "保险", "地产", "房地产")),
        ("军工", ("军工", "国防", "航天", "航空")),
        ("资源能源", ("煤炭", "石油", "油气", "有色", "钢铁", "资源", "能源", "稀土", "黄金", "贵金属")),
        ("港美互联", ("港股", "香港", "恒生", "中概", "海外", "QDII", "纳斯达克", "标普", "美国")),
        ("宽基指数", ("沪深300", "中证500", "中证1000", "上证50", "创业板", "科创", "宽基")),
        ("债券", ("债券", "纯债", "可转债", "固收", "信用债", "利率债")),
        ("商品", ("商品", "黄金", "白银", "原油", "豆粕", "REIT")),
    ]
    for sector, keywords in rules:
        if any(keyword in text for keyword in keywords):
            return sector
    return fund_type or "其他"


def month_start(month: str) -> str:
    """Convert YYYY-MM to the first calendar day string."""
    return f"{month}-01"


def month_end(month: str) -> str:
    """Convert YYYY-MM to the last calendar day string."""
    year, month_number = [int(part) for part in month.split("-")]
    return f"{month}-{calendar.monthrange(year, month_number)[1]:02d}"


def months_between(start_date: str, end_date: str) -> list[str]:
    """List inclusive YYYY-MM month keys between two date strings."""
    start_year, start_month = [int(part) for part in start_date[:7].split("-")]
    end_year, end_month = [int(part) for part in end_date[:7].split("-")]
    result = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        result.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return result


def dataframe_to_catalog(df, include_money_funds: bool = False) -> tuple[list[dict], int]:
    """Normalize AKShare's fund catalog into the simulator's metadata shape."""
    columns = [str(column) for column in df.columns]
    code_col = pick_column(columns, ("基金代码", "基金编码", "code", "symbol"), ("代码",))
    name_col = pick_column(columns, ("基金简称", "基金名称", "name"), ("简称",))
    type_col = pick_column(columns, ("基金类型", "类型", "type"), ("类型",))
    if not code_col or not name_col:
        raise RuntimeError(f"AKShare 基金名录字段不符合预期：{columns}")

    catalog = []
    excluded = 0
    seen = set()
    for _, row in df.iterrows():
        code = normalize_code(row.get(code_col))
        name = str(row.get(name_col, "")).strip()
        fund_type = str(row.get(type_col, "")).strip() if type_col else ""
        if not code or not name or code in seen:
            continue
        seen.add(code)

        if not include_money_funds and any(keyword in name or keyword in fund_type for keyword in EXCLUDE_NAME_KEYWORDS):
            excluded += 1
            continue

        catalog.append(
            {
                "code": code,
                "name": name,
                "type": infer_share_class(name),
                "sector": classify_sector(name, fund_type),
                "risk": fund_type or "未知",
            }
        )
    return catalog, excluded


def load_full_market_catalog(include_money_funds: bool = False) -> tuple[list[dict], int]:
    """Fetch the full fund catalog from AKShare and remove unsupported categories."""
    ak = import_akshare()
    df = ak.fund_name_em()
    return dataframe_to_catalog(df, include_money_funds=include_money_funds)


def to_monthly_nav_from_akshare(df, start_date: str, end_date: str) -> list[list[object]]:
    """Convert daily/unit NAV rows from AKShare into month-end NAV points."""
    columns = [str(column) for column in df.columns]
    date_col = pick_column(columns, ("净值日期", "日期", "FSRQ"), ("日期",))
    nav_col = pick_column(columns, ("单位净值", "DWJZ"), ("单位", "净值"))
    if not date_col or not nav_col:
        raise ValueError(f"历史净值字段不符合预期：{columns}")

    by_month: dict[str, tuple[str, float]] = {}
    for _, row in df.iterrows():
        date_text = str(row.get(date_col, "")).strip()[:10]
        if not re.match(r"\d{4}-\d{2}-\d{2}", date_text):
            continue
        if date_text < start_date or date_text > end_date:
            continue
        nav = parse_float(row.get(nav_col))
        if nav is None:
            continue
        by_month[date_text[:7]] = (date_text, nav)

    return [[date, round(nav, 6)] for _, (date, nav) in sorted(by_month.items())]


def fetch_fund_nav(code: str, start_date: str, end_date: str) -> list[list[object]]:
    """Fetch one fund's NAV history from AKShare and reduce it to monthly points."""
    ak = import_akshare()
    df = ak.fund_open_fund_info_em(symbol=code, indicator=AKSHARE_INDICATOR)
    nav = to_monthly_nav_from_akshare(df, start_date, end_date)
    if len(nav) < 2:
        raise ValueError("有效月度净值少于 2 条")
    return nav


def align_funds_to_requested_months(funds: list[dict], requested_months: list[str]) -> tuple[list[dict], list[dict]]:
    """Keep only funds that have every usable requested month."""
    aligned = []
    warnings = []
    available_months = set()
    for fund in funds:
        available_months.update(row[0][:7] for row in fund["nav"])
    usable_months = [month for month in requested_months if month in available_months]
    ignored_months = [month for month in requested_months if month not in available_months]
    if len(usable_months) < 2:
        raise RuntimeError("所选区间内没有足够的实际净值月份；如果结束月份在未来，需等待 AKShare 有对应数据。")
    if ignored_months:
        warnings.append(
            {
                "code": "SYSTEM",
                "name": "月份对齐",
                "error": f"已忽略 {len(ignored_months)} 个尚无任何净值数据的月份：{ignored_months[0]} 至 {ignored_months[-1]}",
            }
        )
    required = set(usable_months)
    for fund in funds:
        by_month = {row[0][:7]: row for row in fund["nav"]}
        missing = sorted(required - set(by_month))
        if missing:
            warnings.append(
                {
                    "code": fund["code"],
                    "name": fund["name"],
                    "error": f"缺少 {len(missing)} 个所选区间月份净值，已排除",
                }
            )
            continue
        aligned.append({**fund, "nav": [by_month[month] for month in usable_months]})
    return aligned, warnings


def update_fund_data(
    start_date: str,
    end_date: str,
    include_money_funds: bool = False,
    max_funds: int = 0,
    progress_callback=None,
    job_id: str | None = None,
) -> dict:
    """Update the local SQLite cache from AKShare and export compatible JSON."""
    if progress_callback:
        progress_callback(phase="catalog", message="正在通过 AKShare 获取全市场基金目录", progress=1)
    catalog, excluded_money = load_full_market_catalog(include_money_funds=include_money_funds)
    catalog_count = len(catalog)
    if max_funds > 0:
        catalog = catalog[:max_funds]

    conn = connect_fund_db()
    init_fund_db(conn)
    save_update_run(
        conn,
        job_id,
        status="running",
        start_date=start_date,
        end_date=end_date,
        total=len(catalog),
        scanned=0,
        success=0,
        failed=0,
        started_at=datetime.now().isoformat(timespec="seconds"),
        message="scan started",
    )

    funds = []
    fetch_warnings = []
    cached_count = 0
    started_at = datetime.now()
    if progress_callback:
        progress_callback(
            phase="scan",
            message=f"已获取基金目录 {catalog_count} 只，开始扫描 {len(catalog)} 只基金历史净值",
            progress=3,
            total=len(catalog),
            scanned=0,
            success=0,
            failed=0,
            catalogCount=catalog_count,
            excludedMoneyFundCount=excluded_money,
        )

    try:
        for scanned, fund in enumerate(catalog, start=1):
            try:
                cached = cached_fund_from_db(conn, fund, start_date, end_date)
                if cached:
                    funds.append(cached)
                    cached_count += 1
                else:
                    nav = fetch_fund_nav(fund["code"], start_date, end_date)
                    save_fund_to_db(conn, fund, nav, start_date, end_date)
                    funds.append({**fund, "nav": nav})
            except Exception as exc:
                error = str(exc)
                fetch_warnings.append({"code": fund["code"], "name": fund["name"], "error": error})
                try:
                    mark_fund_failed(conn, fund, start_date, end_date, error)
                except Exception:
                    pass

            save_update_run(
                conn,
                job_id,
                status="running",
                total=len(catalog),
                scanned=scanned,
                success=len(funds),
                failed=len(fetch_warnings),
                message=f"scanned {scanned}/{len(catalog)}",
            )
            if progress_callback:
                progress_callback(
                    phase="scan",
                    message=f"正在扫描基金净值：{scanned}/{len(catalog)}，成功 {len(funds)}，缓存 {cached_count}，失败 {len(fetch_warnings)}",
                    progress=3 + int(87 * scanned / max(1, len(catalog))),
                    total=len(catalog),
                    scanned=scanned,
                    success=len(funds),
                    failed=len(fetch_warnings),
                    cached=cached_count,
                )
    finally:
        conn.close()

    requested_months = months_between(start_date, end_date)
    if progress_callback:
        progress_callback(
            phase="align",
            message="正在对齐所选区间的月度净值",
            progress=92,
            total=len(catalog),
            scanned=len(catalog),
            success=len(funds),
            failed=len(fetch_warnings),
        )
    funds, align_warnings = align_funds_to_requested_months(funds, requested_months)
    warnings = fetch_warnings + align_warnings
    if not funds:
        raise RuntimeError("全市场扫描后没有得到可用于所选区间回测的基金，请缩短区间或检查 AKShare 数据源。")

    payload = {
        "ok": True,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "source": ONLINE_DATA_SOURCE,
        "indicator": AKSHARE_INDICATOR,
        "startDate": start_date,
        "endDate": end_date,
        "requestedMonths": requested_months,
        "catalogCount": catalog_count,
        "scannedCount": len(catalog),
        "cachedCount": cached_count,
        "fundCount": len(funds),
        "excludedMoneyFundCount": excluded_money,
        "warningCount": len(warnings),
        "warnings": warnings[:500],
        "durationSeconds": round((datetime.now() - started_at).total_seconds(), 2),
        "funds": sorted(funds, key=lambda item: (item["type"] != "C", item["code"])),
    }
    if progress_callback:
        progress_callback(
            phase="save",
            message=f"正在导出 {len(funds)} 只可回测基金到 data/funds.json，同时保留 SQLite 主缓存",
            progress=98,
            total=len(catalog),
            scanned=len(catalog),
            success=len(funds),
            failed=len(warnings),
        )
    DATA_DIR.mkdir(exist_ok=True)
    FUND_DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    with connect_fund_db() as conn:
        init_fund_db(conn)
        save_update_run(
            conn,
            job_id,
            status="complete",
            total=len(catalog),
            scanned=len(catalog),
            success=len(funds),
            failed=len(warnings),
            finished_at=datetime.now().isoformat(timespec="seconds"),
            message="complete",
        )
    return payload
