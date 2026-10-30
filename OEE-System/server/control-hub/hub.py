# hub.py  -  the one copy of the control page's state (website/control.html), kept on the server.
#
# Control pages (any number, any device) send commands to <line>/control/set:
#   {"cmd":"set","key":"pot.1","value":256,"base":7,"by":"a1b2"}   change one value; base = the version of that
#                                                                   value the page last saw
#   {"cmd":"press","key":"good.A","n":5,"by":"a1b2"}                good.A / rej.B (QC for that product; n parts at once,
#                                                                   1 if left out), undo, reset: counted, never conflict
# The QC counts (good / rej, qc per product) are the line's one count: every page shows them as they are. undo takes
# back the latest GOOD / REJECT press, all n of it (qlog keeps the order, "good.A*5"), reset sets them back to 0.
# The hub takes them in the order they reach it. A "set" whose value someone else changed after the version the
# page saw is ignored (the first one wins); the page then shows the hub's value. After every change, and every
# few seconds, the hub posts the whole state to <line>/control (retained): the control pages show it and the
# dashboards (website/index.html) run their simulated line from it.
#
# src in the state tells every page what to follow: "board" when useBoard is on and the board is sending;
# "none" when the real line is expected (useBoard on, real time) but the board is not sending: the line stands
# and every page records that time as not recorded, with why (board_wait: the board is offline, or online but
# quiet, or never seen); otherwise "sim" (the control pages' simulator, the simulated clock's test line).
# The real line is the board only: the simulated line writes nothing in real time (SIM_RECORD_REAL=1 brings back
# its source sim rows), only on the simulated clock (source test).
#
# Every accepted press / switch is also posted to <line>/events with "source":"website", so the database and the
# Google Sheet show what was done on the control pages next to what was done on the board (source empty = board).
# The OEE numbers in the database count the board's rows only.
#
# Products: items = {"A": {"code": "P-001", "name": "Shaft S-100"}, "B": {...}} names what each product of the line
# (line = LINE_ID) is; set with keys item.A.code / item.A.name, logged as event product_info (code, name).
#
# The simulated line: while src is "sim" (no board), the hub runs the line itself with the board's rules
# (esp32/SmartFactoryBoard_MQTT.ino): each machine makes a part every CYCLE_MS at 100 % while it runs, a route's
# first machine has its own material, the next ones take parts from the one before (up to BUF_CAP waiting), the
# last one's parts are the product's output. Running also needs no set-up / maintenance and the line not paused.
# It writes one minutes row per machine per minute, marked "source":"sim", with that minute's output (parts off the
# end of the route) in it instead of an event per part, so the database works out the simulated line's OEE next to
# the board's (server/postgres/schema.sql) from about 4 rows a minute. Only within the shift set on the control page
# (start, work hours, break: the planned time, as on the OEE panel), in Thailand time; always in real time (the
# pages' 1x / 4x / 10x only speeds up what they draw).

# The line's clock: one for every page and the simulated line. "real" = the computer's time (the data is real,
# source sim). "sim" = a simulated clock for test cases, set on the control page: start it at any time (e.g. just
# before the shift ends), run it 1x / 10x / 60x, pause it. While it runs, the simulated line follows it (shift,
# cycles, minutes) and everything recorded is marked source test, at the simulated time, so the real data stays
# clean; back on "real", recording carries on. Command: {"cmd":"clock","mode":"sim","speed":60,"at":<ms>,"paused":0}.
# The state carries clock = {mode, speed, paused, base_v, base_r}: now = base_v + (wall ms - base_r) x speed.

# Pairing (log another device in): a logged-in control page posts {"by":"a1b2"} to <line>/control/pair; the hub
# answers on <line>/control/pair/a1b2 with a 5-character code. GET /pair/<code> (nginx passes it on) gives that
# device the web login once: a code works a single time, for PAIR_TTL_S seconds, and wrong guesses get blocked.

import json
import os
import random
import secrets
import string
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import paho.mqtt.client as mqtt

HOST = os.environ.get("MQTT_HOST", "mosquitto")
PORT = int(os.environ.get("MQTT_PORT", "1883"))
USER = os.environ["MQTT_USER"]
PASS = os.environ["MQTT_PASS"]
BASE = os.environ.get("LINE_TOPIC", "group3/dpx/line1")
LINE_ID = os.environ.get("LINE_ID", BASE.rsplit("/", 1)[-1])
LINE_NAME = os.environ.get("LINE_NAME", "").strip() or LINE_ID   # what the pages call the line, e.g. "BU 3"
# links the pages show (LINKS in server/.env, kept out of git): "Google Sheet|https://...;Other|https://..."
LINKS = [{"name": n.strip(), "url": u.strip()} for n, _, u in (x.partition("|") for x in os.environ.get("LINKS", "").split(";"))
         if n.strip() and u.strip().startswith(("https://", "http://"))]
T_STATE, T_SET, T_BOARD, T_STATUS = BASE + "/control", BASE + "/control/set", BASE + "/board", BASE + "/status"
SIM_RECORD_REAL = os.environ.get("SIM_RECORD_REAL", "") == "1"
T_PAIR, T_EVENTS, T_MINUTES = BASE + "/control/pair", BASE + "/events", BASE + "/minutes"
PRESS_EVENT = {"good": "good", "rej": "reject", "undo": "undo", "reset": "reset", "clear": "oee_clear"}
QLOG_MAX = 200
CLOCK_SPEEDS = (1, 10, 60)


def wall_ms():
    return time.time() * 1000


def line_ms():
    """the line's time now (ms): the computer's, or the simulated clock's"""
    c = state["clock"]
    if c["mode"] != "sim":
        return wall_ms()
    return c["base_v"] if c["paused"] else c["base_v"] + (wall_ms() - c["base_r"]) * c["speed"]


def testing():
    return state["clock"]["mode"] == "sim"


def set_clock(m):
    """a clock command: mode, speed, at (jump to that time), paused; always rebased on now"""
    global dirty
    c, now_v = state["clock"], line_ms()
    mode = m.get("mode", c["mode"])
    if mode not in ("real", "sim"):
        return
    if mode == "real":
        c.update(mode="real", speed=1, paused=0, base_v=0, base_r=0)
    else:
        speed = m.get("speed", c["speed"] if c["mode"] == "sim" else 1)
        at = m.get("at")
        c.update(mode="sim", speed=speed if speed in CLOCK_SPEEDS else 1,
                 paused=1 if m.get("paused", c["paused"] if c["mode"] == "sim" else 0) else 0,
                 base_v=float(at) if isinstance(at, (int, float)) and at > 0 else now_v, base_r=wall_ms())
    state["shift"]["clock"] = "demo" if c["mode"] == "sim" else "real"   # the OEE panels: run on the line's clock
    state["sim"]["speed"] = c["speed"] if c["mode"] == "sim" and not c["paused"] else 1   # the line drawn at that speed
    sim.retime = True                                                        # hand in the minute so far, start afresh
    dirty = True
QC_MAX_N = 999   # parts in one press (the control page's number box)


def qlog_entry(x):
    """(key, product, n) of a qlog entry such as "good.A*5", or None"""
    head, _, n = str(x).partition("*")
    k, _, p = head.partition(".")
    n = int(n) if n.isdigit() else 1 if not n else 0
    return (k, p, n) if k in ("good", "rej") and p in ("", "A", "B") and 1 <= n <= QC_MAX_N else None
SWITCH_EVENT = {"run": ("run_on", "run_off"), "door": ("door_open", "door_close"), "setup": ("setup_on", "setup_off"),
                "maint": ("maintenance_on", "maintenance_off")}
outbox = []   # event rows to post (on_command runs inside the MQTT callback); source website unless the row says
minutes_out = []   # the simulated line's minutes rows
WEB_USER, WEB_PASS = "web", os.environ.get("MQTT_WEB_PASS", "")
PAIR_TTL_S, PAIR_HTTP_PORT = 600, 8090
PAIR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"   # no 0/O, 1/I: easy to read and to type
pairs = {}                                          # code -> expiry (monotonic)
misses = {}                                         # address -> [times of wrong codes]
pair_lock = threading.Lock()
BOARD_QUIET_S = 3.0
KEEPALIVE_S = 5.0

state = {
    "pot": [512, 512, 512, 512], "run": [1, 1, 1, 1], "door": [0, 0, 0, 0], "setup": [0, 0, 0, 0], "al": 0,
    "sim": {"run": 1, "speed": 4}, "route": "1234-", "useBoard": 1,
    "good": 0, "rej": 0, "undo": 0, "reset": 0,
    "items": {"A": {"code": "", "name": ""}, "B": {"code": "", "name": ""}}, "line": LINE_ID, "lineName": LINE_NAME, "links": LINKS,
    "maint": [0, 0, 0, 0],   # maintenance per machine (setup = set-up / changeover), both stand the machine still
    "qc": {"A": {"good": 0, "rej": 0}, "B": {"good": 0, "rej": 0}},   # QC presses per product (good / rej = all)
    "clock": {"mode": "real", "speed": 1, "paused": 0, "base_v": 0, "base_r": 0},   # the line's clock (see the top)
    "qlog": [],   # the latest QC presses in order ("good.A", "rej.B", "good" ...), so undo knows which to take back
    # the OEE panel of every dashboard: shift, ideal cycle, clock (demo = 1 s is 1 min), time frame; clear = counter
    # shifts: how many, one after the other: each is work hours + the break long (2 x (11 h + 60 min) = the day),
    # each with its break at the same place in it (bstart is the first shift's); a shift may run past midnight
    "shift": {"start": "08:00", "work": 8, "bstart": "12:00", "blen": 60, "cycle": 120, "clock": "demo",
              "win": "shift", "from": "08:00", "to": "17:00", "shifts": 1}, "clear": 0,
    "id": "".join(random.choices(string.ascii_lowercase + string.digits, k=8)),
}
ver = {"n": 0, "kv": {}, "by": {}}   # version counter, version and author of each value
board_at = 0.0
board_status = ""   # "online" / "offline" as the broker keeps it for the board (its last will)
restored = False
dirty = True


def valid_shift(field, value):
    if field in ("start", "bstart", "from", "to"):
        ok = isinstance(value, str) and len(value) == 5 and value[2] == ":" and value[:2].isdigit() and value[3:].isdigit()
        return value if ok and int(value[:2]) < 24 and int(value[3:]) < 60 else None
    if field == "clock":
        return value if value in ("demo", "real") else None
    if field == "win":
        return value if value in ("15", "60", "240", "shift", "custom") else None
    if field == "shifts":
        return value if value in (1, 2, 3) else None
    if not isinstance(value, (int, float)):
        return None
    lo, hi = {"work": (1, 16), "blen": (0, 480), "cycle": (1, 36000)}.get(field, (None, None))
    return (value if field == "work" else int(value)) if lo is not None and lo <= value <= hi else None


def valid(key, value):
    """the value a key may take, or None"""
    if key.startswith("shift."):
        return valid_shift(key[6:], value)
    if key.startswith("item."):
        _, p, field = (key.split(".") + ["", ""])[:3]
        if p not in ("A", "B") or field not in ("code", "name") or not isinstance(value, str):
            return None
        value = "".join(ch for ch in value if ch.isprintable()).strip()
        return value[: 20 if field == "code" else 60]
    name, _, idx = key.partition(".")
    if name in ("pot", "run", "door", "setup", "maint"):
        if not idx.isdigit() or int(idx) > 3:
            return None
        if name == "pot":
            return max(0, min(1023, int(value))) if isinstance(value, (int, float)) else None
        return 1 if value else 0
    if name in ("al", "useBoard"):
        return 1 if value else 0
    if key == "sim.run":
        return 1 if value else 0
    if key == "sim.speed":
        return value if value in (1, 4, 10, 60) else None
    if key == "route":
        return value if isinstance(value, str) and len(value) <= 6 and set(value) <= set("1234-") and value.count("-") <= 1 else None
    return None


def put(key, value):
    if key.startswith("shift."):
        state["shift"][key[6:]] = value
        return
    if key.startswith("item."):
        _, p, field = key.split(".")
        state["items"][p][field] = value
        return
    name, _, idx = key.partition(".")
    if name in ("pot", "run", "door", "setup", "maint"):
        state[name][int(idx)] = value
    elif name == "sim":
        state["sim"][idx] = value
    else:
        state[key] = value


def on_command(m):
    global dirty
    by = str(m.get("by", ""))[:16]
    if m.get("cmd") == "clock":
        set_clock(m)
        return
    if m.get("cmd") == "press":
        k, _, p = str(m.get("key", "")).partition(".")
        n = m.get("n", 1)
        n = n if isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= QC_MAX_N else 0
        if k in ("good", "rej") and p in ("A", "B"):
            if not n:
                return
            state["qc"][p][k] += n
            state[k] += n
            state["qlog"] = (state["qlog"] + [f"{k}.{p}" + (f"*{n}" if n > 1 else "")])[-QLOG_MAX:]
            outbox.extend({"machine": 0, "event": PRESS_EVENT[k], "product": p} for _ in range(n))   # one row per part
            dirty = True
        elif k == "undo" and not p:
            # take back the latest GOOD / REJECT; nothing left to take back: nothing happens
            if not state["qlog"]:
                return
            k2, p2, n2 = qlog_entry(state["qlog"].pop()) or ("good", "", 0)
            state[k2] = max(0, state[k2] - n2)
            if p2:
                state["qc"][p2][k2] = max(0, state["qc"][p2][k2] - n2)
            state["undo"] += 1
            outbox.append({"machine": 0, "event": "undo", **({"product": p2} if p2 else {})})
            dirty = True
        elif k == "reset" and not p:
            state["good"] = state["rej"] = 0
            state["qc"] = {"A": {"good": 0, "rej": 0}, "B": {"good": 0, "rej": 0}}
            state["qlog"] = []
            state["reset"] += 1
            outbox.append({"machine": 0, "event": "reset"})
            dirty = True
        elif k in ("good", "rej", "clear") and not p:
            if k != "clear":
                state["qlog"] = (state["qlog"] + [k])[-QLOG_MAX:]
            state[k] += 1
            outbox.append({"machine": 0, "event": PRESS_EVENT[k]})
            dirty = True
        return
    if m.get("cmd") != "set":
        return
    key = str(m.get("key", ""))
    value = valid(key, m.get("value"))
    if value is None:
        return
    seen = m.get("base", 0)
    # first one wins: someone else changed this value after the version this page saw
    if ver["kv"].get(key, 0) > seen and ver["by"].get(key) != by:
        state["last"] = {"key": key, "by": by, "ok": 0}
        dirty = True
        return
    ver["n"] += 1
    ver["kv"][key], ver["by"][key] = ver["n"], by
    name, _, idx = key.partition(".")
    if name == "item":
        p, field = idx.split(".")
        before = state["items"][p][field]
    elif name == "shift":
        before = state["shift"][idx]
    else:
        before = state[name][int(idx)] if name in ("pot", "run", "door", "setup", "maint") else state["sim"][idx] if name == "sim" else state[key]
    put(key, value)
    if before != value and name == "item":
        it = state["items"][idx.split(".")[0]]
        outbox.append({"machine": 0, "event": "product_info", "product": idx.split(".")[0], "code": it["code"], "name": it["name"]})
    elif before != value:
        if name in SWITCH_EVENT:
            outbox.append({"machine": int(idx) + 1, "event": SWITCH_EVENT[name][0 if value else 1]})
        elif key == "al":
            outbox.append({"machine": 0, "event": "alarm_on" if value else "alarm_off"})
        elif key == "route":
            outbox.append({"machine": 0, "event": "route", "route": value})
        elif key == "useBoard":
            outbox.append({"machine": 0, "event": "use_board" if value else "use_simulator"})
        elif key == "sim.run":
            outbox.append({"machine": 0, "event": "sim_run" if value else "sim_pause"})
    state["last"] = {"key": key, "by": by, "ok": 1}
    dirty = True


def new_code():
    now = time.monotonic()
    with pair_lock:
        for c in [c for c, t in pairs.items() if t < now]:
            del pairs[c]
        if len(pairs) > 50:   # a page asking again and again
            return None
        code = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(5))
        pairs[code] = now + PAIR_TTL_S
        return code


def redeem(code, addr):
    """the web login for a valid code (once), else None; too many wrong codes from one address or overall: blocked"""
    now = time.monotonic()
    with pair_lock:
        for a in list(misses):
            misses[a] = [t for t in misses[a] if now - t < 600]
            if not misses[a]:
                del misses[a]
        if len(misses.get(addr, [])) >= 10 or sum(len(v) for v in misses.values()) >= 100:
            return "blocked"
        t = pairs.pop(code.upper(), None)
        if t is None or t < now:
            misses.setdefault(addr, []).append(now)
            return None
        return {"u": WEB_USER, "p": WEB_PASS}


class PairHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        code = self.path.rsplit("/", 1)[-1]
        addr = self.headers.get("CF-Connecting-IP") or self.headers.get("X-Real-IP") or self.client_address[0]
        got = redeem(code, addr) if len(code) == 5 and WEB_PASS else None
        status, body = (429, {"error": "too many wrong codes, try again in 10 minutes"}) if got == "blocked" else \
            (200, got) if got else (404, {"error": "no such code, or it has expired"})
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        if status != 404:
            print(f"control-hub: pairing code {'used' if status == 200 else 'blocked'} from {addr}", flush=True)

    def log_message(self, *_):
        pass


def src():
    if state["useBoard"] and time.monotonic() - board_at < BOARD_QUIET_S:
        return "board"
    return "none" if state["useBoard"] and not testing() else "sim"


def board_wait():
    """why the real line is not recorded right now ("" when it is, or when it is not expected)"""
    if src() != "none":
        return ""
    if not board_at:
        return "ยังไม่ได้รับข้อมูลจากบอร์ด (บอร์ดปิดอยู่ หรือยังไม่ได้ต่อ)" if board_status != "online" else "บอร์ดออนไลน์ แต่ไม่ส่งข้อมูล"
    if board_status == "offline":
        return "บอร์ดออฟไลน์ (ปิดเครื่อง / ไฟดับ / Wi-Fi หลุด)"
    return "บอร์ดไม่ส่งข้อมูล (MQTT หลุด หรือบอร์ดค้าง)"


class SimLine:
    """the line run on the server while the control page drives it (the board's rules, see the top)"""
    CYCLE_MS = (18000, 30000, 24000, 36000)   # = CYCLE_MS in the sketch and ideal_cycle_s in the machines table
    BUF_CAP = 48
    SUMMARY_S = 60.0

    def __init__(self):
        self.on, self.route, self.retime = False, None, False
        self.clear()

    def clear(self):
        """parts in progress gone (route change, start), and a fresh minute"""
        self.busy, self.work, self.buf = [False] * 4, [0.0] * 4, [0] * 4
        self.run_ms, self.stop_ms, self.alarm_ms, self.parts, self.out = [0.0] * 4, [0.0] * 4, [0.0] * 4, [0] * 4, [0] * 4
        self.minute_at = line_ms()
        self.test = testing()   # this minute's rows: source test (simulated clock) or sim (real time)

    def set_route(self, route):
        self.route = route
        a, _, b = route.partition("-")
        self.prod, self.prev, self.next = [0] * 4, [-1] * 4, [-1] * 4
        for p, ms in ((1, a), (2, b)):
            ms = [int(c) - 1 for c in ms if c in "1234"]
            for k, n in enumerate(ms):
                self.prod[n] = p
                self.prev[n] = ms[k - 1] if k else -1
                self.next[n] = ms[k + 1] if k + 1 < len(ms) else -1

    @staticmethod
    def speed(n):
        return round(state["pot"][n] / 1023 * 40) * 5   # 0..200 % in 5 % steps, like the board

    def running(self, n):
        return bool(not state["al"] and state["run"][n] and not state["door"][n] and not state["setup"][n]
                    and not state["maint"][n] and state["sim"]["run"] and self.speed(n) > 0)

    def summary(self, on_time=False):
        """a minutes row per machine, at the line's time; on_time = the minute is up (the next one starts where it
        ended, no drift)"""
        at = self.minute_at + self.SUMMARY_S * 1000 if on_time else line_ms()
        for n in range(4):
            p = self.prod[n]
            minutes_out.append({"machine": n + 1, "at": at, "source": "test" if self.test else "sim", **({"product": "AB"[p - 1]} if p else {}),
                                "run_s": round(self.run_ms[n] / 1000), "stop_s": round(self.stop_ms[n] / 1000),
                                "alarm_s": round(self.alarm_ms[n] / 1000), "parts": self.parts[n], "output": self.out[n],
                                "speed_pct": self.speed(n)})
        self.run_ms, self.stop_ms, self.alarm_ms, self.parts, self.out = [0.0] * 4, [0.0] * 4, [0.0] * 4, [0] * 4, [0] * 4
        self.minute_at = at
        self.test = testing()

    def step(self, dt_ms, active):
        """dt_ms of the line's time has gone by; active = the simulated line is what drives the line now"""
        if self.retime:            # the clock was changed: the minute so far belongs to the old one
            self.retime = False
            if self.on:
                self.summary()
                self.clear()
        if not active:
            if self.on:          # the board (or nothing) takes over: hand in the minute so far
                self.summary()
                self.on = False
            return
        if not self.on or state["route"] != self.route:
            if self.on:
                self.summary()   # the minute so far, on the old route
            self.on = True
            self.set_route(state["route"])
            self.clear()
        for n in range(4):
            if state["al"]:
                self.stop_ms[n] += dt_ms
                self.alarm_ms[n] += dt_ms
            elif self.running(n):
                self.run_ms[n] += dt_ms
            else:
                self.stop_ms[n] += dt_ms
        for n in range(4):
            if not self.prod[n]:
                continue
            if not self.busy[n]:
                if self.prev[n] < 0:
                    self.busy[n] = True
                elif self.buf[self.prev[n]] > 0:
                    self.buf[self.prev[n]] -= 1
                    self.busy[n] = True
            if not self.busy[n] or not self.running(n):
                continue
            if self.work[n] < self.CYCLE_MS[n]:
                self.work[n] += dt_ms * self.speed(n) / 100
            if self.work[n] < self.CYCLE_MS[n]:
                continue
            if self.next[n] >= 0:
                if self.buf[n] >= self.BUF_CAP:
                    continue                      # no room after it: wait with the part done
                self.buf[n] += 1
            else:
                self.out[n] += 1                  # off the end of its route: the product's output
            self.parts[n] += 1
            self.busy[n], self.work[n] = False, 0.0
        if line_ms() - self.minute_at >= self.SUMMARY_S * 1000:
            self.summary(on_time=True)


sim = SimLine()


def hhmm(t):
    return int(t[:2]) * 60 + int(t[3:5])


def in_shift():
    """now (the line's time, Thailand = UTC+7 all year) within one of the control page's shifts and outside its break"""
    sh = state["shift"]
    t = time.gmtime(line_ms() / 1000 + 7 * 3600)
    m = t.tm_hour * 60 + t.tm_min
    span = round(sh["work"] * 60) + sh["blen"]                         # one shift: work hours + its break
    brk = (hhmm(sh["bstart"]) - hhmm(sh["start"])) % 1440              # where the break sits in a shift
    for k in range(sh.get("shifts", 1)):
        into = (m - hhmm(sh["start"]) - k * span) % 1440                # minutes since this shift began (past midnight too)
        if into < span and not (sh["blen"] and brk <= into < brk + sh["blen"]):
            return True
    return False


def publish(client):
    global dirty
    # the OEE panels' clock and the line's drawing speed always follow the line's clock (older settings included)
    c = state["clock"]
    state["shift"]["clock"] = "demo" if c["mode"] == "sim" else "real"
    state["sim"]["speed"] = c["speed"] if c["mode"] == "sim" and not c["paused"] else 1
    out = dict(state, src=src(), board_wait=board_wait(), board=1 if time.monotonic() - board_at < BOARD_QUIET_S else 0,
               v=ver["n"], kv=ver["kv"], ms=int(time.time() * 1000), hub=1)
    client.publish(T_STATE, json.dumps(out, separators=(",", ":")), qos=1, retain=True)
    dirty = False


def on_message(client, _userdata, msg):
    global board_at, restored, dirty
    global board_status
    if msg.topic == T_BOARD:
        board_at = time.monotonic()
        return
    if msg.topic == T_STATUS:
        board_status = msg.payload.decode("utf-8", "replace").strip()
        dirty = True
        return
    try:
        m = json.loads(msg.payload)
    except ValueError:
        return
    if msg.topic == T_SET:
        on_command(m)
    elif msg.topic == T_PAIR:
        by = "".join(ch for ch in str(m.get("by", "")) if ch.isalnum())[:16]
        code = new_code() if by else None
        if code:
            client.publish(f"{T_PAIR}/{by}", json.dumps({"code": code, "ttl_s": PAIR_TTL_S}), qos=1)
    elif msg.topic == T_STATE and not restored:
        # the retained state from before a restart (or from an older control page): carry on from it
        restored = True
        for k in ("pot", "run", "door", "setup", "maint"):
            if isinstance(m.get(k), list) and len(m[k]) == 4:
                state[k] = [valid(f"{k}.{i}", x) if valid(f"{k}.{i}", x) is not None else state[k][i] for i, x in enumerate(m[k])]
        for k in ("al", "useBoard", "route", "good", "rej", "undo", "reset", "id"):
            if k in m and (k in ("good", "rej", "undo", "reset", "id") or valid(k, m[k]) is not None):
                state[k] = m[k]
        if isinstance(m.get("sim"), dict):
            state["sim"].update({k: v for k, v in m["sim"].items() if valid("sim." + k, v) is not None})
        if isinstance(m.get("shift"), dict):
            for f, v in m["shift"].items():
                if f in state["shift"] and valid_shift(f, v) is not None:
                    state["shift"][f] = valid_shift(f, v)
        if isinstance(m.get("clear"), int):
            state["clear"] = m["clear"]
        if isinstance(m.get("qc"), dict):
            for p in ("A", "B"):
                for k in ("good", "rej"):
                    v = (m["qc"].get(p) or {}).get(k)
                    if isinstance(v, int) and v >= 0:
                        state["qc"][p][k] = v
        if isinstance(m.get("clock"), dict) and m["clock"].get("mode") in ("real", "sim"):
            c = m["clock"]
            state["clock"].update({k: c[k] for k in ("mode", "speed", "paused", "base_v", "base_r") if isinstance(c.get(k), (int, float, str))})
        if isinstance(m.get("qlog"), list):
            state["qlog"] = [x for x in m["qlog"] if isinstance(x, str) and qlog_entry(x)][-QLOG_MAX:]
        if isinstance(m.get("items"), dict):
            for p in ("A", "B"):
                for f in ("code", "name"):
                    v = valid(f"item.{p}.{f}", (m["items"].get(p) or {}).get(f, ""))
                    if v is not None:
                        state["items"][p][f] = v
        ver["n"] = int(m.get("v", 0) or 0)
        dirty = True
        print("control-hub: carried on from the retained state", flush=True)


def on_connect(client, _userdata, _flags, reason, _props):
    print(f"control-hub: connected ({reason})", flush=True)
    client.subscribe([(T_STATE, 1), (T_SET, 1), (T_BOARD, 0), (T_PAIR, 1), (T_STATUS, 1)])


def main():
    global restored
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="dpx-control-hub")
    client.username_pw_set(USER, PASS)
    client.on_connect = on_connect
    client.on_message = on_message
    threading.Thread(target=ThreadingHTTPServer(("0.0.0.0", PAIR_HTTP_PORT), PairHandler).serve_forever, daemon=True).start()
    client.connect_async(HOST, PORT, keepalive=30)
    client.loop_start()
    started, last_pub, last_src = time.monotonic(), 0.0, None
    last_step = time.monotonic()
    while True:
        time.sleep(0.1)
        now = time.monotonic()
        dt, last_step = now - last_step, now
        if restored:
            c = state["clock"]
            speed = 0 if c["mode"] == "sim" and c["paused"] else c["speed"] if c["mode"] == "sim" else 1
            # the simulated line writes rows on the simulated clock (test); in real time only with SIM_RECORD_REAL
            sim.step(min(dt, 1.0) * 1000 * speed, src() == "sim" and in_shift() and (testing() or SIM_RECORD_REAL))
        if not client.is_connected():
            continue
        if not restored and now - started > 2:   # no retained state to carry on from
            restored = True
        if not restored:
            continue
        # rows carry their time as age_ms (Telegraf: time = now - age_ms): the line's time, simulated or not
        while outbox:
            row = outbox.pop(0)
            age = round(wall_ms() - line_ms()) if testing() else 0
            client.publish(T_EVENTS, json.dumps({"source": "test" if testing() else "website", **row, "age_ms": age}), qos=1)
        while minutes_out:
            row = minutes_out.pop(0)
            client.publish(T_MINUTES, json.dumps({**{k: v for k, v in row.items() if k != "at"}, "age_ms": round(wall_ms() - row["at"])}), qos=1)
        s = src() + board_wait()
        if dirty or s != last_src or now - last_pub > KEEPALIVE_S:
            publish(client)
            last_pub, last_src = now, s


if __name__ == "__main__":
    main()
