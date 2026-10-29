// 04-zone2-control-panel.js - ZONE 2 - control-panel cards: run switches, door buttons, alarm, Good / Reject
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
// cp:panel
const CP = {"stations":[{"ax":[1.979,0.7269],"az":[0,-1.888],"ends":[[214.64684478348067,85.44842525286393],[452.1318511137074,172.6740532877329]]},{"ax":[1.979,0.7269],"az":[0,-1.888],"ends":[[214.64684478348067,85.44842525286393],[452.1318511137074,172.6740532877329]]},{"ax":[1.979,0.7269],"az":[0,-1.888],"ends":[[214.64684478348067,85.44842525286393],[452.1318511137074,172.6740532877329]]},{"ax":[1.979,0.7269],"az":[0,-1.888],"ends":[[214.64684478348067,85.44842525286393],[452.1318511137074,172.6740532877329]]}],"line":{"az":[0,-1.888]},"drop":{"latch":3.4,"tact":1.4},"travel":[-60,60]};
// Live control panel: every switch, button, knob and LED on the board, one drawing per station.
// Same knob API the board link uses: window.pots[i].value() / hold(t) / release(), window.onPotTurn(i, t).
// With the board connected the parts mirror its signals; without it, clicking them drives the line on screen.
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const board = () => window.__board;
const live = () => !!(board() && board().live);
const shift = (vec, d) => "translate(" + (vec[0] * d).toFixed(2) + " " + (vec[1] * d).toFixed(2) + ")";

/* ---------- one frame loop for every moving part ---------- */
const movers = [];
let frame = 0, last = 0;
function mover(el, vec, tau) {
  const m = { el, vec, tau, at: 0, target: 0, drawn: NaN, onDraw: null };
  movers.push(m);
  return m;
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  let moving = false;
  for (const m of movers) {
    m.at = still.matches ? m.target : m.at + (m.target - m.at) * (1 - Math.exp(-dt / m.tau));
    if (Math.abs(m.target - m.at) < 1e-3) m.at = m.target; else moving = true;
    if (m.at !== m.drawn) { m.drawn = m.at; m.el.setAttribute("transform", shift(m.vec, m.at)); if (m.onDraw) m.onDraw(m.at); }
  }
  frame = moving ? requestAnimationFrame(tick) : 0;
}
const kick = () => { if (!frame) { last = 0; frame = requestAnimationFrame(tick); } };
function press(m, drop) {
  m.target = -drop; kick();
  clearTimeout(m.timer);
  m.timer = setTimeout(() => { m.target = 0; kick(); }, 150);
}
function flash(card, text) {
  const hint = card.querySelector('[data-corner="hint"]');
  if (!hint) return;
  hint.dataset.flash = "";
  hint.textContent = text;
  clearTimeout(hint.timer);
  hint.timer = setTimeout(() => { delete hint.dataset.flash; }, 1600);
}

/* ---------- station boards ---------- */
window.pots = [];
const stations = [...document.querySelectorAll(".cp-card[data-station]")].map((card, index) => {
  const data = CP.stations[index];
  const stage = card.querySelector(".iso-stage"), svg = stage.querySelector("svg");
  const readout = card.querySelector("[data-readout]");
  const [TX0, TX1] = CP.travel;
  // the lever: t 0..1 is 0..200 % speed, the middle of the travel is 100 %
  const lever = mover(svg.querySelector('[data-part="lever"]'), data.ax, 0.12);
  let held = false;
  const toX = (t) => TX0 + (TX1 - TX0) * t;
  const valueOf = () => (lever.target - TX0) / (TX1 - TX0);
  lever.onDraw = (x) => {
    const t = (x - TX0) / (TX1 - TX0);
    if (window.onPotTurn) window.onPotTurn(index, t);
    const pct = Math.round(t * 200);
    stage.setAttribute("aria-valuenow", String(pct));
    stage.setAttribute("aria-valuetext", pct + " %");
  };
  lever.target = lever.at = toX(0.5);
  lever.el.setAttribute("transform", shift(data.ax, lever.at));
  const steer = (t) => { lever.target = toX(clamp(t, 0, 1)); kick(); };
  const shareAt = (event) => {
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    const [a, b] = data.ends, dx = b[0] - a[0], dy = b[1] - a[1];
    return ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy);
  };
  // switches: the run switch latches down while the machine may run, the door button dips on each press
  const run = mover(svg.querySelector('[data-part="run"]'), data.az, 0.06);
  const part = mover(svg.querySelector('[data-part="part"]'), data.az, 0.03);
  const s = { card, stage, readout, run, part, index, value: () => (lever.at - TX0) / (TX1 - TX0) };
  stage.addEventListener("pointerdown", (event) => {
    const hit = event.target.closest("[data-hit]");
    if (!hit) return;
    const what = hit.dataset.hit;
    if (what === "pot") {
      if (held) return flash(card, "Set by the board's knob");
      stage.setPointerCapture(event.pointerId); stage.dataset.drag = ""; steer(shareAt(event));
    } else if (what === "run") toggleRun(s);
    else if (what === "part") pressPart(s);
  });
  stage.addEventListener("pointermove", (event) => { if (held || stage.dataset.drag === undefined || !event.buttons) return; steer(shareAt(event)); });
  const endDrag = () => { delete stage.dataset.drag; };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); return toggleRun(s); }
    if (event.key === " ") { event.preventDefault(); return pressPart(s); }
    if (held) return;
    const step = event.shiftKey ? 1 / 40 : 1 / 10, now = valueOf();
    let to = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") to = now + step;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = now - step;
    if (event.key === "Home") to = 0;
    if (event.key === "End") to = 1;
    if (to === null) return;
    event.preventDefault();
    steer(Math.round(to * 40) / 40);
  });
  window.pots[index] = {
    value: s.value,
    hold(value) { held = true; stage.dataset.held = ""; steer(value); },
    release() { held = false; delete stage.dataset.held; kick(); },
  };
  return s;
});
window.pot = window.pots[0];

function toggleRun(s) {
  const b = board();
  if (!b) return;
  if (b.live) return flash(s.card, "Set by the board's run switch");
  b.local.run[s.index] = !b.local.run[s.index];
  sync();
}
// the station's tactile button opens / closes its machine's door (with the board, the board's button does)
function pressPart(s) {
  if (live()) return flash(s.card, "Set by the board's door button");
  press(s.part, CP.drop.tact);
  window.__line?.toggleDoor?.(s.index);
}

/* ---------- line board ---------- */
const lineCard = document.querySelector(".cp-card[data-line]");
const line = lineCard && (() => {
  const svg = lineCard.querySelector("svg"), stage = lineCard.querySelector(".iso-stage");
  const l = {
    card: lineCard, stage, readout: lineCard.querySelector("[data-readout]"),
    alarm: mover(svg.querySelector('[data-part="alarm"]'), CP.line.az, 0.06),
    good: mover(svg.querySelector('[data-part="good"]'), CP.line.az, 0.03),
    reject: mover(svg.querySelector('[data-part="reject"]'), CP.line.az, 0.03),
    power: svg.querySelector('[data-part="led-power"]'), io2: svg.querySelector('[data-part="led-io2"]'),
    count: { good: lineCard.querySelector('[data-cp="good"]'), reject: lineCard.querySelector('[data-cp="reject"]') },
    local: { good: 0, reject: 0 },
  };
  window.__qcLocal = l.local;
  stage.addEventListener("pointerdown", (event) => {
    const hit = event.target.closest("[data-hit]");
    if (hit) act(hit.dataset.hit);
  });
  stage.tabIndex = 0;
  stage.setAttribute("aria-label", "Line board: A toggles the alarm switch, G presses QC Good, R presses QC Reject");
  stage.addEventListener("keydown", (event) => {
    const what = { a: "alarm", g: "good", r: "reject" }[event.key.toLowerCase()];
    if (!what || event.metaKey || event.ctrlKey) return;
    event.preventDefault(); act(what);
  });
  return l;
})();
// the control page (control.html, through MQTT) presses QC Good / Reject here when no board is connected
window.__qcPress = (what) => act(what);
function act(what) {
  const b = board();
  if (!b) return;
  if (what === "alarm") {
    if (b.live) return flash(lineCard, "Set by the board's alarm switch");
    b.local.al = !b.local.al;
    return sync();
  }
  press(line[what], CP.drop.tact);
  if (b.live) return;            // the board's own button counts, this one only moves
  line.local[what]++;
  document.querySelector('.dash-oee button[data-part="' + (what === "good" ? "good" : "bad") + '"]')?.click();
  sync();
}

/* ---------- follow the board (or the switches on screen) ---------- */
function sync() {
  const b = board();
  if (!b) return;
  const src = b.live ? b : b.local;
  stations.forEach((s) => {
    const on = !!src.run[s.index];
    s.run.target = on ? -CP.drop.latch : 0;
    const door = !!window.__door?.[s.index];
    const state = src.al ? "alarm" : on && !door ? "run" : "stop";
    s.card.dataset.state = state;
    const text = (state === "alarm" ? "ALARM" : door ? "DOOR OPEN" : state === "run" ? "RUN" : "STOP") + (b.live ? " · " + b.stats[s.index].parts + (b.stats[s.index].parts === 1 ? " part" : " parts") : "");
    if (s.readout.textContent !== text) s.readout.textContent = text;
  });
  if (line) {
    line.alarm.target = src.al ? -CP.drop.latch : 0;
    line.card.dataset.state = src.al ? "alarm" : "run";
    line.io2.toggleAttribute("data-on", !!src.al);
    line.power.toggleAttribute("data-on", b.live);
    const text = (src.al ? "ALARM · line stopped" : "no alarm") + (b.live ? " · board" : "");
    if (line.readout.textContent !== text) line.readout.textContent = text;
    const good = b.live ? b.qc.good : line.local.good, reject = b.live ? b.qc.rej : line.local.reject;
    line.count.good.textContent = good; line.count.reject.textContent = reject;
  }
  kick();
}
const b0 = board();
if (b0) {
  b0.on("door", (i) => { if (stations[i]) press(stations[i].part, CP.drop.tact); });
  b0.on("good", () => line && press(line.good, CP.drop.tact));
  b0.on("reject", () => line && press(line.reject, CP.drop.tact));
  b0.on("live", sync);
}
setInterval(sync, 150);
sync();
})();
