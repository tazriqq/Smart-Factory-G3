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
#   Daily_Report one row per line per day for managers: OEE (A, P, Q), output and QC per product, run / stop /
#               alarm time, best and worst machine, change from the day before (see daily_reports)
# Every day at REPORT_AT (Thailand time) the day's report also goes to LINE (Messaging API: LINE_CHANNEL_TOKEN,
# to LINE_TO, or to every friend of the LINE Official Account when LINE_TO is empty). A report the server missed
# while it was off goes out late. By hand:  python /sync.py report [YYYY-MM-DD]   (prints it)
#                                            python /sync.py report-send [YYYY-MM-DD]   (also sends it to LINE)
# No tab gets more than SHEETS_MAX_ROWS rows: the newest are kept, the oldest drop off (first in, first out), so
# the sheet stays small however long the line runs. The database keeps everything.

import datetime as dt
import json
import os
import sys
import time
import urllib.request
from decimal import Decimal
from zoneinfo import ZoneInfo

import psycopg

DB = os.environ["DATABASE_URI"]
URL = os.environ.get("SHEETS_URL", "").strip()
KEY = os.environ.get("SHEETS_KEY", "").strip()
EVERY = max(1, int(os.environ.get("SHEETS_EVERY_MIN", "15"))) * 60
HOURLY_DAYS = int(os.environ.get("SHEETS_HOURLY_DAYS", "14"))
EVENTS_ROWS = int(os.environ.get("SHEETS_EVENTS_ROWS", "500"))
EVENTS_GAP = max(5, int(os.environ.get("SHEETS_EVENTS_GAP_S", "10")))
MAX_ROWS = max(10, int(os.environ.get("SHEETS_MAX_ROWS", "1000")))
REPORT_AT = os.environ.get("REPORT_AT", "23:55")
LINE_TOKEN = os.environ.get("LINE_CHANNEL_TOKEN", "").strip()
LINE_TO = [x.strip() for x in os.environ.get("LINE_TO", "").split(",") if x.strip()]
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "").strip()
REPORT_STATE = "/state/last_report"   # the last day whose report went out
TH = ZoneInfo("Asia/Bangkok")

RATIOS = "availability, performance, quality, oee"
STAMP = "YYYY-MM-DD HH24:MI:SS:MS"   # every time in the sheet and in this log: 2026-10-30 14:05:09:123
TABS = {
    "OEE_Daily": f"""
        SELECT to_char(day::timestamp, '{STAMP}') AS date, line, machine, product, name, logged_min, run_min, stop_min, alarm_min,
               parts, ideal_cycle_s, good, reject, {RATIOS}
        FROM oee_daily ORDER BY day, line, machine""",
    "OEE_Hourly": f"""
        SELECT to_char(period_start, '{STAMP}') AS hour, line, machine, product, name, logged_min, run_min,
               stop_min, alarm_min, parts, ideal_cycle_s, good, reject, {RATIOS}
        FROM oee('1 hour', date_trunc('day', now()) - make_interval(days => %s)) ORDER BY 1, 2, 3""",
    "Products": f"""
        SELECT to_char(day::timestamp, '{STAMP}') AS date, line, product, code, name, output, good, reject, quality
        FROM product_daily ORDER BY day, line, product""",
    "Machines": "SELECT line, machine, name, ideal_cycle_s FROM machines ORDER BY line, machine",
    "Events": f"""
        SELECT to_char(e.time, '{STAMP}') AS time, e.line, e.machine,
               CASE WHEN e.machine = 0 THEN 'whole line' ELSE m.name END AS name, e.event, e.product, e.route,
               coalesce(e.source, 'board') AS source
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


# ---------------------------------------------------------------- the daily report

REPORT_HEADER = ["date", "line", "status", "oee", "availability", "performance", "quality",
                 "output", "good", "reject", "run_h", "stop_h", "alarm_min", "alarms",
                 "best_machine", "best_oee", "worst_machine", "worst_oee", "products", "oee_vs_day_before", "output_vs_day_before"]


def daily_reports(conn):
    """{(day, line): report}, every day there is data for, from the board's rows only"""
    cur = conn.cursor()
    cur.execute("""SELECT day, line, machine, name, sum(logged_min), sum(run_min), sum(stop_min), sum(alarm_min),
                          sum(ideal_cycle_s * parts) / 60, product, sum(parts)
                   FROM oee_daily GROUP BY day, line, machine, name, product""")
    machines = {}
    for day, line, mach, name, logged, run, stop, alarm, ideal_min, prod, parts in cur.fetchall():
        m = machines.setdefault((day, line), {}).setdefault(mach, {"name": name, "logged": 0, "run": 0, "stop": 0, "alarm": 0, "ideal": 0, "prod": {}})
        m["logged"] += float(logged or 0); m["run"] += float(run or 0); m["stop"] += float(stop or 0)
        m["alarm"] += float(alarm or 0); m["ideal"] += float(ideal_min or 0)
        if prod:
            m["prod"][prod] = m["prod"].get(prod, 0) + int(parts or 0)
    cur.execute("SELECT day, line, product, code, name, output, good, reject FROM product_daily")
    products = {}
    for day, line, prod, code, name, out, good, rej in cur.fetchall():
        products.setdefault((day, line), {})[prod] = {"code": code or "", "name": name or "", "output": out, "good": good, "reject": rej}
    cur.execute("""SELECT (time AT TIME ZONE 'Asia/Bangkok')::date, line, count(*) FROM events
                   WHERE event = 'alarm_on' AND source IS DISTINCT FROM 'website' GROUP BY 1, 2""")
    alarms = {(d, l): n for d, l, n in cur.fetchall()}
    reports = {}
    for key in sorted(set(machines) | set(products)):
        ms, ps = machines.get(key, {}), products.get(key, {})
        logged = sum(m["logged"] for m in ms.values()); run = sum(m["run"] for m in ms.values())
        good = sum(p["good"] for p in ps.values()); rej = sum(p["reject"] for p in ps.values())
        a = run / logged if logged else None
        p_ = min(1.0, sum(m["ideal"] for m in ms.values()) / run) if run else None
        q = good / (good + rej) if good + rej else None
        oee = a * p_ * q if None not in (a, p_, q) else None
        # each machine: its own A and P, and the quality of the product it made most of (else the line's)
        per = []
        for no, m in ms.items():
            if m["logged"] < 1:
                continue
            ma = m["run"] / m["logged"]; mp = min(1.0, m["ideal"] / m["run"]) if m["run"] else 0.0
            main = max(m["prod"], key=m["prod"].get) if m["prod"] else None
            pq = ps.get(main) if main else None
            mq = pq["good"] / (pq["good"] + pq["reject"]) if pq and pq["good"] + pq["reject"] else (q if q is not None else 1.0)
            per.append((ma * mp * mq, m["name"]))
        per.sort()
        reports[key] = {"day": key[0], "line": key[1], "oee": oee, "a": a, "p": p_, "q": q,
                        "output": sum(p["output"] for p in ps.values()), "good": good, "reject": rej,
                        "run_h": run / 60, "stop_h": sum(m["stop"] for m in ms.values()) / 60,
                        "alarm_min": sum(m["alarm"] for m in ms.values()), "alarms": alarms.get(key, 0),
                        "best": per[-1] if per else None, "worst": per[0] if len(per) > 1 else None, "products": ps}
    # change from the day before (the same line)
    for (day, line), r in reports.items():
        before = reports.get((day - dt.timedelta(days=1), line))
        r["oee_delta"] = (r["oee"] - before["oee"]) if before and r["oee"] is not None and before["oee"] is not None else None
        r["output_delta"] = (r["output"] - before["output"]) if before else None
    return reports


def product_text(ps):
    return " · ".join(f"{k} {(v['code'] + ' ' + v['name']).strip() or 'product ' + k}: {v['output']} ชิ้น (ดี {v['good']} เสีย {v['reject']})"
                      for k, v in sorted(ps.items()))


def report_rows(conn):
    today = dt.datetime.now(TH).date()
    rows = []
    for r in daily_reports(conn).values():
        r4 = lambda x: round(x, 4) if x is not None else ""
        rows.append([dt.datetime.combine(r["day"], dt.time()).strftime("%Y-%m-%d %H:%M:%S:000"), r["line"],
                     "final" if r["day"] < today else "today so far",
                     r4(r["oee"]), r4(r["a"]), r4(r["p"]), r4(r["q"]), r["output"], r["good"], r["reject"],
                     round(r["run_h"], 2), round(r["stop_h"], 2), round(r["alarm_min"], 1), r["alarms"],
                     r["best"][1] if r["best"] else "", r4(r["best"][0]) if r["best"] else "",
                     r["worst"][1] if r["worst"] else "", r4(r["worst"][0]) if r["worst"] else "",
                     product_text(r["products"]), r4(r["oee_delta"]), r["output_delta"] if r["output_delta"] is not None else ""])
    return rows[-MAX_ROWS:]


def report_message(r):
    pct = lambda x: "—" if x is None else f"{x * 100:.0f}%"
    lines = [f"📊 สรุปประจำวัน {r['day'].strftime('%d/%m/%Y')} · {r['line']}",
             f"OEE {pct(r['oee'])}  (A {pct(r['a'])} · P {pct(r['p'])} · Q {pct(r['q'])})"
             + (f"  {'▲' if r['oee_delta'] >= 0 else '▼'} {abs(r['oee_delta']) * 100:.0f} จุดจากเมื่อวาน" if r["oee_delta"] is not None else "")]
    if r["products"]:
        lines.append("ผลผลิต:")
        for k, v in sorted(r["products"].items()):
            tot = v["good"] + v["reject"]
            lines.append(f"• {k} {(v['code'] + ' ' + v['name']).strip() or 'product ' + k}: {v['output']} ชิ้น · ดี {v['good']} · เสีย {v['reject']}"
                         + (f" · yield {v['good'] / tot * 100:.0f}%" if tot else ""))
    else:
        lines.append("ผลผลิต: ไม่มีชิ้นงานออกจากไลน์")
    if r["output_delta"] is not None:
        lines.append(f"รวม {r['output']} ชิ้น ({'+' if r['output_delta'] >= 0 else ''}{r['output_delta']} จากเมื่อวาน)")
    lines.append(f"เดินเครื่อง {r['run_h']:.1f} ชม. · หยุด {r['stop_h']:.1f} ชม. · alarm {r['alarm_min']:.0f} นาที ({r['alarms']} ครั้ง)")
    if r["best"]:
        lines.append(f"เครื่องดีสุด {r['best'][1]} {pct(r['best'][0])}" + (f" · ต่ำสุด {r['worst'][1]} {pct(r['worst'][0])}" if r["worst"] else ""))
    if DASHBOARD_URL:
        lines.append(DASHBOARD_URL)
    return "\n".join(lines)


def line_send(text):
    """LINE Messaging API: push to each LINE_TO id, or broadcast to every friend of the account"""
    targets = LINE_TO or [None]
    for to in targets:
        body = {"messages": [{"type": "text", "text": text[:5000]}]}
        if to:
            body["to"] = to
        url = "https://api.line.me/v2/bot/message/" + ("push" if to else "broadcast")
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + LINE_TOKEN})
        with urllib.request.urlopen(req, timeout=30) as r:
            r.read()


def report_due():
    """the day whose report should go out now, if it hasn't yet: today after REPORT_AT, else yesterday"""
    now = dt.datetime.now(TH)
    hh, mm = (int(x) for x in REPORT_AT.split(":"))
    target = now.date() if now.time() >= dt.time(hh, mm) else now.date() - dt.timedelta(days=1)
    try:
        last = dt.date.fromisoformat(open(REPORT_STATE).read().strip())
    except (OSError, ValueError):
        last = None
    return target if last is None or last < target else None


def send_report(day, to_line=True):
    with psycopg.connect(DB) as conn:
        reports = [r for (d, _), r in daily_reports(conn).items() if d == day]
    if not reports:
        print(f"sheets-sync: report {day}: no data that day", flush=True)
    for r in reports:
        text = report_message(r)
        if to_line and LINE_TOKEN:
            line_send(text)
            print(f"sheets-sync: report {day} {r['line']} sent to LINE", flush=True)
        elif to_line:
            print(f"sheets-sync: report {day} ready (LINE_CHANNEL_TOKEN not set, not sent to LINE)", flush=True)
    return reports


def read_tabs(names):
    tabs = {}
    with psycopg.connect(DB) as conn, conn.cursor() as cur:
        for name in names:
            if name == "Daily_Report":
                tabs[name] = {"header": REPORT_HEADER, "rows": report_rows(conn)}
                continue
            sql = TABS[name]
            cur.execute(sql, (PARAMS[name],) if name in PARAMS else None)
            rows = [[plain(v) for v in row] for row in cur.fetchall()]
            # keep the newest: Events comes newest first, the other tabs oldest first
            if len(rows) > MAX_ROWS:
                rows = rows[:MAX_ROWS] if name == "Events" else rows[-MAX_ROWS:]
            tabs[name] = {"header": [c.name for c in cur.description], "rows": rows}
        cur.execute(f"SELECT to_char(now(), '{STAMP}')")
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
    if len(sys.argv) > 1 and sys.argv[1] in ("report", "report-send"):
        day = dt.date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else dt.datetime.now(TH).date()
        for r in send_report(day, to_line=sys.argv[1] == "report-send"):
            print(report_message(r))
        return
    sheets = bool(URL and KEY)
    if not sheets:
        print("sheets-sync: SHEETS_URL / SHEETS_KEY not set in .env: no Google Sheet (the LINE report still runs)", flush=True)
    # every EVERY seconds: all tabs; in between, only Events, whenever a new event has arrived
    next_full, seen = 0.0, None
    while True:
        try:
            now = time.monotonic()
            day = report_due()
            if day:
                send_report(day)
                os.makedirs(os.path.dirname(REPORT_STATE), exist_ok=True)
                open(REPORT_STATE, "w").write(day.isoformat())
                next_full = 0   # the sheet's Daily_Report now too
            if not sheets:
                time.sleep(EVENTS_GAP)
                continue
            latest = latest_event()
            if now >= next_full:
                names = list(TABS) + ["Daily_Report"]
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
