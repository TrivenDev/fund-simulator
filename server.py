from __future__ import annotations

import json
import mimetypes
import re
import socket
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from config import (
    AKSHARE_INDICATOR,
    DEFAULT_SCAN_LIMIT,
    FUND_DATA_PATH,
    FUND_DB_PATH,
    MAX_SCAN_LIMIT,
    ONLINE_DATA_SOURCE,
    ROOT,
    SAVE_DIR,
)
from fund_data import align_funds_to_requested_months, months_between
from jobs import get_update_job, start_update_job
from storage import db_quality_summary, load_funds_from_db


class FundSimulatorHandler(BaseHTTPRequestHandler):
    """HTTP adapter for the local fund simulator.

    The handler deliberately stays thin: it validates requests, delegates fund
    data work to service modules, and serializes responses for the browser.
    """

    server_version = "FundSimulator/1.0"

    def do_GET(self) -> None:
        """Route read-only browser/API requests."""
        endpoint = self.path.split("?", 1)[0]
        if endpoint == "/":
            self._send_file(ROOT / "index.html")
            return
        if endpoint == "/api/fund-data":
            self._send_saved_fund_data()
            return
        if endpoint == "/api/fund-data/quality":
            self._send_json({"ok": True, **db_quality_summary()})
            return
        if endpoint == "/api/update-fund-data/status":
            self._send_json({"ok": True, **get_update_job()})
            return

        self._send_static_asset(endpoint)

    def do_HEAD(self) -> None:
        """Serve HEAD for static files without reading application state."""
        endpoint = self.path.split("?", 1)[0]
        if endpoint == "/":
            self._send_file(ROOT / "index.html", include_body=False)
            return
        self._send_static_asset(endpoint, include_body=False)

    def do_POST(self) -> None:
        """Route mutating API requests."""
        endpoint = self.path.split("?", 1)[0]
        if endpoint == "/api/save-simulation":
            self._save_simulation()
            return
        if endpoint == "/api/update-fund-data":
            self._update_fund_data()
            return
        self._send_json({"error": "Not found"}, status=404)

    def _send_static_asset(self, endpoint: str, include_body: bool = True) -> None:
        """Resolve and return files under the project root only."""
        requested = unquote(endpoint).lstrip("/")
        target = (ROOT / requested).resolve()
        if ROOT not in target.parents and target != ROOT:
            self._send_json({"error": "Invalid path"}, status=403, include_body=include_body)
            return
        if target.is_file():
            self._send_file(target, include_body=include_body)
            return
        self._send_json({"error": "Not found"}, status=404, include_body=include_body)

    def _send_saved_fund_data(self) -> None:
        """Return fund data from SQLite first, then JSON fallback."""
        quality = db_quality_summary()
        last_run = quality.get("lastRun") if quality.get("exists") else None
        db_start = last_run.get("start_date") if isinstance(last_run, dict) else None
        db_end = last_run.get("end_date") if isinstance(last_run, dict) else None
        db_funds = load_funds_from_db(db_start, db_end)
        if db_funds:
            months = (
                months_between(db_start, db_end)
                if db_start and db_end
                else sorted({row[0][:7] for fund in db_funds for row in fund["nav"]})
            )
            try:
                aligned, warnings = align_funds_to_requested_months(db_funds, months)
            except Exception:
                aligned, warnings = db_funds, []
            self._send_json(
                {
                    "ok": True,
                    "updatedAt": datetime.now().isoformat(timespec="seconds"),
                    "source": f"{ONLINE_DATA_SOURCE}（SQLite 本地缓存）",
                    "indicator": AKSHARE_INDICATOR,
                    "fundCount": len(aligned),
                    "warningCount": len(warnings),
                    "warnings": warnings[:500],
                    "storage": "sqlite",
                    "path": str(FUND_DB_PATH),
                    "funds": aligned,
                }
            )
            return

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
        """Read and validate a JSON object request body."""
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Payload must be a JSON object")
        return payload

    def _save_simulation(self) -> None:
        """Persist one simulation result as a timestamped JSON file."""
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
        """Validate update options and queue the AKShare worker process."""
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
        """Use a stable prefix for local server access logs."""
        print(f"[fund-simulator] {self.address_string()} - {format % args}")

    def _send_file(self, path: Path, include_body: bool = True) -> None:
        """Send a static file with a best-effort content type."""
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)

    def _send_json(self, payload: dict, status: int = 200, include_body: bool = True) -> None:
        """Serialize API responses as UTF-8 JSON."""
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if include_body:
            self.wfile.write(data)


def detect_lan_ip() -> str | None:
    """Best-effort detection of the LAN IP that other devices can visit."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            return probe.getsockname()[0]
    except OSError:
        return None


def run() -> None:
    """Start the HTTP server for local and LAN browser access."""
    port = 8765
    local_url = f"http://127.0.0.1:{port}"
    lan_ip = detect_lan_ip()
    server = ThreadingHTTPServer(("0.0.0.0", port), FundSimulatorHandler)
    threading.Timer(0.6, lambda: webbrowser.open(local_url)).start()
    print(f"基金模拟交易系统已启动：{local_url}")
    if lan_ip:
        print(f"局域网访问地址：http://{lan_ip}:{port}")
    else:
        print(f"局域网访问地址：http://你的IPv4地址:{port}（可用 ipconfig 查看 IPv4 地址）")
    print("按 Ctrl+C 停止服务。")
    server.serve_forever()


if __name__ == "__main__":
    run()
