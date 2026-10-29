// 05-zone1-board-connection.js - ZONE 1 + 2 - speed knobs and the board connection (Bluetooth / USB / Wi-Fi / MQTT)
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
// Four knobs, one per machine: each sets that machine's speed, 0–200 %.
// The board sends text lines "512,300,1023,800" (0..1023 per knob, A0..A3).
const COUNT = 4;
const NAMES_M = ["01 Swiss", "02 Lathe", "03 GENOS", "04 Router"];
const $ = (id) => document.getElementById(id);
const button = $("connect"), status = $("status");
const adc = [...Array(COUNT)].map((_, i) => $("adc" + i));
const posEl = [...Array(COUNT)].map((_, i) => $("pos" + i));
const reverse = [...Array(COUNT)].map((_, i) => $("reverse" + i));
const potHints = [...document.querySelectorAll('.pot-deck [data-corner="hint"]')];
const dashMq = matchMedia("(min-width:1180px) and (min-height:620px)");
const potSvgs = [...document.querySelectorAll(".pot-deck .iso-svg")];
potSvgs.forEach((svg) => { svg.dataset.full = svg.getAttribute("viewBox"); });
function fitKnobs() {
  for (const svg of potSvgs) {
    if (!dashMq.matches) { svg.setAttribute("viewBox", svg.dataset.full); svg.style.aspectRatio = ""; continue; }
    svg.setAttribute("viewBox", svg.dataset.full);
    const b = svg.getBBox(), pad = 8;
    svg.setAttribute("viewBox", [b.x - pad, b.y - pad, b.width + 2 * pad, b.height + 2 * pad].map((v) => v.toFixed(1)).join(" "));
    svg.style.aspectRatio = String((b.width + 2 * pad) / (b.height + 2 * pad));
  }
}
fitKnobs();
dashMq.addEventListener("change", fitKnobs);
const say = (text) => { status.textContent = text; };
// connection pill next to the Connect button: not connected / connecting / connected (and whether data arrives)
const pill = $("conn-pill"), pillText = pill.querySelector("span");
let lastData = 0;
function setPill(state, text) { pill.dataset.state = state; pillText.textContent = text; }
setInterval(() => {
  if (!conn) return;
  const quiet = performance.now() - lastData > 2500;
  setPill(quiet ? "quiet" : "on", "Connected · " + NAMES[conn.kind] + (quiet ? " · no data" : " · receiving"));
}, 500);
const lastAdc = Array(COUNT).fill(null);

// knob share 0..1 → speed 0..2 (the middle of the travel is 100 %)
const speedOf = (t) => Math.round(t * 40) / 20;          // 5 % steps
function show(i, t) {
  const s = speedOf(t);
  window.__speeds[i] = s;
  posEl[i].textContent = String(Math.round(s * 100));
  window.__line?.speedChanged?.(i, s);
}
window.onPotTurn = (i, t) => show(i, t);
window.pots.forEach((p, i) => show(i, p.value()));

// ---- the board: Bluetooth (Web Bluetooth) or USB cable (Web Serial) ----
const sourceSel = $("source");
const NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const NAMES = { usb: "USB cable", ble: "Bluetooth", wifi: "Wi‑Fi", mqtt: "MQTT" };
const addrInput = $("board-addr");
const mqttUrl = $("mqtt-url"), mqttTopic = $("mqtt-topic"), mqttUser = $("mqtt-user"), mqttPass = $("mqtt-pass");

// ---- the board's machine signals: run switches, doors, alarm, part / good / reject counters ----
// The board sends {"pot":[..],"run":[1,0,1,1],"door":[0,0,1,0],"al":0,"cnt":[..],"good":n,"rej":n,"ms":n}.
// The board makes the parts itself (cnt); its four door buttons open / close the machines' doors.
// Counters only count up on the board; here they become events and per-machine run/stop time.
window.__board = (() => {
  const b = { live: false, run: [1, 1, 1, 1], door: [false, false, false, false], al: false, last: null, lastAt: 0, tick: 0, lastMachine: -1,
    stats: [0, 1, 2, 3].map(() => ({ run: 0, stop: 0, parts: 0, rej: 0, at: 0, gap: 0 })), qc: { good: 0, rej: 0 }, T: 0 };
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
      if (!!q.al !== b.al) emit("alarm", b.al);
    }
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
  b.reset = () => { b.stats.forEach((s) => Object.assign(s, { run: 0, stop: 0, parts: 0, rej: 0, at: 0, gap: 0 })); b.qc.good = b.qc.rej = 0; b.T = 0; b.lastMachine = -1; };
  b.stop = () => { if (b.live) { b.live = false; emit("live", false); } b.last = null; };
  return b;
})();
window.__gate = (i) => window.__board.gate(i);
const remember = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
if (remember.get("cnc-knob-source") in NAMES) sourceSel.value = remember.get("cnc-knob-source");
// default broker: Mosquitto on the server that serves this page (or the server computer when opened as a file)
mqttUrl.value = remember.get("cnc-mqtt-url") || `ws://${location.hostname || "192.168.1.107"}:9001`;
if (remember.get("cnc-mqtt-topic")) mqttTopic.value = remember.get("cnc-mqtt-topic");
if (remember.get("cnc-mqtt-user")) mqttUser.value = remember.get("cnc-mqtt-user");
if (remember.get("cnc-mqtt-pass")) mqttPass.value = remember.get("cnc-mqtt-pass");
let conn = null, gen = 0;

function apply(i, value) {
  if (i >= COUNT) return;
  lastAdc[i] = value;
  adc[i].textContent = String(value).padStart(4, " ");
  const share = value / 1023;
  window.pots[i].hold(reverse[i].checked ? 1 - share : share);
}
reverse.forEach((box, i) => box.addEventListener("change", () => { if (lastAdc[i] !== null) apply(i, lastAdc[i]); }));
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
function connected(kind, close) {
  conn = { kind, close };
  lastData = performance.now();
  setPill("on", "Connected · " + NAMES[kind]);
  potHints.forEach((h) => { h.textContent = "Set by the board"; });
  syncSource();
  say("Connected by " + NAMES[kind] + ". Knobs set speed · run switches start / stop machines 1–4 · alarm stops the line · part buttons finish a part · Good / Reject go to the OEE panel.");
}
async function disconnect(message) {
  gen++;
  const c = conn; conn = null;
  setPill(/lost|unplugged|stopped/i.test(message) ? "error" : "off", /lost|unplugged|stopped/i.test(message) ? "Disconnected · connection lost" : "Not connected");
  if (c) { try { await c.close(); } catch {} }
  lastAdc.fill(null);
  window.__board.stop();
  adc.forEach((el) => { el.textContent = "—"; });
  potHints.forEach((h) => { h.textContent = "Drag to slide"; });
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
  connected("usb", async () => { try { await reader.cancel(); } catch {} try { await piped; } catch {} try { await port.close(); } catch {} });
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
  connected("wifi", async () => { stopped = true; });
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
  remember.set("cnc-mqtt-url", url); remember.set("cnc-mqtt-topic", topic); remember.set("cnc-mqtt-user", user); remember.set("cnc-mqtt-pass", pass);
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
  const feed = splitter();
  client.on("message", (t, payload) => { if (my === gen && t === topic) feed(payload.toString() + "\n"); });
  client.on("offline", () => { if (my === gen && conn) setPill("error", "MQTT · reconnecting …"); });
  client.on("connect", () => { if (my === gen && conn) setPill("on", "Connected · MQTT"); });
  connected("mqtt", async () => { client.end(true); });
  say("Connected to the MQTT broker. Waiting for the ESP32 on topic “" + topic + "” …");
}
navigator.serial?.addEventListener("disconnect", () => { if (conn && conn.kind === "usb") disconnect("The board was unplugged."); });
async function openBle(my) {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [NUS] }, { namePrefix: "CNC-Knobs" }], optionalServices: [NUS] });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(NUS);
  const tx = await service.getCharacteristic(NUS_TX);
  const feed = splitter(), text = new TextDecoder();
  tx.addEventListener("characteristicvaluechanged", (e) => { if (my === gen) feed(text.decode(e.target.value)); });
  await tx.startNotifications();
  device.addEventListener("gattserverdisconnected", () => { if (my === gen) disconnect("Bluetooth connection lost. Press Connect to pair again."); });
  connected("ble", async () => { try { device.gatt.disconnect(); } catch {} });
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
    const hint = kind === "usb" ? " Close the Arduino IDE Serial Monitor if it is open." : kind === "wifi" ? "" : kind === "mqtt" ? " Check the broker address (the WebSocket one, e.g. wss://xxxx.s1.eu.hivemq.cloud:8884/mqtt), the user and the password." : " Check that the ESP32 is powered, Bluetooth is on in the computer, and the board is not connected to another device.";
    say("Could not connect: " + (error && error.message ? error.message : error) + "." + hint);
  }
});
syncSource();
})();
