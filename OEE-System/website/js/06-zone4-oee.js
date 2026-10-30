// 06-zone4-oee.js - ZONE 4 - OEE panel: A x P x Q, shift settings, timeline
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
// OEE panel: records when the machine runs, takes part counts from buttons, and reports
// A × P × Q for a chosen time frame.
//   A (availability) = run time ÷ recorded plan operating time
//   P (performance)  = ideal cycle × parts ÷ run time
//   Q (quality)      = good parts ÷ all parts
// Run = spindle spinning and at least one axis moved within the last 1.5 s.
// Plan operating time = the shift minus its break. Time with no record (page closed) is shown
// on its own and left out of A, rather than counted as running or stopped.
(() => {
  const root = document.querySelector(".oee");
  if (!root || !window.cnc) return;
  const q = (s) => root.querySelector(s);
  const qa = (s) => [...root.querySelectorAll(s)];
  const o = (name) => q(`[data-o="${name}"]`);
  const MIN = 60000;

  // ───────── settings (remembered in this browser) ─────────
  const inp = { start: q("#oee-start"), work: q("#oee-work"), end: q("#oee-end"), bstart: q("#oee-bstart"), blen: q("#oee-blen"), cycle: q("#oee-cycle"), clock: q("#oee-clockmode"), from: q("#oee-from"), to: q("#oee-to") };
  const segBtns = qa(".oee-seg button");
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const SETTINGS = "cnc-oee-settings-v3";
  const LOG = "cnc-oee-log-v3";
  let win = "shift";
  const saved = store.get(SETTINGS);
  if (saved) {
    for (const k of Object.keys(inp)) if (saved[k] !== undefined && inp[k]) inp[k].value = saved[k];
    if (saved.win) win = saved.win;
  }
  // a worker's day: shift end = start + work hours + break
  const fitEnd = () => {
    const work = Math.min(16, Math.max(1, Number(inp.work.value) || 8));
    const end = Math.min(24 * 60 - 1, toMin(inp.start.value) + Math.round(work * 60) + Math.max(0, Number(inp.blen.value) || 0));
    if (Number.isFinite(end)) inp.end.value = String(Math.floor(end / 60)).padStart(2, "0") + ":" + String(end % 60).padStart(2, "0");
  };
  const save = () => { const v = { win }; for (const k of Object.keys(inp)) v[k] = inp[k].value; store.set(SETTINGS, v); };

  const toMin = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const two = (n) => String(n).padStart(2, "0");
  const hhmm = (t) => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}`; };
  const hhmmss = (t) => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };
  const dur = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    if (s < 3600) return `${Math.floor(s / 60)} min ${two(s % 60)} s`;
    return `${Math.floor(s / 3600)} h ${two(Math.floor(s / 60) % 60)} min`;
  };
  const pc = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const midnight = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  // ───────── clock: the computer's clock, or a fast demo clock ─────────
  const DEMO_RATE = 60; // 1 s = 1 min
  const demo = { realAt: 0, vAt: 0, pending: true };
  const isDemo = () => inp.clock.value === "demo";
  function startDemo() {
    const s = settings();
    demo.realAt = Date.now();
    demo.vAt = midnight(Date.now()) + (Number.isFinite(s.start) ? s.start : 480) * MIN;
    demo.pending = true; // the demo clock starts with the first sample, so the shift starts recorded
  }
  const now = () => (isDemo() ? (demo.pending ? demo.vAt : demo.vAt + (Date.now() - demo.realAt) * DEMO_RATE) : Date.now());

  function settings() {
    const s = { start: toMin(inp.start.value), end: toMin(inp.end.value), bstart: toMin(inp.bstart.value), blen: Math.max(0, Number(inp.blen.value) || 0), cycle: Math.max(0, Number(inp.cycle.value) || 0) };
    return s;
  }
  // the shift (and its plan operating intervals) on the day of time t
  function shiftOf(t) {
    const s = settings();
    const d0 = midnight(t);
    const start = d0 + s.start * MIN, end = d0 + s.end * MIN;
    const bs = Math.max(start, Math.min(end, d0 + s.bstart * MIN));
    const be = Math.max(bs, Math.min(end, bs + s.blen * MIN));
    const plan = [[start, bs], [be, end]].filter(([a, b]) => b > a);
    let bad = "";
    if (!(end > start)) bad = "Shift end must be later than shift start.";
    else if (!Number.isFinite(s.bstart)) bad = "Set a break start time.";
    else if (s.blen > 0 && (d0 + s.bstart * MIN < start || d0 + (s.bstart + s.blen) * MIN > end)) bad = "The break must sit inside the shift.";
    return { start, end, bs, be, plan, bad, cycle: s.cycle };
  }
  function windowOf(t, sh) {
    if (win === "shift") return { w0: sh.start, w1: sh.end, bad: "" };
    if (win === "custom") {
      const d0 = midnight(t);
      const w0 = d0 + toMin(inp.from.value) * MIN, w1 = d0 + toMin(inp.to.value) * MIN;
      return { w0, w1, bad: w1 > w0 ? "" : "In a custom time frame, To must be later than From." };
    }
    const n = Number(win) * MIN;
    return { w0: t - n, w1: t, bad: "" };
  }

  // ───────── the record: [from, to, run, cause] segments and [time, good] parts ─────────
  // cause: why the line stood still (stops only; see window.__line.stopCause), "" when not known
  let log = { segs: [], parts: [] };
  function loadLog() {
    if (isDemo()) { log = { segs: [], parts: [] }; return; }
    const rec = store.get(LOG);
    log = rec && Array.isArray(rec.segs) && Array.isArray(rec.parts) ? rec : { segs: [], parts: [] };
    const keep = Date.now() - 8 * 24 * 60 * MIN; // a week of history is plenty
    log.segs = log.segs.filter((sg) => sg[1] >= keep);
    log.parts = log.parts.filter((p) => p[0] >= keep);
  }
  let dirty = false;
  const persist = () => { if (!isDemo() && dirty) { store.set(LOG, log); dirty = false; } };

  // ───────── sampling the machine ─────────
  let lastPos = null, lastMoveAt = -1e12, running = false;
  function sample() {
    const st = window.cnc.status();
    const real = Date.now();
    if (lastPos && Math.hypot(st.pos[0] - lastPos[0], st.pos[1] - lastPos[1], st.pos[2] - lastPos[2]) > 0.01) lastMoveAt = real;
    lastPos = st.pos;
    running = st.spindle > 0.4 && real - lastMoveAt < 1500;
    if (window.__board?.live) running = window.__board.lineRun();   // board: line runs when all 4 run switches are on and no alarm
    // the line: it runs when every machine on a product route runs; otherwise this says why not
    const cause = window.__line?.stopCause ? window.__line.stopCause() : null;
    if (cause !== null) running = !cause;
    if (isDemo() && demo.pending) { demo.pending = false; demo.realAt = real; }
    const t = now();
    const run = running ? 1 : 0;
    const tol = isDemo() ? 5000 * DEMO_RATE : 65000; // longer gaps are "not recorded"
    const last = log.segs[log.segs.length - 1];
    const why = run ? "" : cause || "";
    if (last && t >= last[1] && t - last[1] <= tol) {
      if (last[2] === run && (last[3] || "") === why) last[1] = t;
      else log.segs.push([last[1], t, run, why]);
    } else if (!last || t > last[1]) log.segs.push([t, t, run, why]);
    // cap the record so localStorage stays small
    if (log.segs.length > 20000) log.segs.splice(0, log.segs.length - 20000);
    dirty = true;
  }

  // ───────── parts ─────────
  // the board's QC buttons count here exactly like +1 Good / +1 Reject
  window.__board?.on("good", () => { log.parts.push([now(), 1]); dirty = true; persist(); render(); });
  window.__board?.on("reject", () => { log.parts.push([now(), 0]); dirty = true; persist(); render(); });
  const runLegend = [...root.querySelectorAll(".oee-legend span")].find((x) => /^Run:/.test(x.textContent.trim()));
  const runLegendText = runLegend ? runLegend.lastChild.textContent : "";
  window.__board?.on("live", (on) => { if (runLegend) runLegend.lastChild.textContent = on ? "Run: board · all 4 run switches on, no alarm" : runLegendText; });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.part === "good" || b.dataset.part === "bad") { log.parts.push([now(), b.dataset.part === "good" ? 1 : 0]); dirty = true; persist(); render(); }
    if (b.dataset.part === "undo") { log.parts.pop(); dirty = true; persist(); render(); }
    if (b.dataset.win) { win = b.dataset.win; if (win === "custom") seedCustom(); save(); render(); }
    if (b.dataset.oee === "clear") {
      if (!b.hasAttribute("data-armed")) {
        b.setAttribute("data-armed", "");
        b.textContent = "Click again to clear";
        setTimeout(() => { b.removeAttribute("data-armed"); b.textContent = "Clear record"; }, 3000);
        return;
      }
      b.removeAttribute("data-armed");
      b.textContent = "Clear record";
      log = { segs: [], parts: [] };
      if (isDemo()) startDemo(); else store.del(LOG);
      render();
    }
  });
  function seedCustom() {
    // a fresh custom frame starts from the shift
    if (!inp.from.value) inp.from.value = inp.start.value;
    if (!inp.to.value) inp.to.value = inp.end.value;
  }
  fitEnd();
  for (const el of Object.values(inp)) el.addEventListener("change", () => {
    if (el === inp.from || el === inp.to) win = "custom";
    if (el === inp.start || el === inp.work || el === inp.blen) fitEnd();
    if (el === inp.clock) { if (isDemo()) startDemo(); loadLog(); }
    save();
    render();
  });

  // ───────── the numbers ─────────
  function measure(t, sh, w0, w1) {
    const e1 = Math.min(w1, t); // only time that has passed counts
    let plan = 0, elapsed = 0, run = 0, stop = 0;
    for (const [a, b] of sh.plan) { plan += overlap(w0, w1, a, b); elapsed += overlap(w0, e1, a, b); }
    for (const [a, b, r] of log.segs) {
      if (b < w0 || a > e1) continue;
      for (const [p0, p1] of sh.plan) {
        const ov = Math.max(0, Math.min(b, e1, w1, p1) - Math.max(a, w0, p0));
        if (r) run += ov; else stop += ov;
      }
    }
    let good = 0, bad = 0;
    for (const [pt, g] of log.parts) if (pt >= w0 && pt <= e1) { if (g) good++; else bad++; }
    const rec = run + stop;
    const parts = good + bad;
    const A = rec > 0 ? run / rec : NaN;
    const P = parts > 0 && run > 0 && sh.cycle > 0 ? (sh.cycle * 1000 * parts) / run : NaN;
    const Q = parts > 0 ? good / parts : NaN;
    return { plan, elapsed, run, stop, gap: Math.max(0, elapsed - rec), rec, good, bad, parts, A, P, Q, OEE: A * P * Q };
  }

  // ───────── drawing ─────────
  // one line under the title: the shift and the time frame in use (both are set on the control page)
  const shiftLine = document.createElement("p");
  shiftLine.className = "oee-shiftline";
  q(".oee-head").after(shiftLine);
  const WIN_NAME = { 15: "last 15 min", 60: "last 1 h", 240: "last 4 h", shift: "shift", custom: "custom" };
  const svg = q(".oee-bar");
  const msg = q(".oee-msg");
  let shownSvg = "";
  function render() {
    const t = now();
    const sh = shiftOf(t);
    const { w0, w1, bad: wbad } = windowOf(t, sh);
    const bad = sh.bad || wbad;
    msg.textContent = bad;
    msg.hidden = !bad;
    for (const b of segBtns) b.setAttribute("aria-checked", String(b.dataset.win === win));
    o("window").textContent = Number.isFinite(w0) && Number.isFinite(w1) ? `${hhmm(w0)} – ${hhmm(Math.min(w1, Math.max(w0, t)))}${w1 > t ? ` (to ${hhmm(w1)})` : ""}` : "";
    const st = settings();
    o("shiftsum").textContent = `${inp.start.value}–${inp.end.value} · work ${inp.work.value} h · break ${inp.bstart.value}, ${st.blen} min · cycle ${st.cycle} s · ${isDemo() ? "demo clock" : "real time"}`;
    shiftLine.textContent = `Shift ${inp.start.value}–${inp.end.value} · break ${inp.bstart.value} (${st.blen} min) · time frame: ${WIN_NAME[win] || win} ${o("window").textContent}${isDemo() ? " · demo clock" : ""}`;
    o("clock").textContent = hhmmss(t);
    o("clock").dateTime = new Date(t).toISOString();
    const chip = o("state");
    chip.dataset.run = running ? "1" : "0";
    chip.textContent = window.__board?.live && window.__board.al ? "ALARM" : running ? "RUN" : "STOP";
    if (sh.bad) { svg.innerHTML = ""; shownSvg = ""; return; }

    const m = measure(t, sh, w0, w1);
    o("plan").textContent = dur(m.elapsed);
    o("planof").textContent = m.plan > m.elapsed ? `of ${dur(m.plan)} in this time frame` : "in this time frame";
    o("run").textContent = dur(m.run);
    o("stop").textContent = dur(m.stop);
    o("gap").textContent = dur(m.gap);
    o("good").textContent = String(m.good);
    o("bad").textContent = String(m.bad);
    o("a").textContent = pc(m.A);
    o("af").textContent = m.rec > 0 ? `${dur(m.run)} ÷ ${dur(m.rec)} recorded` : t < sh.start ? "shift has not started" : "nothing recorded yet";
    o("p").textContent = pc(m.P);
    o("pf").textContent = m.parts > 0 ? (m.run > 0 ? `${sh.cycle} s × ${m.parts} parts ÷ ${dur(m.run)}${m.P > 1 ? " · above 100%: check the ideal cycle" : ""}` : "no run time yet") : "press +1 Good or +1 Reject";
    o("q").textContent = pc(m.Q);
    o("qf").textContent = m.parts > 0 ? `${m.good} good ÷ ${m.parts} parts` : "press +1 Good or +1 Reject";
    o("oee").textContent = pc(m.OEE);
    o("of").textContent = Number.isFinite(m.OEE) ? `${pc(m.A)} × ${pc(m.P)} × ${pc(m.Q)}` : "needs A, P and Q";

    // timeline: the shift, widened to take in the time frame if it reaches outside it
    const r0 = Math.min(sh.start, w0), r1 = Math.max(sh.end, w1);
    const W = Math.max(300, Math.round(svg.clientWidth || svg.getBoundingClientRect().width || 600));
    const H = 92, L = 10, R = W - 10, Y = 34, BH = 34;
    const x = (v) => L + ((v - r0) / (r1 - r0)) * (R - L);
    const X = (v) => x(v).toFixed(1);
    const upto = Math.max(r0, Math.min(r1, t));
    const p = [];
    p.push(`<defs><pattern id="oee-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="oee-future"/><line x1="0" y1="0" x2="0" y2="6" class="oee-hatch-line"/></pattern><pattern id="oee-off" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" class="oee-future"/><circle cx="2" cy="2" r=".6" class="oee-off-line"/></pattern></defs>`);
    p.push(`<rect class="oee-future" x="${L}" y="${Y}" width="${R - L}" height="${BH}"/>`);
    if (upto > r0) p.push(`<rect fill="url(#oee-hatch)" x="${L}" y="${Y}" width="${(x(upto) - L).toFixed(1)}" height="${BH}"/>`);
    for (const [a, b, rr] of log.segs) {
      const a1 = Math.max(a, r0), b1 = Math.min(b, r1);
      if (b1 <= a1) continue;
      p.push(`<rect class="${rr ? "oee-run" : "oee-stop"}" x="${X(a1)}" y="${Y}" width="${Math.max(0.6, x(b1) - x(a1)).toFixed(2)}" height="${BH}"/>`);
    }
    // outside the shift and the break are not plan time: draw them over the record
    if (r0 < sh.start) p.push(`<rect fill="url(#oee-off)" x="${L}" y="${Y}" width="${(x(sh.start) - L).toFixed(1)}" height="${BH}"/>`);
    if (r1 > sh.end) p.push(`<rect fill="url(#oee-off)" x="${X(sh.end)}" y="${Y}" width="${(R - x(sh.end)).toFixed(1)}" height="${BH}"/>`);
    if (sh.be > sh.bs) p.push(`<rect class="oee-break" x="${X(sh.bs)}" y="${Y}" width="${(x(sh.be) - x(sh.bs)).toFixed(1)}" height="${BH}"/>`);
    p.push(`<rect class="oee-frame" x="${L}" y="${Y}" width="${R - L}" height="${BH}"/>`);
    // dim what lies outside the time frame, and frame the time frame itself
    const fx0 = Math.max(L, x(w0)), fx1 = Math.min(R, x(w1));
    if (fx0 > L) p.push(`<rect class="oee-dim" x="${L}" y="${Y}" width="${(fx0 - L).toFixed(1)}" height="${BH}"/>`);
    if (fx1 < R) p.push(`<rect class="oee-dim" x="${fx1.toFixed(1)}" y="${Y}" width="${(R - fx1).toFixed(1)}" height="${BH}"/>`);
    if (fx1 > fx0) p.push(`<rect class="oee-win" x="${fx0.toFixed(1)}" y="${Y - 3}" width="${(fx1 - fx0).toFixed(1)}" height="${BH + 6}"/>`);
    // part marks above the bar
    for (const [pt, g] of log.parts) if (pt >= r0 && pt <= r1) p.push(`<line class="${g ? "oee-mark-good" : "oee-mark-bad"}" x1="${X(pt)}" x2="${X(pt)}" y1="${Y - 11}" y2="${Y - 4}"/>`);
    // hour ticks and labels under the bar
    const hour = 60 * MIN;
    const every = (x(r0 + hour) - x(r0)) < 30 ? 2 : 1;
    for (let h = Math.ceil(r0 / hour) * hour, i = 0; h <= r1; h += hour, i++) {
      p.push(`<line class="oee-tick" x1="${X(h)}" x2="${X(h)}" y1="${Y + BH}" y2="${Y + BH + 4}"/>`);
      if (new Date(h).getHours() % every === 0 && x(h) > L + 14 && x(h) < R - 14) p.push(`<text x="${X(h)}" y="${Y + BH + 16}" text-anchor="middle">${two(new Date(h).getHours())}</text>`);
    }
    // key times above: shift start and end
    p.push(`<text class="oee-key" x="${X(sh.start)}" y="${Y - 16}" text-anchor="${x(sh.start) < L + 30 ? "start" : "middle"}">${hhmm(sh.start)}</text>`);
    p.push(`<text class="oee-key" x="${X(sh.end)}" y="${Y - 16}" text-anchor="${x(sh.end) > R - 30 ? "end" : "middle"}">${hhmm(sh.end)}</text>`);
    // now
    if (t >= r0 && t <= r1) p.push(`<line class="oee-nowline" x1="${X(t)}" x2="${X(t)}" y1="${Y - 6}" y2="${Y + BH + 6}"/>`);
    const key = p.join("");
    if (key !== shownSvg) { svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = key; shownSvg = key; }
    svg.setAttribute("aria-label", `Shift ${hhmm(sh.start)} to ${hhmm(sh.end)}, break ${hhmm(sh.bs)} to ${hhmm(sh.be)}. Time frame ${hhmm(w0)} to ${hhmm(w1)}: run ${dur(m.run)}, stopped ${dur(m.stop)}, OEE ${pc(m.OEE)}.`);
  }
  addEventListener("resize", () => { shownSvg = ""; render(); });

  // ───────── the timeline, large: each stop led out to its cause ─────────
  const zoomBtn = Object.assign(document.createElement("button"), { type: "button", className: "lb-btn oee-expand", textContent: "⤢ ขยาย", title: "ขยายกราฟ · ดูสาเหตุที่หยุด" });
  q(".oee-chart").append(zoomBtn);
  const zoom = document.createElement("div");
  zoom.className = "oee-zoom"; zoom.hidden = true;
  zoom.setAttribute("role", "dialog"); zoom.setAttribute("aria-modal", "true"); zoom.setAttribute("aria-label", "Shift timeline and stop causes");
  zoom.innerHTML = `<div class="oz-box"><div class="oz-h"><b>Shift timeline · สาเหตุที่หยุด</b><span data-z="range"></span><button type="button" class="lb-btn" data-z="close" aria-label="Close">✕</button></div>
    <div class="oz-chart"><svg data-z="svg"></svg></div>
    <div class="oz-grid"><div><h4>เวลาหยุดตามสาเหตุ</h4><div data-z="sum"></div></div><div><h4>ทุกช่วงที่หยุด</h4><div class="oz-list" data-z="list"></div></div></div></div>`;
  document.body.append(zoom);
  const zq = (k) => zoom.querySelector(`[data-z="${k}"]`);
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const causeOf = (c) => c || "ไม่ทราบสาเหตุ";
  // the stops inside [r0, min(r1, t)], next ones with the same cause joined
  function stopsIn(r0, r1) {
    const out = [];
    for (const [a, b, r, c] of log.segs) {
      if (r || b <= r0 || a >= r1) continue;
      const a1 = Math.max(a, r0), b1 = Math.min(b, r1), last = out[out.length - 1];
      if (last && last.c === (c || "") && a1 - last.b < 1000) last.b = b1;
      else out.push({ a: a1, b: b1, c: c || "" });
    }
    return out.filter((s) => s.b > s.a);
  }
  function drawZoom() {
    if (zoom.hidden) return;
    const t = now(), sh = shiftOf(t);
    if (sh.bad) return;
    const r0 = sh.start, r1 = sh.end, upto = Math.min(t, r1);
    zq("range").textContent = `${hhmm(r0)} – ${hhmm(r1)}${isDemo() ? " · demo clock" : ""}`;
    const W = Math.max(640, Math.min(1500, zoom.querySelector(".oz-chart").clientWidth || 1000));
    const L = 16, R = W - 16, Y = 30, BH = 46;
    const x = (v) => L + ((v - r0) / (r1 - r0)) * (R - L), X = (v) => x(v).toFixed(1);
    const p = [`<rect class="oee-future" x="${L}" y="${Y}" width="${R - L}" height="${BH}"/>`];
    for (const [a, b, rr] of log.segs) {
      const a1 = Math.max(a, r0), b1 = Math.min(b, r1);
      if (b1 > a1) p.push(`<rect class="${rr ? "oee-run" : "oee-stop"}" x="${X(a1)}" y="${Y}" width="${Math.max(0.8, x(b1) - x(a1)).toFixed(2)}" height="${BH}"/>`);
    }
    if (sh.be > sh.bs) p.push(`<rect class="oee-break" x="${X(sh.bs)}" y="${Y}" width="${(x(sh.be) - x(sh.bs)).toFixed(1)}" height="${BH}"/>`);
    p.push(`<rect class="oee-frame" x="${L}" y="${Y}" width="${R - L}" height="${BH}"/>`);
    const hour = 60 * MIN;
    for (let h = Math.ceil(r0 / hour) * hour; h <= r1; h += hour) {
      p.push(`<line class="oee-tick" x1="${X(h)}" x2="${X(h)}" y1="${Y + BH}" y2="${Y + BH + 5}"/><text x="${X(h)}" y="${Y + BH + 17}" text-anchor="middle">${hhmm(h)}</text>`);
    }
    if (t >= r0 && t <= r1) p.push(`<line class="oee-nowline" x1="${X(t)}" x2="${X(t)}" y1="${Y - 8}" y2="${Y + BH + 8}"/>`);
    // labels for the longest stops, in lanes under the bar so none overlap; a lead from each stop to its label
    const stops = stopsIn(r0, upto);
    const top = [...stops].sort((a, b) => (b.b - b.a) - (a.b - a.a)).slice(0, 16).sort((a, b) => a.a - b.a);
    const lanes = [], leads = [], tags = [], LANE0 = Y + BH + 40, LH = 30;
    for (const s of top) {
      const text = `${hhmm(s.a)}–${hhmm(s.b)} · ${dur(s.b - s.a)} · ${causeOf(s.c)}`;
      const w = Math.min(R - L, text.length * 6.4 + 16), cx = (x(s.a) + x(s.b)) / 2;
      const lx = Math.max(L, Math.min(R - w, cx - w / 2));
      let lane = lanes.findIndex((end) => end + 8 < lx);
      if (lane < 0) { if (lanes.length >= 6) continue; lane = lanes.length; lanes.push(0); }
      lanes[lane] = lx + w;
      const ly = LANE0 + lane * LH;
      leads.push(`<polyline class="oz-lead" points="${cx.toFixed(1)},${Y + BH} ${cx.toFixed(1)},${ly - 16} ${(lx + w / 2).toFixed(1)},${ly - 16} ${(lx + w / 2).toFixed(1)},${ly - 11}"/>`,
        `<circle class="oz-dot" cx="${cx.toFixed(1)}" cy="${Y + BH}" r="3"/>`);
      tags.push(`<rect class="oz-tag" x="${lx.toFixed(1)}" y="${ly - 11}" width="${w.toFixed(1)}" height="20" rx="4"/>`,
        `<text class="oz-tag-t" x="${(lx + 8).toFixed(1)}" y="${ly + 3}">${esc(text)}</text>`);
    }
    p.push(...leads, ...tags);   // the labels over every lead, so a lead never runs across a label
    const H = LANE0 + Math.max(1, lanes.length) * LH + 6;
    const svgEl = zq("svg");
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`); svgEl.setAttribute("width", W); svgEl.setAttribute("height", H);
    svgEl.innerHTML = p.join("") + (stops.length ? "" : `<text x="${W / 2}" y="${LANE0}" text-anchor="middle" class="oz-none">ไม่มีช่วงหยุดในกะนี้ (จนถึงตอนนี้)</text>`);
    // time stopped by cause, longest first
    const by = {};
    for (const s of stops) by[causeOf(s.c)] = (by[causeOf(s.c)] || 0) + (s.b - s.a);
    const total = Object.values(by).reduce((n, v) => n + v, 0);
    zq("sum").innerHTML = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([c, v]) =>
      `<div class="oz-row"><span>${esc(c)}</span><span class="oz-bar"><i style="width:${(v / total * 100).toFixed(1)}%"></i></span><b>${dur(v)}</b><em>${Math.round(v / total * 100)}%</em></div>`).join("")
      + (total ? `<div class="oz-row oz-total"><span>รวม</span><span></span><b>${dur(total)}</b><em></em></div>` : `<p class="oz-none">—</p>`);
    zq("list").innerHTML = stops.slice().reverse().map((s) => `<div><time>${hhmm(s.a)}–${hhmm(s.b)}</time><b>${dur(s.b - s.a)}</b><span>${esc(causeOf(s.c))}</span></div>`).join("") || `<p class="oz-none">—</p>`;
  }
  const openZoom = () => { zoom.hidden = false; drawZoom(); zq("close").focus(); };
  const closeZoom = () => { zoom.hidden = true; zoomBtn.focus(); };
  zoomBtn.addEventListener("click", openZoom);
  zq("close").addEventListener("click", closeZoom);
  zoom.addEventListener("click", (e) => { if (e.target === zoom) closeZoom(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !zoom.hidden) closeZoom(); });
  setInterval(drawZoom, 1000);

  // ───────── start ─────────
  if (isDemo()) startDemo();
  loadLog();
  render();
  setInterval(() => { sample(); render(); }, 250);
  setInterval(persist, 2000);
  addEventListener("pagehide", () => { dirty = true; persist(); });
  // the shift and time frame are set on the control page (kept by the server's control-hub) for every screen
  const applySettings = (s) => {
    if (!s) return;
    let changed = false, clock = false;
    for (const k of ["start", "work", "bstart", "blen", "cycle", "clock", "from", "to"])
      if (s[k] !== undefined && inp[k] && String(inp[k].value) !== String(s[k])) { inp[k].value = s[k]; changed = true; if (k === "clock") clock = true; }
    if (s.win && String(s.win) !== win) { win = String(s.win); changed = true; }
    if (!changed) return;
    fitEnd();
    if (clock) { if (isDemo()) startDemo(); loadLog(); }
    save(); render();
  };
  const clearRecord = () => { log = { segs: [], parts: [] }; if (isDemo()) startDemo(); else store.del(LOG); render(); };
  // ───────── links: the other pages, and the server's own (LINKS in server/.env, e.g. the Google Sheet) ─────────
  const linkBox = document.createElement("nav");
  linkBox.className = "oee-links"; linkBox.setAttribute("aria-label", "Links");
  root.append(linkBox);
  const sub = (name) => /^oee\./.test(location.hostname) ? `${location.protocol}//${location.hostname.replace(/^oee\./, name + ".")}/` : null;
  const BASIC = [
    { icon: "🎛", name: "Control", note: "ดูสัญญาณ / ควบคุม", url: sub("control") || "control.html" },
    { icon: "📈", name: "Grafana", note: "กราฟสัญญาณสด", url: sub("grafana") || `${location.protocol}//${location.hostname || "192.168.1.107"}:3000/` },
    // pgweb: sql.<domain> from outside, or on the server itself only (it listens on 127.0.0.1)
    { icon: "🗄", name: "SQL", note: "ดู database · อ่านอย่างเดียว", url: sub("sql") || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "http://127.0.0.1:8081/" : null) },
    { icon: "🔌", name: "Wiring map", note: "แผนผังต่อสายบอร์ด", url: "wiring-map.html" },
    { icon: "📟", name: "Board", note: "หน้าเว็บในบอร์ด · Wi-Fi เดียวกัน", url: "http://192.168.1.200/" },
    { icon: "💻", name: "GitHub", note: "คู่มือ / โค้ด", url: "https://github.com/tazriqq/Smart-Factory-G3" },
  ].filter((l) => l.url);
  const ICON = { "google sheet": "📊", sheet: "📊" };
  let extra = [];
  function drawLinks() {
    const all = [...extra.map((l) => ({ icon: ICON[l.name.toLowerCase()] || "🔗", note: /docs\.google\.com\/spreadsheets/.test(l.url) ? "สรุป OEE / Events / Daily report" : "", ...l })), ...BASIC]
      .filter((l, i, a) => a.findIndex((x) => x.name.toLowerCase() === l.name.toLowerCase()) === i);
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    linkBox.innerHTML = `<span class="oee-group-name">Links</span>` + all.map((l) =>
      `<a href="${esc(l.url)}" target="_blank" rel="noopener"><i>${l.icon}</i><b>${esc(l.name)}</b>${l.note ? `<small>${esc(l.note)}</small>` : ""}</a>`).join("");
  }
  drawLinks();
  const setLinks = (list) => { const k = JSON.stringify(list); if (k === JSON.stringify(extra)) return; extra = Array.isArray(list) ? list : []; drawLinks(); };

  window.oee = { applySettings, setLinks, clear: clearRecord, measure: () => { const t = now(); const sh = shiftOf(t); const w = windowOf(t, sh); return measure(t, sh, w.w0, w.w1); }, log: () => log, now,
    frame: () => { const t = now(); const w = windowOf(t, shiftOf(t)); return { t, w0: w.w0, w1: w.w1, bad: w.bad, fixed: win === "shift" || win === "custom" }; } };
})();
})();
