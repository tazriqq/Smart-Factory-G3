# hub.py  -  the one copy of the control page's state (website/control.html), kept on the server.
#
# Control pages (any number, any device) send commands to <line>/control/set:
#   {"cmd":"set","key":"pot.1","value":256,"base":7,"by":"a1b2"}   change one value; base = the version of that
#                                                                   value the page last saw
#   {"cmd":"press","key":"good.A","by":"a1b2"}                      good.A / rej.B (QC for that product), undo, reset:
#                                                                   counted, never conflict
# The hub takes them in the order they reach it. A "set" whose value someone else changed after the version the
# page saw is ignored (the first one wins); the page then shows the hub's value. After every change, and every
# few seconds, the hub posts the whole state to <line>/control (retained): the control pages show it and the
# dashboards (website/index.html) run their simulated line from it.
#
# src in the state tells every page what to follow: "board" when useBoard is on and the board is sending,
# otherwise "sim" (the control pages' simulator).
#
# Every accepted press / switch is also posted to <line>/events with "source":"website", so the database and the
# Google Sheet show what was done on the control pages next to what was done on the board (source empty = board).
# The OEE numbers in the database count the board's rows only.
#
# Products: items = {"A": {"code": "P-001", "name": "Shaft S-100"}, "B": {...}} names what each product of the line
# (line = LINE_ID) is; set with keys item.A.code / item.A.name, logged as event product_info (code, name).
#
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
T_STATE, T_SET, T_BOARD = BASE + "/control", BASE + "/control/set", BASE + "/board"
T_PAIR, T_EVENTS = BASE + "/control/pair", BASE + "/events"
PRESS_EVENT = {"good": "good", "rej": "reject", "undo": "undo", "reset": "reset"}
SWITCH_EVENT = {"run": ("run_on", "run_off"), "door": ("door_open", "door_close"), "setup": ("setup_on", "setup_off")}
outbox = []   # event rows to post (on_command runs inside the MQTT callback)
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
    "items": {"A": {"code": "", "name": ""}, "B": {"code": "", "name": ""}}, "line": LINE_ID,
    "qc": {"A": {"good": 0, "rej": 0}, "B": {"good": 0, "rej": 0}},   # QC presses per product (good / rej = all)
    "id": "".join(random.choices(string.ascii_lowercase + string.digits, k=8)),
}
ver = {"n": 0, "kv": {}, "by": {}}   # version counter, version and author of each value
board_at = 0.0
restored = False
dirty = True


def valid(key, value):
    """the value a key may take, or None"""
    if key.startswith("item."):
        _, p, field = (key.split(".") + ["", ""])[:3]
        if p not in ("A", "B") or field not in ("code", "name") or not isinstance(value, str):
            return None
        value = "".join(ch for ch in value if ch.isprintable()).strip()
        return value[: 20 if field == "code" else 60]
    name, _, idx = key.partition(".")
    if name in ("pot", "run", "door", "setup"):
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
        return value if value in (1, 4, 10) else None
    if key == "route":
        return value if isinstance(value, str) and len(value) <= 6 and set(value) <= set("1234-") and value.count("-") <= 1 else None
    return None


def put(key, value):
    if key.startswith("item."):
        _, p, field = key.split(".")
        state["items"][p][field] = value
        return
    name, _, idx = key.partition(".")
    if name in ("pot", "run", "door", "setup"):
        state[name][int(idx)] = value
    elif name == "sim":
        state["sim"][idx] = value
    else:
        state[key] = value


def on_command(m):
    global dirty
    by = str(m.get("by", ""))[:16]
    if m.get("cmd") == "press":
        k, _, p = str(m.get("key", "")).partition(".")
        if k in ("good", "rej") and p in ("A", "B"):
            state["qc"][p][k] += 1
            state[k] += 1
            outbox.append({"machine": 0, "event": PRESS_EVENT[k], "product": p})
            dirty = True
        elif k in ("good", "rej", "undo", "reset") and not p:
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
    else:
        before = state[name][int(idx)] if name in ("pot", "run", "door", "setup") else state["sim"][idx] if name == "sim" else state[key]
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
    return "board" if state["useBoard"] and time.monotonic() - board_at < BOARD_QUIET_S else "sim"


def publish(client):
    global dirty
    out = dict(state, src=src(), board=1 if time.monotonic() - board_at < BOARD_QUIET_S else 0,
               v=ver["n"], kv=ver["kv"], ms=int(time.time() * 1000), hub=1)
    client.publish(T_STATE, json.dumps(out, separators=(",", ":")), qos=1, retain=True)
    dirty = False


def on_message(client, _userdata, msg):
    global board_at, restored, dirty
    if msg.topic == T_BOARD:
        board_at = time.monotonic()
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
        for k in ("pot", "run", "door", "setup"):
            if isinstance(m.get(k), list) and len(m[k]) == 4:
                state[k] = [valid(f"{k}.{i}", x) if valid(f"{k}.{i}", x) is not None else state[k][i] for i, x in enumerate(m[k])]
        for k in ("al", "useBoard", "route", "good", "rej", "undo", "reset", "id"):
            if k in m and (k in ("good", "rej", "undo", "reset", "id") or valid(k, m[k]) is not None):
                state[k] = m[k]
        if isinstance(m.get("sim"), dict):
            state["sim"].update({k: v for k, v in m["sim"].items() if valid("sim." + k, v) is not None})
        if isinstance(m.get("qc"), dict):
            for p in ("A", "B"):
                for k in ("good", "rej"):
                    v = (m["qc"].get(p) or {}).get(k)
                    if isinstance(v, int) and v >= 0:
                        state["qc"][p][k] = v
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
    client.subscribe([(T_STATE, 1), (T_SET, 1), (T_BOARD, 0), (T_PAIR, 1)])


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
    while True:
        time.sleep(0.1)
        now = time.monotonic()
        if not client.is_connected():
            continue
        if not restored and now - started > 2:   # no retained state to carry on from
            restored = True
        if not restored:
            continue
        while outbox:
            row = outbox.pop(0)
            client.publish(T_EVENTS, json.dumps({**row, "source": "website", "age_ms": 0}), qos=1)
        s = src()
        if dirty or s != last_src or now - last_pub > KEEPALIVE_S:
            publish(client)
            last_pub, last_src = now, s


if __name__ == "__main__":
    main()
