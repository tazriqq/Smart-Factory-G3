# oee.py  -  the OEE panel's numbers and timeline (website/js/06-zone4-oee.js), worked out from the database.
#
# The hub (hub.py) calls panel() every few seconds and posts the answer to <line>/oee (retained), so every dashboard
# shows the same numbers as the database, the Google Sheet and the daily report, and no browser keeps a record.
# The shift and the time frame are the control page's (state["shift"]), on the line's clock (real or simulated).
#
#   source  board = the ESP32 (rows without a source), test = the simulated clock's line, sim = the simulated line in
#           real time (only with SIM_RECORD_REAL=1)
#   numbers the whole line, as oee-api / the daily report: A = run / logged time of all machines, P = ideal time of
#           the parts made / run time (at most 100 %), Q = good / (good + reject) of the QC presses, OEE = A x P x Q;
#           only minutes inside the plan time (the shift without its break) and the time frame count
#   segs    [from, to, state, cause] per minute row, joined: state 1 = the line ran most of that minute, 0 = it stood
#           (cause: alarm, or each machine that stood and why, from the switch events), -1 = not recorded (the
#           board's gaps from not_recorded(), with why)
#   parts   [time, 1 good / 0 reject] of the QC presses, for the marks above the bar
#
# Times are ms since 1970 (the page's Date.now()); minutes rows carry the end of their minute.

from datetime import datetime, timezone

import psycopg

MIN = 60000
DAY = 1440 * MIN
TZ_MS = 7 * 3600 * 1000          # Thailand: UTC+7 all year, no summer time
PARTS_MAX = 2000                 # QC marks sent at most (the newest)
ROW_GAP_MS = 20000               # rows of one minute (one per machine) arrive within this of each other

Q_MINUTES = """
  SELECT (extract(epoch FROM time) * 1000)::bigint, machine::int, run_s, stop_s, alarm_s, parts, speed_pct
  FROM minutes
  WHERE line = %(line)s AND time > %(a)s AND time <= %(b)s AND coalesce(source, 'board') = %(src)s
  ORDER BY time"""
# QC presses: the board's own (no source), the control page's while the simulated clock runs (test), or in real time (website)
Q_QC = """
  SELECT (extract(epoch FROM time) * 1000)::bigint, event = 'good'
  FROM events
  WHERE line = %(line)s AND event IN ('good', 'reject') AND time > %(a)s AND time <= %(b)s
    AND coalesce(source, 'board') = %(qsrc)s
  ORDER BY time"""
# the switches that stand a machine still: each one's state when the timeline starts, then every change in it
SWITCHES = "('run_on','run_off','door_open','door_close','setup_on','setup_off','maintenance_on','maintenance_off','alarm_on','alarm_off')"
SRC_OK = "(coalesce(source, 'board') = %(qsrc)s OR (%(qsrc)s = 'board' AND source = 'website' AND event ~ '^(setup|maintenance)_'))"
Q_SWITCH_BEFORE = f"""
  SELECT DISTINCT ON (machine, split_part(event, '_', 1)) 0::bigint, machine::int, event
  FROM events
  WHERE line = %(line)s AND event IN {SWITCHES} AND time <= %(a)s AND time > %(a)s - INTERVAL '30 days' AND {SRC_OK}
  ORDER BY machine, split_part(event, '_', 1), time DESC"""
Q_SWITCH = f"""
  SELECT (extract(epoch FROM time) * 1000)::bigint, machine::int, event
  FROM events
  WHERE line = %(line)s AND event IN {SWITCHES} AND time > %(a)s AND time <= %(b)s AND {SRC_OK}
  ORDER BY time"""
Q_GAPS = """
  SELECT (extract(epoch FROM gap_from) * 1000)::bigint, (extract(epoch FROM gap_to) * 1000)::bigint, reason
  FROM not_recorded(%(a)s, %(b)s) WHERE line = %(line)s ORDER BY gap_from"""
Q_IDEAL = "SELECT machine, ideal_cycle_s::float FROM machines WHERE line = %(line)s"
QC_SOURCE = {"board": "board", "test": "test", "sim": "website"}


def hm(v):
    return int(v[:2]) * 60 + int(v[3:5])


def midnight(t):
    """00:00 of t's day, Thailand time"""
    return t - (t + TZ_MS) % DAY


def shift_of(t, sh):
    """the shift of time t, as the page works it out (06-zone4-oee.js shiftOf); None when the settings don't fit"""
    work, blen, n = min(16, max(1, float(sh["work"]))), max(0, int(sh["blen"])), min(3, max(1, int(sh.get("shifts", 1))))
    span, start = round(work * 60) + blen, hm(sh["start"])
    into = (hm(sh["bstart"]) - start) % 1440            # where the break sits in a shift
    if n * span > 1440 or (blen and into + blen > span):
        return None
    every = []
    for d in (-1, 0, 1):
        for k in range(n):
            s0 = midnight(t) + d * DAY + (start + k * span) * MIN
            e = s0 + span * MIN
            bs = min(e, s0 + into * MIN)
            every.append({"k": k, "start": s0, "end": e, "bs": bs, "be": min(e, bs + blen * MIN)})
    every.sort(key=lambda x: x["start"])
    pick = (next((x for x in every if x["start"] <= t < x["end"]), None)
            or next((x for x in reversed(every) if x["end"] <= t and midnight(x["end"] - 1) == midnight(t)), None)
            or next(x for x in every if x["start"] > t))
    pick["plan"] = [(a, b) for a, b in ((pick["start"], pick["bs"]), (pick["be"], pick["end"])) if b > a]
    return pick


def window_of(t, sh, s):
    win = str(sh.get("win", "shift"))
    if win == "shift":
        return s["start"], s["end"]
    if win == "custom":
        d0 = midnight(t)
        return d0 + hm(sh["from"]) * MIN, d0 + hm(sh["to"]) * MIN
    return t - int(win) * MIN, t


def overlap(a0, a1, b0, b1):
    return max(0, min(a1, b1) - max(a0, b0))


def ts(ms):
    """ms -> a value psycopg sends as timestamptz"""
    return datetime.fromtimestamp(ms / 1000, timezone.utc)


def cause_of(group, sw):
    """why the line stood in this minute: the alarm, or each machine that stood and why"""
    if sw.get((0, "alarm")) or any(r[4] for r in group):
        return "ALARM · E-stop"
    why = []
    for _t, m, run_s, _stop, _al, _parts, speed in group:
        if run_s >= 30:
            continue
        w = ("maintenance" if sw.get((m, "maintenance")) else "set-up" if sw.get((m, "setup")) else
             "door open" if sw.get((m, "door")) else "STOP" if sw.get((m, "run")) is False else
             "speed 0 %" if speed == 0 else "หยุด")
        why.append(f"{m:02d} {w}")
    return " · ".join(why)


def panel(conn, line, sh, t, source):
    """the OEE panel for the line's time t (ms) and the control page's shift settings sh, or None"""
    s = shift_of(t, sh)
    if not s:
        return None
    w0, w1 = window_of(t, sh, s)
    r0, r1 = min(s["start"], w0), max(s["end"], w1)       # the timeline: the shift, widened to the time frame
    e1, upto = min(w1, t), min(r1, t)
    args = {"line": line, "src": source, "qsrc": QC_SOURCE[source], "a": ts(r0), "b": ts(upto)}
    with conn.cursor() as cur:
        cur.execute(Q_IDEAL, args)
        ideal = dict(cur.fetchall())
        cur.execute(Q_MINUTES, args)
        rows = cur.fetchall()
        cur.execute(Q_QC, args)
        qc = cur.fetchall()
        cur.execute(Q_SWITCH_BEFORE, args)
        switches = cur.fetchall()
        cur.execute(Q_SWITCH, args)
        switches += cur.fetchall()
        gaps = []
        if source == "board":
            cur.execute(Q_GAPS, args)
            gaps = cur.fetchall()

    # one group per minute (a row per machine), and the switch states at its end
    groups = []
    for r in rows:
        if groups and r[0] - groups[-1][0][0] <= ROW_GAP_MS:
            groups[-1].append(r)
        else:
            groups.append([r])
    sw, k = {}, 0
    in_plan = lambda a, b: any(overlap(a, b, p0, p1) > (b - a) / 2 for p0, p1 in s["plan"])
    rec = run_m = log_m = ideal_s = 0.0
    segs = []
    for g in groups:
        end = g[-1][0]
        while k < len(switches) and switches[k][0] <= end:
            _t, m, ev = switches[k]
            kind, on = ev.rsplit("_", 1)[0], ev.endswith(("_on", "_open"))
            sw[(0 if kind == "alarm" else m, kind)] = on
            k += 1
        logged = max(r[2] + r[3] for r in g)
        if logged <= 0:
            continue
        a = end - logged * 1000
        run, total = sum(r[2] for r in g), sum(r[2] + r[3] for r in g)
        state = 1 if run * 2 >= total else 0
        cause = "" if state else cause_of(g, sw)
        last = segs[-1] if segs else None
        if last and last[2] == state and last[3] == cause and a - last[1] < 5000:
            last[1] = end
        else:
            segs.append([max(a, last[1]) if last else a, end, state, cause])
        mid = a + logged * 500
        if w0 <= mid <= e1 and in_plan(a, end):
            rec += logged * 1000
            run_m += run
            log_m += total
            ideal_s += sum(ideal.get(r[1], 0) * r[5] for r in g)
    for a, b, reason in gaps:
        a, b = max(a, r0), min(b, upto)
        if b > a:
            segs.append([a, b, -1, "ไม่ได้บันทึก · " + reason])
    segs.sort(key=lambda x: x[0])

    good = sum(1 for pt, g in qc if g and w0 <= pt <= e1)
    bad = sum(1 for pt, g in qc if not g and w0 <= pt <= e1)
    A = run_m / log_m if log_m else None
    P = min(1.0, ideal_s / run_m) if run_m else None
    Q = good / (good + bad) if good + bad else None
    plan = sum(overlap(w0, w1, a, b) for a, b in s["plan"])
    elapsed = sum(overlap(w0, e1, a, b) for a, b in s["plan"])
    run_ms = rec * A if A is not None else 0
    return {"at": t, "source": source, "w0": w0, "w1": w1, "plan": plan, "elapsed": elapsed, "rec": rec,
            "run": round(run_ms), "stop": round(rec - run_ms), "gap": max(0, elapsed - rec),
            "mrun": run_m * 1000, "ideal": ideal_s * 1000, "good": good, "bad": bad,
            "A": A, "P": P, "Q": Q, "OEE": A * P * Q if None not in (A, P, Q) else None,
            "segs": segs, "parts": [[pt, 1 if g else 0] for pt, g in qc[-PARTS_MAX:]]}


def connect(uri):
    conn = psycopg.connect(uri, connect_timeout=5, autocommit=True)
    conn.execute("SET default_transaction_read_only = on")
    return conn
