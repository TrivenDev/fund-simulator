from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import FUND_DATA_PATH, FUND_DB_PATH  # noqa: E402
from fund_data import month_end, month_start, update_fund_data  # noqa: E402
from jobs import set_update_job, update_result_summary  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Update fund NAV data with AKShare.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--start-month", required=True)
    parser.add_argument("--end-month", required=True)
    parser.add_argument("--max-funds", type=int, default=0)
    parser.add_argument("--include-money-funds", action="store_true")
    args = parser.parse_args()

    def progress(**fields: object) -> None:
        """Mirror worker progress to the status file polled by the browser."""
        set_update_job(jobId=args.job_id, status="running", **fields)

    try:
        progress(message="基金净值更新 worker 已启动", progress=0)
        result = update_fund_data(
            month_start(args.start_month),
            month_end(args.end_month),
            include_money_funds=args.include_money_funds,
            max_funds=args.max_funds,
            progress_callback=progress,
            job_id=args.job_id,
        )
        summary = update_result_summary(result)
        # Keep explicit paths in the worker summary to make status logs actionable.
        summary["path"] = str(FUND_DATA_PATH)
        summary["databasePath"] = str(FUND_DB_PATH)
        set_update_job(
            jobId=args.job_id,
            status="complete",
            phase="complete",
            message=f"更新完成，可回测基金 {summary['fundCount']} 只",
            progress=100,
            result=summary,
            error=None,
        )
        return 0
    except Exception as exc:
        set_update_job(
            jobId=args.job_id,
            status="error",
            phase="error",
            message="更新失败",
            error=str(exc),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
