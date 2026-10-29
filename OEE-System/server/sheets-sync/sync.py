# sync.py  -  copies the OEE summary from the database to the Google Sheet every SHEETS_EVERY_MIN minutes.
#
# The database is the main store; the sheet only holds the summary, so people can open it and Claude on
# claude.ai can read it through Google Drive. Each run replaces these tabs (google-sheets/sheets_webapp.gs):
#   OEE_Daily   one row per machine per day, all history
#   OEE_Hourly  one row per machine per hour, last SHEETS_HOURLY_DAYS days
#   Products    one row per product per day: output, QC good / reject, quality, all history
#   Machines    names and ideal_cycle_s (edit them in the database, not in the sheet)
#   Events      the last SHEETS_EVENTS_ROWS button / switch presses, newest first; sent again within
#               ~SHEETS_EVENTS_GAP_S seconds of a new one, so a press can be seen in the sheet straight away
# No tab gets more than SHEETS_MAX_ROWS rows: the newest are kept, the oldest drop off (first in, first out), so
# the sheet stays small however long the line runs. The database keeps everything.

import json
import os
import sys
import time
import urllib.request
from decimal import Decimal

import psycopg

DB = os.environ["DATABASE_URI"]
URL = os.environ.get("SHEETS_URL", "").strip()
KEY = os.environ.get("SHEETS_KEY", "").strip()
EVERY = max(1, int(os.environ.get("SHEETS_EVERY_MIN", "15"))) * 60
HOURLY_DAYS = int(os.environ.get("SHEETS_HOURLY_DAYS", "14"))
EVENTS_ROWS = int(os.environ.get("SHEETS_EVENTS_ROWS", "500"))
EVENTS_GAP = max(5, int(os.environ.get("SHEETS_EVENTS_GAP_S", "10")))
MAX_ROWS = max(10, int(os.environ.get("SHEETS_MAX_ROWS", "1000")))

RATIOS = "availability, performance, quality, oee"
TABS = {
    "OEE_Daily": f"""
        SELECT to_char(day, 'YYYY-MM-DD') AS date, line, machine, product, name, logged_min, run_min, stop_min, alarm_min,
               parts, ideal_cycle_s, good, reject, {RATIOS}
        FROM oee_daily ORDER BY day, line, machine""",
    "OEE_Hourly": f"""
        SELECT to_char(period_start, 'YYYY-MM-DD HH24:MI') AS hour, line, machine, product, name, logged_min, run_min,
               stop_min, alarm_min, parts, ideal_cycle_s, good, reject, {RATIOS}
        FROM oee('1 hour', date_trunc('day', now()) - make_interval(days => %s)) ORDER BY 1, 2, 3""",
    "Products": """
        SELECT to_char(day, 'YYYY-MM-DD') AS date, line, product, output, good, reject, quality
        FROM product_daily ORDER BY day, line, product""",
    "Machines": "SELECT line, machine, name, ideal_cycle_s FROM machines ORDER BY line, machine",
    "Events": """
        SELECT to_char(e.time, 'YYYY-MM-DD HH24:MI:SS') AS time, e.line, e.machine,
               CASE WHEN e.machine = 0 THEN 'whole line' ELSE m.name END AS name, e.event, e.product, e.route
        FROM events e LEFT JOIN machines m ON m.line = e.line AND m.machine = e.machine
        ORDER BY e.time DESC LIMIT %s""",
}
PARAMS = {"OEE_Hourly": HOURLY_DAYS, "Events": EVENTS_ROWS}
LATEST_EVENT = "SELECT count(*), max(time) FROM events"


def plain(v):
    if isinstance(v, Decimal):
        return float(v)
    return "" if v is None else v


def latest_event():
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        cur.execute(LATEST_EVENT)
        return cur.fetchone()


def read_tabs(names):
    tabs = {}
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        for name in names:
            sql = TABS[name]
            cur.execute(sql, (PARAMS[name],) if name in PARAMS else None)
            rows = [[plain(v) for v in row] for row in cur.fetchall()]
            # keep the newest: Events comes newest first, the other tabs oldest first
            if len(rows) > MAX_ROWS:
                rows = rows[:MAX_ROWS] if name == "Events" else rows[-MAX_ROWS:]
            tabs[name] = {"header": [c.name for c in cur.description], "rows": rows}
        cur.execute("SELECT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')")
        updated = cur.fetchone()[0]
    return tabs, updated


def send(tabs, updated):
    body = json.dumps({"key": KEY, "updated": updated, "tabs": tabs}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
    # Apps Script answers 302; urllib follows it with a GET, which is what Google wants
    with urllib.request.urlopen(req, timeout=60) as r:
        reply = r.read().decode(errors="replace")
    if not reply.startswith("ok"):
        raise RuntimeError(reply[:200])
    return reply


def main():
    if not URL or not KEY:
        print("sheets-sync: SHEETS_URL / SHEETS_KEY not set in .env, nothing to do", flush=True)
        while True:
            time.sleep(3600)
    # every EVERY seconds: all tabs; in between, only Events, whenever a new event has arrived
    next_full, seen = 0.0, None
    while True:
        try:
            now = time.monotonic()
            latest = latest_event()
            if now >= next_full:
                names = list(TABS)
            elif latest != seen:
                names = ["Events"]
            else:
                names = []
            if names:
                tabs, updated = read_tabs(names)
                reply = send(tabs, updated)
                seen = latest
                if len(names) > 1:
                    next_full = now + EVERY
                print(f"sheets-sync: {updated} {'all tabs' if len(names) > 1 else 'Events'} {reply}", flush=True)
            time.sleep(EVENTS_GAP)
        except Exception as e:
            print(f"sheets-sync: failed, trying again in 1 minute: {e}", file=sys.stderr, flush=True)
            time.sleep(60)


if __name__ == "__main__":
    main()
