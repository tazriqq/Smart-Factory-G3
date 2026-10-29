// 15-zone3-factory-line.js - ZONE 3 - line 1: places the machines on the floor, conveyors, parts flow, line stats
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
// Line 1: places the four machine drawings on one floor, draws the conveyors between them
// and moves parts from machine to machine.
const FW = 4300, FH = 2300;              // floor design size, px
const O = [1200, 560];                    // floor origin on screen; u runs right-down, v runs left-down
const S = (u, v) => [O[0] + (u - v), O[1] + (u + v) / 2];

// The machines stand on a 2 × 2 grid of the floor: the back row runs left to right,
// the line turns toward you, and the front row runs back again (a U-shaped line).
// u, v: the machine's base centre on the floor. fx, fy: where that base centre sits inside
// its drawing (0..1). ar: drawing height / width. mirror: drawing seen from the other side, flipped.
const DU = 780, DV = 900;
const MACHINES = [
  { id: 'lnc8',  no: '01', name: 'Okuma LNC-8',  u: 0,  v: 0,  w: 860, ar: 470 / 640, fx: 0.512, fy: 0.679, ru: 264, rv: 83, mirror: false, tagH: 400, cycle: 18, view: [60, 30] },
  { id: 'gfir',  no: '02', name: 'GFIR CK0620',  u: DU, v: 0,  w: 600, ar: 560 / 640, fx: 0.518, fy: 0.787, ru: 148, rv: 45, mirror: false, tagH: 400, cycle: 30, view: [62, 28] },
  { id: 'gfir2', no: '03', name: 'GFIR CK0620',  u: DU, v: DV, w: 600, ar: 560 / 640, fx: 0.518, fy: 0.787, ru: 148, rv: 45, mirror: false, tagH: 400, cycle: 24, view: [62, 28] },
  { id: 'l250e', no: '04', name: 'GENOS L250E',  u: 0,  v: DV, w: 680, ar: 1,         fx: 0.527, fy: 0.778, ru: 185, rv: 63, mirror: false, tagH: 420, cycle: 36, view: [62, 34] },
];
MACHINES.forEach((m) => {
  const [ax, ay] = S(m.u, m.v);
  m.h = m.w * m.ar;
  m.x = ax - m.fx * m.w; m.y = ay - m.fy * m.h;
  m.tag = [ax, ay - m.tagH];
  m.z = 10 + Math.round((m.u + m.v) / 10);
});
// Products: which machines make product A and which make B, in order. "12-34" = A: 01 → 02, B: 03 → 04;
// "1234-" = one product through all four (the U-shaped line). A machine left out of both stands idle.
// With a board connected the board holds the route (it makes the parts); without one it is kept in this browser.
const PRODUCTS = ['A', 'B'];
const ROUTE_KEY = 'lf-route';
function parseRoute(t) {
  const r = [[], []]; let p = 0;
  for (const c of String(t || '').replace(/\s/g, '')) {
    if (c === '-') { if (++p > 1) return null; continue; }
    const i = '1234'.indexOf(c);
    if (i < 0 || r[0].includes(i) || r[1].includes(i)) return null;
    r[p].push(i);
  }
  return r[0].length + r[1].length ? r : null;
}
const routeText = (r) => r.map((ms) => ms.map((i) => i + 1).join('')).join('-');
let ROUTE = parseRoute((() => { try { return localStorage.getItem(ROUTE_KEY); } catch { return null; } })()) || [[0, 1, 2, 3], []];
const prodOf = (i) => ROUTE.findIndex((ms) => ms.includes(i));   // 0 = A, 1 = B, -1 = idle
// what each product is (code, name; set on the control page, kept by the server's control-hub) and the line
let ITEMS = { A: { code: '', name: '' }, B: { code: '', name: '' } }, LINE_ID = 'line1';
const itemText = (p) => { const it = ITEMS[PRODUCTS[p]] || {}; return [it.code, it.name].filter(Boolean).join(' '); };

// conveyors: start on the floor (u, v) and run along one axis per move
const TUCK = 30;
// a route's last machine sends its parts out on a belt this way: along axis, direction, length
const OUT = [['v', -1, 445], ['u', 1, 260], ['u', 1, 260], ['v', 1, 260]];
function linkBelt(a, b, lane) {
  const A = MACHINES[a], Z = MACHINES[b];
  if (A.v === Z.v) { const d = Math.sign(Z.u - A.u); return { start: S(A.u + d * (A.ru - TUCK), A.v), moves: [['u', d * (Math.abs(Z.u - A.u) - A.ru - Z.ru + 2 * TUCK)]] }; }
  if (A.u === Z.u) { const d = Math.sign(Z.v - A.v); return { start: S(A.u, A.v + d * (A.rv - TUCK)), moves: [['v', d * (Math.abs(Z.v - A.v) - A.rv - Z.rv + 2 * TUCK)]] }; }
  // corner to corner: out to the aisle between the two rows, along it, and in
  const d = Math.sign(Z.v - A.v), v0 = A.v + d * (A.rv - TUCK), v1 = Z.v - d * (Z.rv - TUCK), mid = (A.v + Z.v) / 2 + lane;
  return { start: S(A.u, v0), moves: [['v', mid - v0], ['u', Z.u - A.u], ['v', v1 - mid]] };
}
function layoutBelts() {
  const list = [];
  ROUTE.forEach((ms, p) => ms.forEach((a, k) => {
    const b = ms[k + 1], m = MACHINES[a];
    if (b !== undefined) { list.push({ id: `C${a + 1}${b + 1}`, from: a, to: b, product: p, ...linkBelt(a, b, p * 90) }); return; }
    const [ax, d, len] = OUT[a];
    list.push({ id: `O${a + 1}`, from: a, to: 9, product: p, start: ax === 'u' ? S(m.u + d * (m.ru - TUCK), m.v) : S(m.u, m.v + d * (m.rv - TUCK)), moves: [[ax, d * len]] });
  }));
  // each belt is drawn just above the machine it leaves (or the one it enters, when that one is behind)
  list.forEach((b) => { const zs = [MACHINES[b.from]?.z, MACHINES[b.to]?.z].filter((z) => z !== undefined); b.z = Math.min(...zs) + 1; });
  return list;
}
const BELTS = [];
const BW = 64, BH = 30, GAP = 70, SPEED = 60;

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const view = document.querySelector('.line-view');
const floor = document.querySelector('.line-floor');
const ground = floor.querySelector('.lf-ground');
const beltsSvg = floor.querySelector('.lf-belts');
const tagsBox = view.querySelector('.lf-tags');
floor.style.width = FW + 'px'; floor.style.height = FH + 'px';
for (const s of [ground, beltsSvg]) { s.setAttribute('width', FW); s.setAttribute('height', FH); s.setAttribute('viewBox', `0 0 ${FW} ${FH}`); }

/* ---------- ground ---------- */
(() => {
  // invert the projection at the floor's corners to find how much floor to draw
  const inv = ([x, y]) => { const a = x - O[0], b = (y - O[1]) * 2; return [(a + b) / 2, (b - a) / 2]; };
  const cs = [[0, 0], [FW, 0], [0, FH], [FW, FH]].map(inv);
  const u0 = Math.min(...cs.map((c) => c[0])), u1 = Math.max(...cs.map((c) => c[0]));
  const v0 = Math.min(...cs.map((c) => c[1])), v1 = Math.max(...cs.map((c) => c[1]));
  const step = 100;
  const g = el('g', {}, ground);
  for (let u = Math.ceil(u0 / step) * step; u <= u1; u += step) { const a = S(u, v0), b = S(u, v1); el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'gr-grid' }, g); }
  for (let v = Math.ceil(v0 / step) * step; v <= v1; v += step) { const a = S(u0, v), b = S(u1, v); el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'gr-grid' }, g); }
  const t = el('text', { x: 24, y: FH - 24, class: 'gr-text' }, ground); t.textContent = 'LINE 1 · FLOOR GRID 1 m';
})();

/* ---------- machines ---------- */
// The drawings were baked from their own cameras (azimuth/elevation in m.view), so their floor edges
// don't follow the grid. Shear them in 2D about the base centre: x and verticals stay as they are,
// y' = c·x + d·y turns both floor axes to the grid's ±1/2 slope (heights shrink by d).
function squareUp(mx, m) {
  const R = Math.PI / 180, a = m.view[0] * R, e = m.view[1] * R, s = m.mirror ? -1 : 1;
  const mX = (Math.cos(a) * Math.sin(e)) / (s * Math.sin(a)), mY = (Math.sin(a) * Math.sin(e)) / (-s * Math.cos(a));
  const sX = Math.sign(mX) * 0.5, sY = Math.sign(mY) * 0.5;
  const d = (sX - sY) / (mX - mY), c = sX - d * mX;
  const flip = m.mirror ? ` translateX(${((1 - 2 * m.fx) * m.w).toFixed(1)}px) scaleX(-1)` : '';
  mx.style.transformOrigin = `${m.fx * 100}% ${m.fy * 100}%`;
  mx.style.transform = `matrix(1, ${c.toFixed(4)}, 0, ${d.toFixed(4)}, 0, 0)${flip}`;
}
// one blink beat for every floor pad (a per-pad CSS animation would start out of step)
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => ground.classList.toggle('blink-off'), 500);
const PAD = 60, FRONT = 170;   // floor pad reaches this far past the machine's footprint (more on the two front sides, for its label)
// the loading door of each machine, worked through that machine's own control; open() is the operator's choice,
// not the door the program opens by itself for a part change
window.__door = MACHINES.map(() => false);
function doorCtl(m) {
  const q = (sel) => floor.querySelector(`[data-mx="${m.id}"] ${sel}`);
  if (m.id === 'lnc8') {
    const b = q('[data-act="door"]');
    return { can: () => !b.disabled, open: () => !b.disabled && b.getAttribute('aria-pressed') === 'true', toggle: () => b.click() };
  }
  if (m.id === 'l250e') {
    const mode = () => window.__genos.guardState.mode;
    return { can: () => mode() !== 'off', open: () => mode() === 'door', toggle: () => q(`[data-guard="${mode() === 'door' ? 'closed' : 'door'}"]`).click() };
  }
  const guards = q('[data-guards-toggle]'), b = q('[data-door-toggle]');
  return { can: () => guards.getAttribute('aria-pressed') === 'true', open: () => b.getAttribute('aria-pressed') === 'true', toggle: () => b.click() };
}
// andon pole on the floor at the machine's right-hand corner, in its own layer just in front of the machine
function drawAndon(m) {
  const svg = el('svg', { width: FW, height: FH, viewBox: `0 0 ${FW} ${FH}`, class: 'lf-andon' });
  svg.style.zIndex = String(m.z + 1);
  floor.appendChild(svg);
  if (!document.getElementById('an-sheen')) {   // round-glass highlight, shared by every pole
    const gr = el('linearGradient', { id: 'an-sheen' }, el('defs', {}, svg));
    [[0, '#fff', 0.35], [0.3, '#fff', 0.05], [0.7, '#000', 0], [1, '#000', 0.25]].forEach(([o, c, a]) => el('stop', { offset: o, 'stop-color': c, 'stop-opacity': a }, gr));
  }
  const [x, y] = S(m.u + m.ru + 40, m.v - m.rv - 40);
  const g = el('g', { class: 'an', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` }, svg);
  const POLE = 150, R = 15, H = 30, ry = R * 0.5;
  el('ellipse', { rx: 20, ry: 10, class: 'an-foot' }, g);
  el('rect', { x: -3, y: -POLE, width: 6, height: POLE, class: 'an-pole' }, g);
  el('ellipse', { cy: -POLE, rx: R, ry, class: 'an-top' }, g);
  const lamps = {};
  let top = -POLE;
  for (const c of ['green', 'amber', 'red']) {   // bottom to top
    const y1 = top, y0 = top - H;
    const lg = el('g', { class: 'an-lamp', 'data-c': c }, g);
    el('ellipse', { cy: (y0 + y1) / 2, rx: R * 2.2, ry: H, class: 'an-glow' }, lg);
    el('path', { d: `M${-R} ${y0}V${y1}A${R} ${ry} 0 0 0 ${R} ${y1}V${y0}Z`, class: 'an-body' }, lg);
    el('path', { d: `M${-R} ${y0}V${y1}A${R} ${ry} 0 0 0 ${R} ${y1}V${y0}Z`, class: 'an-sheen' }, lg);
    el('ellipse', { cy: y0, rx: R, ry, class: 'an-cap' }, lg);
    lamps[c] = lg;
    top = y0;
  }
  el('path', { d: `M${-R * 0.7} ${top}v-6a${R * 0.7} ${ry * 0.7} 0 0 0 ${R * 1.4} 0v6Z`, class: 'an-top' }, g);
  let on = null, alarm = false;
  return {
    set(c, al) {
      if (c !== on) { for (const k in lamps) lamps[k].toggleAttribute('data-on', k === c); on = c; }
      if (al !== alarm) g.toggleAttribute('data-alarm', (alarm = al));
    },
  };
}
const slots = MACHINES.map((m, i) => {
  const slot = floor.querySelector(`[data-slot="${m.id}"]`);
  slot.style.left = m.x + 'px'; slot.style.top = m.y + 'px'; slot.style.width = m.w + 'px';
  slot.style.zIndex = String(m.z);
  if (m.mirror) slot.dataset.mirror = '';
  if (m.view) squareUp(slot.querySelector('.mx'), m);
  const tag = document.createElement('div');
  tag.className = 'lf-tag';
  tag.innerHTML = `<div class="tg-r"><i></i><b>${m.no} ${m.name}</b><span class="tg-pr"></span><em class="tg-n"></em></div>
    <div class="tg-r"><small>speed</small><span class="tg-bar"><span></span><u></u></span><span class="spd">100%</span></div>
    <div class="tg-r tg-ct"><small>cycle</small><b>—</b><em class="tg-ctx"></em></div>
    <div class="tg-r tg-oee"><small>OEE</small><strong>—</strong><em class="tg-apq"></em></div>
    <div class="tg-r"><button class="tg-ma" type="button" aria-pressed="false">🔧 Set / Maintenance</button><button class="tg-ma tg-door" type="button" aria-pressed="false" title="สไลด์ฝาเปิด / ปิด เพื่อใส่ชิ้นงาน">🚪 เปิดฝา</button></div>`;
  tag.addEventListener('click', () => focusMachine(i));
  tag.querySelector('.tg-ma').addEventListener('click', (e) => {
    e.stopPropagation();
    window.__setup[i] = !window.__setup[i];
    e.currentTarget.setAttribute('aria-pressed', String(window.__setup[i]));
  });
  const door = doorCtl(m);
  tag.querySelector('.tg-door').addEventListener('click', (e) => { e.stopPropagation(); if (!boardLive() && door.can()) door.toggle(); });
  tagsBox.appendChild(tag);
  const andon = drawAndon(m);
  // red floor pad under the machine, blinks while it is stopped
  const pad = el('g', { class: 'gr-stop' }, ground);
  el('polygon', { points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => S(m.u + (a < 0 ? -m.ru - PAD : m.ru + FRONT), m.v + (b < 0 ? -m.rv - PAD : m.rv + FRONT)).map((n) => n.toFixed(1)).join(',')).join(' ') }, pad);
  // label lying on the floor in the pad's front strip, starting just past the middle (where a belt may leave)
  const lines = [el('text', {}, pad), el('text', {}, pad)];
  const padLabel = (setup) => {
    const rows = setup ? [['SET /', 40], ['MAINTENANCE', 40]] : [['DOWN', 84], ['', 0]];
    let dv = m.rv + 16;
    rows.forEach(([txt, fs], k) => {
      dv += fs * 0.8 + (k ? 14 : 0);
      const [x, y] = S(m.u + BW / 2 + 12, m.v + dv);
      lines[k].textContent = txt; lines[k].style.fontSize = fs + 'px';
      lines[k].setAttribute('transform', `matrix(1 0.5 -1 0.5 ${x.toFixed(1)} ${y.toFixed(1)})`);
    });
  };
  padLabel(false);
  return { m, slot, tag, pad, padLabel, door, andon, doorBtn: tag.querySelector('.tg-door'), setup: false, dot: tag.querySelector('i'), bar: tag.querySelector('.tg-bar span'), n: tag.querySelector('.tg-n'), pr: tag.querySelector('.tg-pr'), spd: tag.querySelector('.spd'), oee: tag.querySelector('.tg-oee strong'), apq: tag.querySelector('.tg-apq'), ct: tag.querySelector('.tg-ct b'), ctx: tag.querySelector('.tg-ctx') };
});
const outs = [];      // one output panel + piles per product
const badges = [];   // WIP badges between stations and the output counter, placed like the tags
function placeTags() {
  const put = (node, [x, y]) => { node.style.left = (cam.x + x * cam.k) + 'px'; node.style.top = (cam.y + y * cam.k) + 'px'; };
  slots.forEach((s) => put(s.tag, s.m.tag));
  badges.forEach((b) => put(b.node, b.at));
}

if (location.hash === '#debug') MACHINES.forEach((m) => { const [x, y] = S(m.u, m.v); el('circle', { cx: x, cy: y, r: 10, fill: 'red' }, ground); });
/* ---------- conveyors ---------- */
const DIR = { u: [1, 0.5], v: [-1, 0.5] };
beltsSvg.remove();
// (re)builds the conveyors, output panels and piles for ROUTE; the parts on them are dropped
function buildLine() {
  BELTS.forEach((b) => b.svg.remove());
  badges.forEach((b) => b.node.remove());
  outs.forEach((o) => o.node.remove());
  BELTS.length = badges.length = outs.length = 0;
  BELTS.push(...layoutBelts());
  BELTS.forEach((b) => {
    b.segs = []; let p = b.start, s = 0;
    for (const [ax, len] of b.moves) {
      const d = DIR[ax], sg = Math.sign(len), L = Math.abs(len);
      const q = [p[0] + d[0] * len, p[1] + d[1] * len];
      b.segs.push({ a: p, b: q, ax, sg, len: L, s0: s }); s += L; p = q;
    }
    b.len = s; b.parts = []; b.box = []; b.off = 0;
    const svg = el('svg', { width: FW, height: FH, viewBox: `0 0 ${FW} ${FH}`, class: 'lf-belts' });
    svg.style.zIndex = String(b.z);
    svg.dataset.p = b.product;
    floor.appendChild(svg);
    b.svg = svg;
    drawBelt(b);
  });
  const two = ROUTE[0].length > 0 && ROUTE[1].length > 0;
  // small piles with two products, and behind 01 (big ones would stand on it)
  BELTS.filter((b) => b.to === 9).forEach((b, k) => { b.compact = two || b.from === 0; outs.push(makeOutput(b, k, b.compact)); });
}

// output counter for the end of a product's last belt
function makeOutput(b, k, compact) {
  const P = PRODUCTS[b.product];
  const node = document.createElement('div');
  node.className = 'lf-out';
  node.dataset.p = b.product;
  node.style.left = (10 + k * 222) + 'px';
  node.innerHTML = `<div class="o-h"><span class="o-p">${P}</span><span class="o-name">Output ${P} · ผลผลิต</span></div>
    <div class="o-g"><span><small>total</small><b data-o="tot">0</b></span><span><small>QC wait</small><b data-o="wait">0</b></span><span class="o-good"><small>good</small><b data-o="good">0</b></span><span class="o-bad"><small>scrap</small><b data-o="bad">0</b></span></div>
    <div class="o-y"><small>yield</small><span class="o-ybar"><span></span></span><b data-o="yield">—</b></div>
    <div class="o-s" data-o="by"></div>`;
  tagsBox.appendChild(node);
  const q = (k) => node.querySelector(`[data-o="${k}"]`);
  return { p: b.product, node, name: node.querySelector('.o-name'), tot: q('tot'), wait: q('wait'), good: q('good'), bad: q('bad'), yld: q('yield'), ybar: node.querySelector('.o-ybar span'), by: q('by'), stacks: makeStacks(b, compact) };
}

// output piles beside the end of a product's last belt, one box per part: pile 1 = off the line, waiting
// for QC; GOOD moves a box from pile 1 to the green pile (FG), REJECT to the red pile (NG).
// compact: smaller piles, so two products (or a line ending at 01) fit on the floor.
function makeStacks(b, compact) {
  const e = b.segs[b.segs.length - 1].b, P_ = PRODUCTS[b.product], two = ROUTE[0].length > 0 && ROUTE[1].length > 0;
  const P = (x, y, z) => [e[0] + 40 + (x - y), e[1] + 4 + (x + y) / 2 - z];
  const pts = (a) => a.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const root = el('g', {}, b.svg);
  const PW = 90, PH = 8, BX = 20, BZ = 16, PITCH = 21, PER = 4, LAYERS = 5, CAP = PER * PER * LAYERS;
  // cells of one layer, back to front so later boxes cover earlier ones
  const cells = [];
  for (let ix = 0; ix < PER; ix++) for (let iy = 0; iy < PER; iy++) cells.push([ix, iy]);
  cells.sort((a, c) => a[0] + a[1] - (c[0] + c[1]));
  const cube = (g, x0, y0, z0, w, d, h, cls) => {
    const [t, s1, s2] = cls;
    el('polygon', { points: pts([P(x0, y0 + d, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z0 + h), P(x0, y0 + d, z0 + h)]), class: s1 }, g);
    el('polygon', { points: pts([P(x0 + w, y0, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z0 + h), P(x0 + w, y0, z0 + h)]), class: s2 }, g);
    el('polygon', { points: pts([P(x0, y0, z0 + h), P(x0 + w, y0, z0 + h), P(x0 + w, y0 + d, z0 + h), P(x0, y0 + d, z0 + h)]), class: t }, g);
    el('polygon', { points: pts([P(x0, y0 + d, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0, z0), P(x0 + w, y0, z0 + h), P(x0, y0, z0 + h), P(x0, y0 + d, z0 + h)]), class: 'bx-e' }, g);
  };
  function lane(kind, x, pallets, label, lift) {
    const L = { kind, x, pallets, max: pallets * CAP, shown: 0, groups: [] };
    const node = document.createElement('div');
    node.className = 'lf-wip st-' + kind;
    node.innerHTML = `<small>${two ? P_ + ' · ' : ''}${label}</small><b>0</b>`;
    tagsBox.appendChild(node);
    L.num = node.querySelector('b');
    const top = P(x + PW / 2, PW / 2, PH + LAYERS * BZ + 24 + lift);
    badges.push({ node, at: top });
    return L;
  }
  const lanes = { wt: lane('wt', 130, compact ? 1 : 2, '1 · QC wait', 150), fg: lane('fg', 250, compact ? 2 : 6, 'FG ✓ good', 75), ng: lane('ng', 370, compact ? 1 : 2, 'NG ✕ scrap', 0) };   // labels step down from pile 1 to NG so they don't overlap
  // a pallet group, slotted into the drawing so nearer pallets paint over farther ones
  function pallet(L, n) {
    const x = L.x, y = n * (PW + 20), g = el('g', {});
    g.dataset.depth = x + y;
    const after = [...root.children].find((c) => +c.dataset.depth > x + y);
    root.insertBefore(g, after || null);
    cube(g, x, y, 0, PW, PW, PH, ['bt-top', 'bt-side', 'bt-side2']);
    L.groups.push({ g, x, y });
    return L.groups[n];
  }
  function addBox(L, k) {
    const p = Math.floor(k / CAP), r = k % CAP, layer = Math.floor(r / cells.length), [ix, iy] = cells[r % cells.length];
    const P0 = L.groups[p] || pallet(L, p);
    const c = L.kind;
    cube(P0.g, P0.x + 3 + ix * PITCH, P0.y + 3 + iy * PITCH, PH + layer * BZ, BX, BX, BZ - 1, [c + '-t', c + '-s', c + '-s2']);
  }
  function sync(L, n) {
    if (n < L.shown) { L.groups.forEach((x) => x.g.remove()); L.groups = []; L.shown = 0; }
    while (L.shown < Math.min(n, L.max)) addBox(L, L.shown++);
    L.num.textContent = n > L.max ? `${n} (+${n - L.max})` : n;
  }
  return (wait, good, bad) => { sync(lanes.wt, wait); sync(lanes.fg, good); sync(lanes.ng, bad); };
}
buildLine();

function drawBelt(b) {
  const g = el('g', {}, b.svg);
  b.slatG = [];
  b.segs.forEach((sg) => {
    const pd = DIR[sg.ax === 'u' ? 'v' : 'u'];      // across the belt
    const n = [pd[0] * BW / 2, pd[1] * BW / 2];
    const up = (p) => [p[0], p[1] - BH];
    const A1 = [sg.a[0] + n[0], sg.a[1] + n[1]], A2 = [sg.a[0] - n[0], sg.a[1] - n[1]];
    const B1 = [sg.b[0] + n[0], sg.b[1] + n[1]], B2 = [sg.b[0] - n[0], sg.b[1] - n[1]];
    const pts = (a) => a.map((p) => p.map((x) => x.toFixed(1)).join(',')).join(' ');
    // legs
    const legs = Math.max(2, Math.round(sg.len / 120));
    for (let k = 0; k <= legs; k++) {
      const t = k / legs, c = [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
      for (const s of [1, -1]) { const p = [c[0] + n[0] * s * 0.8, c[1] + n[1] * s * 0.8]; el('rect', { x: p[0] - 3, y: p[1] - BH, width: 6, height: BH, class: 'bt-leg' }, g); }
    }
    // the two long sides: draw the one nearer the viewer last
    const sideA = [A1, B1, up(B1), up(A1)], sideB = [A2, B2, up(B2), up(A2)];
    const near = (A1[1] + B1[1]) > (A2[1] + B2[1]) ? sideA : sideB;
    const capA = [A1, A2, up(A2), up(A1)], capB = [B1, B2, up(B2), up(B1)];
    const nearCap = (sg.a[1] > sg.b[1]) ? capA : capB;
    el('polygon', { points: pts(near), class: 'bt-side' }, g);
    el('polygon', { points: pts(nearCap), class: 'bt-side2' }, g);
    el('polygon', { points: pts([up(A1), up(B1), up(B2), up(A2)]), class: 'bt-top' }, g);
    const inset = 0.78;
    const i1 = (p, c) => [c[0] + (p[0] - c[0]) * inset, c[1] + (p[1] - c[1]) * inset];
    const ca = up(sg.a), cb = up(sg.b);
    const belt = [i1(up(A1), ca), i1(up(B1), cb), i1(up(B2), cb), i1(up(A2), ca)];
    el('polygon', { points: pts(belt), class: 'bt-belt' }, g);
    el('polygon', { points: pts([up(A1), up(B1), up(B2), up(A2)]), class: 'bt-edge' }, g);
    el('polyline', { points: pts(near.slice(0, 3)), class: 'bt-edge' }, g);
    const sl = el('g', {}, g); b.slatG.push({ sg, g: sl, n: [n[0] * inset, n[1] * inset] });
  });
  b.partG = el('g', {}, b.svg);
  if (b.to !== 9) makeCrate(b);
  const mid = pointAt(b, b.len / 2);
  if (b.to !== 9) {
    const node = document.createElement('div');
    node.className = 'lf-wip';
    node.title = `Parts waiting on conveyor ${b.id}, between ${MACHINES[b.from].no} and ${MACHINES[b.to].no}`;
    node.innerHTML = `<small>${ROUTE[0].length && ROUTE[1].length ? PRODUCTS[b.product] + ' · ' : ''}${MACHINES[b.from].no}→${MACHINES[b.to].no}</small><small>WIP</small><b>0</b>`;
    tagsBox.appendChild(node);
    b.wipNode = node.querySelector('b'); b.wipBox = node;
    badges.push({ node, at: [mid[0], mid[1] - 34] });
  }
  b.lab = { set textContent(v) {} };
}
// overflow crate: when the belt is full, finished parts go into a crate beside its start
const BOX_CAP = 48;   // three 4 × 4 layers
const beltFull = (b) => b.parts.length >= Math.floor((b.len - 18) / GAP) + 1;
function makeCrate(b) {
  const sg = b.segs[0], d = DIR[sg.ax], pd = DIR[sg.ax === 'u' ? 'v' : 'u'];
  // screen-left of the belt, a step away so tags don't cover it; 02→03's crate goes screen-right, out from under 03's tag
  const side = b.id === 'C23' ? -1 : 1;
  const at = sg.len * ({ C12: 0.95, C23: 0.5 }[b.id] ?? 0.3) * sg.sg, off = (BW / 2 + 130) * (pd[0] < 0 ? 1 : -1) * side;
  const c = [sg.a[0] + d[0] * at + pd[0] * off, sg.a[1] + d[1] * at + pd[1] * off];
  const g = el('g', { class: 'bx', transform: `translate(${c[0].toFixed(1)} ${c[1].toFixed(1)})` }, b.svg);
  b.boxG = g; b.boxPile = el('g', {}, g); b.boxShown = -1;
}
// laid out like the FG / NG stacks: a pallet, 4 × 4 boxes a layer, back to front
const CR = (() => {
  const PW = 90, PH = 8, BX = 20, BZ = 16, PITCH = 21, PER = 4;
  const cells = [];
  for (let ix = 0; ix < PER; ix++) for (let iy = 0; iy < PER; iy++) cells.push([ix, iy]);
  cells.sort((a, c) => a[0] + a[1] - (c[0] + c[1]));
  const P = (x, y, z) => [x - y, (x + y) / 2 - z];
  const pts = (a) => a.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const cube = (g, x0, y0, z0, w, dd, h, [t, s1, s2]) => {
    el('polygon', { points: pts([P(x0, y0 + dd, z0), P(x0 + w, y0 + dd, z0), P(x0 + w, y0 + dd, z0 + h), P(x0, y0 + dd, z0 + h)]), class: s1 }, g);
    el('polygon', { points: pts([P(x0 + w, y0, z0), P(x0 + w, y0 + dd, z0), P(x0 + w, y0 + dd, z0 + h), P(x0 + w, y0, z0 + h)]), class: s2 }, g);
    el('polygon', { points: pts([P(x0, y0, z0 + h), P(x0 + w, y0, z0 + h), P(x0 + w, y0 + dd, z0 + h), P(x0, y0 + dd, z0 + h)]), class: t }, g);
    el('polygon', { points: pts([P(x0, y0 + dd, z0), P(x0 + w, y0 + dd, z0), P(x0 + w, y0, z0), P(x0 + w, y0, z0 + h), P(x0, y0, z0 + h), P(x0, y0 + dd, z0 + h)]), class: 'bx-e' }, g);
  };
  return { PW, PH, BX, BZ, PITCH, cells, cube };
})();
function drawCrate(b) {
  if (!b.boxG || b.boxShown === b.box.length) return;
  b.boxShown = b.box.length;
  b.boxG.classList.toggle('on', b.box.length > 0);
  const g = b.boxPile, o = -CR.PW / 2;
  g.textContent = '';
  CR.cube(g, o, o, 0, CR.PW, CR.PW, CR.PH, ['bx-in', 'bx-l', 'bx-r']);
  for (let k = 0; k < b.box.length; k++) {
    const layer = Math.floor(k / CR.cells.length), [ix, iy] = CR.cells[k % CR.cells.length];
    CR.cube(g, o + 3 + ix * CR.PITCH, o + 3 + iy * CR.PITCH, CR.PH + layer * CR.BZ, CR.BX, CR.BX, CR.BZ - 1, ['wp-t', 'wp-s', 'wp-s2']);
  }
}
function pointAt(b, s) {
  for (const sg of b.segs) {
    if (s <= sg.s0 + sg.len || sg === b.segs[b.segs.length - 1]) {
      const t = Math.max(0, Math.min(1, (s - sg.s0) / sg.len));
      return [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t - BH];
    }
  }
}
function drawSlats(b) {
  for (const { sg, g, n } of b.slatG) {
    g.textContent = '';
    const step = 22, first = ((sg.s0 + b.off) % step + step) % step;
    for (let s = sg.s0 + step - first; s < sg.s0 + sg.len - 4; s += step) {
      const t = (s - sg.s0) / sg.len;
      const c = [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t - BH];
      el('line', { x1: c[0] + n[0], y1: c[1] + n[1], x2: c[0] - n[0], y2: c[1] - n[1], class: 'bt-slat' }, g);
    }
  }
}

/* parts: small isometric blocks whose look follows the operations done so far */
const LOOK = [
  { t: '#d8b673', s: '#a9844a', w: 30, d: 14, h: 10 },
  { t: '#d8b673', s: '#a9844a', w: 22, d: 18, h: 14 },
  { t: '#b9c0c8', s: '#7b838c', w: 24, d: 24, h: 18 },
  { t: '#e3e8ec', s: '#9aa3ab', w: 30, d: 24, h: 14 },
  { t: '#e8cfa3', s: '#b8986a', w: 34, d: 26, h: 9 },
];
function makePart(stage, parent) {
  const L = LOOK[Math.min(stage, LOOK.length - 1)];
  const g = el('g', {}, parent);
  const P = (x, y, z) => [(x - y), (x + y) / 2 - z];
  const pts = (a) => a.map((p) => p.join(',')).join(' ');
  const { w, d, h } = L, x0 = -w / 2, y0 = -d / 2;
  el('polygon', { points: pts([P(x0, y0 + d, 0), P(x0 + w, y0 + d, 0), P(x0 + w, y0 + d, h), P(x0, y0 + d, h)]), fill: L.s }, g);
  el('polygon', { points: pts([P(x0 + w, y0, 0), P(x0 + w, y0 + d, 0), P(x0 + w, y0 + d, h), P(x0 + w, y0, h)]), fill: L.s, opacity: 0.8 }, g);
  el('polygon', { points: pts([P(x0, y0, h), P(x0 + w, y0, h), P(x0 + w, y0 + d, h), P(x0, y0 + d, h)]), fill: L.t, stroke: L.s, 'stroke-width': 0.8 }, g);
  return g;
}

/* ---------- simulation ---------- */
let running = true, speed = 4, simT = 0, finished = 0;
const fin = [0, 0];            // parts off the end of each product's route
let lastOut = 0;               // product of the latest part off the line: the GOOD / REJECT on screen count for it
const hist = { pts: [], every: 10, next: 0 };   // OEE of each machine every `every` s of line time, for the dashboard
const st = MACHINES.map(() => ({ mode: 'starved', t: 0, part: null, done: 0, bad: 0, run: 0, t0: 0, last: 0, wait: 0, block: 0, stop: 0, pulse: 0 }));
// the board (when connected) holds a machine with its run switch or the alarm, and finishes parts with its buttons
const BOARD = () => window.__board;
const boardLive = () => !!(window.__board && window.__board.live);
const G = (i) => (window.__gate ? window.__gate(i) : 1);
// a machine in set-up / maintenance (toggled on its tag) stands still, but isn't "down"
window.__setup = MACHINES.map(() => false);
const SU = (i) => !!window.__setup[i];
// its door slid open to load material: it stands still too, and isn't "down" either
const DR = (i) => !!window.__door[i];
const spOf = (i) => (SU(i) || DR(i) ? 0 : (window.__speeds[i] || 0) * G(i));
// no part has come in yet: the machine's drawing stands still until one arrives
window.__idle = (i) => st[i]?.mode === 'starved';
function stopWhy(i) {
  if (SU(i)) return 'set-up / maintenance';
  if (DR(i)) return 'door open · loading material';
  const b = BOARD();
  const s = b && (b.live ? b : b.local);
  if (s) return s.al ? 'ALARM · line stopped' : !s.run[i] ? 'stopped by its run switch' : 'stopped by its knob';
  return 'stopped by its knob';
}
// the machine's numbers as the board reports them, in the shape the dashboard reads
function boardX(i) {
  if (!boardLive()) return null;
  const b = BOARD().stats[i], rej = Math.min(b.rej, b.parts);
  return { mode: 'run', done: b.parts - rej, bad: rej, run: b.run, wait: 0, block: 0, stop: b.stop };
}
const inBelt = (i) => BELTS.find((b) => b.to === i), outBelt = (i) => BELTS.find((b) => b.from === i);
function push(b, stage) {
  if (b.parts.length && b.parts[b.parts.length - 1].s < GAP) return false;
  b.parts.push({ s: 0, stage, g: makePart(stage, b.partG) }); return true;
}
// QC presses so far, per product: the board's buttons (the board says which product), or the GOOD / REJECT
// on screen without a board, which count for the product whose part came off the line most recently
const qcL = [{ good: 0, rej: 0 }, { good: 0, rej: 0 }], qcSeen = { good: 0, reject: 0 };
function followLocalQc() {
  const l = window.__qcLocal;
  if (!l) return;
  if (!boardLive()) { qcL[lastOut].good += Math.max(0, l.good - qcSeen.good); qcL[lastOut].rej += Math.max(0, l.reject - qcSeen.reject); }
  qcSeen.good = l.good; qcSeen.reject = l.reject;
}
const qcOf = (p) => (boardLive() ? BOARD().qcP?.[p] || { good: 0, rej: 0 } : qcL[p]);
const qc = () => { const a = qcOf(0), b = qcOf(1); return { good: a.good + b.good, rej: a.rej + b.rej }; };
function step(dt) {
  simT += dt;
  BELTS.forEach((b) => {
    const v = SPEED * dt; b.off += v;
    b.parts.forEach((p, k) => { p.s = Math.min(p.s + v, k === 0 ? b.len - 18 : b.parts[k - 1].s - GAP); });
    if (b.to === 9 && b.parts.length && b.parts[0].s >= b.len - 18.5) { b.parts.shift().g.remove(); finished++; fin[b.product]++; lastOut = b.product; }
  });
  BELTS.forEach((b) => { if (b.box.length && push(b, b.box[0])) b.box.shift(); });
  MACHINES.forEach((m, i) => {
    const s = st[i], ib = inBelt(i), ob = outBelt(i);
    if (prodOf(i) < 0) return;                                  // in no route: idle
    if (s.mode === 'starved') {
      if (!ib) { s.part = { stage: 0 }; s.mode = 'run'; s.t = 0; s.t0 = simT; }       // bar feeder never runs dry
      else if (ib.parts[0] && ib.parts[0].s >= ib.len - 18.5) { const p = ib.parts.shift(); p.g.remove(); s.part = p; s.mode = 'run'; s.t = 0; s.t0 = simT; }
    }
    const sp = spOf(i);
    const live = boardLive();
    if (s.mode === 'run') {
      s.t += dt * sp; if (sp > 0) s.run += dt;
      if (live) s.t = Math.min(s.t, m.cycle * 0.98);           // the part is done when the board's button says so
      if (live ? s.pulse > 0 : s.t >= m.cycle) {
        if (live) s.pulse--;
        s.part.sp = sp; s.last = simT - s.t0;
        s.mode = 'blocked'; ntPart(i, 'done', sp);
      }
    }
    if (s.mode === 'blocked') {
      const toBox = ob.to !== 9 && (ob.box.length > 0 || beltFull(ob));
      if (toBox ? ob.box.length < BOX_CAP && ob.box.push(s.part.stage + 1) : push(ob, s.part.stage + 1)) { s.done++; s.part = null; s.mode = 'starved'; s.t = 0; }
    }
    // where the time went, for the dashboard (run time is counted above)
    if (s.mode === 'blocked') s.block += dt; else if (sp === 0) s.stop += dt; else if (s.mode === 'starved') s.wait += dt;
  });
}

/* ---------- notify: LINE alert when a machine stays stopped, a Google Sheet row per finished part ----------
   both go to one Google Apps Script web app (google-apps-script/Code.gs), which holds the LINE token */
const NT_KEY = 'lf-notify';
const nt = Object.assign({ url: '', key: '', min: 5, line: true, sheet: true }, (() => { try { return JSON.parse(localStorage.getItem(NT_KEY)) || {}; } catch { return {}; } })());
const ntBox = document.querySelector('.nt-settings');
const ntEl = (k) => ntBox.querySelector(`[data-nt="${k}"]`);
const ntStamp = (t = new Date()) => t.toLocaleString('sv-SE');   // 2026-10-23 14:05:00, Sheets reads it as a date
const ntName = (i) => MACHINES[i].no + ' ' + MACHINES[i].name;
function ntSum() {
  ntEl('sum').textContent = !nt.url ? 'not set' : [nt.line && `LINE ≥ ${nt.min} min`, nt.sheet && 'Sheet log'].filter(Boolean).join(' · ') || 'off';
}
for (const k of ['url', 'key', 'min', 'line', 'sheet']) {
  const f = ntEl(k);
  if (f.type === 'checkbox') f.checked = !!nt[k]; else f.value = nt[k];
  f.addEventListener('change', () => {
    nt[k] = f.type === 'checkbox' ? f.checked : k === 'min' ? Math.max(1, +f.value || 5) : f.value.trim();
    try { localStorage.setItem(NT_KEY, JSON.stringify(nt)); } catch {}
    ntSum();
  });
}
ntSum();
// text/plain + no-cors: no preflight, the reply can't be read (check the sheet / LINE instead)
function ntPost(body) {
  if (!nt.url) return;
  fetch(nt.url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key: nt.key }) }).catch(() => {});
}
const ntQ = [];
function ntPart(i, result, sp) {
  if (!nt.url || !nt.sheet) return;
  const o = oeeOf(i);
  ntQ.push({ ts: ntStamp(), machine: ntName(i), result, cycle: +st[i].last.toFixed(1), speed: Math.round(sp * 100), oee: o ? +(o.oee * 100).toFixed(1) : '', source: boardLive() ? 'live' : 'sim' });
}
setInterval(() => { if (ntQ.length) ntPost({ type: 'parts', rows: ntQ.splice(0) }); }, 5000);
// wall-clock stop watch (a timer, not the animation frame, so it keeps going in a background tab)
const ntStop = MACHINES.map(() => ({ at: 0, sent: false }));
function ntAlert(event, i, text, extra) {
  ntPost({ type: 'alert', event, ts: ntStamp(), machine: ntName(i), text, line: nt.line, sheet: nt.sheet, ...extra });
}
setInterval(() => {
  const now = Date.now();
  MACHINES.forEach((m, i) => {
    const a = ntStop[i], stopped = spOf(i) === 0 && !SU(i) && !DR(i);   // planned set-up / maintenance or loading doesn't page anyone
    if (stopped) {
      if (!a.at) a.at = now;
      else if (!a.sent && now - a.at >= nt.min * 60000) {
        a.sent = true;
        ntAlert('stop', i, `⚠️ ${ntName(i)} หยุดทำงานเกิน ${nt.min} นาที\nสาเหตุ: ${stopWhy(i)}\nตั้งแต่ ${ntStamp(new Date(a.at))}`, { reason: stopWhy(i), minutes: nt.min });
      }
    } else {
      if (a.sent && !SU(i)) {
        const min = Math.round((now - a.at) / 60000);
        ntAlert('resume', i, `✅ ${ntName(i)} กลับมาทำงานแล้ว · หยุดไป ${min} นาที`, { minutes: min });
      }
      a.at = 0; a.sent = false;
    }
  });
}, 5000);
ntEl('test').addEventListener('click', () => {
  if (!nt.url) { ntEl('url').focus(); return; }
  ntPost({ type: 'test', ts: ntStamp(), text: '🔔 ทดสอบการแจ้งเตือนจาก Smart Factory dashboard', line: nt.line, sheet: nt.sheet });
  ntEl('test').textContent = 'Sent ✓'; setTimeout(() => { ntEl('test').textContent = 'Send test'; }, 2000);
});

function reset() {
  BELTS.forEach((b) => { b.parts.forEach((p) => p.g.remove()); b.parts = []; b.box = []; });
  st.forEach((s) => Object.assign(s, { mode: 'starved', t: 0, part: null, done: 0, bad: 0, run: 0, t0: 0, last: 0, wait: 0, block: 0, stop: 0, pulse: 0 }));
  window.__board?.reset();
  simT = 0; finished = 0; fin[0] = fin[1] = 0; lastOut = ROUTE[0].length ? 0 : 1;
  qcL.forEach((q) => { q.good = q.rej = 0; }); followLocalQc();
  frameSnap = null;
  hist.pts = []; hist.every = 10; hist.next = 0;
}

/* OEE of one machine since the line started:
   A = time actually cutting ÷ time on the line (waiting, blocked or knob at 0 % all count as stops)
   P = parts made × rated cycle ÷ time cutting (rated cycle = the machine at 100 %), capped at 100 %
   Q = good parts ÷ all parts                                                               */
function oeeOf(i) {
  if (boardLive()) {   // board: A = run ÷ (run + stop), P = parts × std cycle ÷ run (cap 100 %), Q = (parts − rejects) ÷ parts
    const b = BOARD().stats[i], m = MACHINES[i], T = b.run + b.stop;
    if (T < 5 || b.run <= 0 || b.parts === 0) return null;
    const a = b.run / T, p = Math.min(1, (b.parts * m.cycle) / b.run), q = (b.parts - Math.min(b.rej, b.parts)) / b.parts;
    return { a, p, q, oee: a * p * q };
  }
  const x = st[i], m = MACHINES[i], n = x.done + x.bad + (x.mode === 'blocked' ? 1 : 0);
  if (simT < 5 || x.run <= 0 || n === 0) return null;
  const a = Math.min(1, x.run / simT), p = Math.min(1, (n * m.cycle) / x.run), q = n ? (n - x.bad) / n : 1;
  return { a, p, q, oee: a * p * q };
}
window.__board?.on('part', (i) => { const s = st[i]; if (s) s.pulse = Math.min(s.pulse + 1, 20); });
// the board's door buttons open / close the drawings' doors (again later if the machine refused just then)
const doorAt = MACHINES.map(() => 0);
function followDoor(i) {
  const b = BOARD(), s = slots[i];
  if (!b?.live || !s.door.can() || s.door.open() === !!b.door[i] || performance.now() - doorAt[i] < 1200) return;
  doorAt[i] = performance.now(); s.door.toggle();
}
window.__board?.on('door', (i) => followDoor(i));
window.__board?.on('reject', (i) => { if (i >= 0) flash(i); });
function flash(i) { const t = slots[i].tag; t.classList.remove('scrap'); void t.offsetWidth; t.classList.add('scrap'); }

/* ---------- render ---------- */
const $l = (k) => document.querySelector(`[data-l="${k}"]`);
const fmt = (x) => { x = Math.floor(x); return [x / 3600 | 0, (x / 60 | 0) % 60, x % 60].map((n) => String(n).padStart(2, '0')).join(':'); };
function render() {
  BELTS.forEach((b) => {
    drawSlats(b);
    b.parts.forEach((p) => { const q = pointAt(b, p.s); p.g.setAttribute('transform', `translate(${q[0].toFixed(1)} ${q[1].toFixed(1)})`); });
    if (b.wipNode) {
      b.wipNode.textContent = b.parts.length + b.box.length;
      drawCrate(b);
      const full = b.parts.length >= Math.floor((b.len - 18) / GAP) + 1;
      b.wipBox.dataset.full = full ? 'yes' : 'no';
    }
  });
  let wip = 0, best = -1, bn = '—';
  slots.forEach((s, i) => {
    const x = st[i];
    // the operator's door: follow the machine's own control, which may refuse while its covers are off
    followDoor(i);
    const can = s.door.can(), open = can && s.door.open();
    window.__door[i] = open;
    s.doorBtn.disabled = !can || boardLive();
    s.doorBtn.title = boardLive() ? 'ใช้ปุ่มฝาบนบอร์ด (M' + (i + 1) + ')' : 'สไลด์ฝาเปิด / ปิด เพื่อใส่ชิ้นงาน';
    if (s.doorBtn.getAttribute('aria-pressed') !== String(open)) {
      s.doorBtn.setAttribute('aria-pressed', String(open));
      s.doorBtn.textContent = open ? '🚪 ปิดฝา' : '🚪 เปิดฝา';
    }
    const sp = spOf(i);
    s.dot.className = sp === 0 ? 'stopped' : x.mode;
    s.pad.classList.toggle('on', sp === 0 && !open);
    s.pad.classList.toggle('setup', SU(i));
    if (s.setup !== SU(i)) s.padLabel((s.setup = SU(i)));
    if (SU(i) || open) s.dot.className = 'setup';
    const bd = BOARD(), bl = bd && (bd.live ? bd : bd.local);
    s.andon.set(SU(i) || open ? 'amber' : sp === 0 ? 'red' : x.mode === 'run' ? 'green' : 'amber', sp === 0 && !!bl?.al);
    s.dot.title = sp === 0 ? stopWhy(i) : { run: 'running', starved: 'waiting for a part', blocked: 'waiting for room on the belt' }[x.mode];
    s.spd.textContent = Math.round(sp * 100) + '%';
    s.bar.style.width = Math.min(100, sp * 50) + '%';
    if (sp > 1) s.bar.dataset.over = ''; else delete s.bar.dataset.over;
    const bx = boardX(i), bs = bx ? BOARD().stats[i] : null;
    s.n.textContent = `✓ ${(bx || x).done}` + ((bx || x).bad ? `  ✕ ${(bx || x).bad}` : '');
    const pr = prodOf(i);
    if (s.pr.dataset.p !== String(pr)) { s.pr.dataset.p = pr; s.pr.textContent = pr < 0 ? 'idle' : PRODUCTS[pr]; s.tag.classList.toggle('idle', pr < 0); }
    s.ct.textContent = bs ? (bs.gap ? bs.gap.toFixed(1) + ' s/ชิ้น' : '— s/ชิ้น') : sp > 0 ? (s.m.cycle / sp).toFixed(1) + ' s/ชิ้น' : '— s/ชิ้น';
    if (sp > 0 && sp < 1) s.ct.dataset.slow = ''; else delete s.ct.dataset.slow;
    s.ctx.textContent = `std ${s.m.cycle} s · last ${x.last ? x.last.toFixed(1) + ' s' : '—'}`;
    const o = oeeOf(i);
    s.oee.textContent = o ? Math.round(o.oee * 100) + '%' : '—';
    s.oee.dataset.band = o ? (o.oee >= 0.85 ? 'good' : o.oee >= 0.6 ? 'mid' : 'low') : '';
    s.apq.textContent = o ? `A ${Math.round(o.a * 100)} · P ${Math.round(o.p * 100)} · Q ${Math.round(o.q * 100)}` : 'needs a few cycles';
    if (x.part) wip++;
    const u = simT > 0 ? x.run / simT : 0;
    if (simT > 30 && u > best) { best = u; bn = s.m.no + ' ' + s.m.name.split(' ')[0]; }
  });
  BELTS.forEach((b) => (wip += b.parts.length + b.box.length));
  followLocalQc();
  outs.forEach((out) => {
    const nm = itemText(out.p) || `Output ${PRODUCTS[out.p]} · ผลผลิต`;
    if (out.name.textContent !== nm) out.name.textContent = nm;
    const q = qcOf(out.p), checked = q.good + q.rej, wait = Math.max(0, fin[out.p] - checked);
    out.stacks(wait, q.good, q.rej);
    out.tot.textContent = fin[out.p]; out.wait.textContent = wait; out.good.textContent = q.good; out.bad.textContent = q.rej;
    out.yld.textContent = checked ? Math.round(q.good / checked * 100) + '%' : '—';
    out.ybar.style.width = (checked ? q.good / checked * 100 : 0) + '%';
    out.by.textContent = wait ? `${wait} รอตรวจ · กด GOOD / REJECT เพื่อคัดกอง 1` : checked ? 'ตรวจครบแล้ว' : 'ยังไม่มีชิ้นงานออกจากไลน์';
  });
  $l('fin').textContent = finished; $l('wip').textContent = wip; $l('bn').textContent = bn;
  const now = `<small>กำลังผลิต · ${LINE_ID}</small>` + ROUTE.map((ms, p) => ms.length ? `<span class="o-p" data-p="${p}">${PRODUCTS[p]}</span><b>${itemText(p) || 'product ' + PRODUCTS[p]}</b><em>${ms.map((i) => MACHINES[i].no).join('→')}</em>` : '').join('');
  if (nowBox.innerHTML !== now) nowBox.innerHTML = now;
  $l('th').textContent = simT > 60 ? (finished / (simT / 3600)).toFixed(0) + ' /h' : '— /h';
  $l('time').textContent = fmt(simT);
}
// what the line is making right now: product, code, name, machines (line bar)
const nowBox = document.createElement('span');
nowBox.className = 'lb-now';
document.querySelector('.line-bar .lb-title')?.after(nowBox);
const boardTag = document.createElement('span');
boardTag.className = 'lb-stat lb-board'; boardTag.hidden = true;
boardTag.innerHTML = '<small>board</small><b>—</b>';
document.querySelector('.line-bar .lb-sp')?.before(boardTag);
document.head.insertAdjacentHTML('beforeend', '<style>.lb-board[data-alarm] b{color:var(--anatomy-red);animation:lb-al .8s steps(2,end) infinite}@keyframes lb-al{50%{opacity:.35}}</style>');
setInterval(() => {
  const b = BOARD();
  boardTag.hidden = !(b && b.live);
  if (!b || !b.live) return;
  boardTag.toggleAttribute('data-alarm', b.al);
  boardTag.lastChild.textContent = b.al ? 'ALARM' : `run ${b.run.filter(Boolean).length}/4`;
}, 200);
let last = performance.now();
(function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (running) { let rem = dt * speed; while (rem > 0) { const h = Math.min(rem, 0.05); step(h); rem -= h; } sampleHist(); }
  render();
  requestAnimationFrame(frame);
})(last);

/* ---------- controls ---------- */
const runBtn = $l('run');
const ctl = document.createElement('div');
ctl.className = 'lf-ctl';
ctl.innerHTML = '<button class="lb-btn" data-c="play" type="button" aria-label="Play">▶ Play</button>'
  + '<button class="lb-btn" data-c="pause" type="button" aria-label="Pause">❚❚ Pause</button>'
  + '<button class="lb-btn" data-c="reset" type="button" aria-label="Reset">⟲ Reset</button>';
document.body.appendChild(ctl);
function setRunning(on) {
  running = on; window.__paused = !on;
  runBtn.setAttribute('aria-pressed', String(on));
  runBtn.textContent = on ? '❚❚ Pause line' : '▶ Run line';
  ctl.querySelector('[data-c="play"]').setAttribute('aria-pressed', String(on));
  ctl.querySelector('[data-c="pause"]').setAttribute('aria-pressed', String(!on));
}
runBtn.addEventListener('click', () => setRunning(!running));
ctl.querySelector('[data-c="play"]').addEventListener('click', () => setRunning(true));
ctl.querySelector('[data-c="pause"]').addEventListener('click', () => setRunning(false));
ctl.querySelector('[data-c="reset"]').addEventListener('click', reset);
setRunning(running);
document.querySelectorAll('.line-bar [data-speed]').forEach((b) => b.addEventListener('click', () => {
  speed = +b.dataset.speed;
  document.querySelectorAll('.line-bar [data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
$l('reset').addEventListener('click', reset);
// covers off: lift every machine's covers with that machine's own control, so the spindles, screws and pulleys show
let coversOff = false;
function setCovers(off) {
  coversOff = off;
  const floor = document.querySelector('.line-floor');
  const lnc = floor.querySelector('[data-mx="lnc8"] [data-act="covers"]');
  if (lnc && (lnc.getAttribute('aria-pressed') === 'true') !== off) lnc.click();
  // a GFIR door left open by its tag button closes, so the guards come back on shut
  if (off) slots.forEach((s) => { if (s.m.id.startsWith('gfir') && s.door.open()) s.door.toggle(); });
  floor.querySelectorAll('[data-mx^="gfir"] [data-guards-toggle]').forEach((b) => { if ((b.getAttribute('aria-pressed') === 'true') === off) b.click(); });
  floor.querySelector(`[data-mx="l250e"] [data-guard="${off ? 'off' : 'closed'}"]`)?.click();
  $l('covers').setAttribute('aria-pressed', String(off));
  $l('covers').textContent = off ? 'ใส่ฝา' : 'ถอดฝา';
}
$l('covers').addEventListener('click', () => setCovers(!coversOff));

/* ---------- end of the time frame: OEE summary per machine ----------
   The OEE panel's time frame (Shift, or Custom From–To) sets when to count. When its clock passes From,
   the line's counters are noted; when it passes To, the summary shows OEE over what the line did in between. */
const sum = document.createElement('div');
sum.className = 'lf-sum'; sum.hidden = true;
sum.setAttribute('role', 'status');
document.body.appendChild(sum);
let frameSnap = null, frameShown = '';
const snapLine = () => ({ simT, qc: qc(), st: st.map((x) => ({ done: x.done, bad: x.bad, run: x.run })) });
const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function showSummary(f, a, b) {
  const T = b.simT - a.simT;
  const cards = MACHINES.map((m, i) => {
    const run = b.st[i].run - a.st[i].run, bad = b.st[i].bad - a.st[i].bad, n = b.st[i].done - a.st[i].done + bad;
    if (T <= 0 || run <= 0 || n === 0) return `<div class="sm-m"><small>${m.no} ${m.name}</small><b>—</b><em>no parts in this time frame</em></div>`;
    const A = Math.min(1, run / T), P = Math.min(1, (n * m.cycle) / run), Q = (n - bad) / n, o = A * P * Q;
    const band = o >= 0.85 ? 'good' : o >= 0.6 ? 'mid' : 'low';
    return `<div class="sm-m"><small>${m.no} ${m.name}</small><b data-band="${band}">${Math.round(o * 100)}%</b>`
      + `<em>A ${Math.round(A * 100)} · P ${Math.round(P * 100)} · Q ${Math.round(Q * 100)}</em></div>`;
  });
  const good = b.qc.good - a.qc.good, ng = b.qc.rej - a.qc.rej;
  sum.innerHTML = `<div class="sm-h">OEE summary <em>${hhmm(f.w0)}–${hhmm(f.w1)}</em><button type="button" aria-label="Close">✕</button></div>
    <div class="sm-g">${cards.join('')}</div>
    <div class="sm-f"><span>FG <b>${good}</b></span><span>NG <b>${ng}</b></span><span>line time <b>${fmt(T)}</b></span></div>`;
  sum.querySelector('button').addEventListener('click', () => { sum.hidden = true; });
  sum.hidden = false;
}
setInterval(() => {
  const f = window.oee?.frame?.();
  if (!f || !f.fixed || f.bad) return;
  const key = f.w0 + '-' + f.w1;
  if (f.t < f.w0) { frameSnap = null; return; }
  if (f.t < f.w1) { if (!frameSnap || frameSnap.key !== key) frameSnap = { key, at: snapLine() }; return; }
  if (frameSnap && frameSnap.key === key && frameShown !== key) { frameShown = key; showSummary(f, frameSnap.at, snapLine()); }
}, 250);

/* ---------- tab 2: OEE dashboard ----------
   A tab bar at the top centre switches between the line and a dashboard. The line keeps running
   underneath; the dashboard only reads its counters (st, simT) and redraws while it's open. */
function sampleHist() {
  if (simT < hist.next) return;
  hist.next = simT + hist.every;
  hist.pts.push({ t: simT, o: MACHINES.map((_, i) => { const o = oeeOf(i); return o ? o.oee : null; }) });
  if (hist.pts.length > 600) { hist.pts = hist.pts.filter((_, k) => k % 2 === 0); hist.every *= 2; }
}
const tabs = document.createElement('div');
tabs.className = 'lf-tabs'; tabs.setAttribute('role', 'tablist');
tabs.innerHTML = '<button role="tab" type="button" data-tab="line" aria-selected="true">▦ Line <kbd>1</kbd></button>'
  + '<button role="tab" type="button" data-tab="oee" aria-selected="false">◔ OEE Dashboard <kbd>2</kbd></button>';
// in the header bar, next to the title: small, but the selected tab stands out (dark, blue underline)
(document.querySelector('.dash-title') ? document.querySelector('.dash-title').after(tabs) : document.body.prepend(tabs));
const od = document.createElement('section');
od.className = 'od'; od.hidden = true; od.setAttribute('role', 'tabpanel'); od.setAttribute('aria-label', 'OEE dashboard');
const SER = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
od.innerHTML = `<div class="od-in">
  <div class="od-h"><h2>OEE Dashboard</h2><span>Line 1 · since start or last reset · updates live</span></div>
  <div class="od-card"><div class="od-kpis" data-d="kpis"></div></div>
  <div class="od-ms" data-d="ms"></div>
  <div class="od-card"><h3>OEE over line time · dashed line = 85 % world-class target</h3>
    <div class="od-lg">${MACHINES.map((m, i) => `<span><i style="background:${SER[i]};height:3px;width:14px"></i>${m.no} ${m.name}</span>`).join('')}</div>
    <div class="od-chart" data-d="chart"><svg></svg><div class="od-tip" hidden></div></div></div>
  <div class="od-card"><h3>Table</h3><div class="od-tw" data-d="table"></div></div>
</div>`;
document.body.appendChild(od);
const $d = (k) => od.querySelector(`[data-d="${k}"]`);
// machine cards are built once, then only their numbers change
$d('ms').innerHTML = MACHINES.map((m, i) => `<div class="od-card od-m">
  <div class="od-mh"><i style="background:${SER[i]}"></i>${m.no} ${m.name}<span class="st" data-m="st"></span></div>
  <div class="od-big"><b data-m="oee">—</b><span class="od-band" data-m="band"></span></div>
  <div class="od-apq">${[['A', 'Availability', 0.9], ['P', 'Performance', 0.95], ['Q', 'Quality', 0.99]].map(([k, name, goal]) =>
    `<div class="od-row" title="${name}, world-class goal ${Math.round(goal * 100)} %"><small>${k} · ${name}</small><span class="od-bar"><span data-m="${k}b"></span><u style="left:${goal * 100}%"></u></span><b data-m="${k}">—</b></div>`).join('')}</div>
  <div><div class="od-tl" data-m="tl"></div></div>
  <div class="od-facts"><span><small>good</small><b data-m="good">0</b></span><span><small>scrap</small><b data-m="bad">0</b></span><span><small>cycle</small><b data-m="ct">—</b></span></div>
</div>`).join('');
const cards = [...$d('ms').children].map((c) => { const o = {}; c.querySelectorAll('[data-m]').forEach((e) => { o[e.dataset.m] = e; }); return o; });
const legendTime = `<div class="od-lg"><span><i style="background:var(--anatomy-green)"></i>run</span><span><i style="background:#d9a12a"></i>waiting for a part</span><span><i style="background:var(--anatomy-red)"></i>belt full</span><span><i style="background:var(--anatomy-muted)"></i>stopped by knob</span></div>`;
od.querySelector('.od-ms').insertAdjacentHTML('beforebegin', `<div class="od-sec"><h3>Machines · bar = where the time went</h3>${legendTime}</div>`);
const pct = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
const bandOf = (o) => (o >= 0.85 ? ['good', '● world class'] : o >= 0.6 ? ['mid', '▲ typical'] : ['low', '■ low']);
function renderDash() {
  const os = MACHINES.map((_, i) => oeeOf(i));
  const got = os.filter(Boolean), avg = got.length ? got.reduce((n, o) => n + o.oee, 0) / got.length : null;
  const BB = boardLive() ? BOARD() : null;
  const q = qc(), finished_ = q.good, simT_ = BB ? BB.elapsed() : simT;   // FG / NG = what QC sorted out of pile 1
  const scrap = q.rej, total = finished_ + scrap;
  { const finished = finished_, simT = simT_;
  $d('kpis').innerHTML = [
    ['line OEE', pct(avg), 'average of the machines'],
    ['good (FG)', finished, 'parts off the line'],
    ['scrap (NG)', scrap, 'all stations'],
    ['yield', total ? pct(finished / total) : '—', 'good ÷ all parts'],
    ['throughput', simT > 60 ? (finished / (simT / 3600)).toFixed(0) + ' /h' : '—', 'good parts per hour'],
    ['line time', fmt(simT), BB ? (BB.al ? 'ALARM' : 'board · real time') : running ? 'running' : 'paused'],
    ...ROUTE.map((ms, p) => [ms, p]).filter(([ms]) => ms.length).map(([ms, p]) => { const qp = qcOf(p);
      return [`product ${PRODUCTS[p]}${itemText(p) ? ' · ' + itemText(p) : ''}`, fin[p], `${ms.map((i) => MACHINES[i].no).join(' → ')} · ✓ ${qp.good} · ✕ ${qp.rej}`]; }),
  ].map(([k, v, e]) => `<div class="od-kpi"><small>${k}</small><b>${v}</b><em>${e}</em></div>`).join('');
  }
  MACHINES.forEach((m, i) => {
    const c = cards[i], o = os[i], x = boardX(i) || st[i], sp = spOf(i);
    c.oee.textContent = o ? pct(o.oee) : '—';
    const [band, label] = o ? bandOf(o.oee) : ['', 'needs a few cycles'];
    c.band.dataset.band = band; c.band.textContent = label;
    for (const k of ['A', 'P', 'Q']) { const v = o ? o[k.toLowerCase()] : null; c[k].textContent = pct(v); c[k + 'b'].style.width = (v || 0) * 100 + '%'; }
    c.st.textContent = sp === 0 ? stopWhy(i) : { run: 'running', starved: 'waiting for a part', blocked: 'belt full' }[x.mode];
    const parts = [['r', x.run], ['w', x.wait], ['b', x.block], ['x', x.stop]], all = parts.reduce((n, p) => n + p[1], 0);
    c.tl.innerHTML = all ? parts.filter((p) => p[1] > 0).map(([k, v]) => `<span class="${k}" style="flex:${v}" title="${{ r: 'run', w: 'waiting for a part', b: 'belt full', x: 'stopped by knob' }[k]} ${fmt(v)} (${Math.round(v / all * 100)}%)"></span>`).join('') : '';
    c.good.textContent = x.done; c.bad.textContent = x.bad;
    c.ct.textContent = sp > 0 ? (m.cycle / sp).toFixed(1) + ' s' : '—';
  });
  $d('table').innerHTML = `<table><thead><tr><th>machine</th><th>OEE</th><th>A</th><th>P</th><th>Q</th><th>good</th><th>scrap</th><th>run</th><th>waiting</th><th>belt full</th><th>stopped</th><th>std cycle</th></tr></thead><tbody>${
    MACHINES.map((m, i) => { const o = os[i], x = boardX(i) || st[i];
      return `<tr><td>${m.no} ${m.name}</td><td>${o ? pct(o.oee) : '—'}</td><td>${o ? pct(o.a) : '—'}</td><td>${o ? pct(o.p) : '—'}</td><td>${o ? pct(o.q) : '—'}</td><td>${x.done}</td><td>${x.bad}</td><td>${fmt(x.run)}</td><td>${fmt(x.wait)}</td><td>${fmt(x.block)}</td><td>${fmt(x.stop)}</td><td>${m.cycle} s</td></tr>`; }).join('')}</tbody></table>`;
  drawChart();
}
// trend chart: one 0–100 % axis, a line per machine labelled at its end, crosshair + tooltip on hover
const chart = $d('chart'), csvg = chart.querySelector('svg'), tip = chart.querySelector('.od-tip');
let hoverX = null;
function drawChart() {
  const W = chart.clientWidth || 800, H = 280, L = 36, R = 120, T = 10, B = 26;
  const pts = hist.pts, t1 = Math.max(60, pts.length ? pts[pts.length - 1].t : 0);
  const X = (t) => L + (t / t1) * (W - L - R), Y = (v) => T + (1 - v) * (H - T - B);
  csvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const g = [];
  for (const v of [0, 0.25, 0.5, 0.75, 1]) g.push(`<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${v * 100}%</text>`);
  g.push(`<line class="tg" x1="${L}" x2="${W - R}" y1="${Y(0.85)}" y2="${Y(0.85)}"/>`);
  for (let k = 0; k <= 4; k++) { const t = (t1 * k) / 4; g.push(`<text x="${X(t)}" y="${H - 8}" text-anchor="middle">${fmt(t)}</text>`); }
  if (pts.length < 2) g.push(`<text x="${(L + W - R) / 2}" y="${H / 2}" text-anchor="middle">the trend appears after a few cycles</text>`);
  const ends = [];
  MACHINES.forEach((m, i) => {
    let d = '', pen = false, lastP = null;
    for (const p of pts) { const v = p.o[i]; if (v == null) { pen = false; continue; } d += (pen ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; lastP = p; }
    if (d) g.push(`<path class="ln" d="${d}" style="stroke:${SER[i]}"/>`);
    if (lastP) ends.push({ i, y: Y(lastP.o[i]), x: X(lastP.t), v: lastP.o[i] });
  });
  // end labels, nudged apart so they never overlap
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 14);
  ends.forEach((e) => g.push(`<text class="lab" x="${W - R + 8}" y="${e.y + 4}">${MACHINES[e.i].no} · ${pct(e.v)}</text>`));
  if (hoverX != null && pts.length) {
    const t = ((hoverX - L) / (W - L - R)) * t1;
    let p = pts[0]; for (const q of pts) if (Math.abs(q.t - t) < Math.abs(p.t - t)) p = q;
    const x = X(p.t);
    g.push(`<line class="xh" x1="${x}" x2="${x}" y1="${T}" y2="${H - B}"/>`);
    p.o.forEach((v, i) => { if (v != null) g.push(`<circle class="dot" cx="${x}" cy="${Y(v)}" r="4.5" style="fill:${SER[i]}"/>`); });
    tip.innerHTML = `<b>line time ${fmt(p.t)}</b>` + MACHINES.map((m, i) => `<span><i style="background:${SER[i]}"></i>${m.no} ${m.name} <b>${pct(p.o[i])}</b></span>`).join('');
    tip.hidden = false;
    tip.style.left = Math.min(x + 12, W - 230) + 'px'; tip.style.top = '8px';
  } else tip.hidden = true;
  csvg.innerHTML = g.join('');
}
csvg.addEventListener('pointermove', (e) => { const r = csvg.getBoundingClientRect(); hoverX = e.clientX - r.left; drawChart(); });
csvg.addEventListener('pointerleave', () => { hoverX = null; drawChart(); });
function showTab(name) {
  tabs.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  od.hidden = name !== 'oee';
  document.body.classList.toggle('od-open', !od.hidden);
  if (!od.hidden) renderDash();
  try { localStorage.setItem('lf-tab', name); } catch {}
}
tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '1') showTab('line'); else if (e.key === '2') showTab('oee');
});
setInterval(() => { if (!od.hidden) renderDash(); }, 500);
try { if (localStorage.getItem('lf-tab') === 'oee') showTab('oee'); } catch {}

/* ---------- pan / zoom ---------- */
let cam = { x: 0, y: 0, k: 0.3 };
const apply = () => { floor.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`; placeTags(); };
function frameRect(x, y, w, h, anim) {
  const r = view.getBoundingClientRect();
  const k = Math.min(r.width / w, r.height / h);
  const t = { k, x: (r.width - w * k) / 2 - x * k, y: (r.height - h * k) / 2 - y * k };
  if (!anim) { cam = t; apply(); return; }
  const f = { ...cam }, t0 = performance.now();
  (function tick(now) {
    const u = Math.min(1, (now - t0) / 420), e = 1 - Math.pow(1 - u, 3);
    cam = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e, k: f.k + (t.k - f.k) * e }; apply();
    if (u < 1) requestAnimationFrame(tick);
  })(t0);
}
function contentBox() {
  const xs = [], ys = [];
  MACHINES.forEach((m) => { xs.push(m.x, m.x + m.w); ys.push(m.y, m.y + m.h); });
  BELTS.forEach((b) => b.segs.forEach((s) => { xs.push(s.a[0] - 60, s.b[0] - 60, s.a[0] + 60, s.b[0] + 160); ys.push(s.a[1] + 40, s.b[1] + 140); }));
  // the output piles beside the end of each product's last belt (see makeStacks)
  BELTS.filter((b) => b.to === 9).forEach((b) => {
    const e = b.segs[b.segs.length - 1].b, Y = b.compact ? 220 : 660;
    xs.push(e[0] + 40 + 130 - Y, e[0] + 40 + 460); ys.push(e[1] - 160, e[1] + 4 + (460 + Y) / 2);
  });
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
}
const fit = (anim) => { const [x, y, w, h] = contentBox(); frameRect(x - 20, y - 260, w + 40, h + 320, anim); };
function focusMachine(i) {
  const s = slots[i].slot, m = slots[i].m;
  frameRect(m.x - 30, m.y - 40, m.w + 60, m.h + 80, true);
  slots.forEach((x, j) => x.slot.classList.toggle('sel', j === i));
  s.querySelector('.iso-stage, .cnc-stage')?.focus({ preventScroll: true });
}
function zoomAt(f, px, py) {
  const k = Math.max(0.1, Math.min(3, cam.k * f));
  cam.x = px - (px - cam.x) * (k / cam.k); cam.y = py - (py - cam.y) * (k / cam.k); cam.k = k; apply();
}
view.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = view.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
let drag = null;
view.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.lf-tag, .lf-full, .lf-route') || (e.target.closest('.lf-slot') && e.target.closest('svg *, canvas'))) return;
  drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
  view.setPointerCapture(e.pointerId); view.classList.add('drag');
});
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.x = drag.cx + e.clientX - drag.x; cam.y = drag.cy + e.clientY - drag.y; apply();
});
const end = () => { drag = null; view.classList.remove('drag'); };
view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
document.querySelector('[data-z="in"]').addEventListener('click', () => { const r = view.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); });
document.querySelector('[data-z="out"]').addEventListener('click', () => { const r = view.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); });
document.querySelector('[data-z="fit"]').addEventListener('click', () => { fit(true); slots.forEach((x) => x.slot.classList.remove('sel')); });
new ResizeObserver(() => fit(false)).observe(view);
// full-screen toggles: centre 3D floor (lf-fs) and right OEE panel (oee-fs)
const fullBtns = { 'lf-fs': [view.querySelector('.lf-full'), 'Full screen 3D view'], 'oee-fs': [document.querySelector('.oee-full'), 'Full screen OEE'] };
const fullOf = () => Object.keys(fullBtns).find((c) => document.body.classList.contains(c));
const setFull = (cls) => {
  for (const [c, [b, label]] of Object.entries(fullBtns)) {
    const on = c === cls;
    document.body.classList.toggle(c, on);
    b.setAttribute('aria-pressed', on); b.textContent = on ? '✕' : '⛶'; b.setAttribute('aria-label', on ? 'Exit full screen' : label);
  }
};
for (const [c, [b]] of Object.entries(fullBtns)) b.addEventListener('click', () => setFull(fullOf() === c ? null : c));
// left panel: slide out / back in
const knobsBtn = document.querySelector('.knobs-toggle');
const setKnobs = (hidden) => {
  document.body.classList.toggle('knobs-hidden', hidden);
  knobsBtn.setAttribute('aria-expanded', !hidden); knobsBtn.textContent = hidden ? '›' : '‹';
  knobsBtn.title = hidden ? 'Show left panel' : 'Hide left panel'; knobsBtn.setAttribute('aria-label', knobsBtn.title);
  try { localStorage.setItem('knobs-hidden', hidden ? '1' : ''); } catch {}
};
// the left panel's controls moved to their own page (control.html): the panel stays hidden (its knobs and
// switches still take the control page's values), and its button opens that page
setKnobs(true);
const controlUrl = /^oee\./.test(location.hostname) ? location.protocol + '//' + location.hostname.replace(/^oee\./, 'control.') + '/' : 'control.html';
const controlLink = Object.assign(document.createElement('a'), { className: 'lb-btn knobs-toggle', href: controlUrl, target: '_blank', rel: 'noopener', textContent: 'Control ↗', title: 'Line controls (knobs, run switches, doors, alarm, QC) on their own page' });
knobsBtn.replaceWith(controlLink);
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && fullOf()) setFull(null);
  else if ((e.key === 'f' || e.key === 'F') && !e.target.closest('.cnc-stage, .iso-stage')) setFull(fullOf() === 'lf-fs' ? null : 'lf-fs');
  else if ((e.key === 'c' || e.key === 'C') && !e.target.closest('.cnc-stage, .iso-stage')) $l('covers').click();
});
fit(false);

// numbered callouts and labels belong to the explainer pages, not to the floor
setTimeout(() => {
  document.querySelectorAll('.lf-slot [data-toggle][aria-pressed="true"]').forEach((b) => b.click());
}, 400);
/* ---------- phone: live numbers instead of the 3D floor ----------
   On a narrow screen the floor is hidden (CSS) and these cards show the same numbers as the floor's tags
   and output panels, copied from them twice a second. The line keeps running underneath either way. */
// a phone: the browser says so, or a small touch screen without a mouse, or a narrow window. Tablets keep the 3D floor.
// The Simple / 3D button in the header overrides it (kept in this browser).
const VIEW_KEY = 'lf-view';
const narrow = matchMedia('(max-width:760px)'), touchOnly = matchMedia('(pointer:coarse) and (hover:none)');
const looksLikePhone = () => !!navigator.userAgentData?.mobile || /Android.+Mobile|iPhone|iPod|Windows Phone|Opera Mini/i.test(navigator.userAgent)
  || (touchOnly.matches && Math.min(screen.width, screen.height) < 600) || narrow.matches;
const viewChoice = () => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } };
const phone = { get matches() { return document.body.classList.contains('phone'); } };
const viewBtn = Object.assign(document.createElement('button'), { type: 'button', className: 'lb-btn view-toggle' });
function applyView() {
  const c = viewChoice(), on = c ? c === 'simple' : looksLikePhone();
  document.body.classList.toggle('phone', on);
  viewBtn.textContent = on ? '🧊 3D view' : '📱 Simple view';
  viewBtn.title = on ? 'Show the 3D floor' : 'Numbers only, no 3D (lighter on a phone)';
}
viewBtn.addEventListener('click', () => {
  try { localStorage.setItem(VIEW_KEY, document.body.classList.contains('phone') ? '3d' : 'simple'); } catch {}
  applyView(); renderPhone();
});
document.querySelector('.dash-bar .lf-tabs, .dash-title')?.after(viewBtn);
[narrow, touchOnly].forEach((m) => m.addEventListener('change', applyView));
applyView();
const mv = document.createElement('section');
mv.className = 'm-view'; mv.setAttribute('aria-label', 'Line, live');
mv.innerHTML = `<div class="mv-outs"></div><div class="mv-ms">${MACHINES.map((m, i) => `<div class="mv-card mv-m">
  <div class="mv-h"><i class="mv-dot"></i><b>${m.no} ${m.name}</b><span class="tg-pr"></span><em class="mv-st"></em></div>
  <div class="mv-g"><span><small>speed</small><b data-v="spd"></b></span><span><small>cycle</small><b data-v="ct"></b></span><span><small>OEE</small><b data-v="oee"></b></span><span><small>parts</small><b data-v="n"></b></span></div>
  <div class="mv-apq" data-v="apq"></div></div>`).join('')}</div>`;
document.querySelector('.line-bar').after(mv);
const mvCards = [...mv.querySelectorAll('.mv-m')].map((c) => ({ c, dot: c.querySelector('.mv-dot'), pr: c.querySelector('.tg-pr'), st: c.querySelector('.mv-st'), v: Object.fromEntries([...c.querySelectorAll('[data-v]')].map((e) => [e.dataset.v, e])) }));
function renderPhone() {
  if (!phone.matches) return;
  mv.querySelector('.mv-outs').innerHTML = outs.map((o) => `<div class="mv-card"><div class="mv-h"><span class="o-p" data-p="${o.p}">${PRODUCTS[o.p]}</span><b>${itemText(o.p) || 'Output ' + PRODUCTS[o.p]}</b><em>${LINE_ID} · ${ROUTE[o.p].map((i) => MACHINES[i].no).join(' → ')}</em></div>
    <div class="mv-g"><span><small>total</small><b>${o.tot.textContent}</b></span><span><small>QC wait</small><b>${o.wait.textContent}</b></span><span class="o-good"><small>good</small><b>${o.good.textContent}</b></span><span class="o-bad"><small>scrap</small><b>${o.bad.textContent}</b></span></div>
    <div class="mv-apq">yield ${o.yld.textContent}</div></div>`).join('');
  slots.forEach((s, i) => {
    const k = mvCards[i];
    k.dot.className = 'mv-dot ' + s.dot.className; k.st.textContent = s.dot.title;
    k.pr.dataset.p = s.pr.dataset.p; k.pr.textContent = s.pr.textContent;
    k.c.classList.toggle('idle', s.tag.classList.contains('idle'));
    k.v.spd.textContent = s.spd.textContent; k.v.ct.textContent = s.ct.textContent; k.v.oee.textContent = s.oee.textContent;
    k.v.oee.dataset.band = s.oee.dataset.band || ''; k.v.n.textContent = s.n.textContent; k.v.apq.textContent = s.apq.textContent;
  });
}
setInterval(renderPhone, 500);

/* ---------- products: route editor ----------
   Click machines in order for each product (click again to take one out), then Apply. With a board
   connected the route goes to the board, and the line follows once the board reports it back. */
function setRoute(r) {
  if (routeText(r) === routeText(ROUTE)) return;
  ROUTE = r;
  try { localStorage.setItem(ROUTE_KEY, routeText(r)); } catch {}
  buildLine(); reset(); fit(true); routeUi.show();
}
const routeUi = (() => {
  const box = document.createElement('div');
  box.className = 'lf-route';
  box.innerHTML = `<button type="button" class="rt-h" aria-expanded="false"><span class="o-h">Products · เส้นทางผลิต</span><em class="rt-sum"></em><b>▾</b></button>
    <div class="rt-body" hidden>${PRODUCTS.map((P, p) => `<div class="rt-row" data-p="${p}"><span class="o-p">${P}</span>${MACHINES.map((m, i) => `<button type="button" class="rt-m" data-i="${i}" title="${m.no} ${m.name}">${m.no}</button>`).join('')}<em class="rt-seq"></em></div>`).join('')}
    <div class="rt-f"><button type="button" class="lb-btn" data-r="apply">Apply</button><button type="button" class="lb-btn" data-r="undo">Undo</button><small class="rt-msg"></small></div></div>`;
  tagsBox.appendChild(box);
  const head = box.querySelector('.rt-h'), body = box.querySelector('.rt-body');
  head.addEventListener('click', () => { body.hidden = !body.hidden; head.setAttribute('aria-expanded', String(!body.hidden)); });
  let draft = ROUTE.map((ms) => ms.slice()), waitFor = null;
  const msg = box.querySelector('.rt-msg');
  const say = (t) => { msg.textContent = t; };
  function show() {
    box.querySelectorAll('.rt-row').forEach((row) => {
      const p = +row.dataset.p;
      row.querySelectorAll('.rt-m').forEach((b) => {
        const k = draft[p].indexOf(+b.dataset.i);
        b.setAttribute('aria-pressed', String(k >= 0));
        b.dataset.n = k >= 0 ? k + 1 : '';
      });
      row.querySelector('.rt-seq').textContent = draft[p].length ? draft[p].map((i) => MACHINES[i].no).join(' → ') + ' → out' : '— not made';
    });
    box.querySelector('.rt-sum').innerHTML = ROUTE.map((ms, p) => ms.length ? `<span class="o-p" data-p="${p}">${PRODUCTS[p]}</span>${ms.map((i) => MACHINES[i].no).join('→')}` : '').filter(Boolean).join(' ');
    const changed = routeText(draft) !== routeText(ROUTE);
    box.querySelector('[data-r="apply"]').disabled = !changed;
    box.querySelector('[data-r="undo"]').disabled = !changed;
    if (!changed && !waitFor) say(boardLive() ? 'set on the board' : 'click machines in order');
  }
  box.addEventListener('click', (e) => {
    const m = e.target.closest('.rt-m');
    if (m) {
      const p = +m.closest('.rt-row').dataset.p, i = +m.dataset.i, k = draft[p].indexOf(i);
      if (k >= 0) draft[p].splice(k, 1);
      else { draft[1 - p] = draft[1 - p].filter((x) => x !== i); draft[p].push(i); }
      say('Apply to use it · parts on the belts are cleared');
      return show();
    }
    const r = e.target.closest('[data-r]')?.dataset.r;
    if (r === 'undo') { draft = ROUTE.map((ms) => ms.slice()); return show(); }
    if (r !== 'apply') return;
    if (!draft[0].length && !draft[1].length) return say('pick at least one machine');
    const want = routeText(draft);
    if (!boardLive()) return setRoute(draft.map((ms) => ms.slice()));
    if (!BOARD().setRoute) return say('this connection can\'t send to the board');
    say('sending to the board …');
    waitFor = want;
    BOARD().setRoute(want).catch((err) => { waitFor = null; say('could not send: ' + (err?.message || err)); });
    setTimeout(() => { if (waitFor === want) { waitFor = null; say('the board did not take it (MQTT: the web user needs write access to …/route/set)'); } }, 4000);
  });
  // the board's route wins while it is connected
  window.__board?.on('route', (t) => {
    const r = parseRoute(t);
    if (!r) return;
    if (waitFor === routeText(r)) { waitFor = null; say('the board took it'); }
    draft = r.map((ms) => ms.slice());
    setRoute(r); show();
  });
  show();
  return { show() { if (!waitFor) draft = ROUTE.map((ms) => ms.slice()); show(); } };
})();

window.__line = { MACHINES, BELTS, slots, placeTags, fit, oeeOf, speedChanged() {}, finish(i) { const s = st[i]; if (s && s.mode === 'run') s.t = Math.max(s.t, MACHINES[i].cycle); },
  // the control page (control.html) runs the simulation: play / pause, time speed, reset, set-up per machine
  setRunning(on) { if (running !== !!on) setRunning(!!on); },
  setSpeed(n) { const b = document.querySelector(`.line-bar [data-speed="${n}"]`); if (b && speed !== n) b.click(); },
  reset,
  setRouteText(t) { const r = parseRoute(t); if (r) setRoute(r); },
  setItems(items, line) { ITEMS = { A: { ...ITEMS.A, ...(items.A || {}) }, B: { ...ITEMS.B, ...(items.B || {}) } }; if (line) LINE_ID = line; },
  setSetup(i, on) { if (!slots[i] || !!window.__setup[i] === !!on) return; window.__setup[i] = !!on; slots[i].tag.querySelector('.tg-ma').setAttribute('aria-pressed', String(!!on)); },
  toggleDoor(i) { const s = slots[i]; if (s && !boardLive() && s.door.can()) s.door.toggle(); } };

// mirrored drawings: turn their lettering back the right way round
function unmirrorText() {
  document.querySelectorAll('.lf-slot[data-mirror] svg text').forEach((t) => {
    if (t.parentNode.dataset && t.parentNode.dataset.unmirror !== undefined) return;
    let b; try { b = t.getBBox(); } catch { return; }
    if (!b.width) return;
    const m = t.transform.baseVal.consolidate()?.matrix;
    const cx = m ? m.a * (b.x + b.width / 2) + m.c * (b.y + b.height / 2) + m.e : b.x + b.width / 2;
    const g = document.createElementNS(NS, 'g');
    g.dataset.unmirror = '';
    g.setAttribute('transform', `translate(${(2 * cx).toFixed(2)} 0) scale(-1 1)`);
    t.parentNode.insertBefore(g, t); g.appendChild(t);
  });
}
setTimeout(unmirrorText, 600); setTimeout(unmirrorText, 2500);
})();
