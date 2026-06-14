from __future__ import annotations

import calendar
import json
import mimetypes
import re
import site
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent
SAVE_DIR = ROOT / "saved-simulations"
DATA_DIR = ROOT / "data"
FUND_DATA_PATH = DATA_DIR / "funds.json"
UPDATE_STATUS_PATH = DATA_DIR / "update-status.json"
WORKER_PATH = ROOT / "fund_data_worker.py"

ONLINE_DATA_SOURCE = "AKShare 全市场公募基金数据（fund_name_em + fund_open_fund_info_em，底层数据源为东方财富）"
AKSHARE_INDICATOR = "单位净值走势"
EXCLUDE_NAME_KEYWORDS = ("货币", "现金", "理财", "同业存单")
DEFAULT_SCAN_LIMIT = 1000
MAX_SCAN_LIMIT = 1000
UPDATE_LOCK = threading.Lock()
UPDATE_JOB: dict = {
    "jobId": None,
    "status": "idle",
    "message": "No update job has been started",
    "progress": 0,
    "total": 0,
    "scanned": 0,
    "success": 0,
    "failed": 0,
    "result": None,
    "error": None,
}
UPDATE_PROCESS: subprocess.Popen | None = None


def set_update_job(**fields: object) -> None:
    with UPDATE_LOCK:
        UPDATE_JOB.update(fields)
        UPDATE_JOB["updatedAt"] = datetime.now().isoformat(timespec="seconds")
        DATA_DIR.mkdir(exist_ok=True)
        temp_path = UPDATE_STATUS_PATH.with_suffix(".tmp")
        temp_path.write_text(json.dumps(UPDATE_JOB, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(UPDATE_STATUS_PATH)


def get_update_job() -> dict:
    global UPDATE_PROCESS

    if UPDATE_STATUS_PATH.exists():
        try:
            status = json.loads(UPDATE_STATUS_PATH.read_text(encoding="utf-8"))
            with UPDATE_LOCK:
                UPDATE_JOB.update(status)
        except Exception:
            pass
    if UPDATE_JOB.get("status") == "running" and UPDATE_PROCESS is not None:
        exit_code = UPDATE_PROCESS.poll()
        if exit_code is not None:
            set_update_job(
                status="error",
                phase="worker-exit",
                message="AKShare worker 已退出",
                error=f"AKShare worker 进程异常退出，退出码 {exit_code}",
            )
    with UPDATE_LOCK:
        return json.loads(json.dumps(UPDATE_JOB, ensure_ascii=False))


def configure_python_paths() -> None:
    candidates = [ROOT / "vendor_local"]
    try:
        candidates.append(Path(site.getusersitepackages()))
    except Exception:
        pass

    for path in candidates:
        try:
            if path.exists():
                text = str(path)
                if text not in sys.path:
                    sys.path.insert(0, text)
        except OSError:
            continue


configure_python_paths()


def import_akshare():
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
    for candidate in candidates:
        if candidate in columns:
            return candidate
    if contains:
        for column in columns:
            if all(token in column for token in contains):
                return column
    return None


def parse_float(value: object) -> float | None:
    try:
        text = str(value).strip().replace(",", "")
        if not text or text == "--" or text.lower() == "nan":
            return None
        return float(text)
    except ValueError:
        return None


def normalize_code(value: object) -> str | None:
    text = str(value).strip()
    match = re.search(r"\d{6}", text)
    return match.group(0) if match else None


def infer_share_class(name: str) -> str:
    stripped = re.sub(r"\s+", "", name.upper())
    if re.search(r"(?:A|A类)$", stripped):
        return "A"
    if re.search(r"(?:C|C类)$", stripped):
        return "C"
    if re.search(r"(?:E|E类)$", stripped):
        return "E"
    return "未知"


def classify_sector(name: str, fund_type: str) -> str:
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
    return f"{month}-01"


def month_end(month: str) -> str:
    year, month_number = [int(part) for part in month.split("-")]
    return f"{month}-{calendar.monthrange(year, month_number)[1]:02d}"


def months_between(start_date: str, end_date: str) -> list[str]:
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
    ak = import_akshare()
    df = ak.fund_name_em()
    return dataframe_to_catalog(df, include_money_funds=include_money_funds)


def to_monthly_nav_from_akshare(df, start_date: str, end_date: str) -> list[list[object]]:
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
    ak = import_akshare()
    df = ak.fund_open_fund_info_em(symbol=code, indicator=AKSHARE_INDICATOR)
    nav = to_monthly_nav_from_akshare(df, start_date, end_date)
    if len(nav) < 2:
        raise ValueError("有效月度净值少于 2 条")
    return nav


def align_funds_to_requested_months(funds: list[dict], requested_months: list[str]) -> tuple[list[dict], list[dict]]:
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
) -> dict:
    if progress_callback:
        progress_callback(
            phase="catalog",
            message="正在通过 AKShare 获取全市场基金目录",
            progress=1,
        )
    catalog, excluded_money = load_full_market_catalog(include_money_funds=include_money_funds)
    catalog_count = len(catalog)
    if max_funds > 0:
        catalog = catalog[:max_funds]

    funds = []
    fetch_warnings = []
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

    def fetch_one(fund: dict) -> dict:
        nav = fetch_fund_nav(fund["code"], start_date, end_date)
        return {**fund, "nav": nav}

    for scanned, fund in enumerate(catalog, start=1):
        try:
            funds.append(fetch_one(fund))
        except Exception as exc:
            fetch_warnings.append({"code": fund["code"], "name": fund["name"], "error": str(exc)})
        if progress_callback:
            progress_callback(
                phase="scan",
                message=f"正在扫描基金净值：{scanned}/{len(catalog)}，成功 {len(funds)}，失败 {len(fetch_warnings)}",
                progress=3 + int(87 * scanned / max(1, len(catalog))),
                total=len(catalog),
                scanned=scanned,
                success=len(funds),
                failed=len(fetch_warnings),
            )

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
            message=f"正在保存 {len(funds)} 只可回测基金到 data/funds.json",
            progress=98,
            total=len(catalog),
            scanned=len(catalog),
            success=len(funds),
            failed=len(warnings),
        )
    DATA_DIR.mkdir(exist_ok=True)
    FUND_DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def run_update_job(job_id: str, options: dict) -> None:
    def progress(**fields: object) -> None:
        set_update_job(jobId=job_id, status="running", **fields)

    try:
        progress(message="基金净值更新任务已启动", progress=0)
        result = update_fund_data(
            month_start(options["startMonth"]),
            month_end(options["endMonth"]),
            include_money_funds=options.get("includeMoneyFunds", False),
            max_funds=options.get("maxFunds", 0),
            progress_callback=progress,
        )
        summary = {
            "ok": True,
            "updatedAt": result["updatedAt"],
            "source": result["source"],
            "indicator": result["indicator"],
            "startDate": result["startDate"],
            "endDate": result["endDate"],
            "catalogCount": result["catalogCount"],
            "scannedCount": result["scannedCount"],
            "fundCount": result["fundCount"],
            "excludedMoneyFundCount": result["excludedMoneyFundCount"],
            "warningCount": result["warningCount"],
            "warnings": result["warnings"][:20],
            "durationSeconds": result["durationSeconds"],
            "path": str(FUND_DATA_PATH),
        }
        set_update_job(
            jobId=job_id,
            status="complete",
            phase="complete",
            message=f"更新完成，可回测基金 {summary['fundCount']} 只",
            progress=100,
            result=summary,
            error=None,
        )
    except Exception as exc:
        set_update_job(
            jobId=job_id,
            status="error",
            phase="error",
            message="更新失败",
            error=str(exc),
        )


def start_update_job(options: dict) -> dict:
    global UPDATE_PROCESS

    current = get_update_job()
    if current.get("status") == "running" and UPDATE_PROCESS and UPDATE_PROCESS.poll() is None:
        return current

    job_id = datetime.now().strftime("%Y%m%d%H%M%S")
    set_update_job(
        jobId=job_id,
        status="running",
        phase="queued",
        message="更新任务已排队",
        progress=0,
        total=0,
        scanned=0,
        success=0,
        failed=0,
        result=None,
        error=None,
        startedAt=datetime.now().isoformat(timespec="seconds"),
    )
    command = [
        sys.executable,
        str(WORKER_PATH),
        "--job-id",
        job_id,
        "--start-month",
        options["startMonth"],
        "--end-month",
        options["endMonth"],
        "--max-funds",
        str(options.get("maxFunds", 0)),
    ]
    if options.get("includeMoneyFunds", False):
        command.append("--include-money-funds")

    UPDATE_PROCESS = subprocess.Popen(
        command,
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
    )
    return get_update_job()


class FundSimulatorHandler(BaseHTTPRequestHandler):
    server_version = "FundSimulator/1.0"

    def do_GET(self) -> None:
        endpoint = self.path.split("?", 1)[0]
        if endpoint == "/":
            self._send_file(ROOT / "index.html")
            return
        if endpoint == "/api/fund-data":
            self._send_saved_fund_data()
            return
        if endpoint == "/api/update-fund-data/status":
            self._send_json({"ok": True, **get_update_job()})
            return

        requested = unquote(endpoint).lstrip("/")
        target = (ROOT / requested).resolve()
        if ROOT not in target.parents and target != ROOT:
            self._send_json({"error": "Invalid path"}, status=403)
            return

        if target.is_file():
            self._send_file(target)
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_HEAD(self) -> None:
        endpoint = self.path.split("?", 1)[0]
        if endpoint == "/":
            self._send_file(ROOT / "index.html", include_body=False)
            return

        requested = unquote(endpoint).lstrip("/")
        target = (ROOT / requested).resolve()
        if ROOT not in target.parents and target != ROOT:
            self._send_json({"error": "Invalid path"}, status=403, include_body=False)
            return

        if target.is_file():
            self._send_file(target, include_body=False)
            return

        self._send_json({"error": "Not found"}, status=404, include_body=False)

    def do_POST(self) -> None:
        endpoint = self.path.split("?", 1)[0]
        if endpoint == "/api/save-simulation":
            self._save_simulation()
            return

        if endpoint == "/api/update-fund-data":
            self._update_fund_data()
            return

        self._send_json({"error": "Not found"}, status=404)

    def _send_saved_fund_data(self) -> None:
        if not FUND_DATA_PATH.exists():
            self._send_json(
                {
                    "ok": False,
                    "error": "No updated fund data found",
                    "fallback": "data/funds.js",
                },
                status=404,
            )
            return

        try:
            payload = json.loads(FUND_DATA_PATH.read_text(encoding="utf-8"))
            self._send_json(payload)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=500)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a JSON object")
        return payload

    def _save_simulation(self) -> None:
        try:
            payload = self._read_json_body()
            if not payload:
                raise ValueError("Payload must not be empty")

            SAVE_DIR.mkdir(exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            filename = f"simulation-{timestamp}.json"
            path = SAVE_DIR / filename
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

            self._send_json(
                {
                    "ok": True,
                    "filename": filename,
                    "path": str(path),
                    "savedAt": datetime.now().isoformat(timespec="seconds"),
                }
            )
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=400)

    def _update_fund_data(self) -> None:
        try:
            payload = self._read_json_body()
            start_month = payload.get("startMonth", "2022-01")
            end_month = payload.get("endMonth", "2025-12")
            include_money_funds = bool(payload.get("includeMoneyFunds", False))
            max_funds = int(payload.get("maxFunds", DEFAULT_SCAN_LIMIT) or DEFAULT_SCAN_LIMIT)
            max_funds = max(1, min(MAX_SCAN_LIMIT, max_funds))

            if not re.match(r"^\d{4}-\d{2}$", start_month) or not re.match(r"^\d{4}-\d{2}$", end_month):
                raise ValueError("startMonth/endMonth must use YYYY-MM format")
            if start_month > end_month:
                raise ValueError("startMonth must not be later than endMonth")

            job = start_update_job(
                {
                    "startMonth": start_month,
                    "endMonth": end_month,
                    "includeMoneyFunds": include_money_funds,
                    "maxFunds": max_funds,
                }
            )
            self._send_json({"ok": True, **job})
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=400)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[fund-simulator] {self.address_string()} - {format % args}")

    def _send_file(self, path: Path, include_body: bool = True) -> None:
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)

    def _send_json(self, payload: dict, status: int = 200, include_body: bool = True) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)


def run() -> None:
    url = "http://127.0.0.1:8765"
    server = ThreadingHTTPServer(("127.0.0.1", 8765), FundSimulatorHandler)
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    print(f"基金模拟交易系统已启动：{url}")
    print("按 Ctrl+C 停止服务。")
    server.serve_forever()


if __name__ == "__main__":
    run()
