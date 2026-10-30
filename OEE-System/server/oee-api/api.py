# api.py  -  the database's OEE for the dashboard (website/index.html, tab OEE Dashboard), read only.
#
#   GET /api/db?source=board|sim|test   one line's OEE from the database: the board, the simulated line (real time),
#                                       or test (the simulated line on the control page's simulated clock);
#                                       &day=YYYY-MM-DD for another day than today (a simulated clock's day):
#     {"at", "date" (today, Thailand), "source", "line", "status": {...}, "today": [per machine and product], "hours": [today, per hour],
#      "days": [the last 14 days, the whole line], "products": [today, per product],
#      "not_recorded": [the board's gaps that day, with why: board only]}
#
# Fixed queries only (nothing from the request goes into SQL but the source and the line, as parameters), as the
# read-only user "reader". nginx passes /api/ on to it (server/nginx/default.conf). One answer per source is kept
# CACHE_S seconds, so any number of open dashboards ask the database at most once in that time.
# Line OEE = the daily report's: A = run / logged time of all machines, P = ideal time of the parts made / run time
# (at most 100 %), Q = good / (good + reject) of the products, OEE = A x P x Q.

import json
import os
import threading
import time
from datetime import date, datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import psycopg

DB = os.environ["DATABASE_URI"]
LINE_ID = os.environ.get("LINE_ID", "line1")
PORT, CACHE_S, DAYS = 8091, 30, 14
TODAY = "coalesce(%(day)s::date, (now() AT TIME ZONE 'Asia/Bangkok')::date)"   # the day shown: asked for, or today
# every query reads only the days it shows: oee() / products() with a since (and an until), not the all-history views
START = f"({TODAY}::timestamp AT TIME ZONE 'Asia/Bangkok')"                        # that day 00:00, Thailand
END = f"({START} + INTERVAL '1 day')"
DAYS_START = f"({START} - INTERVAL '{DAYS - 1} days')"
DAY = "(period_start AT TIME ZONE 'Asia/Bangkok')::date"

Q_TODAY = f"""
  SELECT machine, name, product, logged_min, run_min, stop_min, alarm_min, parts, good, reject,
         availability, performance, quality, oee
  FROM oee('1 day', {START}, {END}) WHERE line = %(line)s AND source = %(source)s ORDER BY machine, product NULLS FIRST"""
Q_HOURS = f"""
  SELECT period_start AS hour, sum(logged_min) AS logged_min, sum(run_min) AS run_min, sum(parts) AS parts
  FROM oee('1 hour', {START}, {END}) WHERE line = %(line)s AND source = %(source)s GROUP BY 1 ORDER BY 1"""
Q_DAYS = f"""
  SELECT m.day, m.logged_min, m.run_min, m.ideal_min, m.parts, coalesce(p.good, 0) AS good, coalesce(p.reject, 0) AS reject
  FROM (SELECT {DAY} AS day, sum(logged_min) AS logged_min, sum(run_min) AS run_min,
               sum(ideal_cycle_s * parts) / 60 AS ideal_min, sum(parts) AS parts
        FROM oee('1 day', {DAYS_START}, {END}) WHERE line = %(line)s AND source = %(source)s GROUP BY 1) m
  LEFT JOIN (SELECT day, sum(good) AS good, sum(reject) AS reject FROM products({DAYS_START})
             WHERE line = %(line)s AND source = %(source)s GROUP BY day) p ON p.day = m.day
  ORDER BY m.day"""
Q_PRODUCTS = f"""
  SELECT product, code, name, output, good, reject, quality
  FROM products({START}) WHERE line = %(line)s AND source = %(source)s AND day = {TODAY} ORDER BY product"""
Q_GAPS = f"""
  SELECT gap_from, gap_to, minutes, reason FROM not_recorded({START}, {END}) WHERE line = %(line)s ORDER BY gap_from"""
Q_STATUS = """
  SELECT board, last_signal, last_minute_row, last_event,
         (SELECT max(time) FROM minutes WHERE line = %(line)s AND source = 'sim') AS last_sim_minute
  FROM line_status WHERE line = %(line)s"""

cache, lock = {}, threading.Lock()


def plain(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def rows(cur, sql, args):
    cur.execute(sql, args)
    names = [c.name for c in cur.description]
    return [{k: plain(v) for k, v in zip(names, r)} for r in cur.fetchall()]


def line_oee(d):
    """the whole line's ratios for one day row"""
    a = d["run_min"] / d["logged_min"] if d["logged_min"] else None
    p = min(1.0, d["ideal_min"] / d["run_min"]) if d["run_min"] else None
    q = d["good"] / (d["good"] + d["reject"]) if d["good"] + d["reject"] else None
    return {**d, "availability": a, "performance": p, "quality": q,
            "oee": a * p * q if None not in (a, p, q) else None}


def answer(source, day=None):
    args = {"line": LINE_ID, "source": source, "day": day}
    with psycopg.connect(DB, connect_timeout=5) as conn, conn.cursor() as cur:
        cur.execute("SET TRANSACTION READ ONLY")
        status = rows(cur, Q_STATUS, args)
        cur.execute(f"SELECT now(), {TODAY}", args)
        now, today = cur.fetchone()
        return {"at": now.isoformat(), "date": today.isoformat(), "source": source, "line": LINE_ID,
                "status": status[0] if status else {},
                "today": rows(cur, Q_TODAY, args), "hours": rows(cur, Q_HOURS, args),
                "days": [line_oee(d) for d in rows(cur, Q_DAYS, args)], "products": rows(cur, Q_PRODUCTS, args),
                "not_recorded": rows(cur, Q_GAPS, args) if source == "board" else []}   # the real line = the board


def cached(source, day=None):
    key = (source, day)
    with lock:
        hit = cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_S:
            return hit[1]
        if len(cache) > 64:
            cache.clear()
    body = json.dumps(answer(source, day), separators=(",", ":")).encode()
    with lock:
        cache[key] = (time.monotonic(), body)
    return body


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        source = (q.get("source") or ["board"])[0]
        day = (q.get("day") or [None])[0]
        if day is not None and not (len(day) == 10 and day[4] == day[7] == "-" and (day[:4] + day[5:7] + day[8:]).isdigit()):
            return self.reply(400, b'{"error":"day=YYYY-MM-DD"}')
        if url.path != "/api/db" or source not in ("board", "sim", "test"):
            return self.reply(404, b'{"error":"GET /api/db?source=board, sim or test"}')
        try:
            self.reply(200, cached(source, day))
        except Exception as e:   # the database is down or starting: say so, the page keeps its last numbers
            print(f"oee-api: {type(e).__name__}: {e}", flush=True)
            self.reply(503, json.dumps({"error": "database not reachable"}).encode())

    def reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    print(f"oee-api: listening on {PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
