// 01-machine-sandbox.js - Gives each machine's script its own 'document' and clock (loaded first, in <head>)
// Each machine drawing came from its own page. Give every machine script a "document"
// that only sees that machine's part of this page, so their selectors never collide.
(function(){
  const real = document;
  const cache = {};
  function make(id){
    const roots = () => [...real.querySelectorAll('[data-mx="' + id + '"]')];
    const one = (sel) => { for (const r of roots()) { if (r.matches(sel)) return r; const f = r.querySelector(sel); if (f) return f; } return null; };
    const all = (sel) => roots().flatMap((r) => (r.matches(sel) ? [r] : []).concat([...r.querySelectorAll(sel)]));
    const over = {
      querySelector: one,
      querySelectorAll: all,
      getElementById: (x) => one('#' + CSS.escape(x)),
      getElementsByClassName: (c) => all('.' + c.trim().split(/\s+/).map(CSS.escape).join('.')),
      getElementsByTagName: (t) => all(t),
    };
    Object.defineProperty(over, 'body', { get: () => roots()[0]?.firstElementChild || real.body });
    Object.defineProperty(over, 'documentElement', { get: () => roots()[0] || real.documentElement });
    return new Proxy(real, {
      get(t, p) {
        if (p in over) return over[p];
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }
  // per-machine clock: each machine's animation runs on its own time, scaled by its knob
  window.__speeds = window.__speeds || [1, 1, 1, 1];
  const rt = performance.now.bind(performance), rraf = requestAnimationFrame.bind(window), rcaf = cancelAnimationFrame.bind(window);
  const clocks = {};
  // the line's animations (the machine drawings, and the line itself: window.__mx.raf) draw at most 30 frames a
  // second, all in the same browser frames: in between nothing changes, so the browser has nothing to paint.
  // Callbacks of one browser frame share its timestamp: every loop waiting for this slot draws in it.
  const FRAME_MS = 1000 / 30 - 2, ids = {};
  let seq = 0, slotAt = -1e9;   // a request may wait a few browser frames: its handle maps to whichever is pending
  const due = (ts) => ts === slotAt || (ts - slotAt >= FRAME_MS && (slotAt = ts, true));
  function gated(cb) {
    const k = ++seq;
    const step = (ts) => { if (!due(ts)) { ids[k] = rraf(step); return; } delete ids[k]; cb(ts); };
    ids[k] = rraf(step);
    return k;
  }
  const ungate = (k) => { if (ids[k] !== undefined) { rcaf(ids[k]); delete ids[k]; } };
  function time(i) {
    if (clocks[i]) return clocks[i];
    let r = rt(), v = r;
    const now = () => { const n = rt(), k = window.__setup?.[i] || window.__idle?.(i) ? 0 : window.__speeds[i] * (window.__gate ? window.__gate(i) : 1); if (!window.__paused) v += (n - r) * (k > 0 ? Math.max(0.02, k) : 0); r = n; return v; };   // a stopped machine (0 %) or one with no part yet stands still
    return (clocks[i] = { now, raf: (cb) => gated(() => cb(now())), caf: ungate, perf: { now, timeOrigin: performance.timeOrigin } });
  }
  window.__mx = { doc: (id) => cache[id] || (cache[id] = make(id)), time, raf: gated };
})();
