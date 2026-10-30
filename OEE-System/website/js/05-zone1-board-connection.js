// 05-zone1-board-connection.js - ZONE 1 - machine speeds and the board connection (Bluetooth / USB / Wi-Fi / MQTT)
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
// Four knobs, one per machine (window.pots, js/04): each sets that machine's speed, 0–200 %.
// The board sends text lines "512,300,1023,800" (0..1023 per knob, A0..A3).
const COUNT = 4;
const NAMES_M = ["01 Swiss", "02 Lathe", "03 GENOS", "04 Router"];
const $ = (id) => document.getElementById(id);
const button = $("connect"), status = $("status");
const say = (text) => { status.textContent = text; };
// connection pill next to the Connect button: not connected / connecting / connected (and whether data arrives)
const pill = $("conn-pill"), pillText = pill.querySelector("span");
let lastData = 0;
function setPill(state, text) { pill.dataset.state = state; pillText.textContent = text; }
setInterval(() => {
  if (!conn) return;
  // the control page resends every 2 s, but a browser slows a hidden tab down to about once a second or less
  const now = performance.now(), fromControl = !window.__board.live && now - controlAt < 10000, quiet = !fromControl && now - lastData > 2500;
  // the real line, and this page no longer hears the hub: that time is not recorded either
  if (viewOnly && (controlSrc === "board" || controlSrc === "none") && controlMsgAt && now - controlMsgAt > 15000)
    window.__lineWait = "หน้าเว็บขาดการเชื่อมต่อกับ server";
  if (viewOnly && window.__lineWait) { setPill("quiet", "Not recorded · " + window.__lineWait); return; }
  // the control page decides: its "src" says whether the line follows the board or the control page's simulator
  if (viewOnly && controlSrc === "sim") { setPill(fromControl ? "on" : "quiet", fromControl ? "Live · control via website" : "Control via website · waiting for the control page"); return; }
  if (viewOnly && controlSrc === "board" && !window.__board.live) { setPill("quiet", "Via board · waiting for the board"); return; }
  const via = fromControl ? " · control page" : quiet ? " · no data" : " · receiving";
  if (viewOnly) setPill(quiet ? "quiet" : "on", fromControl ? "Live · control via website" : quiet ? "Waiting for the board or the control page" : "Live · via board");
  else setPill(quiet ? "quiet" : "on", "Connected · " + NAMES[conn.kind] + via);
}, 500);
const lastAdc = Array(COUNT).fill(null);

// knob share 0..1 → speed 0..2 (the middle of the travel is 100 %)
const speedOf = (t) => Math.round(t * 40) / 20;          // 5 % steps
function show(i, t) {
  const s = speedOf(t);
  window.__speeds[i] = s;
  window.__line?.speedChanged?.(i, s);
}
window.onPotTurn = (i, t) => show(i, t);
window.pots.forEach((p, i) => show(i, p.value()));

// ---- the board: Bluetooth (Web Bluetooth) or USB cable (Web Serial) ----
const sourceSel = $("source");
const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";   // page -> board: "route 12-34"
const toBoard = new TextEncoder();
const NAMES = { usb: "USB cable", ble: "Bluetooth", wifi: "Wi‑Fi", mqtt: "MQTT" };
const addrInput = $("board-addr");
const mqttUrl = $("mqtt-url"), mqttTopic = $("mqtt-topic"), mqttUser = $("mqtt-user"), mqttPass = $("mqtt-pass");

// ---- the board's machine signals: run switches, doors, alarm, part / good / reject counters ----
// The board sends {"pot":[..],"run":[1,0,1,1],"door":[0,0,1,0],"al":0,"cnt":[..],"good":n,"rej":n,"ms":n,
//                 "route":"12-34","out":[a,b],"qg":[a,b],"qr":[a,b]}  (products A / B: route, output, QC good / reject).
// The board makes the parts itself (cnt); its four door buttons open / close the machines' doors.
// Counters only count up on the board; here they become events and per-machine run/stop time.
window.__board = (() => {
  const b = { live: false, run: [1, 1, 1, 1], door: [false, false, false, false], al: false, last: null, lastAt: 0, tick: 0, lastMachine: -1,
    stats: [0, 1, 2, 3].map(() => ({ run: 0, stop: 0, parts: 0, rej: 0, at: 0, gap: 0 })), qc: { good: 0, rej: 0 }, T: 0,
    qcP: [{ good: 0, rej: 0 }, { good: 0, rej: 0 }], route: null, setRoute: null };
  const ls = {};
  const emit = (ev, ...a) => (ls[ev] || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } });
  b.on = (ev, fn) => (ls[ev] || (ls[ev] = [])).push(fn);
  // 1 = the machine may run, 0 = held by its run switch or the alarm (only while the board is live)
  b.local = { run: [1, 1, 1, 1], al: false };   // the switches on screen, used while no board is connected
  b.gate = (i) => { const s = b.live ? b : b.local; return s.al || !s.run[i] ? 0 : 1; };
  b.lineRun = () => b.live && !b.al && b.run.every(Boolean);
  b.elapsed = () => b.T;
  b.feed = (m) => {
    if (!Array.isArray(m.run) || !Array.isArray(m.cnt)) return;
    const now = performance.now();
    if (b.last && typeof m.ms === "number" && typeof b.last.ms === "number" && m.ms < b.last.ms) b.last = null; // board restarted
    const q = b.last;
    b.run = m.run.slice(0, 4).map(Boolean); b.al = !!m.al; b.lastAt = now;
    if (Array.isArray(m.door)) for (let i = 0; i < 4; i++) {   // on the first line too, so the drawings start the same
      const open = !!m.door[i];
      if (!q || open !== b.door[i]) { b.door[i] = open; emit("door", i, open); }
    }
    if (!b.live) { b.live = true; b.tick = now; emit("live", true); }
    if (q) {
      for (let i = 0; i < 4; i++) {
        const d = (m.cnt[i] >>> 0) - (q.cnt[i] >>> 0);
        if (d > 0 && d < 1000) {
          const s = b.stats[i]; s.parts += d; if (s.at) s.gap = (now - s.at) / 1000 / d; s.at = now; b.lastMachine = i;
          for (let k = 0; k < d; k++) emit("part", i);
        }
      }
      const dg = (m.good >>> 0) - (q.good >>> 0), dr = (m.rej >>> 0) - (q.rej >>> 0);
      for (let k = 0; k < dg && k < 1000; k++) { b.qc.good++; emit("good"); }
      for (let k = 0; k < dr && k < 1000; k++) { b.qc.rej++; if (b.lastMachine >= 0) b.stats[b.lastMachine].rej++; emit("reject", b.lastMachine); }
      // per product: the board's own split when it sends one (its counters restart with a new route), else all for A
      const split = Array.isArray(m.qg) && Array.isArray(q.qg) && m.route === q.route;
      for (let p = 0; p < 2; p++) {
        const g = split ? (m.qg[p] >>> 0) - (q.qg[p] >>> 0) : p ? 0 : dg, r = split ? (m.qr[p] >>> 0) - (q.qr[p] >>> 0) : p ? 0 : dr;
        if (g > 0 && g < 1000) b.qcP[p].good += g;
        if (r > 0 && r < 1000) b.qcP[p].rej += r;
      }
      if (!!q.al !== b.al) emit("alarm", b.al);
    }
    if (typeof m.route === "string" && m.route !== b.route) { b.route = m.route; emit("route", m.route); }
    b.last = m;
  };
  // run / stop time per machine, in real time: running = its switch on, no alarm, knob above 0 %
  setInterval(() => {
    if (!b.live) return;
    const now = performance.now();
    if (now - b.lastAt > 3000) { b.live = false; emit("live", false); return; }
    const dt = (now - b.tick) / 1000; b.tick = now; b.T += dt;
    for (let i = 0; i < 4; i++) { if (b.gate(i) && !b.door[i] && (window.__speeds[i] || 0) > 0) b.stats[i].run += dt; else b.stats[i].stop += dt; }
  }, 250);
  b.reset = () => { b.stats.forEach((s) => Object.assign(s, { run: 0, stop: 0, parts: 0, rej: 0, at: 0, gap: 0 })); b.qc.good = b.qc.rej = 0; b.qcP.forEach((x) => { x.good = x.rej = 0; }); b.T = 0; b.lastMachine = -1; };
  b.stop = () => { if (b.live) { b.live = false; emit("live", false); } b.last = null; b.route = null; };
  return b;
})();
window.__gate = (i) => window.__board.gate(i);
const remember = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
// The dashboard only shows the line: it listens on the server's read-only MQTT (/mqtt-view, no login), where the
// board and the control page (control.html, the one place people log in) come in. ?connect brings back the
// connection settings (Bluetooth / USB / Wi-Fi / MQTT with a password).
const viewOnly = !/[?&]connect\b/.test(location.search);
if (viewOnly) document.body.classList.add("view-only");
if (remember.get("cnc-knob-source") in NAMES) sourceSel.value = remember.get("cnc-knob-source");
// default broker: Mosquitto on the server that serves this page (or the server computer when opened as a file);
// over https (the Cloudflare tunnel) nginx passes /mqtt on to it
// (port 9001 itself is open on the server only: an address remembered on 9001 of another computer moves to /mqtt)
const savedBroker = remember.get("cnc-mqtt-url");
mqttUrl.value = savedBroker && !(/:9001\b/.test(savedBroker) && !/^wss?:\/\/(127\.0\.0\.1|localhost):/.test(savedBroker)) ? savedBroker
  : (location.protocol === "https:" ? "wss://" : "ws://") + (location.host || "192.168.1.107:8080") + "/mqtt";
if (remember.get("cnc-mqtt-topic")) mqttTopic.value = remember.get("cnc-mqtt-topic");
if (remember.get("cnc-mqtt-user")) mqttUser.value = remember.get("cnc-mqtt-user");
if (remember.get("cnc-mqtt-pass")) mqttPass.value = remember.get("cnc-mqtt-pass");
let conn = null, gen = 0;

function apply(i, value) {
  if (i >= COUNT) return;
  lastAdc[i] = value;
  const share = value / 1023;
  window.pots[i].hold(share);
}
function handle(line) {
  lastData = performance.now();
  if (line.startsWith("{")) {            // the machine-signal board: JSON line
    let m; try { m = JSON.parse(line); } catch { return; }
    if (Array.isArray(m.pot)) m.pot.slice(0, COUNT).forEach((v, i) => { if (v >= 0 && v <= 1023) apply(i, v | 0); });
    window.__board.feed(m);
    return;
  }
  if (!/^\d{1,4}(,\d{1,4}){0,3}$/.test(line)) return;
  line.split(",").map(Number).forEach((value, i) => { if (value <= 1023) apply(i, value); });
}
function splitter() {
  let buffer = "";
  return (text) => {
    buffer += text;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) { handle(buffer.slice(0, end).trim()); buffer = buffer.slice(end + 1); }
    if (buffer.length > 1024) buffer = "";
  };
}
const supported = (kind) => (kind === "mqtt" ? true : kind === "wifi" ? location.protocol !== "https:" : kind === "usb" ? "serial" in navigator : "bluetooth" in navigator);
function syncSource() {
  const kind = sourceSel.value;
  sourceSel.disabled = !!conn;
  addrInput.hidden = kind !== "wifi"; addrInput.disabled = !!conn;
  for (const el of [mqttUrl, mqttTopic, mqttUser, mqttPass]) { el.hidden = kind !== "mqtt"; el.disabled = !!conn; }
  button.textContent = conn ? "Disconnect" : "Connect";
  button.disabled = !conn && !supported(kind);
  button.title = button.disabled ? "This browser can't use " + NAMES[kind] + ": use Chrome or Edge on a computer" : "";
}
sourceSel.addEventListener("change", () => {
  remember.set("cnc-knob-source", sourceSel.value);
  syncSource();
  if (!supported(sourceSel.value)) say(NAMES[sourceSel.value] + " needs Chrome or Edge on a computer" + (sourceSel.value === "ble" ? " (or Chrome on Android), opened from http://localhost." : "."));
  else say("Press Connect and pick the board.");
});
// setRoute(text): sends the products' route ("12-34") to the board over this connection
function connected(kind, close, setRoute) {
  conn = { kind, close };
  document.body.classList.remove("conn-open");
  window.__board.setRoute = setRoute || null;
  lastData = performance.now();
  setPill("on", "Connected · " + NAMES[kind]);
  syncSource();
  say("Connected by " + NAMES[kind] + ". Knobs set speed · run switches start / stop machines 1–4 · alarm stops the line · part buttons finish a part · Good / Reject go to the OEE panel.");
}
async function disconnect(message) {
  gen++;
  const c = conn; conn = null;
  window.__board.setRoute = null;
  setPill(/lost|unplugged|stopped/i.test(message) ? "error" : "off", /lost|unplugged|stopped/i.test(message) ? "Disconnected · connection lost" : "Not connected");
  if (c) { try { await c.close(); } catch {} }
  lastAdc.fill(null);
  window.__board.stop();
  window.pots.forEach((p) => p.release());
  syncSource();
  say(message);
}
async function openUsb(my) {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });
  const decoder = new TextDecoderStream();
  const piped = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  connected("usb", async () => { try { await reader.cancel(); } catch {} try { await piped; } catch {} try { await port.close(); } catch {} },
    async (route) => { const w = port.writable.getWriter(); try { await w.write(toBoard.encode("route " + route + "\n")); } finally { w.releaseLock(); } });
  const feed = splitter();
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; feed(value); } } catch {}
  finally { try { reader.releaseLock(); } catch {} }
  if (my === gen) disconnect("The board stopped sending. Check the cable and that the sketch is uploaded.");
}
async function openWifi(my) {
  let a = addrInput.value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(a)) a = "http://" + a;
  const url = a + "/data";
  const once = async () => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 1500);
    try { const r = await fetch(url, { cache: "no-store", signal: ctl.signal }); return (await r.text()).trim(); } finally { clearTimeout(t); }
  };
  let first;
  try { first = await once(); } catch { throw new Error("can't reach " + a + " (same 2.4 GHz Wi‑Fi? right address?)"); }
  if (my !== gen) return;
  let stopped = false;
  connected("wifi", async () => { stopped = true; }, async (route) => {
    const r = await fetch(a + "/route", { method: "POST", body: route });
    if (!r.ok) throw new Error((await r.text()).trim() || "HTTP " + r.status);
  });
  handle(first);
  let fails = 0;
  while (!stopped && my === gen) {
    await new Promise((r) => setTimeout(r, 100));
    try { const line = await once(); if (stopped || my !== gen) break; handle(line); fails = 0; }
    catch { if (++fails >= 25 && !stopped && my === gen) { disconnect("The board stopped answering over Wi‑Fi."); return; } }
  }
}
// MQTT: the ESP32 publishes the same JSON line to a broker; this page subscribes over a WebSocket,
// so it works from any website (https too), not only on the board's own Wi‑Fi.
let mqttLib = null;
// the copy next to this page first (works without internet), the CDN if that copy is missing
const MQTT_LIB = ["js/vendor/mqtt.min.js", "https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js"];
function loadMqtt() {
  if (window.mqtt) return Promise.resolve(window.mqtt);
  const tryLoad = (i) => new Promise((ok, fail) => {
    if (i >= MQTT_LIB.length) return fail(new Error("can't load the MQTT library (js/vendor/mqtt.min.js missing and offline?)"));
    const s = document.createElement("script");
    s.src = MQTT_LIB[i];
    s.onload = () => ok(window.mqtt);
    s.onerror = () => { s.remove(); tryLoad(i + 1).then(ok, fail); };
    document.head.appendChild(s);
  });
  return mqttLib || (mqttLib = tryLoad(0).catch((e) => { mqttLib = null; throw e; }));
}
async function openMqtt(my) {
  const url = mqttUrl.value.trim(), topic = mqttTopic.value.trim();
  if (!/^wss?:\/\//.test(url)) throw new Error("the broker address must start with wss:// (or ws://)");
  if (!topic) throw new Error("enter the MQTT topic");
  if (location.protocol === "https:" && url.startsWith("ws://")) throw new Error("an https page needs a wss:// broker address");
  const user = mqttUser.value.trim(), pass = mqttPass.value;
  if (!viewOnly) { remember.set("cnc-mqtt-url", url); remember.set("cnc-mqtt-topic", topic); remember.set("cnc-mqtt-user", user); remember.set("cnc-mqtt-pass", pass); }
  const lib = await loadMqtt();
  if (my !== gen) return;
  const client = lib.connect(url, { clientId: "dpx-web-" + Math.random().toString(16).slice(2, 10), reconnectPeriod: 2000, connectTimeout: 8000, clean: true, ...(user ? { username: user, password: pass } : {}) });
  await new Promise((ok, fail) => {
    const done = () => { clearTimeout(t); client.off("connect", good); client.off("error", bad); };
    const good = () => { done(); ok(); };
    const bad = (e) => { done(); client.end(true); fail(e); };
    const t = setTimeout(() => bad(new Error("no answer from " + url)), 9000);
    client.on("connect", good);
    client.on("error", bad);
  });
  if (my !== gen) { client.end(true); return; }
  await new Promise((ok, fail) => client.subscribe(topic, { qos: 0 }, (e) => (e ? fail(e) : ok())));
  // the control page (control.html) posts its knobs / switches here; it drives the line while no board is sending
  const controlTopic = topic.replace(/\/[^/]+$/, "/control");
  await new Promise((ok) => client.subscribe(controlTopic, { qos: 0 }, () => ok()));
  const feed = splitter();
  client.on("message", (t, payload) => {
    if (my !== gen) return;
    if (t === topic) { if (controlSrc !== "sim") feed(payload.toString() + "\n"); }   // the control page chose its simulator: ignore the board
    else if (t === controlTopic) { let m; try { m = JSON.parse(payload.toString()); } catch { return; } followControl(m); }
  });
  client.on("offline", () => { if (my === gen && conn) setPill("error", "MQTT · reconnecting …"); });
  client.on("connect", () => { if (my === gen && conn) setPill("on", "Connected · MQTT"); });
  // the board listens on <line>/route/set next to its <line>/board topic
  const routeTopic = topic.replace(/\/[^/]+$/, "/route/set");
  connected("mqtt", async () => { client.end(true); },
    (route) => new Promise((ok, fail) => client.publish(routeTopic, route, { qos: 1 }, (e) => (e ? fail(e) : ok()))));
  say("Connected to the MQTT broker. Waiting for the ESP32 on topic “" + topic + "” …");
}
// the control page's state: {"pot":[..4],"run":[..4],"door":[..4],"al":0,"good":n,"rej":n,"id":"session"}
// (retained, so it also arrives right after connecting). good / rej count up per control-page session.
// src: "board" = the control page connected the board, the line follows the board; "sim" = the control page is the
// board (its simulator), even while the real board is sending. Pages from before src existed: the board wins.
let lastControl = null, controlAt = 0, controlSrc = null, controlMsgAt = 0;
// the real line is the board only: while the hub waits for it (src "none") or this page stops hearing the hub,
// window.__lineWait says why, the line stands, and the OEE panel records that time as not recorded
window.__lineWait = "";
// the line's clock (server/control-hub): real time, or the control page's simulated clock for test cases.
// window.__lineClock.now() = the line's time in ms; the hub's wall clock (m.ms) corrects this computer's.
function followClock(m) {
  const c = m.clock;
  if (!c || (c.mode !== "real" && c.mode !== "sim")) return;
  const skew = typeof m.ms === "number" ? m.ms - Date.now() : 0;
  window.__lineClock = { mode: c.mode, speed: c.mode === "sim" ? c.speed : 1, paused: !!c.paused,
    now: c.mode === "sim" ? () => (c.paused ? c.base_v : c.base_v + (Date.now() + skew - c.base_r) * c.speed) : () => Date.now() };
}
function followControl(m) {
  followClock(m);
  controlMsgAt = performance.now();
  controlSrc = m.src === "sim" || m.src === "board" || m.src === "none" ? m.src : null;
  window.__lineWait = controlSrc === "none" ? m.board_wait || "รอบอร์ด" : "";
  if (m.items) window.__line?.setItems?.(m.items, m.line, m.lineName);   // what is being made, whichever source drives the line
  if (m.shift) window.oee?.applySettings?.(m.shift);          // the shift and time frame, set on the control page
  if (m.links) window.oee?.setLinks?.(m.links);               // the server's extra links (LINKS in server/.env)
  if (lastControl && lastControl.id === m.id && (m.clear >>> 0) > (lastControl.clear >>> 0)) window.oee?.clear?.();
  if (controlSrc === "none") {                       // no simulator in its place: the line stands
    if (window.__board.live) window.__board.stop();
    window.__line?.setRunning?.(false);
    lastControl = m;
    return;
  }
  if (controlSrc === "board") { lastControl = m; return; }
  if (controlSrc === "sim" && window.__board.live) window.__board.stop();   // let go of the board at once
  if (window.__board.live || !Array.isArray(m.pot) || !Array.isArray(m.run)) return;   // the board wins
  controlAt = lastData = performance.now();
  m.pot.slice(0, COUNT).forEach((v, i) => { if (v >= 0 && v <= 1023) apply(i, v | 0); });
  const loc = window.__board.local;
  for (let i = 0; i < 4; i++) loc.run[i] = m.run[i] ? 1 : 0;
  loc.al = !!m.al;
  // a door can refuse to move for a moment (covers off, mid-animation): the page resends every 2 s
  if (Array.isArray(m.door)) for (let i = 0; i < 4; i++) if (!!m.door[i] !== !!window.__door?.[i]) window.__line?.toggleDoor?.(i);
  const q = lastControl && lastControl.id === m.id ? lastControl : null;
  const L = window.__line;
  if (typeof m.route === "string") L?.setRouteText?.(m.route);
  if (Array.isArray(m.setup)) for (let i = 0; i < 4; i++) L?.setSetup?.(i, !!m.setup[i]);
  if (Array.isArray(m.maint)) for (let i = 0; i < 4; i++) L?.setMaint?.(i, !!m.maint[i]);
  if (m.sim) { L?.setRunning?.(m.sim.run !== 0); if (m.sim.speed) L?.setSpeed?.(m.sim.speed); }
  // the hub's QC counts are the counts: the same numbers the control page shows, also right after this page opens
  if (m.qc) L?.qcSet?.(m.qc);
  if (q) {
    // each new GOOD / REJECT also marks the OEE panel's timeline (undo / reset below take marks back);
    // what is left of the totals (pages without products): the latest product
    let pg = 0, pr = 0;
    if (m.qc && q.qc) for (const [i, P] of [[0, "A"], [1, "B"]]) {
      const dg = ((m.qc[P] || {}).good >>> 0) - ((q.qc[P] || {}).good >>> 0), dr = ((m.qc[P] || {}).rej >>> 0) - ((q.qc[P] || {}).rej >>> 0);
      for (let k = 0; k < dg && k < 1000; k++) L?.qcPress?.(i, "good");
      for (let k = 0; k < dr && k < 1000; k++) L?.qcPress?.(i, "rej");
      pg += Math.max(0, dg); pr += Math.max(0, dr);
    }
    for (let k = 0; k < (m.good >>> 0) - (q.good >>> 0) - pg && k < 100; k++) window.__qcPress?.("good");
    for (let k = 0; k < (m.rej >>> 0) - (q.rej >>> 0) - pr && k < 100; k++) window.__qcPress?.("reject");
    // undo takes back a whole press (n parts): as many marks as the totals went down (an older hub: one per undo)
    const undos = (m.undo >>> 0) - (q.undo >>> 0), gone = (q.good >>> 0) + (q.rej >>> 0) - (m.good >>> 0) - (m.rej >>> 0);
    for (let k = 0; undos > 0 && k < (gone > 0 ? gone : undos) && k < 1000; k++) document.querySelector('.dash-oee button[data-part="undo"]')?.click();
    if ((m.reset >>> 0) > (q.reset >>> 0)) L?.reset?.();
  }
  lastControl = m;
}
navigator.serial?.addEventListener("disconnect", () => { if (conn && conn.kind === "usb") disconnect("The board was unplugged."); });
async function openBle(my) {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [NUS] }, { namePrefix: "CNC-Knobs" }], optionalServices: [NUS] });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS);
  const tx = await service.getCharacteristic(NUS_TX);
  const rx = await service.getCharacteristic(NUS_RX).catch(() => null);
  const feed = splitter(), text = new TextDecoder();
  tx.addEventListener("characteristicvaluechanged", (e) => { if (my === gen) feed(text.decode(e.target.value)); });
  await tx.startNotifications();
  device.addEventListener("gattserverdisconnected", () => { if (my === gen) disconnect("Bluetooth connection lost. Press Connect to pair again."); });
  connected("ble", async () => { try { device.gatt.disconnect(); } catch {} },
    rx && ((route) => rx.writeValue(toBoard.encode("route " + route + "\n"))));
}
button.addEventListener("click", async () => {
  if (conn) return disconnect("Disconnected. Drag the on-screen sliders to set each machine's speed.");
  const kind = sourceSel.value, my = ++gen;
  say("Connecting by " + NAMES[kind] + " …");
  setPill("connecting", "Connecting · " + NAMES[kind] + " …");
  try { if (kind === "usb") await openUsb(my); else if (kind === "wifi") await openWifi(my); else if (kind === "mqtt") await openMqtt(my); else await openBle(my); }
  catch (error) {
    if (my !== gen) return;
    conn = null; syncSource();
    setPill(error && error.name === "NotFoundError" ? "off" : "error", error && error.name === "NotFoundError" ? "Not connected" : "Could not connect");
    if (error && error.name === "NotFoundError") return say("No device chosen.");
    if (viewOnly) { setPill("error", "Server not reachable · retrying"); setTimeout(autoView, 5000); return; }
    document.body.classList.add("conn-open");
    const hint = kind === "usb" ? " Close the Arduino IDE Serial Monitor if it is open." : kind === "wifi" ? "" : kind === "mqtt" ? " Check the broker address (the WebSocket one, e.g. wss://xxxx.s1.eu.hivemq.cloud:8884/mqtt), the user and the password." : " Check that the ESP32 is powered, Bluetooth is on in the computer, and the board is not connected to another device.";
    say("Could not connect: " + (error && error.message ? error.message : error) + "." + hint);
  }
});
syncSource();
// the connection settings stay folded behind ⚙ next to the status pill; they open when there is something to do
status.textContent = "";
if (!viewOnly) {
  const gear = Object.assign(document.createElement("button"), { type: "button", className: "conn-gear", textContent: "⚙", title: "Connection settings" });
  gear.setAttribute("aria-label", "Connection settings");
  pill.after(gear);
  const toggleConn = () => document.body.classList.toggle("conn-open");
  gear.addEventListener("click", toggleConn);
  pill.addEventListener("click", toggleConn);
  setTimeout(() => { if (!conn) document.body.classList.add("conn-open"); }, 4000);   // not connected by itself: show how
}
// view only: the server that serves this page (the server computer when opened as a file), no login
function autoView() {
  if (conn) return;
  const host = location.host || "192.168.1.107:8080";
  sourceSel.value = "mqtt"; syncSource();
  mqttUrl.value = (location.protocol === "https:" ? "wss://" : "ws://") + host + "/mqtt-view";
  mqttUser.value = ""; mqttPass.value = "";
  button.click();
}
// opened from the board itself (http://<board>/, see esp32/build_web.py): it answers /data, so read it over Wi-Fi at once;
// otherwise, with an MQTT password remembered, connect by MQTT (the board, or the control page, comes in that way)
const autoMqtt = () => { if (viewOnly) return autoView(); if (!conn && sourceSel.value === "mqtt" && mqttPass.value) button.click(); };
if (location.protocol === "https:" && !remember.get("cnc-knob-source")) { sourceSel.value = "mqtt"; syncSource(); }
if (location.protocol === "http:") {
  fetch("/data", { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).then((t) => {
    if (!t.trim().startsWith("{")) return autoMqtt();
    if (conn) return;
    sourceSel.value = "wifi"; addrInput.value = location.host; syncSource();
    button.click();
  }).catch(autoMqtt);
} else autoMqtt();
})();
