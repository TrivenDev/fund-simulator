from __future__ import annotations

import site
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SAVE_DIR = ROOT / "saved-simulations"
DATA_DIR = ROOT / "data"
FUND_DATA_PATH = DATA_DIR / "funds.json"
FUND_DB_PATH = DATA_DIR / "funds.db"
UPDATE_STATUS_PATH = DATA_DIR / "update-status.json"
WORKER_PATH = ROOT / "fund_data_worker.py"

ONLINE_DATA_SOURCE = "AKShare 全市场公募基金数据（fund_name_em + fund_open_fund_info_em，底层数据源为东方财富）"
AKSHARE_INDICATOR = "单位净值走势"
EXCLUDE_NAME_KEYWORDS = ("货币", "现金", "理财", "同业存单")
DEFAULT_SCAN_LIMIT = 1000
MAX_SCAN_LIMIT = 2000


def configure_python_paths() -> None:
    """Add local vendored dependency directories before importing optional packages."""
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
