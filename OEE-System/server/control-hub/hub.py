# hub.py  -  the one copy of the control page's state (website/control.html), kept on the server.
#
# Control pages (any number, any device) send commands to <line>/control/set:
#   {"cmd":"set","key":"pot.1","value":256,"base":7,"by":"a1b2"}   change one value; base = the version of that
#                                                                   value the page last saw
#   {"cmd":"press","key":"good","by":"a1b2"}                        good / rej / undo / reset: counted, never conflict
# The hub takes them in the order they reach it. A "set" whose value someone else changed after the version the
# page saw is ignored (the first one wins); the page then shows the hub's value. After every change, and every
# few seconds, the hub posts the whole state to <line>/control (retained): the control pages show it and the
# dashboards (website/index.html) run their simulated line from it.
#
# src in the state tells every page what to follow: "board" when useBoard is on and the board is sending,
# otherwise "sim" (the control pages' simulator).

import json
import os
import random
import string
import time

import paho.mqtt.client as mqtt

HOST = os.environ.get("MQTT_HOST", "mosquitto")
PORT = int(os.environ.get("MQTT_PORT", "1883"))
USER = os.environ["MQTT_USER"]
PASS = os.environ["MQTT_PASS"]
BASE = os.environ.get("LINE_TOPIC", "group3/dpx/line1")
T_STATE, T_SET, T_BOARD = BASE + "/control", BASE + "/control/set", BASE + "/board"
BOARD_QUIET_S = 3.0
KEEPALIVE_S = 5.0

state = {
    "pot": [512, 512, 512, 512], "run": [1, 1, 1, 1], "door": [0, 0, 0, 0], "setup": [0, 0, 0, 0], "al": 0,
    "sim": {"run": 1, "speed": 4}, "route": "1234-", "useBoard": 1,
    "good": 0, "rej": 0, "undo": 0, "reset": 0,
    "id": "".join(random.choices(string.ascii_lowercase + string.digits, k=8)),
}
ver = {"n": 0, "kv": {}, "by": {}}   # version counter, version and author of each value
board_at = 0.0
restored = False
dirty = True


def valid(key, value):
    """the value a key may take, or None"""
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
    if m.get("cmd") == "press" and m.get("key") in ("good", "rej", "undo", "reset"):
        state[m["key"]] += 1
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
    put(key, value)
    state["last"] = {"key": key, "by": by, "ok": 1}
    dirty = True


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
        ver["n"] = int(m.get("v", 0) or 0)
        dirty = True
        print("control-hub: carried on from the retained state", flush=True)


def on_connect(client, _userdata, _flags, reason, _props):
    print(f"control-hub: connected ({reason})", flush=True)
    client.subscribe([(T_STATE, 1), (T_SET, 1), (T_BOARD, 0)])


def main():
    global restored
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="dpx-control-hub")
    client.username_pw_set(USER, PASS)
    client.on_connect = on_connect
    client.on_message = on_message
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
        s = src()
        if dirty or s != last_src or now - last_pub > KEEPALIVE_S:
            publish(client)
            last_pub, last_src = now, s


if __name__ == "__main__":
    main()
