from __future__ import annotations

import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Update fund NAV data with AKShare.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--start-month", required=True)
    parser.add_argument("--end-month", required=True)
    parser.add_argument("--max-funds", type=int, default=0)
    parser.add_argument("--include-money-funds", action="store_true")
    args = parser.parse_args()

    def progress(**fields: object) -> None:
        server.set_update_job(jobId=args.job_id, status="running", **fields)

    try:
        progress(message="基金净值更新 worker 已启动", progress=0)
        result = server.update_fund_data(
            server.month_start(args.start_month),
            server.month_end(args.end_month),
            include_money_funds=args.include_money_funds,
            max_funds=args.max_funds,
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
            "path": str(server.FUND_DATA_PATH),
        }
        server.set_update_job(
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
        server.set_update_job(
            jobId=args.job_id,
            status="error",
            phase="error",
            message="更新失败",
            error=str(exc),
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
