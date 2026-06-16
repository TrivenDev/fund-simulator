from __future__ import annotations

import sqlite3
from datetime import datetime

from config import DATA_DIR, FUND_DB_PATH, ONLINE_DATA_SOURCE


def connect_fund_db() -> sqlite3.Connection:
    """Open the local SQLite cache with settings suitable for incremental writes."""
    DATA_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(FUND_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_fund_db(conn: sqlite3.Connection) -> None:
    """Create tables used by fund metadata, monthly NAV data, and update jobs."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS funds (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT,
          sector TEXT,
          risk TEXT,
          source TEXT,
          last_status TEXT,
          last_error TEXT,
          last_start_date TEXT,
          last_end_date TEXT,
          updated_at TEXT
        );

        CREATE TABLE IF NOT EXISTS fund_nav (
          code TEXT NOT NULL,
          date TEXT NOT NULL,
          nav REAL NOT NULL,
          PRIMARY KEY (code, date)
        );

        CREATE INDEX IF NOT EXISTS idx_fund_nav_code_date ON fund_nav(code, date);

        CREATE TABLE IF NOT EXISTS update_runs (
          job_id TEXT PRIMARY KEY,
          status TEXT,
          start_date TEXT,
          end_date TEXT,
          total INTEGER DEFAULT 0,
          scanned INTEGER DEFAULT 0,
          success INTEGER DEFAULT 0,
          failed INTEGER DEFAULT 0,
          started_at TEXT,
          finished_at TEXT,
          message TEXT
        );
        """
    )
    conn.commit()


def save_update_run(conn: sqlite3.Connection, job_id: str | None, **fields: object) -> None:
    """Upsert background update progress so interrupted runs can be inspected."""
    if not job_id:
        return
    row = {
        "job_id": job_id,
        "status": fields.get("status"),
        "start_date": fields.get("start_date"),
        "end_date": fields.get("end_date"),
        "total": fields.get("total"),
        "scanned": fields.get("scanned"),
        "success": fields.get("success"),
        "failed": fields.get("failed"),
        "started_at": fields.get("started_at"),
        "finished_at": fields.get("finished_at"),
        "message": fields.get("message"),
    }
    conn.execute(
        """
        INSERT INTO update_runs (
          job_id, status, start_date, end_date, total, scanned, success, failed,
          started_at, finished_at, message
        )
        VALUES (
          :job_id, :status, :start_date, :end_date, :total, :scanned, :success, :failed,
          :started_at, :finished_at, :message
        )
        ON CONFLICT(job_id) DO UPDATE SET
          status=COALESCE(excluded.status, update_runs.status),
          start_date=COALESCE(excluded.start_date, update_runs.start_date),
          end_date=COALESCE(excluded.end_date, update_runs.end_date),
          total=COALESCE(excluded.total, update_runs.total),
          scanned=COALESCE(excluded.scanned, update_runs.scanned),
          success=COALESCE(excluded.success, update_runs.success),
          failed=COALESCE(excluded.failed, update_runs.failed),
          started_at=COALESCE(excluded.started_at, update_runs.started_at),
          finished_at=COALESCE(excluded.finished_at, update_runs.finished_at),
          message=COALESCE(excluded.message, update_runs.message)
        """,
        row,
    )
    conn.commit()


def upsert_fund_metadata(
    conn: sqlite3.Connection,
    fund: dict,
    status: str,
    start_date: str,
    end_date: str,
    error: str | None = None,
) -> None:
    """Persist one fund's metadata and latest fetch status."""
    conn.execute(
        """
        INSERT INTO funds (
          code, name, type, sector, risk, source, last_status, last_error,
          last_start_date, last_end_date, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          name=excluded.name,
          type=excluded.type,
          sector=excluded.sector,
          risk=excluded.risk,
          source=excluded.source,
          last_status=excluded.last_status,
          last_error=excluded.last_error,
          last_start_date=excluded.last_start_date,
          last_end_date=excluded.last_end_date,
          updated_at=excluded.updated_at
        """,
        (
            fund["code"],
            fund["name"],
            fund.get("type", ""),
            fund.get("sector", ""),
            fund.get("risk", ""),
            ONLINE_DATA_SOURCE,
            status,
            error,
            start_date,
            end_date,
            datetime.now().isoformat(timespec="seconds"),
        ),
    )


def save_fund_to_db(conn: sqlite3.Connection, fund: dict, nav: list[list[object]], start_date: str, end_date: str) -> None:
    """Write one fund's monthly NAV rows immediately after a successful fetch."""
    upsert_fund_metadata(conn, fund, "success", start_date, end_date)
    conn.executemany(
        """
        INSERT INTO fund_nav(code, date, nav)
        VALUES (?, ?, ?)
        ON CONFLICT(code, date) DO UPDATE SET nav=excluded.nav
        """,
        [(fund["code"], str(date), float(value)) for date, value in nav],
    )
    conn.commit()


def mark_fund_failed(conn: sqlite3.Connection, fund: dict, start_date: str, end_date: str, error: str) -> None:
    """Record failed fetches without aborting the whole market update."""
    upsert_fund_metadata(conn, fund, "failed", start_date, end_date, error=error[:1000])
    conn.commit()


def cached_fund_from_db(conn: sqlite3.Connection, fund: dict, start_date: str, end_date: str) -> dict | None:
    """Return cached NAV when the database already covers the requested date range."""
    row = conn.execute(
        "SELECT last_status, last_start_date, last_end_date FROM funds WHERE code = ?",
        (fund["code"],),
    ).fetchone()
    if not row or row["last_status"] != "success":
        return None
    if not row["last_start_date"] or not row["last_end_date"]:
        return None
    if row["last_start_date"] > start_date or row["last_end_date"] < end_date:
        return None

    nav_rows = conn.execute(
        """
        SELECT date, nav
        FROM fund_nav
        WHERE code = ? AND date >= ? AND date <= ?
        ORDER BY date
        """,
        (fund["code"], start_date, end_date),
    ).fetchall()
    if len(nav_rows) < 2:
        return None
    return {**fund, "nav": [[row["date"], round(float(row["nav"]), 6)] for row in nav_rows]}


def load_funds_from_db(start_date: str | None = None, end_date: str | None = None) -> list[dict]:
    """Load successful funds from SQLite in the front-end compatible JSON shape."""
    if not FUND_DB_PATH.exists():
        return []
    with connect_fund_db() as conn:
        init_fund_db(conn)
        fund_rows = conn.execute(
            """
            SELECT code, name, type, sector, risk
            FROM funds
            WHERE last_status = 'success'
            ORDER BY CASE WHEN type = 'C' THEN 0 ELSE 1 END, code
            """
        ).fetchall()
        funds = []
        for fund_row in fund_rows:
            params: list[object] = [fund_row["code"]]
            where = "WHERE code = ?"
            if start_date:
                where += " AND date >= ?"
                params.append(start_date)
            if end_date:
                where += " AND date <= ?"
                params.append(end_date)
            nav_rows = conn.execute(f"SELECT date, nav FROM fund_nav {where} ORDER BY date", params).fetchall()
            if len(nav_rows) < 2:
                continue
            funds.append(
                {
                    "code": fund_row["code"],
                    "name": fund_row["name"],
                    "type": fund_row["type"] or "未知",
                    "sector": fund_row["sector"] or "其他",
                    "risk": fund_row["risk"] or "未知",
                    "nav": [[row["date"], round(float(row["nav"]), 6)] for row in nav_rows],
                }
            )
        return funds


def db_quality_summary() -> dict:
    """Summarize the local SQLite cache for diagnostics and the data-quality API."""
    if not FUND_DB_PATH.exists():
        return {"exists": False, "path": str(FUND_DB_PATH)}
    with connect_fund_db() as conn:
        init_fund_db(conn)
        fund_count = conn.execute("SELECT COUNT(*) AS count FROM funds").fetchone()["count"]
        success_count = conn.execute("SELECT COUNT(*) AS count FROM funds WHERE last_status = 'success'").fetchone()["count"]
        failed_count = conn.execute("SELECT COUNT(*) AS count FROM funds WHERE last_status = 'failed'").fetchone()["count"]
        nav_count = conn.execute("SELECT COUNT(*) AS count FROM fund_nav").fetchone()["count"]
        range_row = conn.execute("SELECT MIN(date) AS start_date, MAX(date) AS end_date FROM fund_nav").fetchone()
        last_run = conn.execute(
            "SELECT * FROM update_runs WHERE status = 'complete' ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 1"
        ).fetchone()
        return {
            "exists": True,
            "path": str(FUND_DB_PATH),
            "fundCount": fund_count,
            "successCount": success_count,
            "failedCount": failed_count,
            "navCount": nav_count,
            "startDate": range_row["start_date"],
            "endDate": range_row["end_date"],
            "lastRun": dict(last_run) if last_run else None,
        }
