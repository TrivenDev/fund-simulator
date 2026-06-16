from __future__ import annotations

import json
import subprocess
import sys
import threading
from datetime import datetime

from config import DATA_DIR, FUND_DATA_PATH, FUND_DB_PATH, UPDATE_STATUS_PATH, WORKER_PATH
from fund_data import month_end, month_start, update_fund_data


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
    """Persist update-job state for polling and worker crash recovery."""
    with UPDATE_LOCK:
        UPDATE_JOB.update(fields)
        UPDATE_JOB["updatedAt"] = datetime.now().isoformat(timespec="seconds")
        DATA_DIR.mkdir(exist_ok=True)
        temp_path = UPDATE_STATUS_PATH.with_suffix(".tmp")
        temp_path.write_text(json.dumps(UPDATE_JOB, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(UPDATE_STATUS_PATH)


def get_update_job() -> dict:
    """Return current update state, merging disk state written by a worker process."""
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


def run_update_job(job_id: str, options: dict) -> None:
    """Run an update in-process; kept for tests and non-subprocess execution."""
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
            job_id=job_id,
        )
        summary = update_result_summary(result)
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
        set_update_job(jobId=job_id, status="error", phase="error", message="更新失败", error=str(exc))


def update_result_summary(result: dict) -> dict:
    """Reduce a full update payload to the fields needed by the polling UI."""
    return {
        "ok": True,
        "updatedAt": result["updatedAt"],
        "source": result["source"],
        "indicator": result["indicator"],
        "startDate": result["startDate"],
        "endDate": result["endDate"],
        "catalogCount": result["catalogCount"],
        "scannedCount": result["scannedCount"],
        "cachedCount": result.get("cachedCount", 0),
        "fundCount": result["fundCount"],
        "excludedMoneyFundCount": result["excludedMoneyFundCount"],
        "warningCount": result["warningCount"],
        "warnings": result["warnings"][:20],
        "durationSeconds": result["durationSeconds"],
        "path": str(FUND_DATA_PATH),
        "databasePath": str(FUND_DB_PATH),
    }


def start_update_job(options: dict) -> dict:
    """Start the AKShare update in a separate process to isolate native crashes."""
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
        cwd=str(DATA_DIR.parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
    )
    return get_update_job()
