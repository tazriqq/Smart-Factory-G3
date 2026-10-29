// 14-machine-l250e.js - Machine M4 Okuma GENOS L250E - drawing, animation and parts list
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
const document = window.__mx.doc("l250e");
const __t = window.__mx.time(3); const requestAnimationFrame = __t.raf, cancelAnimationFrame = __t.caf, performance = __t.perf;
const AZIMUTH = 45;
const ELEVATION = 30;
const SHADES = 4;
const RADIANS = Math.PI / 180;
const UNIT = Math.sqrt(1.6);
function cameraOf({ scale, azimuth = AZIMUTH, elevation = ELEVATION }) {
    const a = azimuth * RADIANS;
    const e = elevation * RADIANS;
    return { sinA: Math.sin(a), cosA: Math.cos(a), sinE: Math.sin(e), cosE: Math.cos(e), k: scale * UNIT };
}
function iso([x, y, z], projection) {
    const { origin } = projection;
    const { sinA, cosA, sinE, cosE, k } = cameraOf(projection);
    return [origin[0] + (x * sinA - y * cosA) * k, origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k];
}
function towardViewer(projection) {
    const { sinA, cosA } = cameraOf(projection);
    return [cosA, sinA];
}
function depthOf([x, y, z], projection) {
    const { sinA, cosA, sinE, cosE } = cameraOf(projection);
    return (x * cosA + y * sinA) * cosE + z * sinE;
}
const tenth = (value) => {
    const text = (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return text === "-0" ? "0" : text;
};
function pathOf(points, closed = false) {
    if (!points.length)
        return "";
    return points.map(([x, y], at) => `${at ? "L" : "M"}${tenth(x)} ${tenth(y)}`).join("") + (closed ? "Z" : "");
}
const joinPaths = (paths) => paths.filter(Boolean).join("");
function roundedPlan({ x, y, w, d, r }, steps = 8) {
    const radius = Math.max(0, Math.min(r, w / 2, d / 2));
    const corners = [
        [x + w - radius, y + radius, -90],
        [x + w - radius, y + d - radius, 0],
        [x + radius, y + d - radius, 90],
        [x + radius, y + radius, 180],
    ];
    const out = [];
    for (const [cx, cy, start] of corners) {
        const count = radius > 0 ? steps : 0;
        for (let step = 0; step <= count; step++) {
            const angle = (start + (count ? (90 * step) / count : 45)) * RADIANS;
            out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
        }
    }
    return out;
}
function signedArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const [ax, ay] = points[index];
        const [bx, by] = points[(index + 1) % points.length];
        area += ax * by - bx * ay;
    }
    return area / 2;
}
const oriented = (points) => (signedArea(points) < 0 ? [...points].reverse() : points);
function convexHull(points) {
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (sorted.length < 3)
        return sorted;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const point of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0)
            lower.pop();
        lower.push(point);
    }
    const upper = [];
    for (let index = sorted.length - 1; index >= 0; index--) {
        const point = sorted[index];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0)
            upper.pop();
        upper.push(point);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function runsOf(flags, want) {
    const count = flags.length;
    const runs = [];
    const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
    if (start < 0)
        return flags[0] === want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
    let run = null;
    for (let step = 0; step < count; step++) {
        const index = (start + step) % count;
        if (flags[index] === want) {
            if (!run)
                run = [index];
            run.push((index + 1) % count);
        }
        else if (run) {
            runs.push(run);
            run = null;
        }
    }
    if (run)
        runs.push(run);
    return runs;
}
function extrude(ring, z, height, projection, options = {}) {
    const convex = options.convex ?? true;
    const count = ring.length;
    const counter = signedArea(ring) > 0;
    const [vx, vy] = towardViewer(projection);
    const { sinA, cosA } = cameraOf(projection);
    const normals = ring.map(([ax, ay], index) => {
        const [bx, by] = ring[(index + 1) % count];
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.hypot(dx, dy) || 1;
        return (counter ? [dy / length, -dx / length] : [-dy / length, dx / length]);
    });
    const facing = normals.map(([nx, ny]) => nx * vx + ny * vy > 1e-9);
    const top = ring.map(([x, y]) => iso([x, y, z + height], projection));
    const bottom = ring.map(([x, y]) => iso([x, y, z], projection));
    const outline = [];
    const crease = [];
    for (const run of runsOf(facing, false))
        outline.push(pathOf(run.map((index) => top[index])));
    for (const run of runsOf(facing, true)) {
        crease.push(pathOf(run.map((index) => top[index])));
        if (height > 0)
            outline.push(pathOf(run.map((index) => bottom[index])));
    }
    if (height > 0) {
        for (let index = 0; index < count; index++) {
            if (facing[(index + count - 1) % count] !== facing[index])
                outline.push(pathOf([top[index], bottom[index]]));
        }
    }
    let fill;
    if (convex) {
        fill = pathOf(convexHull([...top, ...bottom]), true);
    }
    else {
        const parts = [pathOf(oriented(top), true), pathOf(oriented(bottom), true)];
        for (let index = 0; index < count; index++) {
            if (!facing[index])
                continue;
            const next = (index + 1) % count;
            parts.push(pathOf(oriented([top[index], top[next], bottom[next], bottom[index]]), true));
        }
        fill = parts.join("");
    }
    const buckets = Array.from({ length: SHADES }, () => []);
    if (height > 0) {
        const [lx, ly] = [-sinA, cosA];
        for (let index = 0; index < count; index++) {
            if (!facing[index])
                continue;
            const [nx, ny] = normals[index];
            const lit = (nx * lx + ny * ly + 1) / 2;
            const shade = Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)));
            const next = (index + 1) % count;
            buckets[shade].push(pathOf(oriented([top[index], top[next], bottom[next], bottom[index]]), true));
        }
    }
    let bevel;
    if (options.bevel && options.bevel > 0) {
        const by = options.bevel;
        const inset = ring.map(([x, y], index) => {
            const [ax, ay] = normals[(index + count - 1) % count];
            const [bx, by2] = normals[index];
            const mx = ax + bx;
            const my = ay + by2;
            const length = Math.hypot(mx, my) || 1;
            return [x - (mx / length) * by, y - (my / length) * by];
        });
        const insetTop = inset.map(([x, y]) => iso([x, y, z + height], projection));
        bevel = runsOf(facing, true)
            .map((run) => pathOf([top[run[0]], ...run.slice(1, -1).map((index) => insetTop[index]), top[run[run.length - 1]]]))
            .join("");
    }
    return {
        fill,
        outline: outline.join(""),
        crease: crease.join(""),
        top: pathOf(oriented(top), true),
        shades: buckets.map((paths) => paths.join("")),
        bevel,
    };
}
const ringOf = (plan, steps = 8) => roundedPlan(plan, steps);
function slabOf(plan, z, height, projection, steps = 8, bevel = 0) {
    return extrude(ringOf(plan, steps), z, height, projection, { convex: true, bevel });
}
function circleRing(cx, cy, radius, steps = 40) {
    return Array.from({ length: steps }, (_, step) => {
        const angle = (step / steps) * Math.PI * 2;
        return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    });
}
function cylinder(cx, cy, radius, z, height, projection, steps = 32, bevel = 0) {
    return extrude(circleRing(cx, cy, radius, steps), z, height, projection, { convex: true, bevel });
}
const insetPlan = ({ x, y, w, d, r }, by) => ({ x: x + by, y: y + by, w: w - by * 2, d: d - by * 2, r: Math.max(0, r - by) });
function onTop(points, z, projection, closed = false) {
    return pathOf(points.map(([x, y]) => iso([x, y, z], projection)), closed);
}
const planOutline = (plan, z, projection, steps = 8) => onTop(ringOf(plan, steps), z, projection, true);
const lineOnTop = (from, to, z, projection) => onTop([from, to], z, projection);
const segment = (from, to, projection) => pathOf([iso(from, projection), iso(to, projection)]);
const rise = (at, from, to, projection) => segment([at[0], at[1], from], [at[0], at[1], to], projection);
const ring = (cx, cy, radius, z, projection, steps = 40) => onTop(circleRing(cx, cy, radius, steps), z, projection, true);
const pointsAt = (points, projection) => points.map((point) => iso(point, projection));
function dotGrid(x, y, columns, rows, gap, z, projection) {
    const dots = [];
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++)
            dots.push(iso([x + column * gap, y + row * gap, z], projection));
    }
    return dots;
}
function corners({ x, y, w, d }, inset = 0) {
    return [
        [x + inset, y + inset],
        [x + w - inset, y + inset],
        [x + inset, y + d - inset],
        [x + w - inset, y + d - inset],
    ];
}
function boxCorners({ x, y, w, d }, z0, z1) {
    const out = [];
    for (const px of [x, x + w])
        for (const py of [y, y + d])
            for (const z of [z0, z1])
                out.push([px, py, z]);
    return out;
}
function knurl(cx, cy, radius, z0, z1, count, projection, inset = 0.4) {
    const [vx, vy] = towardViewer(projection);
    const lines = [];
    for (let index = 0; index < count; index++) {
        const angle = (index / count) * Math.PI * 2;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        if (nx * vx + ny * vy < 0.15)
            continue;
        lines.push(segment([cx + radius * nx, cy + radius * ny, z0 + inset], [cx + radius * nx, cy + radius * ny, z1 - inset], projection));
    }
    return lines.join("");
}
function sideArc(cx, cy, radius, z, projection, steps = 24) {
    const [vx, vy] = towardViewer(projection);
    const facing = Math.atan2(vy, vx);
    const points = [];
    for (let step = 0; step <= steps; step++) {
        const angle = facing - Math.PI / 2 + (step / steps) * Math.PI;
        points.push(iso([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z], projection));
    }
    return pathOf(points);
}
function ringSeam(ring, z, projection) {
    const count = ring.length;
    const counter = signedArea(ring) > 0;
    const [vx, vy] = towardViewer(projection);
    const facing = ring.map(([ax, ay], index) => {
        const [bx, by] = ring[(index + 1) % count];
        const dx = bx - ax;
        const dy = by - ay;
        const [nx, ny] = counter ? [dy, -dx] : [-dy, dx];
        return nx * vx + ny * vy > 1e-9;
    });
    return runsOf(facing, true).map((run) => pathOf(run.map((index) => iso([ring[index][0], ring[index][1], z], projection)))).join("");
}
const sideSeam = (plan, z, projection, steps = 8) => ringSeam(ringOf(plan, steps), z, projection);
function sideRing(center, radius, axis, projection, steps = 20) {
    const [px, py, pz] = center;
    const points = [];
    for (let step = 0; step < steps; step++) {
        const angle = (step / steps) * Math.PI * 2;
        const u = radius * Math.cos(angle);
        const v = radius * Math.sin(angle);
        points.push(iso(axis === "x" ? [px, py + u, pz + v] : [px + u, py, pz + v], projection));
    }
    return pathOf(points, true);
}
function coil(from, to, center, radius, turns, axis, projection, perTurn = 16) {
    const count = Math.max(1, Math.round(turns * perTurn));
    const back = [];
    const front = [];
    let run = [];
    let near = null;
    for (let index = 0; index <= count; index++) {
        const share = index / count;
        const angle = share * turns * Math.PI * 2;
        const u = radius * Math.cos(angle);
        const v = radius * Math.sin(angle);
        const along = from + (to - from) * share;
        const point = axis === "x" ? [along, center[0] + u, center[1] + v] : [center[0] + u, along, center[1] + v];
        const normal = axis === "x" ? [0, Math.cos(angle), Math.sin(angle)] : [Math.cos(angle), 0, Math.sin(angle)];
        const facing = depthOf(normal, projection) > 0;
        const flat = iso(point, projection);
        if (near === null)
            near = facing;
        if (facing !== near) {
            run.push(flat);
            (near ? front : back).push(pathOf(run));
            run = [flat];
            near = facing;
            continue;
        }
        run.push(flat);
    }
    if (run.length > 1)
        (near ? front : back).push(pathOf(run));
    return { back: back.join(""), front: front.join("") };
}
function topTicks(from, to, step, every, edge, z, lengths, projection, axis = "x") {
    const minor = [];
    const major = [];
    const first = Math.ceil(from / step) * step;
    for (let at = first, index = Math.round(first / step); at <= to + 1e-9; at += step, index++) {
        const big = index % every === 0;
        const length = big ? lengths[1] : lengths[0];
        const a = axis === "x" ? [at, edge] : [edge, at];
        const b = axis === "x" ? [at, edge + length] : [edge + length, at];
        (big ? major : minor).push(lineOnTop(a, b, z, projection));
    }
    return { minor: minor.join(""), major: major.join("") };
}
function sideTicks(from, to, step, every, face, top, lengths, projection, axis = "x") {
    const minor = [];
    const major = [];
    const first = Math.ceil(from / step) * step;
    for (let at = first, index = Math.round(first / step); at <= to + 1e-9; at += step, index++) {
        const big = index % every === 0;
        const length = big ? lengths[1] : lengths[0];
        const a = axis === "x" ? [at, face, top] : [face, at, top];
        const b = axis === "x" ? [at, face, top - length] : [face, at, top - length];
        (big ? major : minor).push(segment(a, b, projection));
    }
    return { minor: minor.join(""), major: major.join("") };
}
function radialTicks(cx, cy, radius, count, every, z, lengths, projection, from = 0, span = Math.PI * 2) {
    const minor = [];
    const major = [];
    const closed = Math.abs(span - Math.PI * 2) < 1e-9;
    const steps = closed ? count : count + 1;
    for (let index = 0; index < steps; index++) {
        const angle = from + (index / count) * span;
        const big = index % every === 0;
        const inner = radius - (big ? lengths[1] : lengths[0]);
        const sx = Math.sin(angle);
        const sy = -Math.cos(angle);
        (big ? major : minor).push(lineOnTop([cx + sx * inner, cy + sy * inner], [cx + sx * radius, cy + sy * radius], z, projection));
    }
    return { minor: minor.join(""), major: major.join("") };
}
const haloOf = (plan, z, height, projection) => slabOf(plan, z, height, projection).fill;
function axisVector(projection, [dx, dy, dz]) {
    const origin = iso([0, 0, 0], projection);
    const moved = iso([dx, dy, dz], projection);
    return [moved[0] - origin[0], moved[1] - origin[1]];
}
const fine = (value) => Math.round(value * 100) / 100;
function translateAlong(projection, by) {
    const [x, y] = axisVector(projection, by);
    return `translate(${fine(x)} ${fine(y)})`;
}
const thousandth = (value) => Math.round(value * 1000) / 1000;
function axesAt(at, z, projection) {
    const origin = iso([at[0], at[1], z], projection);
    const along = (point) => {
        const [px, py] = iso(point, projection);
        return [px - origin[0], py - origin[1]];
    };
    return { origin, x: along([at[0] + 1, at[1], z]), y: along([at[0], at[1] + 1, z]), z: along([at[0], at[1], z + 1]) };
}
const matrixOf = (u, v, origin) => `matrix(${thousandth(u[0])} ${thousandth(u[1])} ${thousandth(v[0])} ${thousandth(v[1])} ${thousandth(origin[0])} ${thousandth(origin[1])})`;
function holdStill(element, [dx, dy]) {
    const text = dx || dy ? `translate(${-dx} ${-dy})` : "";
    element.querySelectorAll("[data-hold]").forEach((node) => (text ? node.setAttribute("transform", text) : node.removeAttribute("transform")));
}
function topMatrix(at, z, projection, along = "x") {
    const { origin, x, y } = axesAt(at, z, projection);
    return along === "x" ? matrixOf(x, y, origin) : matrixOf([-y[0], -y[1]], x, origin);
}
function sideMatrix(at, z, projection, face) {
    const { origin, x, y, z: up } = axesAt(at, z, projection);
    const down = [-up[0], -up[1]];
    return face === "left" ? matrixOf(x, down, origin) : matrixOf([-y[0], -y[1]], down, origin);
}
function screenRise(height, projection) {
    const { cosE, k } = cameraOf(projection);
    return height * cosE * k;
}
function fitProjection(points, width, height, { pad = 24, headroom = 0, azimuth = AZIMUTH, elevation = ELEVATION } = {}) {
    const unit = { origin: [0, 0], scale: 1, azimuth, elevation };
    const flat = points.map((point) => iso(point, unit));
    const xs = flat.map(([x]) => x);
    const ys = flat.map(([, y]) => y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const up = Math.min(...ys);
    const down = Math.max(...ys);
    const scale = Math.min((width - pad * 2) / (right - left), (height - pad * 2 - headroom) / (down - up));
    return {
        origin: [width / 2 - ((left + right) / 2) * scale, headroom + (height - headroom) / 2 - ((up + down) / 2) * scale],
        scale,
        azimuth,
        elevation,
    };
}
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attrs = (pairs) => Object.entries(pairs)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => ` ${key}="${escape(String(value))}"`)
    .join("");
function solidSvg(paths, { tone = "hi", crease = "faint", halo = false, lit = false, flat = false, className, inner = "" } = {}) {
    const parts = [];
    if (halo)
        parts.push(`<path class="iso-halo" d="${paths.fill}"/>`);
    parts.push(`<path class="iso-fill" d="${paths.fill}"/>`);
    if (!flat) {
        paths.shades.forEach((d, shade) => {
            if (d)
                parts.push(`<path class="iso-shade" data-shade="${shade}" d="${d}"/>`);
        });
        parts.push(`<path class="iso-top" d="${paths.top}"/>`);
    }
    if (crease !== "none" && paths.crease)
        parts.push(`<path class="iso-line iso-crease" data-tone="${crease}" d="${paths.crease}"/>`);
    if (crease !== "none" && paths.bevel)
        parts.push(`<path class="iso-line iso-bevel" data-tone="${crease}" d="${paths.bevel}"/>`);
    if (inner)
        parts.push(inner);
    parts.push(`<path class="iso-line iso-edge" data-tone="${tone}" d="${paths.outline}"/>`);
    return `<g${attrs({ class: className ? `iso-solid ${className}` : "iso-solid", "data-lit": lit ? "" : undefined, "data-seamless": paths.seamless ? "" : undefined })}>${parts.join("")}</g>`;
}
function lineSvg(d, { tone = "lo", dotted = false, dashed = false, flow = false, className, free } = {}) {
    if (!d)
        return "";
    return `<path${attrs({
        class: className ? `iso-line ${className}` : "iso-line",
        "data-tone": tone,
        "data-free": free === true ? "" : free || undefined,
        "data-dotted": dotted ? "" : undefined,
        "data-dashed": dashed ? "" : undefined,
        "data-flow": flow ? "" : undefined,
        d,
    })}/>`;
}
function dotsSvg(points, { size = 0.5, tone = "mid", pulse = false } = {}) {
    const dots = points
        .map(([x, y, alpha], index) => `<circle cx="${tenth(x)}" cy="${tenth(y)}" r="${size}"${alpha !== undefined && alpha < 1 ? ` fill-opacity="${Math.max(0, alpha).toFixed(2)}"` : ""}${pulse ? ` data-pulse="" style="--pulse-at:${(index * 137) % 1600}ms"` : ""}/>`)
        .join("");
    return `<g class="iso-dots" data-tone="${tone}">${dots}</g>`;
}
function fadedSvg(list, style = {}) {
    const groups = new Map();
    for (const entry of list) {
        const [d, alpha] = Array.isArray(entry) ? entry : [entry.d, entry.alpha];
        if (!d || !(alpha > 0.02))
            continue;
        const level = Math.min(1, Math.round(alpha * 20) / 20);
        groups.set(level, (groups.get(level) ?? "") + d);
    }
    return [...groups].map(([alpha, d]) => (alpha >= 1 ? lineSvg(d, style) : `<g opacity="${alpha.toFixed(2)}">${lineSvg(d, style)}</g>`)).join("");
}
function fadeLineSvg(points, { fade = [0, 0], tone = "lo", className, stops = 6 } = {}) {
    if (points.length < 2)
        return "";
    const ease = (t) => t * t * (3 - 2 * t);
    const hashOf = (text) => {
        let hash = 2166136261;
        for (let index = 0; index < text.length; index++)
            hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
        return (hash >>> 0).toString(36);
    };
    const lengths = [0];
    for (let index = 1; index < points.length; index++)
        lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
    const at = (length) => {
        let index = 1;
        while (index < points.length - 1 && lengths[index] < length)
            index++;
        const span = lengths[index] - lengths[index - 1] || 1;
        const t = Math.max(0, Math.min(1, (length - lengths[index - 1]) / span));
        return [points[index - 1][0] + (points[index][0] - points[index - 1][0]) * t, points[index - 1][1] + (points[index][1] - points[index - 1][1]) * t];
    };
    const pieceOf = (from, to) => [at(from), ...points.filter((_, index) => lengths[index] > from + 1e-6 && lengths[index] < to - 1e-6), at(to)];
    const total = lengths[lengths.length - 1];
    if (total < 1e-6)
        return "";
    let [start, end] = Array.isArray(fade) ? fade : [fade, fade];
    if (start + end > total) {
        const share = total / (start + end);
        start *= share;
        end *= share;
    }
    const paint = `var(--anatomy-${tone})`;
    const ramp = (piece, rising) => {
        const d = pathOf(piece);
        const [x1, y1] = piece[0];
        const [x2, y2] = piece[piece.length - 1];
        const id = `iso-fade-${hashOf(`${d}|${tone}|${rising}`)}`;
        const marks = Array.from({ length: stops + 1 }, (_, index) => {
            const t = index / stops;
            const alpha = ease(rising ? t : 1 - t);
            return `<stop offset="${t.toFixed(3)}" stop-opacity="${alpha.toFixed(3)}" style="stop-color:${paint}"/>`;
        }).join("");
        const gradient = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${tenth(x1)}" y1="${tenth(y1)}" x2="${tenth(x2)}" y2="${tenth(y2)}">${marks}</linearGradient>`;
        return `<defs>${gradient}</defs><path${attrs({ class: className ? `iso-line ${className}` : "iso-line", "data-tone": tone, "data-free": rising ? "start" : "end", d, style: `stroke:url(#${id})` })}/>`;
    };
    const parts = [];
    if (start > 0.05)
        parts.push(ramp(pieceOf(0, start), true));
    if (total - end - start > 0.05)
        parts.push(lineSvg(pathOf(pieceOf(start, total - end)), { tone, className }));
    if (end > 0.05)
        parts.push(ramp(pieceOf(total - end, total), false));
    return `<g class="iso-fade">${parts.join("")}</g>`;
}
function wireSvg(from, to, { via = [], tone = "lo", dotted = false, dashed = false, flow = false, ends = "both", size = 1.2 } = {}) {
    const d = pathOf([from, ...via, to]);
    const end = ([x, y]) => `<circle class="iso-wire-end" cx="${tenth(x)}" cy="${tenth(y)}" r="${size}"/>`;
    return `<g class="iso-wire" data-tone="${tone}">${lineSvg(d, { tone, dotted, dashed, flow })}${ends === "both" || ends === "from" ? end(from) : ""}${ends === "both" || ends === "to" ? end(to) : ""}</g>`;
}
function faceTextSvg(transform, text, { size = 3, tone = "mid", anchor = "start" } = {}) {
    return `<text class="iso-face-text" data-tone="${tone}" transform="${transform}" font-size="${size}" text-anchor="${anchor}">${escape(text)}</text>`;
}
function groupSvg(children, extra = {}) {
    return `<g${attrs(extra)}>${Array.isArray(children) ? children.join("") : children}</g>`;
}
function figureSvg({ width, height, label, body, standalone = false, className }) {
    const style = standalone ? `<style>${ISO_CSS}</style>` : "";
    return `<svg${attrs({
        xmlns: "http://www.w3.org/2000/svg",
        class: `iso-svg${standalone ? " iso" : ""}${className ? ` ${className}` : ""}`,
        "data-theme": standalone || undefined,
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-label": label,
    })}>${style}${Array.isArray(body) ? body.join("") : body}</svg>`;
}
function swatchSvg(mark) {
    if (mark === "raised" || mark === "flat" || mark === "lit") {
        const body = mark === "flat" ? "M2 6.5 8 3.5 14 6.5 8 9.5Z" : "M2 4.5 8 1.5 14 4.5 14 6 8 9 2 6Z";
        const crease = mark === "flat" ? "" : `<path class="iso-swatch-crease" d="M2 4.5 8 7.5 14 4.5"/>`;
        return `<svg class="iso-swatch" data-mark="${mark}" viewBox="0 0 16 10" aria-hidden="true"><path d="${body}"/>${crease}</svg>`;
    }
    return `<svg class="iso-swatch" data-mark="${mark}" viewBox="0 0 16 10" aria-hidden="true"><path d="M1.5 5h13"/></svg>`;
}
function plateHtml({ fig, title, hint, readout = "", keys = [], caption, body }) {
    const corner = (name, text, extra = "") => `<span class="iso-plate-corner" data-corner="${name}"${extra}>${escape(text)}</span>`;
    const legend = keys.length || caption
        ? `<figcaption class="iso-legend">${keys.length ? `<span class="iso-keys">${keys.map((key) => `<span class="iso-key">${swatchSvg(key.mark)}${escape(key.label)}</span>`).join("")}</span>` : ""}${caption ? `<span class="iso-caption">${escape(caption)}</span>` : ""}</figcaption>`
        : "";
    return `<figure class="iso-figure"><div class="iso-plate"><div class="iso-plate-corners" aria-hidden="true">${corner("fig", fig)}${title ? corner("title", title) : ""}${hint ? corner("hint", hint) : ""}${corner("readout", readout, " data-readout")}</div>${body}</div>${legend}</figure>`;
}
function pageHtml({ title, theme = "dark", body, script = "", width = 650 }) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>${ISO_CSS}${PAGE_CSS.replace("__WIDTH__", String(width))}</style></head><body class="iso" data-theme="${theme}"><main class="iso-page">${body}</main>${script ? `<script type="module">${script.replace(/<\/(script)/gi, "<\\/$1")}<\/script>` : ""}</body></html>`;
}
const PAGE_CSS = `
*{box-sizing:border-box}
html{color-scheme:dark}
body[data-theme="light"]{color-scheme:light}
body{margin:0;background:var(--anatomy-page);color:var(--anatomy-text);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.iso-page{width:min(__WIDTH__px,100% - 32px);margin:64px auto 96px}
`;
const ISO_CSS = `
.iso{
  --anatomy-page:#0b0b0b;--anatomy-card:#131313;--anatomy-text:#a3a3a3;--anatomy-strong:#e6e6e6;--anatomy-muted:#6e6e6e;
  --anatomy-paper:#131313;--anatomy-face:#1b1b1b;--anatomy-top:#1c1c1c;
  --anatomy-shade-0:#0f0f0f;--anatomy-shade-1:#121212;--anatomy-shade-2:#151515;--anatomy-shade-3:#181818;
  --anatomy-lit-top:#262626;--anatomy-lit-shade:#1d1d1d;
  --anatomy-hi:#d4d4d4;--anatomy-mid:#6a6a6a;--anatomy-lo:#3e3e3e;--anatomy-faint:#2a2a2a;--anatomy-lit:#ffffff;
  --anatomy-halo:#050505;--anatomy-halo-opacity:.9;--anatomy-dot:#e6e6e6;
  --anatomy-red:#ff6b6b;--anatomy-green:#6be0a0;--anatomy-blue:#6b9bff;
  --anatomy-weight:.6px;--anatomy-ease:cubic-bezier(.32,.72,0,1);
  --anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --anatomy-lift:inset 0 1px 0 0 #ffffff0a,inset 0 0 0 1px #ffffff06,0 0 0 1px #00000026,0 1px 1px -.5px #00000014,0 3px 3px -1.5px #00000014,0 6px 6px -3px #00000014,0 12px 12px -6px #00000014;
}
.iso[data-theme="light"]{
  --anatomy-page:#f2f2ef;--anatomy-card:#fbfbfa;--anatomy-text:#57575a;--anatomy-strong:#18181a;--anatomy-muted:#8c8c90;
  --anatomy-paper:#fbfbfa;--anatomy-face:#ffffff;--anatomy-top:#ffffff;
  --anatomy-shade-0:#dcdcd9;--anatomy-shade-1:#e5e5e2;--anatomy-shade-2:#ededea;--anatomy-shade-3:#f4f4f1;
  --anatomy-lit-top:#ffffff;--anatomy-lit-shade:#eeeeeb;
  --anatomy-hi:#26262a;--anatomy-mid:#8a8a8f;--anatomy-lo:#b4b4b8;--anatomy-faint:#d4d4d6;--anatomy-lit:#000000;
  --anatomy-halo:#8a8a80;--anatomy-halo-opacity:.32;--anatomy-dot:#3a3a3e;
  --anatomy-red:#e5484d;--anatomy-green:#30a46c;--anatomy-blue:#3e63dd;
  --anatomy-lift:inset 0 1px 0 0 #ffffff,0 0 0 1px #0000000f,0 1px 1px -.5px #0000000a,0 3px 3px -1.5px #0000000a,0 6px 6px -3px #0000000a,0 12px 12px -6px #0000000a;
}
.iso-svg{display:block;width:100%;height:auto;overflow:visible}
.iso-svg path,.iso-svg circle{vector-effect:non-scaling-stroke}
.iso-fill{fill:var(--anatomy-paper);stroke:none}
.iso-solid[data-lit]>.iso-fill{fill:var(--anatomy-face)}
.iso-shade,.iso-top{stroke:none}
.iso-shade[data-shade="0"]{fill:var(--anatomy-shade-0)}
.iso-shade[data-shade="1"]{fill:var(--anatomy-shade-1)}
.iso-shade[data-shade="2"]{fill:var(--anatomy-shade-2)}
.iso-shade[data-shade="3"]{fill:var(--anatomy-shade-3)}
.iso-top{fill:var(--anatomy-top)}
.iso-solid[data-lit]>.iso-top{fill:var(--anatomy-lit-top)}
.iso-solid[data-lit]>.iso-shade{fill:var(--anatomy-lit-shade)}
.iso-solid[data-seamless]>.iso-shade,.iso-solid[data-seamless]>.iso-top{stroke-width:.4;stroke-linejoin:round}
.iso-solid[data-seamless]>.iso-shade[data-shade="0"]{stroke:var(--anatomy-shade-0)}
.iso-solid[data-seamless]>.iso-shade[data-shade="1"]{stroke:var(--anatomy-shade-1)}
.iso-solid[data-seamless]>.iso-shade[data-shade="2"]{stroke:var(--anatomy-shade-2)}
.iso-solid[data-seamless]>.iso-shade[data-shade="3"]{stroke:var(--anatomy-shade-3)}
.iso-solid[data-seamless]>.iso-top{stroke:var(--anatomy-top)}
.iso-solid[data-seamless][data-lit]>.iso-top{stroke:var(--anatomy-lit-top)}
.iso-solid[data-seamless][data-lit]>.iso-shade{stroke:var(--anatomy-lit-shade)}
.iso-solid[data-lit]>.iso-edge{stroke:var(--anatomy-lit)}
.iso-halo{fill:var(--anatomy-halo);stroke:none;filter:blur(9px);opacity:var(--anatomy-halo-opacity);transform:translateY(3px)}
.iso-line{fill:none;stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight);stroke-linecap:round;stroke-linejoin:round}
.iso-line[data-tone="hi"]{stroke:var(--anatomy-hi)}
.iso-line[data-tone="mid"]{stroke:var(--anatomy-mid)}
.iso-line[data-tone="lo"]{stroke:var(--anatomy-lo)}
.iso-line[data-tone="faint"]{stroke:var(--anatomy-faint)}
.iso-line[data-tone="lit"]{stroke:var(--anatomy-lit)}
.iso-line[data-tone="red"]{stroke:var(--anatomy-red)}
.iso-line[data-tone="green"]{stroke:var(--anatomy-green)}
.iso-line[data-tone="blue"]{stroke:var(--anatomy-blue)}
.iso-line[data-dotted]{stroke-dasharray:.01 3.5;stroke-width:1}
.iso-line[data-dashed]{stroke-dasharray:3 3}
.iso-line[data-flow]{stroke-dasharray:2 6}
.iso-wire-end{fill:var(--anatomy-paper);stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight)}
.iso-wire[data-tone="hi"] .iso-wire-end{stroke:var(--anatomy-hi)}
.iso-wire[data-tone="mid"] .iso-wire-end{stroke:var(--anatomy-mid)}
.iso-wire[data-tone="faint"] .iso-wire-end{stroke:var(--anatomy-faint)}
.iso-wire[data-tone="lit"] .iso-wire-end{stroke:var(--anatomy-lit)}
.iso-dots circle{fill:var(--anatomy-dot);stroke:none;opacity:.32}
.iso-dots[data-tone="hi"] circle{opacity:.85}
.iso-dots[data-tone="mid"] circle{opacity:.45}
.iso-dots[data-tone="lo"] circle{opacity:.22}
.iso-dots[data-tone="faint"] circle{opacity:.12}
.iso-face-text{fill:var(--anatomy-mid);font-family:var(--anatomy-mono);letter-spacing:.04em}
.iso-face-text[data-tone="hi"]{fill:var(--anatomy-hi)}
.iso-face-text[data-tone="lo"]{fill:var(--anatomy-lo)}
.iso-face-text[data-tone="faint"]{fill:var(--anatomy-faint)}
.tb-body{fill:var(--anatomy-shade-2);stroke:none}
.tb-shine{fill:var(--anatomy-top);stroke:none}
.tb-shade{fill:var(--anatomy-shade-0);stroke:none}
.tb-ring{fill:none;stroke:var(--anatomy-lo);stroke-width:.45;stroke-linecap:butt;stroke-linejoin:round}
.tb-ring[data-tone="mid"]{stroke:var(--anatomy-mid)}
.tb-ring[data-tone="faint"]{stroke:var(--anatomy-faint)}
.tb-ring[data-tone="hi"]{stroke:var(--anatomy-hi)}
@keyframes iso-flow{to{stroke-dashoffset:-32}}
@keyframes iso-pulse{0%,100%{opacity:.18}12%{opacity:1}40%{opacity:.18}}
.iso-line[data-flow]{animation:iso-flow 1600ms linear infinite}
.iso-dots circle[data-pulse]{animation:iso-pulse 1600ms steps(1,end) infinite;animation-delay:var(--pulse-at,0ms)}
.iso-figure{margin:32px 0 36px}
.iso-plate{position:relative;padding:52px 24px;border-radius:0;background:var(--anatomy-card);box-shadow:0 0 0 1px var(--anatomy-mid);--anatomy-paper:var(--anatomy-card)}
.iso-plate-corners{position:absolute;inset:18px 20px;pointer-events:none}
.iso-plate-corner{position:absolute;color:var(--anatomy-muted);font-family:var(--anatomy-mono);font-size:10.5px;line-height:1;letter-spacing:.04em;white-space:nowrap}
.iso-plate-corner[data-corner="fig"]{top:0;left:0;color:var(--anatomy-text)}
.iso-plate-corner[data-corner="title"]{top:0;right:0;text-transform:uppercase;letter-spacing:.1em}
.iso-plate-corner[data-corner="hint"]{bottom:0;left:0;text-transform:uppercase;letter-spacing:.1em}
.iso-plate-corner[data-corner="readout"]{right:0;bottom:0;color:var(--anatomy-text);font-variant-numeric:tabular-nums}
.iso-plate .iso-svg{margin:0 auto}
.iso-legend{display:grid;gap:8px;margin-top:12px;color:var(--anatomy-muted);font-size:13px;line-height:1.55}
.iso-keys{display:flex;flex-wrap:wrap;gap:6px 18px}
.iso-key{display:inline-flex;align-items:center;gap:7px}
.iso-swatch{width:16px;height:10px;flex:none;overflow:visible}
.iso-swatch path{fill:none;stroke:var(--anatomy-hi);stroke-width:1;vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round}
.iso-swatch[data-mark="raised"] path,.iso-swatch[data-mark="flat"] path{stroke:var(--anatomy-mid)}
.iso-swatch[data-mark="lit"] path{stroke:var(--anatomy-lit)}
.iso-swatch[data-mark="dim"] path{stroke:var(--anatomy-lo)}
.iso-swatch[data-mark="dotted"] path{stroke-dasharray:.01 3;stroke-width:1.4}
.iso-swatch[data-mark="dashed"] path{stroke-dasharray:3 2.5}
.iso-swatch[data-mark="red"] path{stroke:var(--anatomy-red)}
.iso-swatch[data-mark="green"] path{stroke:var(--anatomy-green)}
.iso-swatch[data-mark="blue"] path{stroke:var(--anatomy-blue)}
.iso-swatch-crease{stroke:var(--anatomy-lo)!important}
@media (max-width:560px){.iso-plate{padding:48px 12px 70px}.iso-plate-corner[data-corner="hint"]{bottom:18px}}
@media (prefers-reduced-motion:reduce){.iso-line[data-flow],.iso-dots circle[data-pulse]{animation:none}}
`;
const G = (() => {

const TAU = Math.PI * 2;
const LIGHT_UP = 1.2;
const BANDS = [0, 0.2, 0.42, 0.62];

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a) => {
  const length = len3(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function viewOf(P) {
  const { sinA, cosA, sinE, cosE } = cameraOf(P);
  return [cosA * cosE, sinA * cosE, sinE];
}

function lightOf(P) {
  const { sinA, cosA } = cameraOf(P);
  return unit3([-sinA, cosA, LIGHT_UP]);
}

const scaleOf = (P) => cameraOf(P).k;

function bandOf(score) {
  let tone = 0;
  while (tone < BANDS.length && score >= BANDS[tone]) tone++;
  return tone;
}

const toneOf = (normal, P) => bandOf(dot3(unit3(normal), lightOf(P)));

function frameAlong(o, a) {
  const axis = unit3(a);
  const helper = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit3(cross3(helper, axis));
  const v = cross3(axis, u);
  return { o, a: axis, u, v };
}

const frameOf = (o, a, u, v) => ({ o, a, u, v });

function pointOf(F, s, r, angle) {
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [
    F.o[0] + F.a[0] * s + r * (c * F.u[0] + n * F.v[0]),
    F.o[1] + F.a[1] * s + r * (c * F.u[1] + n * F.v[1]),
    F.o[2] + F.a[2] * s + r * (c * F.u[2] + n * F.v[2]),
  ];
}

const radialOf = (F, angle) => {
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [c * F.u[0] + n * F.v[0], c * F.u[1] + n * F.v[1], c * F.u[2] + n * F.v[2]];
};

const tangentOf = (F, angle) => {
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [-n * F.u[0] + c * F.v[0], -n * F.u[1] + c * F.v[1], -n * F.u[2] + c * F.v[2]];
};

const angleToward = (F, direction) => Math.atan2(dot3(direction, F.v), dot3(direction, F.u));

function hullTagged(points) {
  const sorted = [...points].sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a.p[0] - o.p[0]) * (b.p[1] - o.p[1]) - (a.p[1] - o.p[1]) * (b.p[0] - o.p[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-9) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index--) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-9) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const hullOf = (points) => hullTagged(points.map((p) => ({ p }))).map(({ p }) => p);

function runsOf(flags) {
  const count = flags.length;
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return flags[0] ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];
  const runs = [];
  let run = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index]) {
      if (!run) run = [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

function groupsOf(keys) {
  const count = keys.length;
  const out = [];
  const start = keys.findIndex((key, index) => key !== keys[(index + count - 1) % count]);
  if (start < 0) {
    if (keys[0] !== null) out.push({ key: keys[0], run: Array.from({ length: count + 1 }, (_, index) => index % count) });
    return out;
  }
  let current = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    const key = keys[index];
    if (current && current.key === key) {
      current.run.push((index + 1) % count);
      continue;
    }
    if (current && current.key !== null) out.push(current);
    current = { key, run: [index, (index + 1) % count] };
  }
  if (current && current.key !== null) out.push(current);
  return out;
}

const stepsFor = (radius, least = 16, most = 112, scale = 0) => Math.max(least, Math.min(most, scale ? Math.ceil((TAU * radius * scale) / 3) : Math.round((radius * 1.3) / 4) * 4));

function chains(edges) {
  const out = [];
  let current = null;
  for (const [a, b, keep] of edges) {
    if (!keep) {
      if (current) out.push(current);
      current = null;
      continue;
    }
    if (!current) current = [a];
    current.push(b);
  }
  if (current) out.push(current);
  if (out.length > 1 && edges[0][2] && edges[edges.length - 1][2]) {
    const last = out.pop();
    out[0] = [...last, ...out[0].slice(1)];
  }
  return out;
}

function labelledArcs(nr, na, view, light, gr = nr, ga = na) {
  const cuts = [];
  if (Math.abs(gr) > 1e-9) {
    const visibleCut = -(ga * view.a) / (gr * view.flat);
    if (visibleCut > -1 && visibleCut < 1) {
      const d = Math.acos(visibleCut);
      cuts.push(view.phi - d, view.phi + d);
    }
  }
  if (Math.abs(nr) > 1e-9) {
    for (const threshold of BANDS) {
      const c = (threshold - na * light.a) / (nr * light.flat);
      if (c > -1 && c < 1) {
        const d = Math.acos(c);
        cuts.push(light.phi - d, light.phi + d);
      }
    }
  }
  const wrap = (angle) => ((angle % TAU) + TAU) % TAU;
  const sorted = [...new Set(cuts.map((angle) => Math.round(wrap(angle) * 1e9) / 1e9))].sort((a, b) => a - b);
  const label = (angle) => {
    const facing = gr * view.flat * Math.cos(angle - view.phi) + ga * view.a;
    if (facing <= 1e-9) return -1;
    return bandOf(nr * light.flat * Math.cos(angle - light.phi) + na * light.a);
  };
  if (!sorted.length) {
    const tone = label(0);
    return tone < 0 ? [] : [{ tone, from: 0, to: TAU, full: true }];
  }
  const arcs = sorted.map((from, index) => {
    const to = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + TAU;
    return { tone: label((from + to) / 2), from, to };
  });
  const merged = [];
  for (const arc of arcs) {
    const last = merged[merged.length - 1];
    if (last && last.tone === arc.tone && Math.abs(last.to - arc.from) < 1e-9) last.to = arc.to;
    else merged.push({ ...arc });
  }
  if (merged.length > 1 && merged[0].tone === merged[merged.length - 1].tone && Math.abs(merged[merged.length - 1].to - TAU - merged[0].from) < 1e-9) {
    const last = merged.pop();
    merged[0].from = last.from - TAU;
  }
  return merged.filter((arc) => arc.tone >= 0);
}

function hermiteSlopes(run) {
  const n = run.length - 1;
  const h = Array.from({ length: n }, (_, j) => run[j + 1][0] - run[j][0]);
  const delta = h.map((value, j) => (run[j + 1][1] - run[j][1]) / value);
  const d = new Array(n + 1).fill(0);
  const end = (h0, h1, d0, d1) => {
    let value = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(value) !== Math.sign(d0)) value = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(value) > Math.abs(3 * d0)) value = 3 * d0;
    return value;
  };
  if (n === 1) d[0] = d[1] = delta[0];
  else {
    d[0] = end(h[0], h[1], delta[0], delta[1]);
    d[n] = end(h[n - 1], h[n - 2], delta[n - 1], delta[n - 2]);
  }
  for (let k = 1; k < n; k++) {
    if (delta[k - 1] * delta[k] <= 0) continue;
    const w1 = 2 * h[k] + h[k - 1];
    const w2 = h[k] + 2 * h[k - 1];
    d[k] = (w1 + w2) / (w1 / delta[k - 1] + w2 / delta[k]);
  }
  return d;
}

function curveRuns(meridian) {
  const m = meridian.length;
  const segments = new Array(m - 1).fill(null);
  let start = 0;
  while (start < m - 1) {
    let end = start + 1;
    while (end < m - 1 && meridian[end][2] && Math.abs(meridian[end + 1][0] - meridian[end][0]) > 1e-9 && Math.abs(meridian[end][0] - meridian[end - 1][0]) > 1e-9) end++;
    const run = meridian.slice(start, end + 1);
    const n = run.length - 1;
    if (n >= 2 && run.every((point, j) => j === 0 || Math.abs(point[0] - run[j - 1][0]) > 1e-9)) {
      const d = hermiteSlopes(run);
      for (let j = 0; j < n; j++) {
        const [s0, r0] = run[j];
        const [s1, r1] = run[j + 1];
        const hj = s1 - s0;
        const d0 = d[j];
        const d1 = d[j + 1];
        const radius = (s) => {
          const t = (s - s0) / hj;
          return (2 * t ** 3 - 3 * t ** 2 + 1) * r0 + (t ** 3 - 2 * t ** 2 + t) * hj * d0 + (-2 * t ** 3 + 3 * t ** 2) * r1 + (t ** 3 - t ** 2) * hj * d1;
        };
        const slope = (s) => {
          const t = (s - s0) / hj;
          return ((6 * t ** 2 - 6 * t) * r0 + (6 * t - 6 * t ** 2) * r1) / hj + (3 * t ** 2 - 4 * t + 1) * d0 + (3 * t ** 2 - 2 * t) * d1;
        };
        segments[start + j] = { radius, slope };
      }
    }
    start = end;
  }
  return segments;
}

function curved(meridian, P, segments, { error = 0.2, depth = 6 } = {}) {
  const k = scaleOf(P);
  const out = [meridian[0]];
  for (let i = 0; i < meridian.length - 1; i++) {
    const curve = segments[i];
    const [s0] = meridian[i];
    const [s1] = meridian[i + 1];
    if (curve) {
      const split = (a, b, level) => {
        const mid = (a + b) / 2;
        const chord = (curve.radius(a) + curve.radius(b)) / 2;
        if (level < depth && Math.abs(curve.radius(mid) - chord) * k > error) {
          split(a, mid, level + 1);
          out.push([mid, curve.radius(mid), 1]);
          split(mid, b, level + 1);
        }
      };
      split(s0, s1, 0);
    }
    out.push(meridian[i + 1]);
  }
  return out;
}

function smoothRows(meridian, F, P, { rows = 6, slope = null, radius = null, steps = 48, error = 0.35, depth: deepest = 8, fineness = 0.1 } = {}) {
  const V = viewOf(P);
  const L = lightOf(P);
  const view = { a: dot3(F.a, V), flat: Math.hypot(dot3(F.u, V), dot3(F.v, V)), phi: Math.atan2(dot3(F.v, V), dot3(F.u, V)) };
  const light = { a: dot3(F.a, L), flat: Math.hypot(dot3(F.u, L), dot3(F.v, L)), phi: Math.atan2(dot3(F.v, L), dot3(F.u, L)) };
  const m = meridian.length;
  const faces = [];
  for (let i = 0; i < m - 1; i++) {
    const ds = meridian[i + 1][0] - meridian[i][0];
    const dr = meridian[i + 1][1] - meridian[i][1];
    const length = Math.hypot(ds, dr) || 1;
    faces.push([ds / length, -dr / length]);
  }
  const splines = slope ? null : curveRuns(meridian);
  const vertexNormal = (k, own) => {
    if (k <= 0 || k >= m - 1 || !meridian[k][2]) return own;
    const a = faces[k - 1];
    const b = faces[k];
    const x = a[0] + b[0];
    const y = a[1] + b[1];
    const length = Math.hypot(x, y) || 1;
    return [x / length, y / length];
  };
  const normalAt = (i, u) => {
    const [s0] = meridian[i];
    const [s1] = meridian[i + 1];
    const s = s0 + (s1 - s0) * u;
    const sign = Math.sign(s1 - s0) || 1;
    const g = slope ? slope(s) : splines[i] ? splines[i].slope(s) : null;
    if (g !== null) {
      const length = Math.hypot(1, g);
      return [sign / length, (-sign * g) / length];
    }
    const a = vertexNormal(i, faces[i]);
    const b = vertexNormal(i + 1, faces[i]);
    const x = a[0] + (b[0] - a[0]) * u;
    const y = a[1] + (b[1] - a[1]) * u;
    const length = Math.hypot(x, y) || 1;
    return [x / length, y / length];
  };
  const pointAt = (i, u, angle) => {
    const [s0, r0] = meridian[i];
    const [s1, r1] = meridian[i + 1];
    const s = s0 + (s1 - s0) * u;
    return iso(pointOf(F, s, radius ? radius(s) : splines && splines[i] ? splines[i].radius(s) : r0 + (r1 - r0) * u, angle), P);
  };
  const buckets = [[], [], [], [], []];
  const fine = TAU / Math.max(24, Math.min(192, steps * 1.5));
  const arcPoints = (i, u, from, to) => {
    const count = Math.max(1, Math.ceil((to - from) / fine));
    return Array.from({ length: count + 1 }, (_, index) => pointAt(i, u, from + ((to - from) * index) / count));
  };
  const centreOf = (arc, reference) => {
    let mid = (arc.from + arc.to) / 2 - reference;
    mid = ((mid % TAU) + TAU) % TAU;
    return mid;
  };
  const levelOf = (i, u) => {
    const [nr, na] = normalAt(i, u);
    const groups = new Map();
    for (const arc of labelledArcs(nr, na, view, light, faces[i][0], faces[i][1])) {
      if (!groups.has(arc.tone)) groups.set(arc.tone, []);
      groups.get(arc.tone).push(arc);
    }
    for (const list of groups.values()) list.sort((x, y) => centreOf(x, light.phi) - centreOf(y, light.phi));
    return { i, u, groups };
  };
  const same = (x, y) => {
    if (x.groups.size !== y.groups.size) return false;
    for (const [tone, list] of x.groups) if ((y.groups.get(tone) ?? []).length !== list.length) return false;
    return true;
  };
  const align = (reference, arc) => {
    const out = { ...arc };
    const centre = (reference.from + reference.to) / 2;
    while ((out.from + out.to) / 2 - centre > Math.PI) {
      out.from -= TAU;
      out.to -= TAU;
    }
    while (centre - (out.from + out.to) / 2 > Math.PI) {
      out.from += TAU;
      out.to += TAU;
    }
    return out;
  };
  const strayOf = (i, a, mid, b) => {
    let worst = 0;
    for (const [tone, list] of mid.groups) {
      list.forEach((arc, index) => {
        const lo = align(arc, a.groups.get(tone)[index]);
        const hi = align(arc, b.groups.get(tone)[index]);
        for (const key of ["from", "to"]) {
          const p = pointAt(i, mid.u, arc[key]);
          const p0 = pointAt(i, a.u, lo[key]);
          const p1 = pointAt(i, b.u, hi[key]);
          worst = Math.max(worst, Math.hypot(p[0] - (p0[0] + p1[0]) / 2, p[1] - (p0[1] + p1[1]) / 2));
        }
      });
    }
    return worst;
  };
  const sheet = (tone, levels) => {
    levels[0].groups.get(tone).forEach((arc, index) => {
      const chain = [arc];
      for (let k = 1; k < levels.length; k++) chain.push(align(chain[k - 1], levels[k].groups.get(tone)[index]));
      const last = levels.length - 1;
      const points = [...arcPoints(levels[0].i, levels[0].u, chain[0].from, chain[0].to)];
      for (let k = 1; k < last; k++) points.push(pointAt(levels[k].i, levels[k].u, chain[k].to));
      points.push(...arcPoints(levels[last].i, levels[last].u, chain[last].from, chain[last].to).reverse());
      for (let k = last - 1; k >= 1; k--) points.push(pointAt(levels[k].i, levels[k].u, chain[k].from));
      buckets[tone].push(pathOf(oriented(points), true));
    });
  };
  const overlap = (x, y) => Math.min(x.to, y.to) - Math.max(x.from, y.from);
  const strip = (tone, a, b) => {
    const below = a.groups.get(tone) ?? [];
    const above = (b.groups.get(tone) ?? []).map((arc) => ({ arc, used: false }));
    const quad = (lo, hi) => {
      const points = [...arcPoints(a.i, a.u, lo.from, lo.to), ...arcPoints(b.i, b.u, hi.from, hi.to).reverse()];
      buckets[tone].push(pathOf(oriented(points), true));
    };
    for (const arc of below) {
      let best = null;
      let score = -Infinity;
      for (const entry of above) {
        if (entry.used) continue;
        const aligned = align(arc, entry.arc);
        const value = overlap(arc, aligned);
        if (value > score) (score = value), (best = entry);
      }
      if (best && score > -0.05) {
        best.used = true;
        quad(arc, align(arc, best.arc));
      } else {
        const centre = (arc.from + arc.to) / 2;
        quad(arc, { from: centre, to: centre });
      }
    }
    for (const entry of above) {
      if (entry.used) continue;
      const centre = (entry.arc.from + entry.arc.to) / 2;
      quad({ from: centre, to: centre }, entry.arc);
    }
  };
  const k = scaleOf(P);
  let run = [];
  const flush = () => {
    const tones = [...new Set(run.flatMap((level) => [...level.groups.keys()]))].sort((x, y) => x - y);
    for (const tone of tones) {
      const countOf = (level) => (level.groups.get(tone) ?? []).length;
      let start = 0;
      for (let at = 1; at <= run.length; at++) {
        if (at < run.length && countOf(run[at - 1]) === countOf(run[at])) continue;
        if (at - 1 > start && countOf(run[start])) sheet(tone, run.slice(start, at));
        if (at < run.length) strip(tone, run[at - 1], run[at]);
        start = at;
      }
    }
    run = [];
  };
  for (let i = 0; i < m - 1; i++) {
    const ds = meridian[i + 1][0] - meridian[i][0];
    if (Math.abs(ds) < 1e-9) {
      flush();
      continue;
    }
    const count = Math.max(1, rows);
    const reach = (Math.hypot(ds, meridian[i + 1][1] - meridian[i][1]) * k) / count;
    const limit = Math.max(1, Math.min(deepest, Math.ceil(Math.log2(Math.max(2, reach / fineness)))));
    const coarse = Array.from({ length: count + 1 }, (_, index) => levelOf(i, index / count));
    run.push(coarse[0]);
    const refine = (a, b, depth) => {
      const mid = levelOf(i, (a.u + b.u) / 2);
      const split = depth < limit && (!same(a, b) || !same(a, mid) || (depth < 6 && strayOf(i, a, mid, b) > error));
      if (!split) {
        run.push(b);
        return;
      }
      refine(a, mid, depth + 1);
      refine(mid, b, depth + 1);
    };
    for (let index = 1; index <= count; index++) refine(coarse[index - 1], coarse[index], 0);
  }
  flush();
  return buckets;
}

function sideOf(meridian) {
  const m = meridian.length;
  let first = 0;
  let last = m - 1;
  if (meridian[0][1] <= 1e-9) first = 1;
  if (meridian[m - 1][1] <= 1e-9) last = m - 2;
  const side = meridian.slice(first, last + 1);
  for (let index = 1; index < side.length; index++) if (side[index][0] - side[index - 1][0] <= 1e-9) return null;
  return side.length >= 3 ? side : null;
}

function surfaceOf(side, F, P, rims, { samples = 96, slope = null } = {}) {
  const V = viewOf(P);
  const aV = dot3(F.a, V);
  const facing = Math.atan2(dot3(F.v, V), dot3(F.u, V));
  const [left, right] = silhouettePoints(side, F, P, { samples, slope });
  if (left.length <= samples || right.length <= samples) return null;
  const s0 = side[0][0];
  const s1 = side[side.length - 1][0];
  const angleOf = (point) => angleToward(F, sub3(point, add3(F.o, mul3(F.a, dot3(sub3(point, F.o), F.a)))));
  const wrap = (angle) => ((angle % TAU) + TAU) % TAU;
  const arc = (s, r, from, to, through) => {
    let sweep = wrap(to - from);
    if (wrap(through - from) > sweep) sweep -= TAU;
    const count = Math.max(4, Math.ceil(Math.abs(sweep) / (TAU / 96)), Math.ceil((Math.abs(sweep) * r * scaleOf(P)) / 1.5));
    return Array.from({ length: count + 1 }, (_, index) => iso(pointOf(F, s, r, from + (sweep * index) / count), P));
  };
  const r0 = side[0][1];
  const r1 = side[side.length - 1][1];
  const bottom = -aV > 0 ? facing + Math.PI : facing;
  const top = aV > 0 ? facing + Math.PI : facing;
  const L = left.map((point) => iso(point, P));
  const R = right.map((point) => iso(point, P));
  const topArc = arc(s1, r1, angleOf(left[left.length - 1]), angleOf(right[right.length - 1]), top);
  const bottomArc = arc(s0, r0, angleOf(right[0]), angleOf(left[0]), bottom);
  const keepFirst = rims === "all" || rims === "first" || rims === "ends";
  const keepLast = rims === "all" || rims === "last" || rims === "ends";
  const fill = pathOf([...L, ...topArc, ...[...R].reverse(), ...bottomArc], true);
  const outline = [pathOf(L), pathOf(R), keepLast ? pathOf(topArc) : "", keepFirst ? pathOf(bottomArc) : ""].join("");
  const hull = hullOf([...arc(s0, r0, 0, TAU - 1e-6, Math.PI), ...arc(s1, r1, 0, TAU - 1e-6, Math.PI), ...L, ...R]);
  let gap = 0;
  for (const p of [...L, ...R]) {
    let best = Infinity;
    for (let index = 0; index < hull.length; index++) {
      const a = hull[index];
      const b = hull[(index + 1) % hull.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
    }
    gap = Math.max(gap, best);
  }
  return { fill, outline, gap };
}

const softOf = (meridian) => meridian.some((point) => Boolean(point[2]));

function lathe(meridian, F, P, { steps = stepsFor(Math.max(...meridian.map(([, r]) => r)), 32, 160, scaleOf(P)), fill = "auto", hole = null, bevel = 0, rims = "all", smooth: asked = "auto", waist = 0.5 } = {}) {
  const smooth = asked === "auto" ? softOf(meridian) : asked;
  const V = viewOf(P);
  const L = lightOf(P);
  const aV = dot3(F.a, V);
  const uV = dot3(F.u, V);
  const vV = dot3(F.v, V);
  const aL = dot3(F.a, L);
  const uL = dot3(F.u, L);
  const vL = dot3(F.v, L);
  const n = steps;
  const m = meridian.length;
  const rings = meridian.map(([s, r]) => Array.from({ length: n }, (_, j) => iso(pointOf(F, s, r, (j / n) * TAU), P)));
  const midC = [];
  const midS = [];
  for (let j = 0; j < n; j++) {
    const t = ((j + 0.5) / n) * TAU;
    midC.push(Math.cos(t));
    midS.push(Math.sin(t));
  }
  const seen = [];
  const tones = [];
  for (let i = 0; i < m - 1; i++) {
    const ds = meridian[i + 1][0] - meridian[i][0];
    const dr = meridian[i + 1][1] - meridian[i][1];
    const length = Math.hypot(ds, dr);
    const row = [];
    const toneRow = [];
    for (let j = 0; j < n; j++) {
      if (length < 1e-9) {
        row.push(false);
        toneRow.push(0);
        continue;
      }
      const facing = ds * (midC[j] * uV + midS[j] * vV) - dr * aV;
      const lit = (ds * (midC[j] * uL + midS[j] * vL) - dr * aL) / length;
      row.push(facing > 1e-6 * length);
      toneRow.push(bandOf(lit));
    }
    seen.push(row);
    tones.push(toneRow);
  }
  const buckets = [[], [], [], [], []];
  const all = [];
  const smoothed = smooth ? smoothRows(meridian, F, P, { steps, ...(smooth === true ? {} : smooth) }) : null;
  if (smoothed) smoothed.forEach((list, tone) => list.forEach((d) => (buckets[tone].push(d), all.push(d))));
  for (let i = 0; i < m - 1; i++) {
    if (smoothed && Math.abs(meridian[i + 1][0] - meridian[i][0]) > 1e-9) continue;
    const keys = seen[i].map((visible, j) => (visible ? tones[i][j] : null));
    for (const { key, run } of groupsOf(keys)) {
      const a = run.map((j) => rings[i][j]);
      const b = run.map((j) => rings[i + 1][j]).reverse();
      const d = pathOf(oriented([...a, ...b]), true);
      buckets[key].push(d);
      all.push(d);
    }
  }
  const phi = Math.atan2(vV, uV);
  const flatV = Math.hypot(uV, vV);
  const rangeOf = (i) => {
    const ds = meridian[i + 1][0] - meridian[i][0];
    const dr = meridian[i + 1][1] - meridian[i][1];
    if (Math.hypot(ds, dr) < 1e-9) return null;
    if (Math.abs(ds) < 1e-9 || flatV < 1e-9) return -dr * aV > 1e-9 ? [-1, 1] : null;
    const c = (dr * aV) / (ds * flatV);
    return ds > 0 ? [Math.max(-1, c), 1] : [-1, Math.min(1, c)];
  };
  const arcsOf = (ranges) => {
    if (ranges.some((range) => !range)) return [];
    const lo = Math.max(...ranges.map(([x]) => x));
    const hi = Math.min(...ranges.map(([, x]) => x));
    if (lo >= hi - 1e-9) return [];
    const near = Math.acos(Math.min(1, hi));
    const far = Math.acos(Math.max(-1, lo));
    if (hi >= 1 && lo <= -1) return [[phi, phi + TAU]];
    if (hi >= 1) return [[phi - far, phi + far]];
    if (lo <= -1) return [[phi + near, phi + TAU - near]];
    return [[phi + near, phi + far], [phi - far, phi - near]];
  };
  const along = (s, r, [from, to]) => {
    const count = Math.max(2, Math.ceil(((to - from) * Math.max(r, 1e-6) * scaleOf(P)) / 1.5));
    return Array.from({ length: count + 1 }, (_, j) => iso(pointOf(F, s, r, from + ((to - from) * j) / count), P));
  };
  const creases = [];
  for (let i = 1; i < m - 1; i++) {
    if (meridian[i][2] || meridian[i][1] <= 1e-9) continue;
    for (const arc of arcsOf([rangeOf(i - 1), rangeOf(i)])) creases.push(pathOf(along(meridian[i][0], meridian[i][1], arc)));
  }
  let bevelPath = "";
  if (bevel > 0 && m > 2) {
    const ends = [];
    if (meridian[0][1] <= 1e-9) ends.push([0, 1, 1]);
    if (meridian[m - 1][1] <= 1e-9) ends.push([m - 2, m - 2, m - 3]);
    for (const [cap, rim, side] of ends) {
      const [s, r] = meridian[rim];
      for (const arc of arcsOf([rangeOf(cap), rangeOf(side)])) {
        const inset = along(s, Math.max(0, r - bevel), arc);
        const edge = along(s, r, arc);
        bevelPath += pathOf([edge[0], ...inset.slice(1, -1), edge[edge.length - 1]]);
      }
    }
  }
  const { fill: fillPath, outline } = outlineOf(meridian, F, P, { steps: n, fill, hole, rims, smooth, waist, all });
  return {
    fill: fillPath,
    outline,
    crease: creases.join(""),
    top: buckets[4].join(""),
    shades: buckets.slice(0, 4).map((list) => list.join("")),
    bevel: bevelPath || undefined,
    seamless: Boolean(smoothed),
  };
}

function shapeOf(meridian, P, smooth) {
  if (smooth && smooth.radius) {
    const segments = meridian.slice(0, -1).map(([s0], index) => (Math.abs(meridian[index + 1][0] - s0) > 1e-9 ? { radius: smooth.radius, slope: smooth.slope } : null));
    return curved(meridian, P, segments);
  }
  const curves = smooth && !smooth.slope ? curveRuns(meridian) : null;
  return curves && curves.some(Boolean) ? curved(meridian, P, curves) : meridian;
}

function outlineOf(meridian, F, P, { steps = stepsFor(Math.max(...meridian.map(([, r]) => r)), 32, 160, scaleOf(P)), fill = "auto", hole = null, rims = "all", smooth: asked = "auto", waist = 0.5, all = null } = {}) {
  const smooth = asked === "auto" ? softOf(meridian) : asked;
  const n = steps;
  let fillPath;
  let outline;
  const shape = shapeOf(meridian, P, smooth);
  const side = fill === "auto" || fill === "surface" ? sideOf(shape) : null;
  const surface = side && !hole ? surfaceOf(side, F, P, rims, { slope: smooth && smooth.slope ? smooth.slope : null }) : null;
  if (surface && (fill === "surface" || surface.gap > waist)) {
    fillPath = surface.fill;
    outline = surface.outline;
  } else if (fill === "hull" || fill === "auto" || fill === "surface") {
    const most = Math.max(...shape.map(([, r]) => r));
    const around = Math.min(320, Math.max(n, Math.ceil((TAU * most * scaleOf(P)) / 1.5)));
    const tagged = [];
    shape.forEach(([s, r], index) => {
      for (let j = 0; j < around; j++) tagged.push({ p: iso(pointOf(F, s, r, (j / around) * TAU), P), ring: index });
    });
    const hull = hullTagged(tagged);
    const holePath = hole ? pathOf(Array.from({ length: around }, (_, j) => iso(pointOf(F, hole[0], hole[1], (j / around) * TAU), P)), true) : "";
    fillPath = pathOf(hull.map(({ p }) => p), true) + holePath;
    if (rims === "all") {
      outline = pathOf(hull.map(({ p }) => p), true) + holePath;
    } else {
      const keepFirst = rims === "first" || rims === "ends";
      const keepLast = rims === "last" || rims === "ends";
      const edges = hull.map((a, index) => {
        const b = hull[(index + 1) % hull.length];
        const same = a.ring === b.ring;
        const keep = !same || (a.ring !== 0 && a.ring !== shape.length - 1) || (keepFirst && a.ring === 0) || (keepLast && a.ring === shape.length - 1);
        return [a.p, b.p, keep];
      });
      outline = chains(edges).map((points) => pathOf(points)).join("") + holePath;
    }
  } else {
    fillPath = all ? all.join("") : (({ shades, top }) => [...shades, top].join(""))(lathe(meridian, F, P, { steps: n, fill: "auto", hole, rims, smooth, waist }));
    outline = "";
  }
  return { fill: fillPath, outline };
}

const signedArea = (points) => points.reduce((sum, [x, y], index) => {
  const [nx, ny] = points[(index + 1) % points.length];
  return sum + x * ny - nx * y;
}, 0);

const oriented = (points) => (signedArea(points) < 0 ? [...points].reverse() : points);

const saddleStart = (R, a, angle) => Math.sqrt(Math.max(0, R * R - a * a * Math.cos(angle) ** 2));

function saddleOf(F, a, start, s1, P, { steps = stepsFor(a, 24) } = {}) {
  const V = viewOf(P);
  const L = lightOf(P);
  const n = steps;
  const angle = (j) => (j / n) * TAU;
  const from = typeof start === "function" ? start : (t) => saddleStart(start, a, t);
  const low = Array.from({ length: n }, (_, j) => iso(pointOf(F, from(angle(j)), a, angle(j)), P));
  const high = Array.from({ length: n }, (_, j) => iso(pointOf(F, s1, a, angle(j)), P));
  const seen = [];
  const tones = [];
  for (let j = 0; j < n; j++) {
    const normal = radialOf(F, angle(j + 0.5));
    seen.push(dot3(normal, V) > 1e-6);
    tones.push(bandOf(dot3(normal, L)));
  }
  const buckets = [[], [], [], [], []];
  const fills = [];
  const keys = seen.map((visible, j) => (visible ? tones[j] : null));
  for (const { key, run } of groupsOf(keys)) {
    const d = pathOf(oriented([...run.map((j) => low[j]), ...run.map((j) => high[j]).reverse()]), true);
    buckets[key].push(d);
    fills.push(d);
  }
  const capSeen = dot3(F.a, V) > 1e-6;
  if (capSeen) {
    const d = pathOf(oriented(high), true);
    buckets[bandOf(dot3(F.a, L))].push(d);
    fills.push(d);
  }
  const front = runsOf(seen);
  const back = runsOf(seen.map((visible) => !visible));
  const edges = [];
  for (const run of front) {
    edges.push(pathOf(run.map((j) => low[j])));
    edges.push(pathOf([low[run[0]], high[run[0]]]), pathOf([low[run[run.length - 1]], high[run[run.length - 1]]]));
  }
  for (const run of capSeen ? back : front) edges.push(pathOf(run.map((j) => high[j])));
  return {
    fill: fills.join(""),
    outline: edges.join(""),
    crease: capSeen ? front.map((run) => pathOf(run.map((j) => high[j]))).join("") : "",
    top: buckets[4].join(""),
    shades: buckets.slice(0, 4).map((list) => list.join("")),
    seamless: true,
  };
}

function prismOf(F, polygon, s0, s1, P) {
  const V = viewOf(P);
  const L = lightOf(P);
  const ring = oriented(polygon.map(([x, y]) => [x, y]));
  const n = ring.length;
  const at = (s, [x, y]) => [F.o[0] + F.a[0] * s + F.u[0] * x + F.v[0] * y, F.o[1] + F.a[1] * s + F.u[1] * x + F.v[1] * y, F.o[2] + F.a[2] * s + F.u[2] * x + F.v[2] * y];
  const low = ring.map((point) => iso(at(s0, point), P));
  const high = ring.map((point) => iso(at(s1, point), P));
  const buckets = [[], [], [], [], []];
  const seen = [];
  for (let j = 0; j < n; j++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[(j + 1) % n];
    const normal = unit3(add3(mul3(F.u, y1 - y0), mul3(F.v, -(x1 - x0))));
    const visible = dot3(normal, V) > 1e-6;
    seen.push(visible);
    if (visible) buckets[bandOf(dot3(normal, L))].push(pathOf([low[j], low[(j + 1) % n], high[(j + 1) % n], high[j]], true));
  }
  const ends = [[s0, low, mul3(F.a, -1)], [s1, high, F.a]];
  const capSeen = ends.map(([, , normal]) => dot3(normal, V) > 1e-6);
  ends.forEach(([, points, normal], index) => capSeen[index] && buckets[bandOf(dot3(normal, L))].push(pathOf(points, true)));
  const hull = hullOf([...low, ...high]);
  const creases = [];
  for (let j = 0; j < n; j++) {
    const prev = (j - 1 + n) % n;
    const a = [ring[j][0] - ring[prev][0], ring[j][1] - ring[prev][1]];
    const b = [ring[(j + 1) % n][0] - ring[j][0], ring[(j + 1) % n][1] - ring[j][1]];
    const sharp = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1) < Math.cos(0.35);
    if (sharp && seen[j] && seen[prev]) creases.push(pathOf([low[j], high[j]]));
    ends.forEach(([, points], index) => capSeen[index] && seen[j] && creases.push(pathOf([points[j], points[(j + 1) % n]])));
  }
  return { fill: pathOf(hull, true), outline: pathOf(hull, true), crease: creases.join(""), top: buckets[4].join(""), shades: buckets.slice(0, 4).map((list) => list.join("")) };
}

function stadium(r0, r1, offset, steps = 32) {
  const circle = (cx, r) => Array.from({ length: steps }, (_, index) => [cx + r * Math.cos((index / steps) * TAU), r * Math.sin((index / steps) * TAU)]);
  return hullOf([...circle(0, r0), ...circle(offset, r1)]);
}

function sphereOf(centre, r, P, { steps = 48 } = {}) {
  const V = viewOf(P);
  const L = lightOf(P);
  const F = frameAlong(centre, V);
  const flat = (p) => iso(p, P);
  const rim = Array.from({ length: steps }, (_, index) => pointOf(F, 0, r, (index / steps) * TAU));
  const outline = pathOf(rim.map(flat), true);
  const capOf = (threshold) => {
    const points = rim.filter((p) => dot3(sub3(p, centre), L) / r >= threshold).map(flat);
    const c = dot3(L, V);
    const LF = frameAlong(add3(centre, mul3(L, r * threshold)), L);
    const radius = r * Math.sqrt(Math.max(0, 1 - threshold * threshold));
    for (let index = 0; index < steps; index++) {
      const p = pointOf(LF, 0, radius, (index / steps) * TAU);
      if (dot3(sub3(p, centre), V) >= -1e-9) points.push(flat(p));
    }
    if (c > threshold) points.push(flat(add3(centre, mul3(V, r))));
    return points.length > 2 ? pathOf(hullOf(points), true) : "";
  };
  const shades = [outline, capOf(BANDS[1]), capOf(BANDS[2]), capOf(BANDS[3])];
  return { fill: outline, outline, crease: "", top: "", shades, seamless: true };
}

const disc = (s0, s1, r, F, P, options = {}) =>
  lathe(
    [
      [s0, 0],
      [s0, r],
      [s1, r],
      [s1, 0],
    ],
    F,
    P,
    { steps: stepsFor(r, 32, 160, scaleOf(P)), ...options },
  );

const ringBand = (s0, s1, rIn, rOut, F, P, options = {}) =>
  lathe(
    [
      [s0, rIn],
      [s0, rOut],
      [s1, rOut],
      [s1, rIn],
    ],
    F,
    P,
    { steps: stepsFor(rOut, 32, 160, scaleOf(P)), hole: null, ...options },
  );

function solidOf(profile, F, P, options = {}) {
  const first = profile[0];
  const last = profile[profile.length - 1];
  const meridian = [[first[0], 0], ...profile, [last[0], 0]];
  const most = Math.max(...profile.map(([, r]) => r));
  return lathe(meridian, F, P, { steps: stepsFor(most, 32, 160, scaleOf(P)), ...options });
}

function bandOfProfile(profile, F, P, options = {}) {
  const most = Math.max(...profile.map(([, r]) => r));
  return lathe(profile, F, P, { steps: stepsFor(most, 32, 160, scaleOf(P)), ...options });
}

function silhouettePoints(profile, F, P, { samples = 72, slope: given = null, radius = null } = {}) {
  const V = viewOf(P);
  const aV = dot3(F.a, V);
  const uV = dot3(F.u, V);
  const vV = dot3(F.v, V);
  const facing = Math.atan2(vV, uV);
  const flat = Math.hypot(uV, vV) || 1e-9;
  const s0 = profile[0][0];
  const s1 = profile[profile.length - 1][0];
  const radiusAt = radius ?? ((s) => {
    let index = 1;
    while (index < profile.length - 1 && profile[index][0] < s) index++;
    const [sa, ra] = profile[index - 1];
    const [sb, rb] = profile[index];
    return ra + ((rb - ra) * (s - sa)) / (sb - sa || 1);
  });
  const side = (sign) => {
    const points = [];
    for (let step = 0; step <= samples; step++) {
      const s = s0 + ((s1 - s0) * step) / samples;
      const h = (s1 - s0) / samples / 2 || 0.01;
      const slope = given ? given(s) : (radiusAt(Math.min(s1, s + h)) - radiusAt(Math.max(s0, s - h))) / (Math.min(s1, s + h) - Math.max(s0, s - h) || 1);
      const c = (slope * aV) / flat;
      if (Math.abs(c) > 1) continue;
      points.push(pointOf(F, s, radiusAt(s), facing + sign * Math.acos(c)));
    }
    return points;
  };
  return [side(1), side(-1)];
}

const silhouetteOf = (profile, F, P, options = {}) =>
  silhouettePoints(profile, F, P, options)
    .map((points) => pathOf(points.map((point) => iso(point, P))))
    .join("");

function profileCurve(profile, { slope = null, radius = null } = {}) {
  for (let index = 1; index < profile.length; index++) if (profile[index][0] - profile[index - 1][0] <= 1e-9) throw new Error(`profileCurve: s must rise along the profile (point ${index} at s = ${profile[index][0]})`);
  const segments = curveRuns(profile);
  const s0 = profile[0][0];
  const s1 = profile[profile.length - 1][0];
  const find = (s) => {
    let lo = 0;
    let hi = profile.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (profile[mid][0] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const linear = (index, s) => {
    const [sa, ra] = profile[index];
    const [sb, rb] = profile[index + 1];
    return [ra + ((rb - ra) * (s - sa)) / (sb - sa), (rb - ra) / (sb - sa)];
  };
  const radiusAt = radius ?? ((s) => {
    const at = Math.max(s0, Math.min(s1, s));
    const index = find(at);
    return segments[index] ? segments[index].radius(at) : linear(index, at)[0];
  });
  const slopeAt = slope ?? ((s) => {
    const at = Math.max(s0, Math.min(s1, s));
    const index = find(at);
    return segments[index] ? segments[index].slope(at) : linear(index, at)[1];
  });
  return { s0, s1, radius: radiusAt, slope: slopeAt, analytic: Boolean(slope && radius) };
}

function bandsOf(profile, cuts, F, P, { slope = null, radius = null, steps, rows = 6, rims = "none", fill = "auto", samples = 72 } = {}) {
  const curve = profileCurve(profile, { slope, radius });
  const { s0, s1 } = curve;
  const stops = [s0, ...[...new Set(cuts)].filter((s) => s > s0 + 1e-6 && s < s1 - 1e-6).sort((a, b) => a - b), s1];
  const most = Math.max(...profile.map(([, r]) => r), ...stops.map((s) => curve.radius(s)));
  const n = steps ?? stepsFor(most, 32, 160, scaleOf(P));
  const knot = (s, soft) => (soft ? [s, curve.radius(s), 1] : [s, curve.radius(s)]);
  const meridianOf = (a, b) => [knot(a), ...profile.filter(([s]) => s > a + 1e-9 && s < b - 1e-9).map(([s, , soft]) => knot(s, soft)), knot(b)];
  const shading = { slope: curve.slope, radius: curve.radius, rows };
  const bands = stops.slice(0, -1).map((a, index) => {
    const b = stops[index + 1];
    const meridian = meridianOf(a, b);
    const paths = lathe(meridian, F, P, { steps: n, rims, fill, smooth: shading });
    const seam = index < stops.length - 2 ? arcOf(F, b, curve.radius(b), P, { slope: curve.slope(b) }) : "";
    return { s0: a, s1: b, profile: meridian, paths: { ...paths, outline: "" }, outline: paths.outline, seam };
  });
  const sidesOf = (from = s0, to = s1, { ends = false, count = samples } = {}) => {
    const span = [Math.max(s0, from), Math.min(s1, to)];
    const dense = Array.from({ length: count + 1 }, (_, index) => knot(span[0] + ((span[1] - span[0]) * index) / count, true));
    const points = silhouettePoints(dense, F, P, { samples: count, slope: curve.slope, radius: curve.radius });
    const rim = (s) => arcOf(F, s, curve.radius(s), P, { slope: curve.slope(s) });
    const rimsAt = ends === true ? span : ends === "first" ? [span[0]] : ends === "last" ? [span[1]] : [];
    return { d: points.map((list) => pathOf(list.map((point) => iso(point, P)))).join("") + rimsAt.map(rim).join(""), points };
  };
  return { bands, sidesOf, radius: curve.radius, slope: curve.slope, steps: n, s0, s1 };
}

function arcOf(F, s, r, P, { slope = 0, steps = 0, least = 0.02, inward = false, from = 0, to = TAU, trim = 0.3 } = {}) {
  const V = viewOf(P);
  const aV = dot3(F.a, V);
  const uV = dot3(F.u, V);
  const vV = dot3(F.v, V);
  const flat = Math.hypot(uV, vV);
  const phi = Math.atan2(vV, uV);
  const norm = Math.hypot(1, slope);
  const full = Math.abs(to - from - TAU) < 1e-9;
  let visible;
  if (flat < 1e-9) visible = (inward ? slope * aV / norm > least : -slope * aV / norm > least) ? [[phi, phi + TAU]] : [];
  else if (inward) {
    const c = (slope * aV - least * norm) / flat;
    visible = c <= -1 ? [] : c >= 1 ? [[phi, phi + TAU]] : [[phi + Math.acos(c), phi + TAU - Math.acos(c)]];
  } else {
    const c = (least * norm + slope * aV) / flat;
    visible = c >= 1 ? [] : c <= -1 ? [[phi, phi + TAU]] : [[phi - Math.acos(c), phi + Math.acos(c)]];
  }
  const at = (t) => iso(pointOf(F, s, r, t), P);
  const speed = (t) => {
    const a = at(t - 1e-3);
    const b = at(t + 1e-3);
    return Math.hypot(b[0] - a[0], b[1] - a[1]) / 2e-3;
  };
  const count = (span) => Math.max(2, Math.ceil(((steps || stepsFor(r, 24, 112)) * span) / TAU), Math.ceil((span * r * scaleOf(P)) / 1.5));
  const out = [];
  for (const [a, b] of visible) {
    if (b - a >= TAU - 1e-9 && full) {
      const n = count(TAU);
      out.push(pathOf(Array.from({ length: n }, (_, j) => at(from + (j / n) * TAU)), true));
      continue;
    }
    const pieces = full ? [[a, b, true, true]] : [];
    if (!full)
      for (let turn = -2; turn <= 2; turn++) {
        const lo = Math.max(a + turn * TAU, from);
        const hi = Math.min(b + turn * TAU, to);
        if (hi - lo > 1e-6) pieces.push([lo, hi, lo > from + 1e-9, hi < to - 1e-9]);
      }
    for (const [lo, hi, limb0, limb1] of pieces) {
      const span = hi - lo;
      const cut0 = limb0 && trim > 0 ? Math.min(span * 0.25, trim / (speed(lo) || 1)) : 0;
      const cut1 = limb1 && trim > 0 ? Math.min(span * 0.25, trim / (speed(hi) || 1)) : 0;
      const t0 = lo + cut0;
      const t1 = hi - cut1;
      const n = count(t1 - t0);
      out.push(pathOf(Array.from({ length: n + 1 }, (_, j) => at(t0 + ((t1 - t0) * j) / n))));
    }
  }
  return out.join("");
}

function circleOf(F, s, r, P, steps = 0) {
  const count = steps || stepsFor(r, 24, 112);
  return pathOf(
    Array.from({ length: count }, (_, j) => iso(pointOf(F, s, r, (j / count) * TAU), P)),
    true,
  );
}

function spokesOf(F, s, r0, r1, count, P, { phase = 0, sweep = 0, from = 0, to = TAU } = {}) {
  const lines = [];
  for (let index = 0; index < count; index++) {
    const t = phase + from + (index / count) * (to - from);
    lines.push(pathOf([iso(pointOf(F, s, r0, t), P), iso(pointOf(F, s, r1, t + sweep), P)]));
  }
  return lines.join("");
}

const fadeOf = (value, [lo, hi]) => {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1e-9)));
  return t * t * (3 - 2 * t);
};

function ribsOf(F, s0, s1, r, count, P, { phase = 0, twist = 0, least = 0.12, r1 = r, fade = null, seams = false } = {}) {
  const V = viewOf(P);
  const lines = [];
  const slope = (r1 - r) / (s1 - s0 || 1);
  for (let index = 0; index < count; index++) {
    const t = phase + (index / count) * TAU;
    const radial = radialOf(F, t + twist / 2);
    const normal = unit3([radial[0] - slope * F.a[0], radial[1] - slope * F.a[1], radial[2] - slope * F.a[2]]);
    const facing = dot3(normal, V);
    const d = pathOf([iso(pointOf(F, s0, r, t), P), iso(pointOf(F, s1, r1, t + twist), P)]);
    if (fade) {
      const alpha = fadeOf(facing, fade);
      if (alpha > 0.02) lines.push({ d, alpha });
      continue;
    }
    if (facing < least) continue;
    lines.push(d);
  }
  const ends = seams ? [seams === "last" ? "" : arcOf(F, s0, r, P, { slope }), seams === "first" ? "" : arcOf(F, s1, r1, P, { slope })].filter(Boolean) : [];
  if (fade) return [...lines, ...ends.map((d) => ({ d, alpha: 1 }))];
  return [...lines, ...ends].join("");
}

function rodOut(F, from, to, r, P, { stroke = 0, ...options } = {}) {
  const pad = 0.35 / scaleOf(P);
  const ring = (s) => Array.from({ length: 48 }, (_, index) => iso(pointOf(F, s, r + pad, (index / 48) * TAU), P));
  return {
    paths: disc(from - stroke, to, r, F, P, options),
    clip: pathOf(hullOf([...ring(from), ...ring(to + stroke)]), true),
    from,
    to,
    stroke,
    reach: to + stroke,
  };
}

function dotsOf(F, s, r, count, P, { phase = 0, slope = 0, least = 0.08, all = false, fade = null } = {}) {
  const V = viewOf(P);
  const out = [];
  for (let index = 0; index < count; index++) {
    const t = phase + (index / count) * TAU;
    let alpha = 1;
    if (!all) {
      const radial = radialOf(F, t);
      const normal = unit3([radial[0] - slope * F.a[0], radial[1] - slope * F.a[1], radial[2] - slope * F.a[2]]);
      const facing = dot3(normal, V);
      if (fade) alpha = fadeOf(facing, fade);
      else if (facing < least) continue;
      if (alpha <= 0.02) continue;
    }
    const [x, y] = iso(pointOf(F, s, r, t), P);
    out.push(alpha < 1 ? [x, y, alpha] : [x, y]);
  }
  return out;
}

function facingOf(F, angle, P, slope = 0) {
  const radial = radialOf(F, angle);
  return dot3(unit3([radial[0] - slope * F.a[0], radial[1] - slope * F.a[1], radial[2] - slope * F.a[2]]), viewOf(P));
}

function fillet(points, radius, perArc = 7, { P = null, tube = 0, margin = 1.3 } = {}) {
  if (points.length < 3) return points.map((p) => [...p]);
  const V = P && tube ? viewOf(P) : null;
  const out = [[...points[0]]];
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1];
    const here = points[index];
    const next = points[index + 1];
    const into = unit3(sub3(here, prev));
    const outOf = unit3(sub3(next, here));
    const cosTurn = Math.max(-1, Math.min(1, dot3(into, outOf)));
    const turn = Math.acos(cosTurn);
    if (turn < 1e-3) {
      out.push([...here]);
      continue;
    }
    const room = Math.min(len3(sub3(here, prev)), len3(sub3(next, here))) * 0.48;
    const facing = V ? Math.abs(dot3(unit3(cross3(into, outOf)), V)) : 1;
    const bend = V ? Math.max(radius, (margin * tube) / (0.7 * Math.max(0.05, facing) ** 2)) : radius;
    const cut = Math.min(bend * Math.tan(turn / 2), room);
    const a = sub3(here, mul3(into, cut));
    const b = add3(here, mul3(outOf, cut));
    const count = Math.max(2, Math.ceil((perArc * turn) / (Math.PI / 2)));
    for (let step = 0; step <= count; step++) {
      const t = step / count;
      const p0 = lerp3(a, here, t);
      const p1 = lerp3(here, b, t);
      out.push(lerp3(p0, p1, t));
    }
  }
  out.push([...points[points.length - 1]]);
  return out;
}

function resample(points, spacing) {
  const lengths = [0];
  for (let index = 1; index < points.length; index++) lengths.push(lengths[index - 1] + len3(sub3(points[index], points[index - 1])));
  const total = lengths[lengths.length - 1];
  const count = Math.max(1, Math.round(total / spacing));
  const out = [];
  let segment = 1;
  for (let step = 0; step <= count; step++) {
    const at = (total * step) / count;
    while (segment < points.length - 1 && lengths[segment] < at) segment++;
    const a = points[segment - 1];
    const b = points[segment];
    const span = lengths[segment] - lengths[segment - 1] || 1;
    out.push(lerp3(a, b, Math.min(1, Math.max(0, (at - lengths[segment - 1]) / span))));
  }
  return out;
}

function pathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += len3(sub3(points[index], points[index - 1]));
  return total;
}

function cut(points, from, to) {
  const out = [];
  let walked = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    const length = len3(sub3(b, a));
    const start = walked;
    const end = walked + length;
    if (end >= from && start <= to) {
      const t0 = Math.max(0, (from - start) / (length || 1));
      const t1 = Math.min(1, (to - start) / (length || 1));
      if (!out.length) out.push(lerp3(a, b, t0));
      out.push(lerp3(a, b, t1));
    }
    walked = end;
  }
  return out;
}

const pointAlong = (points, at) => {
  const piece = cut(points, at, at + 0.01);
  return piece[0] ?? points[points.length - 1];
};

function tangentAlong(points, at) {
  const total = pathLength(points);
  const a = pointAlong(points, Math.max(0, at - 0.6));
  const b = pointAlong(points, Math.min(total, at + 0.6));
  return unit3(sub3(b, a));
}

function spiral(F, s, r0, r1, a0, a1, steps = 28) {
  const out = [];
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    out.push(pointOf(F, s, r0 + (r1 - r0) * t, a0 + (a1 - a0) * t));
  }
  return out;
}

function arcPoints(F, s, r, a0, a1, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, index) => pointOf(F, s, r, a0 + ((a1 - a0) * index) / steps));
}

return { viewOf, scaleOf, frameAlong, frameOf, pointOf, disc, ringBand, solidOf, sphereOf, prismOf, circleOf, arcOf, ribsOf, dotsOf, dot3, add3, sub3, mul3, unit3, cross3, len3, lightOf, toneOf, radialOf };})();
// GENOS L250E cycle model. Pure: positions, spindle speed and active block as a function of time.
// World units are mm / 4. Machine X is a diameter in mm, Z is mm from the finished face (Z0).

const U = 0.25;
const GEO = {
  Zc: 132, // spindle centreline height (units)
  face: 18, // world x of Z0 (finished face)
  stockFace: 18.25, // world x of the raw face (Z+1)
  stockR: 7.5, // Ø60 stock
  stockFrom: -9, // inside the jaws
  jawFace: 3,
  Rt: 40, // OD tool tip radius from the turret axis
  Ra: 24, // axial tool radius from the turret axis
  odX: 32.2, // saddle reference x minus OD tool tip x
  axX: 56, // saddle reference x minus axial tool tip x (drill)
  xsMin: 10,
  xsMax: 88,
  ytMin: 24,
  ytMax: 64,
};

// stations: 0..11, 30° apart; T number = station + 1
const TOOLS = {
  1: { st: 0, kind: "od", name: "T01 rough · CNMG 120408", vc: 180, ap: 2.4 },
  3: { st: 2, kind: "od", name: "T03 finish · DNMG 150404", vc: 220 },
  5: { st: 4, kind: "drill", name: "T05 U-drill Ø16", vc: 120, d: 16 },
  7: { st: 6, kind: "groove", name: "T07 groove 3 mm" },
  9: { st: 8, kind: "thread", name: "T09 thread 60°" },
  11: { st: 10, kind: "bore", name: "T11 boring bar Ø20" },
};

const RAPID_X = 25000 / 60; // mm/s on the axis (X travel is radial)
const RAPID_Z = 30000 / 60;
const SMAX = 2500;
const ACCEL = 0.12; // s added per rapid for acceleration

const home = (t) => (TOOLS[t].kind === "drill" ? { X: (GEO.ytMax - GEO.Ra) * 8, Z: (GEO.xsMax - GEO.axX - GEO.face) * 4 } : { X: (GEO.ytMax - GEO.Rt) * 8, Z: (GEO.xsMax - GEO.odX - GEO.face) * 4 });
const r0 = (v) => Math.round(v * 10) / 10;

// The program. Each entry: block text and the motion it causes.
function program() {
  const H1 = home(1);
  const H5 = home(5);
  return [
    { n: "N01", text: "G50 S2500", op: "set", smax: SMAX },
    { n: "N02", text: `G00 X${H1.X} Z${H1.Z} T0101`, op: "rapid", X: H1.X, Z: H1.Z, tool: 1 },
    { n: "N03", text: "G96 S180 M03 M08", op: "spin", vc: 180, coolant: true },
    { n: "N04", text: "G00 X64.0 Z0", op: "rapid", X: 64, Z: 0 },
    { n: "N05", text: "G01 X-1.6 F0.2", op: "feed", X: -1.6, Z: 0, f: 0.2 },
    { n: "N06", text: "G00 Z2.0", op: "rapid", X: -1.6, Z: 2 },
    { n: "N07", text: "G00 X55.2", op: "rapid", X: 55.2, Z: 2 },
    { n: "N08", text: "G01 Z-44.8 F0.3", op: "feed", X: 55.2, Z: -44.8, f: 0.3 },
    { n: "N09", text: "G01 X61.0", op: "feed", X: 61, Z: -44.8, f: 0.3 },
    { n: "N10", text: "G00 Z2.0", op: "rapid", X: 61, Z: 2 },
    { n: "N11", text: "G00 X50.4", op: "rapid", X: 50.4, Z: 2 },
    { n: "N12", text: "G01 Z-44.8 F0.3", op: "feed", X: 50.4, Z: -44.8, f: 0.3 },
    { n: "N13", text: "G01 X56.0", op: "feed", X: 56, Z: -44.8, f: 0.3 },
    { n: "N14", text: `G00 X${H1.X}`, op: "rapid", X: H1.X, Z: -44.8 },
    { n: "N15", text: `G00 Z${H1.Z}`, op: "rapid", X: H1.X, Z: H1.Z },
    { n: "N16", text: "T0303", op: "index", tool: 3 },
    { n: "N17", text: "G96 S220", op: "spin", vc: 220 },
    { n: "N18", text: "G00 X46.0 Z1.0", op: "rapid", X: 46, Z: 1 },
    { n: "N19", text: "G01 X50.0 Z-1.0 F0.12", op: "feed", X: 50, Z: -1, f: 0.12 },
    { n: "N20", text: "G01 Z-45.0", op: "feed", X: 50, Z: -45, f: 0.12 },
    { n: "N21", text: "G01 X61.0", op: "feed", X: 61, Z: -45, f: 0.12 },
    { n: "N22", text: `G00 X${H1.X}`, op: "rapid", X: H1.X, Z: -45 },
    { n: "N23", text: `G00 Z${H1.Z}`, op: "rapid", X: H1.X, Z: H1.Z },
    { n: "N24", text: "T0505", op: "index", tool: 5 },
    { n: "N25", text: "G97 S2390", op: "spin", rpm: 2390 },
    { n: "N26", text: "G00 X0 Z5.0", op: "rapid", X: 0, Z: 5 },
    { n: "N27", text: "G01 Z-30.0 F0.1", op: "feed", X: 0, Z: -30, f: 0.1 },
    { n: "N28", text: "G00 Z5.0", op: "rapid", X: 0, Z: 5 },
    { n: "N29", text: `G00 X${H5.X} Z${H5.Z}`, op: "rapid", X: H5.X, Z: H5.Z },
    { n: "N30", text: "M09 M05", op: "stop" },
    { n: "N31", text: "T0101", op: "index", tool: 1 },
    { n: "N32", text: "M30", op: "end" },
  ];
}

// Tool tip (world) → turret axis position (saddle x, turret y)
function axesOf(tool, X, Z) {
  const t = TOOLS[tool];
  const tipX = GEO.face + Z * U;
  const tipR = (X / 2) * U;
  if (t.kind === "drill" || t.kind === "bore") return { xs: tipX + GEO.axX, yt: tipR + GEO.Ra, tipX, tipR };
  return { xs: tipX + GEO.odX, yt: tipR + GEO.Rt, tipX, tipR };
}

const rpmAt = (vc, D, smax) => Math.min(smax, (1000 * vc) / (Math.PI * Math.max(Math.abs(D), 0.1)));

// Build the timeline: list of segments with start time and duration.
function timeline() {
  const blocks = program();
  const segs = [];
  let t = 0;
  let X = home(1).X;
  let Z = home(1).Z;
  let tool = 1;
  let smax = SMAX;
  let mode = { vc: 0, rpm: 0 };
  let coolant = false;
  let spinning = false;
  const push = (seg) => {
    segs.push({ ...seg, t0: t, tool, coolant, spinning, mode: { ...mode } });
    t += seg.dur;
  };
  for (const b of blocks) {
    if (b.op === "set") {
      smax = b.smax;
      push({ b, kind: "dwell", dur: 0.25, from: { X, Z }, to: { X, Z } });
    } else if (b.op === "spin") {
      const wasStill = !spinning;
      mode = b.rpm ? { vc: 0, rpm: b.rpm } : { vc: b.vc, rpm: 0 };
      spinning = true;
      if (b.coolant) coolant = true;
      push({ b, kind: "dwell", dur: wasStill ? 0.9 : 0.3, from: { X, Z }, to: { X, Z }, spinUp: wasStill });
    } else if (b.op === "rapid") {
      if (b.tool) tool = b.tool;
      const dx = Math.abs(b.X - X) / 2; // radial mm
      const dz = Math.abs(b.Z - Z);
      const dur = Math.max(dx / RAPID_X, dz / RAPID_Z) + ACCEL;
      push({ b, kind: "rapid", dur, from: { X, Z }, to: { X: b.X, Z: b.Z } });
      X = b.X;
      Z = b.Z;
    } else if (b.op === "feed") {
      // integrate time with CSS
      const n = 200;
      let dur = 0;
      const len = Math.hypot((b.X - X) / 2, b.Z - Z);
      for (let i = 0; i < n; i++) {
        const D = X + ((b.X - X) * (i + 0.5)) / n;
        const rpm = mode.rpm || rpmAt(mode.vc, D, smax);
        dur += len / n / ((b.f * rpm) / 60);
      }
      push({ b, kind: "feed", dur, f: b.f, from: { X, Z }, to: { X: b.X, Z: b.Z } });
      X = b.X;
      Z = b.Z;
    } else if (b.op === "index") {
      const from = TOOLS[tool].st;
      const to = TOOLS[b.tool].st;
      let steps = to - from;
      if (steps > 6) steps -= 12;
      if (steps < -6) steps += 12;
      const dur = 0.3 * Math.max(1, Math.abs(steps)) ** 0.6 + 0.2;
      push({ b, kind: "index", dur, from: { X, Z }, to: { X, Z }, fromSt: from, toSt: to, steps, nextTool: b.tool });
      tool = b.tool;
      // keep the turret where it is: re-express X,Z for the new tool
      const a0 = axesOf(segs[segs.length - 1].tool, X, Z);
      const t2 = TOOLS[tool];
      const ax = t2.kind === "drill" || t2.kind === "bore";
      X = ((a0.yt - (ax ? GEO.Ra : GEO.Rt)) / U) * 2;
      Z = (a0.xs - (ax ? GEO.axX : GEO.odX) - GEO.face) / U;
    } else if (b.op === "stop") {
      coolant = false;
      push({ b, kind: "dwell", dur: 0.9, from: { X, Z }, to: { X, Z }, spinDown: true });
      spinning = false;
      mode = { vc: 0, rpm: 0 };
    } else if (b.op === "end") {
      push({ b, kind: "dwell", dur: 0.6, from: { X, Z }, to: { X, Z } });
    }
  }
  const cycle = t;
  // part change: door open, unload, load (representative)
  segs.push({ b: { n: "", text: "part change" }, kind: "change", dur: 6.0, t0: t, tool: 1, coolant: false, spinning: false, mode: { vc: 0, rpm: 0 }, from: { X, Z }, to: { X, Z } });
  t += 6.0;
  return { segs, cycle, total: t, smax };
}

const ease = (u) => (u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u));

// State at time t (seconds into the loop)
function stateAt(T, time) {
  const { segs, total, smax } = T;
  let t = ((time % total) + total) % total;
  let i = segs.findIndex((s) => t < s.t0 + s.dur);
  if (i < 0) i = segs.length - 1;
  const s = segs[i];
  const u = (t - s.t0) / s.dur;
  let X = s.from.X;
  let Z = s.from.Z;
  if (s.kind === "rapid") {
    const e = ease(u);
    X = s.from.X + (s.to.X - s.from.X) * e;
    Z = s.from.Z + (s.to.Z - s.from.Z) * e;
  } else if (s.kind === "feed") {
    // CSS makes progress non-linear; approximate by integrating rate
    const n = 60;
    let acc = 0;
    const rate = (k) => {
      const D = s.from.X + ((s.to.X - s.from.X) * (k + 0.5)) / n;
      const rpm = s.mode.rpm || rpmAt(s.mode.vc, D, smax);
      return (s.f * rpm) / 60;
    };
    const len = Math.hypot((s.to.X - s.from.X) / 2, s.to.Z - s.from.Z);
    const want = u * s.dur;
    let frac = 1;
    for (let k = 0; k < n; k++) {
      const dt = len / n / rate(k);
      if (acc + dt >= want) {
        frac = (k + (want - acc) / dt) / n;
        break;
      }
      acc += dt;
    }
    X = s.from.X + (s.to.X - s.from.X) * frac;
    Z = s.from.Z + (s.to.Z - s.from.Z) * frac;
  }
  let tool = s.tool;
  let turret = TOOLS[tool].st * 30;
  if (s.kind === "index") {
    const e = ease(u);
    turret = (s.fromSt + s.steps * e) * 30;
    if (u > 0.5) tool = s.nextTool;
  }
  const ax = axesOf(s.tool, X, Z);
  let rpm = 0;
  if (s.spinning || s.kind === "dwell") {
    const D = Math.max(Math.abs(X), 1);
    const target = s.mode.rpm || (s.mode.vc ? rpmAt(s.mode.vc, D, smax) : 0);
    rpm = s.spinning ? target : 0;
    if (s.spinUp) rpm = (s.mode.rpm || rpmAt(s.mode.vc, D, smax)) * ease(u);
    if (s.spinDown) rpm = rpmAt(220, D, smax) * 0 + (segs[i - 1]?.mode.rpm || 0) * (1 - ease(u));
  }
  if (s.kind === "feed" && !s.mode.rpm) rpm = rpmAt(s.mode.vc, Math.max(Math.abs(X), 0.1), smax);
  const cutting = s.kind === "feed";
  const feedRate = cutting ? s.f * rpm : 0;
  return {
    t,
    seg: i,
    block: s.b,
    kind: s.kind,
    X: r0(X),
    Z: r0(Z),
    Xf: X,
    Zf: Z,
    xs: ax.xs,
    yt: ax.yt,
    tipX: ax.tipX,
    tipR: ax.tipR,
    tool,
    cutTool: s.tool,
    turret,
    rpm,
    cutting,
    feed: s.f ?? 0,
    feedRate,
    coolant: s.coolant && s.kind !== "change",
    phase: s.kind,
    cycle: T.cycle,
    total,
  };
}
// Parts that are rebuilt while the machine runs: the turret (indexing), the chuck jaws (turning),
// the workpiece (being cut) and the visible lengths of the ball screws. Runs in Node and in the page.
function makeParts(k, G, P, D) {
  const V = G.viewOf(P);
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const Ln = (d, style) => k.lineSvg(d, style);
  const deg = Math.PI / 180;
  const { Zc } = D;
  const rad3 = (a) => [0, Math.cos(a), Math.sin(a)];
  const tan3 = (a) => [0, -Math.sin(a), Math.cos(a)];

  // ---------- turret at the rest pose (axis at y = T.yt, z = Zc, back face at x = T.back) ----------
  const T = D.turret;
  const R = T.R; // across-flats radius
  const DISC = 12;
  function dodecagon(phi, r) {
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = phi + (i * 30 - 15) * deg;
      const rr = r / Math.cos(15 * deg);
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    return pts;
  }
  const axisO = (s) => [T.back - s, T.yt, Zc];
  const TF = G.frameOf(axisO(0), [-1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const stationFrame = (a, s = 0) => G.frameOf(axisO(s), [-1, 0, 0], rad3(a), tan3(a));
  const P3 = (a, s, r, w = 0) => G.add3(G.add3(axisO(s), G.mul3(rad3(a), r)), G.mul3(tan3(a), w));

  let SINK = null;
  const insertOf = (kind) =>
    kind === "groove" ? [[35, DISC + 2.4], [40, DISC + 3.4], [40, DISC + 6.2], [35, DISC + 6.2]] : kind === "thread" ? [[35, DISC + 1.2], [40, DISC + 6.2], [35, DISC + 6.2]] : [[34.6, DISC + 0.8], [38.2, DISC + 3.6], [40, DISC + 6.2], [34.6, DISC + 6.2]];
  const keep = (spec) => SINK && SINK.push(spec);
  function odTool(a, kind, lit, part = "all") {
    const items = [];
    const SF = stationFrame(a);
    if (part === "front") {
      // only what shows past the rim of the disc: the end of the shank and the insert
      keep({ kind: "prism", F: SF, poly: [[R - 0.1, -3.1], [36.2, -3.1], [36.2, 3.1], [R - 0.1, 3.1]], s0: DISC, s1: DISC + 5.8 });
      items.push({ at: P3(a, 15, 33), bias: 0.2, svg: S(G.prismOf(SF, [[R - 0.1, -3.1], [36.2, -3.1], [36.2, 3.1], [R - 0.1, 3.1]], DISC, DISC + 5.8, P), { tone: "hi", lit }) });
      const IF = G.frameOf(P3(a, 0, 0, 0), tan3(a), rad3(a), [-1, 0, 0]);
      items.push({ at: P3(a, 15, 38, -3.2), bias: 0.4, svg: S(G.prismOf(IF, insertOf(kind), -3.1, -1.9, P), { tone: lit ? "hi" : "mid", lit }) });
      keep({ kind: "prism", F: IF, poly: insertOf(kind), s0: -3.1, s1: -1.9 });
      return items;
    }
    keep({ kind: "prism", F: SF, poly: [[17, -4.6], [36.2, -4.6], [36.2, 6.4], [17, 6.4]], s0: DISC, s1: DISC + 6.2 });
    const holder = [[17, -4.6], [30, -4.6], [30, 4.6], [17, 4.6]];
    items.push({ at: P3(a, 15, 23.5), svg: S(G.prismOf(SF, holder, DISC, DISC + 6.2, P), { tone: "mid" }) + k.dotsSvg([at(P3(a, DISC + 6.2, 19.4, -2.6)), at(P3(a, DISC + 6.2, 19.4, 2.6))], { size: 0.45, tone: "hi" }) });
    const shank = [[20, -3.1], [36.2, -3.1], [36.2, 3.1], [20, 3.1]];
    items.push({ at: P3(a, 15, 32), bias: 0.2, svg: S(G.prismOf(SF, shank, DISC + 0.4, DISC + 5.8, P), { tone: "hi", lit }) });
    // insert: a plate on the shank's leading face, rhombic tip at r = Rt
    const IF = G.frameOf(P3(a, 0, 0, 0), tan3(a), rad3(a), [-1, 0, 0]);
    const tip = insertOf(kind);
    items.push({ at: P3(a, 15, 38, -3.2), bias: 0.4, svg: S(G.prismOf(IF, tip, -3.1, -1.9, P), { tone: lit ? "hi" : "mid", lit }) });
    items.push({ at: P3(a, 16, 25, 4.6), bias: 0.3, svg: S(G.prismOf(SF, [[22, 4.6], [28, 4.6], [28, 6.4], [22, 6.4]], DISC + 1, DISC + 5.2, P), { tone: "lo" }) });
    return items;
  }
  function axialTool(a, kind, lit, clipS = 99) {
    const items = [];
    const c0 = P3(a, DISC, T.Ra);
    const F = G.frameOf(c0, [-1, 0, 0], [0, 1, 0], [0, 0, 1]);
    keep({ kind: "disc", F, s0: 0, s1: 10, r: 8 });
    keep({ kind: "disc", F, s0: 10, s1: kind === "drill" ? 30 : 26.4, r: kind === "drill" ? 3.2 : 4 });
    items.push({ at: P3(a, DISC + 1.5, T.Ra), svg: S(G.disc(0, 3, 8, F, P), { tone: "mid" }) + k.dotsSvg(G.dotsOf(F, 0, 6.4, 6, P, { fade: [0.04, 0.42] }), { size: 0.4, tone: "hi" }) });
    items.push({ at: P3(a, DISC + 6.5, T.Ra), svg: S(G.disc(3, 10, 6, F, P), { tone: "mid", inner: Ln(G.arcOf(F, 7, 6, P), { tone: "faint" }) }) });
    if (kind === "drill") {
      const end = Math.min(30, clipS);
      const prof = end >= 30 ? [[10, 3.2], [12, 3.2], [12, 2], [28.6, 2], [30, 0.2]] : [[10, 3.2], [12, 3.2], [12, 2], [Math.max(12.2, end), 2]];
      const fl = end > 12.6 ? Ln(G.ribsOf(F, 12, Math.min(28.6, end), 2, 3, P, { twist: 1.6, least: 0.2 }), { tone: "lo" }) : "";
      items.push({ at: P3(a, DISC + 20, T.Ra), bias: 0.2, svg: S(G.solidOf(prof, F, P, { steps: 28 }), { tone: "hi", lit, inner: fl }) });
    } else {
      const prof = [[10, 4], [25, 4], [26.4, 3.2]];
      items.push({ at: P3(a, DISC + 18, T.Ra), bias: 0.2, svg: S(G.solidOf(prof, F, P, { steps: 28 }), { tone: "hi", lit }) });
    }
    return items;
  }
  const STATIONS = D.stations; // [{ st, kind, t }]
  // the station pointing at the spindle is drawn as its own item, so it can sit in front of the chuck and behind the bar
  const frontStation = (phi) => {
    let best = null;
    for (const s of STATIONS) {
      let a = (phi / deg + s.st * 30) % 360;
      if (a > 180) a -= 360;
      if (a < -180) a += 360;
      if (!best || Math.abs(a) < best.d) best = { st: s.st, d: Math.abs(a) };
    }
    return best && best.d < 20 ? best.st : -1;
  };
  function turretShapes(phiDeg, which = "back") {
    SINK = [];
    turretSvg(phiDeg, -1, -1e9, which);
    const out = SINK;
    SINK = null;
    if (which === "back") out.push({ kind: "prism", F: TF, poly: dodecagon(phiDeg * deg, R), s0: 0, s1: DISC });
    return out;
  }
  function turretSvg(phiDeg, activeSt = -1, clipX = -1e9, which = "back") {
    const phi = phiDeg * deg;
    const back = [];
    const fs = frontStation(phi);
    for (const s of STATIONS) {
      if ((s.st === fs) !== (which === "front")) continue;
      const a = phi + s.st * 30 * deg;
      const lit = s.st === activeSt;
      const clipS = s.st === activeSt ? T.back - clipX - DISC : 99;
      const list = s.kind === "drill" || s.kind === "bore" ? axialTool(a, s.kind, lit, clipS) : odTool(a, s.kind, lit, which);
      for (const it of list) back.push({ ...it, key: G.dot3(it.at, V) + (it.bias ?? 0) });
    }
    back.sort((x, y) => x.key - y.key);
    if (which === "front") return back.map((b) => b.svg).join("");
    const ring = dodecagon(phi, R);
    const bolts = [];
    for (let i = 0; i < 12; i++) bolts.push(at(G.add3(axisO(0), [0, Math.cos(phi + i * 30 * deg) * 27, Math.sin(phi + i * 30 * deg) * 27])));
    const flats = [];
    for (let i = 0; i < 12; i++) {
      const a = phi + i * 30 * deg;
      const facing = G.dot3(rad3(a), V);
      if (facing <= 0.02) continue;
      flats.push(at(P3(a, DISC / 2, R, 0)));
    }
    const disc = S(G.prismOf(TF, ring, 0, DISC, P), {
      tone: "mid",
      inner: Ln(G.circleOf(TF, 0, 24.6, P, 72), { tone: "faint" }),
    });
    const hub = k.dotsSvg(bolts, { size: 0.45, tone: "hi" }) + k.dotsSvg(flats, { size: 0.4, tone: "lo" });
    return back.map((b) => b.svg).join("") + disc + hub;
  }

  // ---------- chuck jaws (three, 120° apart), turning about x ----------
  const C = D.chuck;
  function jawsSvg(thetaDeg) {
    const th = thetaDeg * deg;
    const list = [];
    for (let j = 0; j < 3; j++) {
      const a = th + j * 120 * deg;
      const u = [0, Math.cos(a), Math.sin(a)];
      const v = [0, -Math.sin(a), Math.cos(a)];
      const F = G.frameOf([C.face, 0, Zc], [1, 0, 0], u, v);
      const master = [[C.wr + 7.5, -3.6], [C.r - 2, -3.6], [C.r - 2, 3.6], [C.wr + 7.5, 3.6]];
      const top = [[C.wr, -3], [C.wr + 13, -3], [C.wr + 13, 3], [C.wr, 3]];
      const ctr = G.add3([C.face, 0, Zc], G.mul3(u, C.r * 0.6));
      const key = G.dot3(ctr, V);
      const fu = G.dot3(u, V);
      const m = S(G.prismOf(F, master, 0, 2.2, P), { tone: "mid" });
      const sJ = S(G.prismOf(F, top, 2.2, C.jaw, P), { tone: "hi" });
      const bolts = k.dotsSvg([at(G.add3([C.face + C.jaw, 0, Zc], G.mul3(u, C.wr + 4))), at(G.add3([C.face + C.jaw, 0, Zc], G.mul3(u, C.wr + 9.5)))], { size: 0.45, tone: "lo" });
      list.push({ key, svg: m + sJ + bolts, fu });
    }
    list.sort((x, y) => x.key - y.key);
    return list.map((x) => x.svg).join("");
  }
  // marks on the chuck face that turn with it
  function chuckMarks(thetaDeg) {
    const th = thetaDeg * deg;
    const F = G.frameOf([C.face, 0, Zc], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const dots = [];
    for (let j = 0; j < 6; j++) {
      const a = th + (j * 60 + 30) * deg;
      dots.push(at([C.face, Math.cos(a) * (C.r - 4), Zc + Math.sin(a) * (C.r - 4)]));
    }
    return k.dotsSvg(dots, { size: 0.5, tone: "lo" });
  }

  // ---------- workpiece from a radius profile ----------
  const W = D.work; // { x0, x1, r, dz }
  function workSvg(radii, bore, lit = false) {
    // radii: radius per sample from x0 (in the jaws) to the raw face; bore: { depth, r } from the face
    const pts = [];
    const n = radii.length;
    let lastR = -1;
    let end = n - 1;
    while (end > 0 && radii[end] <= 0.01) end--;
    for (let i = 0; i <= end; i++) {
      const x = W.x0 + i * W.dz;
      const r = Math.max(0.01, radii[i]);
      if (Math.abs(r - lastR) > 1e-3) {
        if (i > 0 && lastR >= 0) pts.push([x, lastR]);
        pts.push([x, r]);
        lastR = r;
      }
    }
    const xEnd = W.x0 + (end + 1) * W.dz;
    pts.push([xEnd, lastR]);
    const F = G.frameOf([0, 0, Zc], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const prof = [];
    for (const [x, r] of pts) {
      const p = prof[prof.length - 1];
      if (p && Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - r) < 1e-6) continue;
      prof.push([x, r]);
    }
    let svg = S(G.solidOf(prof, F, P, { steps: 40 }), { tone: "hi", lit });
    if (bore && bore.depth > 0.05) {
      const holeR = Math.min(bore.r, lastR - 0.5);
      svg += `<path class="gl-void" d="${G.circleOf(F, xEnd, holeR, P, 40)}"/>` + Ln(G.circleOf(F, xEnd, holeR, P, 40), { tone: "lo" });
    }
    return svg;
  }

  // ---------- ball screws: visible pieces ----------
  function screwSvg(F, s0, s1, r) {
    if (s1 - s0 < 0.4) return "";
    const rings = [];
    const pitch = 2.5;
    for (let s = Math.ceil((s0 + 0.6) / pitch) * pitch; s < s1 - 0.6; s += pitch) rings.push(G.arcOf(F, s, r, P));
    return S(G.disc(s0, s1, r, F, P, { steps: 24 }), { tone: "hi", inner: Ln(rings.join(""), { tone: "lo" }) });
  }

  function coverSvg(F, front, back, x0, x1) {
    // three nested sheet-metal sections from the cross slide (front) to the saddle edge (back)
    const L = 40;
    const secs = [
      { y0: front, w: 0, h: 93.4, tone: "lo" },
      { y0: front + (back - L - front) / 2, w: 0.6, h: 94.2, tone: "mid" },
      { y0: back - L, w: 1.2, h: 95, tone: "mid" },
    ];
    return secs
      .map((c) => {
        const y0 = Math.max(front, c.y0);
        const plan = { x: x0 - c.w, y: y0, w: x1 - x0 + 2 * c.w, d: Math.max(0.5, Math.min(back, y0 + L) - y0), r: 0.3 };
        return S(k.slabOf(plan, 88, c.h - 88, P, 1, 0.3), { tone: c.tone });
      })
      .join("");
  }

  return { coverSvg, turretSvg, turretShapes, jawsSvg, chuckMarks, workSvg, screwSvg, dodecagon };
}

const D = {"P":{"origin":[289.1399660884981,403.4436071363251],"scale":0.883409435681685,"azimuth":62,"elevation":34},"Zc":132,"rest":{"xs":88,"yt":64},"turret":{"back":74,"yt":-64,"R":30,"Ra":24},"stations":[{"t":1,"st":0,"kind":"od"},{"t":3,"st":2,"kind":"od"},{"t":5,"st":4,"kind":"drill"},{"t":7,"st":6,"kind":"groove"},{"t":9,"st":8,"kind":"thread"},{"t":11,"st":10,"kind":"bore"}],"chuck":{"face":-5,"r":26.25,"jaw":8,"wr":7.5},"work":{"x0":-9,"x1":18.25,"r":7.5,"dz":0.125},"zscrew":{"y":8,"z":71.5,"r":2.8,"x0":-30,"x1":38,"from":-20,"to":150},"xscrew":{"x":88,"z":91.25,"r":2.4,"block":-96,"nut":-30},"cover":{"x0":74,"x1":110,"back":84,"front":34},"geo":{"Zc":132,"face":18,"stockFace":18.25,"stockR":7.5,"stockFrom":-9,"jawFace":3,"Rt":40,"Ra":24,"odX":32.2,"axX":56,"xsMin":10,"xsMax":88,"ytMin":24,"ytMax":64},"enclosure":{"door":{"x0":-4,"x1":108,"z0":90,"z1":292,"slide":-104},"lift":470,"vbOpen":[59,121.1,503,503],"vbFull":[0,0,640,640]},"tools":{"1":{"st":0,"kind":"od","name":"T01 rough · CNMG 120408","vc":180,"ap":2.4},"3":{"st":2,"kind":"od","name":"T03 finish · DNMG 150404","vc":220},"5":{"st":4,"kind":"drill","name":"T05 U-drill Ø16","vc":120,"d":16},"7":{"st":6,"kind":"groove","name":"T07 groove 3 mm"},"9":{"st":8,"kind":"thread","name":"T09 thread 60°"},"11":{"st":10,"kind":"bore","name":"T11 boring bar Ø20"}}};
const P = D.P;
const K = { iso, pathOf, solidSvg, lineSvg, dotsSvg, slabOf };
const PARTS = makeParts(K, G, P, D);
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (sel) => svg.querySelector(sel);
const $$ = (sel) => [...svg.querySelectorAll(sel)];
const at = (p) => iso(p, P);
const readout = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const progEl = document.querySelector('[data-part="program"]');
const still = matchMedia("(prefers-reduced-motion: reduce)");
const TL = timeline();
const GEOM = D.geo;

const el = {
  saddle: $$('[data-piece="saddle"]'),
  cross: $$('[data-piece="cross"]'),
  turret: $('[data-part="turret"]'),
  tool: $('[data-part="turret-tool"]'),
  jaws: $('[data-part="jaws"]'),
  marks: $('[data-part="chuckmarks"]'),
  work: $('[data-part="work"]'),
  zl: $('[data-part="zscrew-left"]'),
  zr: $('[data-part="zscrew-right"]'),
  xs: $('[data-part="xscrew"]'),
  jet: $('[data-part="jet"]'),
  cover: $('[data-part="xcover"]'),
  enFront: $('[data-part="encl-front"]'),
  enBack: $('[data-part="encl-back"]'),
  door: $('[data-part="door"]'),
  scrN: $('[data-scr="n"]'),
  scrB: $('[data-scr="b"]'),
  scrS: $('[data-scr="s"]'),
  scrG: $('[data-scr="g"]'),
  lamps: Object.fromEntries($$('[data-lamp]').map((g) => [g.dataset.lamp, g])),
  chips: $('[data-part="chips"]'),
};
const nodes = { tool: el.tool.closest(".it"), work: el.work.closest(".it") };
nodes.workNext = nodes.work.nextSibling;
function endFaceX() {
  let end = NS - 1;
  while (end > 0 && work.r[end] <= 0.01) end--;
  return D.work.x0 + (end + 1) * D.work.dz;
}
const ZSF = G.frameOf([0, D.zscrew.y, D.zscrew.z], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
const XSF0 = (x) => G.frameOf([x, 0, D.xscrew.z], [0, 1, 0], [0, 0, 1], [1, 0, 0]);

// ---------- program listing ----------
const blocks = [];
for (const s of TL.segs) if (s.b && s.b.n && !blocks.includes(s.b)) blocks.push(s.b);
const lines = blocks.map((b) => `<div class="gl-line" data-n="${b.n}"><span class="gl-n">${b.n}</span> ${b.text}</div>`).join("");
progEl.innerHTML = `<div class="gl-screen"><div class="gl-head"><span>O1001 · S45C Ø60</span><span data-clock>0.0 s</span></div><div class="gl-lines">${lines}</div></div>`;
const lineEls = [...progEl.querySelectorAll(".gl-line")];
const clockEl = progEl.querySelector("[data-clock]");
const linesBox = progEl.querySelector(".gl-lines");

// ---------- the bar being cut ----------
const NS = Math.round((D.work.x1 - D.work.x0) / D.work.dz) + 1;
const stock = () => ({ r: new Float32Array(NS).fill(D.work.r), bore: 0 });
let work = stock();
let workDirty = true;
function cut(w, s) {
  if (!s.cutting) return;
  const kind = D.tools[s.cutTool].kind;
  if (kind === "drill" || kind === "bore") {
    const depth = GEOM.face + 0 - s.tipX;
    if (Math.abs(s.tipR) < 0.6 && depth > w.bore) {
      w.bore = depth;
      workDirty = true;
    }
    return;
  }
  const tipR = Math.max(0, s.tipR);
  const from = Math.max(0, Math.floor((s.tipX - D.work.x0) / D.work.dz));
  const to = Math.min(NS - 1, Math.ceil((s.tipX + 1.6 - D.work.x0) / D.work.dz));
  for (let i = from; i <= to; i++) {
    if (w.r[i] > tipR + 1e-4) {
      w.r[i] = tipR;
      workDirty = true;
    }
  }
}
function workAt(t) {
  const w = stock();
  const end = Math.min(t, TL.cycle);
  for (let u = 0; u <= end; u += 0.02) cut(w, stateAt(TL, u));
  if (t > TL.cycle + 3) return stock();
  return w;
}

// ---------- chips ----------
const chips = [];
let chipClock = 0;
function chipPath(c) {
  const a = at(c.p);
  const s = c.size;
  const r = c.spin;
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = r + i * 0.9;
    pts.push([a[0] + Math.cos(t) * s * (1 - i * 0.09), a[1] + Math.sin(t) * s * 0.7 * (1 - i * 0.09)]);
  }
  return pathOf(pts);
}

// ---------- guards: closed, door open (interlocked), lifted off ----------
const EN = D.enclosure;
const guard = { mode: "closed", door: { x: 0, v: 0 }, lift: { x: 0, v: 0 }, touched: false };
const guardButtons = [...document.querySelectorAll("[data-guard]")];
function setGuard(mode, byUser = true) {
  if (byUser) guard.touched = true;
  guard.mode = mode;
  for (const b of guardButtons) b.setAttribute("aria-pressed", String(b.dataset.guard === mode));
  if (status) status.textContent = mode === "closed" ? "guards closed" : mode === "door" ? "door open, cycle interlocked" : "guards lifted off";
  run();
}
function moveGuards(dt) {
  const wantLift = guard.mode === "off" ? 1 : 0;
  const wantDoor = guard.mode === "closed" && guard.lift.x < 0.02 ? 0 : guard.mode === "closed" ? 1 : 1;
  const calm = still.matches;
  // the door opens before the hood lifts, and the hood comes down before the door closes
  const liftTarget = wantLift && guard.door.x > 0.97 ? 1 : 0;
  const a = settle(guard.door, wantDoor, dt, 0.18, calm);
  const b = settle(guard.lift, liftTarget, dt, 0.28, calm);
  const lift = guard.lift.x;
  const door = guard.door.x;
  const up = translateAlong(P, [0, 0, EN.lift * lift * lift]);
  const f = Math.min(1, Math.max(0, (lift - 0.45) / 0.5));
  const fade = 1 - f * f * (3 - 2 * f);
  for (const g of [el.enFront, el.enBack]) {
    if (lift > 0.001) g.setAttribute("transform", up);
    else g.removeAttribute("transform");
    g.style.opacity = fade.toFixed(3);
    g.style.visibility = fade < 0.01 ? "hidden" : "visible";
  }
  if (door > 0.001) el.door.setAttribute("transform", translateAlong(P, [EN.door.slide * door, 0, 0]));
  else el.door.removeAttribute("transform");
  // once the guards are off, the view closes in on the machine (not on the line floor: its slot keeps the full view)
  const z = svg.closest(".lf-slot") ? 0 : lift * lift * (3 - 2 * lift);
  const vb = EN.vbFull.map((v, i) => (v + (EN.vbOpen[i] - v) * z).toFixed(2)).join(" ");
  if (vb !== state.vb) {
    svg.setAttribute("viewBox", vb);
    state.vb = vb;
  }
  return a || b;
}
const interlocked = () => guard.door.x > 0.02 && guard.lift.x < 0.98;

// ---------- state ----------
const state = { t: 0, hold: false, turret: null, theta: 0, last: null, touched: 0 };
function settle(st, target, dt, seconds, calm) {
  if (calm) {
    st.x = target;
    st.v = 0;
    return false;
  }
  const w = 1 / seconds;
  for (let i = 0; i < 4; i++) {
    const h = dt / 4;
    st.v += (w * w * (target - st.x) - 2 * w * st.v) * h;
    st.x += st.v * h;
  }
  if (Math.abs(target - st.x) < 1e-4 && Math.abs(st.v) < 1e-4) {
    st.x = target;
    st.v = 0;
    return false;
  }
  return true;
}
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
const grp = (n) => Math.round(n).toLocaleString("en-US");

function place(s) {
  const dz = s.xs - D.rest.xs;
  const dy = -(s.yt - D.rest.yt);
  const ts = translateAlong(P, [dz, 0, 0]);
  const tc = translateAlong(P, [dz, dy, 0]);
  for (const g of el.saddle) dz ? g.setAttribute("transform", ts) : g.removeAttribute("transform");
  for (const g of el.cross) dz || dy ? g.setAttribute("transform", tc) : g.removeAttribute("transform");
  // turret rotation (rebuilt only when it changes)
  const lit = s.cutting ? D.tools[s.cutTool].st : -1;
  const drilling = D.tools[s.tool].kind === "drill" && s.phase !== "index";
  // the drill is drawn only up to the face it has entered; the rest is inside the bar
  const faceX = endFaceX();
  const clipX = drilling && s.tipX < faceX ? faceX - dz : -1e9;
  const key = `${s.turret.toFixed(2)}|${lit}|${clipX.toFixed(2)}`;
  if (key !== state.turret) {
    el.turret.innerHTML = PARTS.turretSvg(-s.turret, lit, clipX, "back");
    el.tool.innerHTML = PARTS.turretSvg(-s.turret, lit, clipX, "front");
    state.turret = key;
  }
  // in front of the bar's end face the turret is nearer than the bar; behind its side it is farther
  const front = (drilling && s.tipR < 3) || (s.phase !== "index" && s.tipX >= faceX - 0.3 && s.tipR < D.work.r + 1);
  if (front !== state.front || state.front === undefined) {
    state.front = front;
    // static order (facing, drilling): work, cross slide, tool; turning: the tool goes behind the bar
    if (front) nodes.workNext.before(nodes.work);
    else nodes.tool.after(nodes.work);
  }
  // screws
  el.zl.innerHTML = PARTS.screwSvg(ZSF, D.zscrew.from, s.xs + D.zscrew.x0, D.zscrew.r);
  el.zr.innerHTML = PARTS.screwSvg(ZSF, s.xs + D.zscrew.x1, D.zscrew.to, D.zscrew.r);
  el.cover.innerHTML = PARTS.coverSvg(null, -s.yt + D.cover.front, D.cover.back, D.cover.x0, D.cover.x1);
  el.xs.innerHTML = PARTS.screwSvg(XSF0(D.xscrew.x), D.xscrew.block, -s.yt + D.xscrew.nut, D.xscrew.r);
}

function draw(s, dt) {
  place(s);
  el.jaws.innerHTML = PARTS.jawsSvg(state.theta);
  el.marks.innerHTML = PARTS.chuckMarks(state.theta);
  if (workDirty) {
    el.work.innerHTML = PARTS.workSvg(work.r, { depth: work.bore, r: 2 }, s.cutting);
    workDirty = false;
    state.workLit = s.cutting;
  } else if (state.workLit !== s.cutting) {
    el.work.innerHTML = PARTS.workSvg(work.r, { depth: work.bore, r: 2 }, s.cutting);
    state.workLit = s.cutting;
  }
  // coolant jet: from the nozzle on the holder to the tip (cross group translates it, so draw at rest)
  const dz = s.xs - D.rest.xs;
  const dy = -(s.yt - D.rest.yt);
  const kind = D.tools[s.cutTool].kind;
  const tip = [s.tipX - dz, -s.tipR - dy, D.Zc];
  if (s.coolant && s.cutting && kind !== "drill") {
    const noz = [tip[0] + 4, tip[1] - 14, D.Zc + 9];
    const mid = [tip[0] + 2.4, tip[1] - 6, D.Zc + 6];
    const d = pathOf([at(noz), at(mid), at(tip)]);
    el.jet.innerHTML = `<path class="iso-line gl-jet" data-tone="lit" data-flow="" d="${d}"/>` + dotsSvg([at(noz)], { size: 0.8, tone: "lo" });
  } else el.jet.innerHTML = "";
  // chips fly from the tip in world space, falling under gravity
  if (s.cutting && !still.matches && !state.hold && !interlocked()) {
    chipClock += dt;
    const every = kind === "drill" ? 0.12 : 0.07;
    while (chipClock > every) {
      chipClock -= every;
      if (chips.length < 28)
        chips.push({ p: [s.tipX - dz + 0.6, -s.tipR - dy - 0.6, D.Zc + 1.2], v: [3 + Math.random() * 9, 4 + Math.random() * 14, 14 + Math.random() * 12], age: 0, life: 0.9 + Math.random() * 0.5, size: 0.9 + Math.random() * 1.1, spin: Math.random() * 6 });
    }
  }
  if (!state.hold && !interlocked()) for (const c of chips) {
    c.age += dt;
    c.v[2] -= 60 * dt;
    c.p = [c.p[0] + c.v[0] * dt, c.p[1] + c.v[1] * dt, Math.max(89, c.p[2] + c.v[2] * dt)];
    c.spin += dt * 9;
  }
  for (let i = chips.length - 1; i >= 0; i--) if (chips[i].age > chips[i].life) chips.splice(i, 1);
  el.chips.innerHTML = chips.map((c) => `<path class="gl-chip" style="opacity:${fmt(Math.max(0, 1 - c.age / c.life) * 0.9, 2)}" d="${chipPath(c)}"/>`).join("");
  // readout
  const t = D.tools[s.tool];
  const head = interlocked() ? "door open · interlock" : s.phase === "change" ? "part change" : state.hold ? "feed hold" : s.phase === "index" ? "indexing" : s.cutting ? "cutting" : s.phase === "rapid" ? "rapid" : "dwell";
  const feed = s.cutting ? ` · F ${grp(s.feedRate)} mm/min` : "";
  const rpm = interlocked() ? 0 : s.rpm;
  const running = !state.hold && !interlocked() && s.phase !== "change";
  const lampKey = running ? "green" : "amber";
  if (lampKey !== state.lamp) {
    state.lamp = lampKey;
    for (const [name, g] of Object.entries(el.lamps)) g.toggleAttribute("data-on", name === lampKey);
  }
  if (el.scrG) el.scrG.textContent = guard.door.x > 0.02 && guard.lift.x < 0.98 ? "DOOR OPEN  INTERLOCK" : state.hold ? "FEED HOLD" : "AUTO  CYCLE";
  readout.textContent = `T${String(s.tool).padStart(2, "0")} · X${fmt(s.Xf)} Z${fmt(s.Zf)} · ${grp(rpm)} min⁻¹`;
  if (el.scrS) el.scrS.textContent = `S ${grp(rpm)} min-1  T${String(s.tool).padStart(2, "0")}`;
  clockEl.textContent = `${head}${feed} · ${fmt(Math.min(s.t, TL.cycle))} / ${fmt(TL.cycle)} s`;
  const n = s.block.n;
  if (n !== state.block) {
    state.block = n;
    for (const l of lineEls) l.toggleAttribute("data-on", l.dataset.n === n);
    if (el.scrN) el.scrN.textContent = n || "--";
    if (el.scrB) el.scrB.textContent = s.block.text;
    const on = lineEls.find((l) => l.dataset.n === n);
    if (on) linesBox.scrollTop = Math.max(0, on.offsetTop - linesBox.clientHeight / 2 + on.clientHeight / 2);
    if (status && document.activeElement === stage) status.textContent = `${n} ${s.block.text}`;
  }
}

function step(dt, gdt = dt) {
  moveGuards(gdt);
  const paused = state.hold || interlocked();
  if (!paused) {
    const before = state.t;
    state.t += dt;
    if (state.t >= TL.total) {
      state.t -= TL.total;
      work = stock();
      workDirty = true;
    }
    // cut between frames in small steps
    for (let u = before; u < state.t; u += 0.02) cut(work, stateAt(TL, u));
    const s = stateAt(TL, state.t);
    if (s.phase === "change" && s.t - TL.cycle > 3 && work.r[NS - 1] < D.work.r - 1e-3) {
      work = stock();
      workDirty = true;
    }
    state.theta = (state.theta + (s.rpm / 60) * 360 * dt / 40) % 360;
  }
  const s = stateAt(TL, state.t);
  cut(work, s);
  draw(s, paused ? 0 : dt);
}

function jumpTo(t) {
  state.t = Math.max(0, Math.min(TL.total - 0.01, t));
  work = workAt(state.t);
  workDirty = true;
  chips.length = 0;
}
function blockStart(dir) {
  const starts = [];
  let last = null;
  for (const sg of TL.segs) if (sg.b.n && sg.b !== last) (starts.push(sg.t0), (last = sg.b));
  const now = state.t;
  if (dir > 0) return starts.find((t0) => t0 > now + 1e-3) ?? 0;
  const prev = starts.filter((t0) => t0 < now - 0.05);
  return prev.length >= 1 ? prev[prev.length - 1] : 0;
}

// ---------- loop ----------
let frame = 0;
let last = 0;
let visible = false;
// the guards move on wall time: the machine's own clock stands still while it waits for a part or is stopped
let lastWall = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const wall = window.performance.now();
  const gdt = lastWall ? Math.min((wall - lastWall) / 1000, 1 / 30) : 1 / 60;
  lastWall = wall;
  step(dt, gdt);
  frame = visible && !still.matches ? requestAnimationFrame(tick) : 0;
}
const run = () => {
  if (!frame && visible && !still.matches) {
    last = 0;
    lastWall = 0;
    frame = requestAnimationFrame(tick);
  }
};
new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  },
  { rootMargin: "120px 0px" },
).observe(stage);

const toggleHold = () => {
  state.hold = !state.hold;
  if (status) status.textContent = state.hold ? "feed hold" : "cycle running";
  if (still.matches) step(0);
};
stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  toggleHold();
});
stage.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    toggleHold();
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    jumpTo(blockStart(e.key === "ArrowRight" ? 1 : -1));
    state.hold = true;
    step(0);
  } else if (e.key === "g" || e.key === "G") {
    e.preventDefault();
    setGuard(guard.mode === "closed" ? "door" : guard.mode === "door" ? "off" : "closed");
  } else if (e.key === "Home") {
    e.preventDefault();
    jumpTo(0);
    step(0);
  }
});
stage.addEventListener("focus", () => {
  if (status) status.textContent = `${state.hold ? "feed hold" : "cycle running"} · ${state.block ?? ""}`;
});
for (const b of guardButtons) b.addEventListener("click", () => setGuard(b.dataset.guard));
window.__genos = { guard: (m) => setGuard(m), guardState: guard,  jumpTo: (t) => { jumpTo(t); step(0); }, hold: (v) => { state.hold = v; step(0); }, state, TL, stateAt };

if (still.matches) {
  jumpTo(12);
  state.hold = true;
  setGuard("off", false);
} else if (svg.closest(".lf-slot")) {
  // on the line floor the guards stay on until the line's "covers off" button lifts them
  setGuard("closed", false);
} else {
  // opening sequence: closed, then the door slides open, then the guards lift away
  setGuard("closed", false);
  setTimeout(() => guard.touched || setGuard("door", false), 1800);
  setTimeout(() => guard.touched || setGuard("off", false), 3200);
}
step(0);
})();
