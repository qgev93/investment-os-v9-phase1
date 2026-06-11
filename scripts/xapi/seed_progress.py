"""
Create a safe incremental progress file for GitHub Actions.

This does not contain raw posts or paid data. It marks historical ranges as
already handled up to the first day of the current month, so the first cloud
run collects only the current month instead of doing a full backfill.
"""

import json
from datetime import datetime


ACCOUNTS = {
    "LNCV34": "2021-05-01",
    "min_anko38": "2024-01-01",
    "Alisvolatprop12": "2020-09-01",
}

PROGRESS_FILE = "progress.json"


def main():
    current_month_start = datetime.today().replace(day=1).strftime("%Y-%m-%d")
    progress = {
        "completed_ranges": {account: [[start, current_month_start]] for account, start in ACCOUNTS.items()},
        "completed_until": {account: current_month_start for account in ACCOUNTS},
        "posts": {account: [] for account in ACCOUNTS},
        "seeded_incremental": True,
        "seeded_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False, indent=2)
    print(f"Seeded incremental progress at {PROGRESS_FILE}; first run starts from {current_month_start}.")


if __name__ == "__main__":
    main()
