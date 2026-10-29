// 08-machine-lnc8.js - Machine M1 Okuma LNC-8 - drawing, animation and parts list
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
const document = window.__mx.doc("lnc8");
const __t = window.__mx.time(0); const requestAnimationFrame = __t.raf, cancelAnimationFrame = __t.caf, performance = __t.perf;
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

return { viewOf, scaleOf, frameAlong, frameOf, pointOf, disc, solidOf, lathe, prismOf, circleOf, arcOf, dotsOf, ribsOf, sphereOf, dot3, add3, sub3, mul3, unit3, cross3, len3 };})();
// The LNC-8 cycle model: one program, turned into a timeline of physical turret positions.
// Shared by the build (for the screen text and the audit poses) and the page (inlined).
// Machine units: X is a diameter in mm, Z in mm from the finished part face.
// World units: 1 unit = 2.5 mm. The spindle axis runs along world x at y = 0, z = 150.

const LNC = {
  U: 2.5,
  XF0: 140, // world x of Z0 (finished face)
  RAPID: 200, // mm/s: 472 in/min = 12 m/min
  RAMP: 0.12, // s to reach rapid speed
  SMAX: 3000, // G50 clamp used by the program (machine max 4200)
  STOCK_R: 12, // Ø60 mm bar
  STOCK_FACE: 140.4, // stock face, 1 mm proud of Z0
  GRIP: [106, 116], // jaws grip the blank over this world x span
  INDEX_PER_STATION: 0.3, // s per 30° station
};

// Tool offsets: reach from turret centre to tip. rho is radial (world units, in the disc plane),
// lambda is axial (disc centre x minus tip x). theta is the station angle on the disc.
const TOOLS = {
  1: { name: "OD turning tool", station: 0, rho: 56, lambda: 26 },
  3: { name: "Ø10 drill", station: 2, rho: 34, lambda: 54 },
};

const smooth = (t) => t * t * (3 - 2 * t);

// The program, as the control would hold it. Each block is one line on the OSP screen.
const PROGRAM = [
  { n: 1, text: "G50 S3000", kind: "set", smax: 3000 },
  { n: 2, text: "G00 X200. Z50. T0101", kind: "rapid", X: 200, Z: 50, tool: 1 },
  { n: 3, text: "G96 S200 M03", kind: "spindle", css: 200 },
  { n: 4, text: "G00 X64. Z0 M08", kind: "rapid", X: 64, Z: 0, coolant: true },
  { n: 5, text: "G01 X-1.6 F0.15", kind: "feed", X: -1.6, F: 0.15, note: "face" },
  { n: 6, text: "G00 Z2.", kind: "rapid", Z: 2 },
  { n: 7, text: "X54.", kind: "rapid", X: 54 },
  { n: 8, text: "G01 Z-30. F0.25", kind: "feed", Z: -30, F: 0.25, note: "rough Ø54" },
  { n: 9, text: "X62.", kind: "feed", X: 62, F: 0.25 },
  { n: 10, text: "G00 Z2.", kind: "rapid", Z: 2 },
  { n: 11, text: "X48.8", kind: "rapid", X: 48.8 },
  { n: 12, text: "G01 Z-30. F0.25", kind: "feed", Z: -30, F: 0.25, note: "rough Ø48.8" },
  { n: 13, text: "X62.", kind: "feed", X: 62, F: 0.25 },
  { n: 14, text: "G00 X44. Z1.", kind: "rapid", X: 44, Z: 1 },
  { n: 15, text: "G01 X48. Z-1. F0.12", kind: "feed", X: 48, Z: -1, F: 0.12, note: "chamfer" },
  { n: 16, text: "Z-30.", kind: "feed", Z: -30, F: 0.12, note: "finish Ø48" },
  { n: 17, text: "X62.", kind: "feed", X: 62, F: 0.12 },
  { n: 18, text: "G00 X200. Z50. M09", kind: "rapid", X: 200, Z: 50, coolant: false },
  { n: 19, text: "T0303", kind: "index", tool: 3 },
  { n: 20, text: "G97 S1500", kind: "spindle", rpm: 1500 },
  { n: 21, text: "G00 X0 Z5. M08", kind: "rapid", X: 0, Z: 5, coolant: true },
  { n: 22, text: "G01 Z-20. F0.1", kind: "feed", Z: -20, F: 0.1, note: "drill" },
  { n: 23, text: "G00 Z5.", kind: "rapid", Z: 5 },
  { n: 24, text: "X200. Z50. M09 M05", kind: "rapid", X: 200, Z: 50, coolant: false, stop: true },
  { n: 25, text: "T0101", kind: "index", tool: 1 },
  { n: 26, text: "M30", kind: "load" },
];

// Physical turret position from machine coordinates of a tool.
function physOf(X, Z, tool) {
  const t = TOOLS[tool];
  return { D: X / 2 / LNC.U + t.rho, xc: LNC.XF0 + Z / LNC.U + t.lambda };
}
function machineOf(D, xc, tool) {
  const t = TOOLS[tool];
  return { X: (D - t.rho) * 2 * LNC.U, Z: (xc - t.lambda - LNC.XF0) * LNC.U };
}

const rpmFor = (spin, X) => {
  if (!spin.on) return 0;
  if (spin.css) return Math.min(spin.smax, (1000 * spin.css) / (Math.PI * Math.max(Math.abs(X), 0.5)));
  return spin.rpm;
};

// Build the timeline: each block becomes a segment with a start time and a way to evaluate it.
function buildTimeline() {
  let X = 200, Z = 50, tool = 1, phi = 0, coolant = false;
  const spin = { on: false, css: 0, rpm: 0, smax: LNC.SMAX };
  let t = 0;
  const segs = [];
  for (const b of PROGRAM) {
    const from = { X, Z, tool, phi, coolant, spin: { ...spin } };
    let dur = 0.25;
    let path = null;
    if (b.kind === "set") spin.smax = b.smax;
    if (b.kind === "spindle") {
      spin.on = true;
      if (b.css) { spin.css = b.css; spin.rpm = 0; } else { spin.css = 0; spin.rpm = b.rpm; }
      dur = 0.6;
    }
    if (b.kind === "rapid" || b.kind === "feed") {
      const tX = b.X ?? X, tZ = b.Z ?? Z;
      if (b.tool) tool = b.tool;
      const dist = Math.hypot((tX - X) / 2, tZ - Z);
      if (b.kind === "rapid") {
        const v = LNC.RAPID, a = v / LNC.RAMP;
        const tAcc = Math.min(LNC.RAMP, Math.sqrt(dist / a));
        const dAcc = 0.5 * a * tAcc * tAcc;
        dur = Math.max(0.05, 2 * tAcc + Math.max(0, dist - 2 * dAcc) / v);
        path = { type: "rapid", X0: X, Z0: Z, X1: tX, Z1: tZ, a, v, tAcc, dist };
      } else {
        // integrate feed: F mm/rev at the spindle speed the CSS gives at each X
        const N = 240, cum = [0];
        for (let i = 0; i < N; i++) {
          const xm = X + (tX - X) * ((i + 0.5) / N);
          const n = rpmFor(spin, xm);
          const v = (b.F * n) / 60; // mm/s
          cum.push(cum[i] + dist / N / Math.max(v, 1e-3));
        }
        dur = cum[N];
        path = { type: "feed", X0: X, Z0: Z, X1: tX, Z1: tZ, cum, F: b.F };
      }
      X = tX; Z = tZ;
      if (b.coolant !== undefined) coolant = b.coolant;
      if (b.stop) spin.on = false;
    }
    if (b.kind === "index") {
      const st0 = TOOLS[tool].station, st1 = TOOLS[b.tool].station;
      let steps = st1 - st0;
      if (steps > 6) steps -= 12;
      if (steps < -6) steps += 12;
      dur = Math.abs(steps) * LNC.INDEX_PER_STATION + 0.35;
      const keep = physOf(X, Z, tool);
      path = { type: "index", phi0: phi, phi1: phi + steps * 30, keep };
      phi += steps * 30;
      tool = b.tool;
      const m = machineOf(keep.D, keep.xc, tool);
      X = m.X; Z = m.Z;
    }
    if (b.kind === "load") { dur = 8; path = { type: "load" }; }
    segs.push({ ...b, t0: t, t1: t + dur, from, to: { X, Z, tool, phi, coolant, spin: { ...spin } }, path });
    t += dur;
  }
  return { segs, total: t };
}

// State at time t (seconds into the cycle).
function stateAt(TL, time) {
  const t = Math.max(0, Math.min(TL.total - 1e-6, time));
  let i = TL.segs.findIndex((s) => t < s.t1);
  if (i < 0) i = TL.segs.length - 1;
  const s = TL.segs[i];
  const u = Math.max(0, Math.min(1, (t - s.t0) / (s.t1 - s.t0)));
  let { X, Z, tool, phi, coolant } = s.from;
  let spin = s.from.spin;
  let load = null;
  let moving = "dwell";
  const p = s.path;
  if (p && p.type === "rapid") {
    const tt = t - s.t0, T = s.t1 - s.t0;
    let d;
    const tc = T - 2 * p.tAcc;
    if (tt < p.tAcc) d = 0.5 * p.a * tt * tt;
    else if (tt < p.tAcc + tc) d = 0.5 * p.a * p.tAcc * p.tAcc + p.v * (tt - p.tAcc);
    else { const r = T - tt; d = p.dist - 0.5 * p.a * r * r; }
    const f = p.dist > 0 ? Math.max(0, Math.min(1, d / p.dist)) : 1;
    X = p.X0 + (p.X1 - p.X0) * f; Z = p.Z0 + (p.Z1 - p.Z0) * f;
    moving = "rapid";
    if (s.tool) tool = s.tool;
  } else if (p && p.type === "feed") {
    const tt = t - s.t0, cum = p.cum, N = cum.length - 1;
    let k = 0;
    while (k < N - 1 && cum[k + 1] < tt) k++;
    const f = (k + Math.max(0, Math.min(1, (tt - cum[k]) / (cum[k + 1] - cum[k])))) / N;
    X = p.X0 + (p.X1 - p.X0) * f; Z = p.Z0 + (p.Z1 - p.Z0) * f;
    moving = "feed";
  } else if (p && p.type === "index") {
    phi = p.phi0 + (p.phi1 - p.phi0) * smooth(Math.min(1, u / 0.85));
    moving = "index";
    if (u > 0.5) { tool = s.to.tool; const m = machineOf(p.keep.D, p.keep.xc, tool); X = m.X; Z = m.Z; }
  } else if (p && p.type === "load") {
    load = u;
    moving = "load";
  } else {
    ({ X, Z, tool, phi, coolant } = s.to);
  }
  if (s.kind === "spindle" || s.kind === "set") spin = s.to.spin;
  if (s.kind === "rapid" && s.coolant !== undefined && u > 0.6) coolant = s.coolant;
  if (s.kind === "rapid" && s.stop) spin = { ...spin, on: u < 0.15 };
  if (s.kind === "index" || s.kind === "load") coolant = false;
  const ph = physOf(X, Z, tool);
  const rpm = rpmFor(spin, X);
  return { i, seg: s, u, X, Z, tool, phi, coolant, rpm, D: ph.D, xc: ph.xc, moving, load, feed: s.F ?? 0 };
}

// Where the active tool's tip is in world space.
function tipOf(st) {
  const r = st.X / 2 / LNC.U;
  const x = LNC.XF0 + st.Z / LNC.U;
  return { x, r };
}
// live part of the LNC-8 figure: runs the program, moves the slides, turns the chuck and the part
const DD = {"P":{"origin":[167.7716531847047,287.07905176319883],"scale":0.5614110845386118,"azimuth":60,"elevation":30},"V":[0.43301270189221946,0.75,0.49999999999999994],"SQ":0.7071067811865476,"ZC":150,"HN":80,"P0":[0,-56.568542494923804,93.4314575050762],"REF":{"D":96,"xc":186},"LNC":{"U":2.5,"XF0":140,"RAPID":200,"RAMP":0.12,"SMAX":3000,"STOCK_R":12,"STOCK_FACE":140.4,"GRIP":[106,116],"INDEX_PER_STATION":0.3},"TOOLS":{"1":{"name":"OD turning tool","station":0,"rho":56,"lambda":26},"3":{"name":"Ø10 drill","station":2,"rho":34,"lambda":54}},"chuck":{"x0":72,"x1":106,"r":42},"door":{"travel":-200,"shift":[0.6149950300704745,0.17753377308071094]},"moving":[{"name":"@tools","axis":"x","svg":""},{"name":"saddle.block.30.180","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M299.6 227.7L304.6 214.6L318.1 218.5L320.1 220.3L315.1 233.3L301.6 229.4Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M301.6 229.4L299.6 227.7L313.1 231.6L315.1 233.3ZM315.1 233.3L313.1 231.6L318.1 218.5L320.1 220.3Z\"/><path class=\"iso-top\" d=\"M299.6 227.7L304.6 214.6L318.1 218.5L313.1 231.6Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M315.1 233.3L313.1 231.6M299.6 227.7L313.1 231.6M313.1 231.6L318.1 218.5\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M299.6 227.7L304.6 214.6L318.1 218.5L320.1 220.3L315.1 233.3L301.6 229.4Z\"/></g>"},{"name":"saddle.block.30.240","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M336.5 238.3L341.5 225.3L355 229.2L357 230.9L352 244L338.5 240Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M338.5 240L336.5 238.3L350 242.2L352 244ZM352 244L350 242.2L355 229.2L357 230.9Z\"/><path class=\"iso-top\" d=\"M336.5 238.3L341.5 225.3L355 229.2L350 242.2Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M352 244L350 242.2M336.5 238.3L350 242.2M350 242.2L355 229.2\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M336.5 238.3L341.5 225.3L355 229.2L357 230.9L352 244L338.5 240Z\"/></g>"},{"name":"saddle.block.140.180","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M327.2 155.9L332.2 142.9L345.7 146.8L347.7 148.5L342.7 161.5L329.2 157.6Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M329.2 157.6L327.2 155.9L340.7 159.8L342.7 161.5ZM342.7 161.5L340.7 159.8L345.7 146.8L347.7 148.5Z\"/><path class=\"iso-top\" d=\"M327.2 155.9L332.2 142.9L345.7 146.8L340.7 159.8Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M342.7 161.5L340.7 159.8M327.2 155.9L340.7 159.8M340.7 159.8L345.7 146.8\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M327.2 155.9L332.2 142.9L345.7 146.8L347.7 148.5L342.7 161.5L329.2 157.6Z\"/></g>"},{"name":"saddle.block.140.240","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M364.1 166.6L369.1 153.5L382.6 157.4L384.6 159.2L379.6 172.2L366.1 168.3Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M366.1 168.3L364.1 166.6L377.6 170.5L379.6 172.2ZM379.6 172.2L377.6 170.5L382.6 157.4L384.6 159.2Z\"/><path class=\"iso-top\" d=\"M364.1 166.6L369.1 153.5L382.6 157.4L377.6 170.5Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M379.6 172.2L377.6 170.5M364.1 166.6L377.6 170.5M377.6 170.5L382.6 157.4\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M364.1 166.6L369.1 153.5L382.6 157.4L384.6 159.2L379.6 172.2L366.1 168.3Z\"/></g>"},{"name":"saddle.wiper.30.176","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M296.8 227.6L302.4 213.2L304.8 214L306.7 215.6L301.2 229.9L298.7 229.2Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M298.7 229.2L296.8 227.6L299.3 228.3L301.2 229.9ZM301.2 229.9L299.3 228.3L304.8 214L306.7 215.6Z\"/><path class=\"iso-top\" d=\"M296.8 227.6L302.4 213.2L304.8 214L299.3 228.3Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M301.2 229.9L299.3 228.3M296.8 227.6L299.3 228.3M299.3 228.3L304.8 214\"/><path class=\"iso-line iso-edge\" data-tone=\"lo\" d=\"M296.8 227.6L302.4 213.2L304.8 214L306.7 215.6L301.2 229.9L298.7 229.2Z\"/></g>"},{"name":"saddle.wiper.30.262","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M349.7 242.9L355.3 228.5L357.7 229.2L359.6 230.8L354.1 245.2L351.6 244.5Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M351.6 244.5L349.7 242.9L352.2 243.6L354.1 245.2ZM354.1 245.2L352.2 243.6L357.7 229.2L359.6 230.8Z\"/><path class=\"iso-top\" d=\"M349.7 242.9L355.3 228.5L357.7 229.2L352.2 243.6Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M354.1 245.2L352.2 243.6M349.7 242.9L352.2 243.6M352.2 243.6L357.7 229.2\"/><path class=\"iso-line iso-edge\" data-tone=\"lo\" d=\"M349.7 242.9L355.3 228.5L357.7 229.2L359.6 230.8L354.1 245.2L351.6 244.5Z\"/></g>"},{"name":"saddle.wiper.140.176","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M324.5 155.8L330 141.5L332.5 142.2L334.3 143.8L328.8 158.2L326.3 157.5Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M326.3 157.5L324.5 155.8L326.9 156.6L328.8 158.2ZM328.8 158.2L326.9 156.6L332.5 142.2L334.3 143.8Z\"/><path class=\"iso-top\" d=\"M324.5 155.8L330 141.5L332.5 142.2L326.9 156.6Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M328.8 158.2L326.9 156.6M324.5 155.8L326.9 156.6M326.9 156.6L332.5 142.2\"/><path class=\"iso-line iso-edge\" data-tone=\"lo\" d=\"M324.5 155.8L330 141.5L332.5 142.2L334.3 143.8L328.8 158.2L326.3 157.5Z\"/></g>"},{"name":"saddle.wiper.140.262","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M377.4 171.1L382.9 156.8L385.3 157.5L387.2 159.1L381.7 173.4L379.2 172.7Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M379.2 172.7L377.4 171.1L379.8 171.8L381.7 173.4ZM381.7 173.4L379.8 171.8L385.3 157.5L387.2 159.1Z\"/><path class=\"iso-top\" d=\"M377.4 171.1L382.9 156.8L385.3 157.5L379.8 171.8Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M381.7 173.4L379.8 171.8M377.4 171.1L379.8 171.8M379.8 171.8L385.3 157.5\"/><path class=\"iso-line iso-edge\" data-tone=\"lo\" d=\"M377.4 171.1L382.9 156.8L385.3 157.5L387.2 159.1L381.7 173.4L379.2 172.7Z\"/></g>"},{"name":"saddle","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M291.8 226.7L331.2 124.3L386.6 140.3L390.6 143.8L351.2 246.2L295.8 230.2Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M295.8 230.2L291.8 226.7L347.2 242.7L351.2 246.2ZM351.2 246.2L347.2 242.7L386.6 140.3L390.6 143.8Z\"/><path class=\"iso-top\" d=\"M291.8 226.7L331.2 124.3L386.6 140.3L347.2 242.7Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M351.2 246.2L347.2 242.7M291.8 226.7L347.2 242.7M347.2 242.7L386.6 140.3\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M291.8 226.7L331.2 124.3L386.6 140.3L390.6 143.8L351.2 246.2L295.8 230.2Z\"/></g><g class=\"iso-dots\" data-tone=\"mid\"><circle cx=\"297.3\" cy=\"223.2\" r=\"0.5\"/><circle cx=\"345.2\" cy=\"237.1\" r=\"0.5\"/><circle cx=\"333.2\" cy=\"129.9\" r=\"0.5\"/><circle cx=\"381.1\" cy=\"143.8\" r=\"0.5\"/></g>"},{"name":"@disc","axis":"x","svg":""},{"name":"xrail.212","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M310.1 229L348.3 129.8L354.5 131.6L356 132.9L317.8 232.1L311.6 230.3Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M317.8 232.1L316.3 230.7L354.5 131.6L356 132.9ZM311.6 230.3L317.8 232.1L316.3 230.7L310.1 229Z\"/><path class=\"iso-top\" d=\"M316.3 230.7L310.1 229L348.3 129.8L354.5 131.6Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M317.8 232.1L316.3 230.7M316.3 230.7L354.5 131.6M316.3 230.7L310.1 229\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M310.1 229L348.3 129.8L354.5 131.6L356 132.9L317.8 232.1L311.6 230.3Z\"/></g><g class=\"iso-dots\" data-tone=\"lo\"><circle cx=\"314.7\" cy=\"225.9\" r=\"0.45\"/><circle cx=\"319.2\" cy=\"214.2\" r=\"0.45\"/><circle cx=\"323.8\" cy=\"202.5\" r=\"0.45\"/><circle cx=\"328.3\" cy=\"190.7\" r=\"0.45\"/><circle cx=\"332.8\" cy=\"179\" r=\"0.45\"/><circle cx=\"337.3\" cy=\"167.2\" r=\"0.45\"/><circle cx=\"341.8\" cy=\"155.5\" r=\"0.45\"/><circle cx=\"346.4\" cy=\"143.8\" r=\"0.45\"/></g>"},{"name":"xrail.252","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M334.7 236.1L372.9 136.9L379.1 138.7L380.6 140L342.4 239.2L336.2 237.4Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M342.4 239.2L340.9 237.8L379.1 138.7L380.6 140ZM336.2 237.4L342.4 239.2L340.9 237.8L334.7 236.1Z\"/><path class=\"iso-top\" d=\"M340.9 237.8L334.7 236.1L372.9 136.9L379.1 138.7Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M342.4 239.2L340.9 237.8M340.9 237.8L379.1 138.7M340.9 237.8L334.7 236.1\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M334.7 236.1L372.9 136.9L379.1 138.7L380.6 140L342.4 239.2L336.2 237.4Z\"/></g><g class=\"iso-dots\" data-tone=\"lo\"><circle cx=\"339.3\" cy=\"233\" r=\"0.45\"/><circle cx=\"343.8\" cy=\"221.3\" r=\"0.45\"/><circle cx=\"348.4\" cy=\"209.6\" r=\"0.45\"/><circle cx=\"352.9\" cy=\"197.8\" r=\"0.45\"/><circle cx=\"357.4\" cy=\"186.1\" r=\"0.45\"/><circle cx=\"361.9\" cy=\"174.3\" r=\"0.45\"/><circle cx=\"366.4\" cy=\"162.6\" r=\"0.45\"/><circle cx=\"371\" cy=\"150.9\" r=\"0.45\"/></g>"},{"name":"xscrew","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M325.2 230.6L362.3 134.1L362.4 134L362.5 134L362.7 134L362.9 134L363.2 134.1L363.6 134.2L363.9 134.3L364.3 134.4L364.7 134.6L365.1 134.7L365.4 134.9L365.7 135L366 135.2L366.2 135.3L366.3 135.5L366.3 135.5L329.1 232.1L329.1 232.1L329 232.2L328.8 232.2L328.5 232.1L328.2 232.1L327.9 232L327.5 231.9L327.1 231.7L326.7 231.6L326.4 231.4L326 231.3L325.7 231.1L325.5 230.9L325.3 230.8L325.2 230.7Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L327.1 231.3L329 231.9L329.1 232L329.1 232.1L329.1 232.1L329 232.2L328.8 232.2L328.5 232.1L328.2 232.1L327.9 232L327.5 231.9L327.1 231.7L326.7 231.6L326.4 231.4L326 231.3L325.7 231.1L325.5 230.9L325.3 230.8L325.2 230.7L325.2 230.6L325.2 230.5L325.3 230.5L325.5 230.5L325.7 230.5L326 230.6L326.4 230.7L326.8 230.8L327.2 230.9L327.5 231.1L327.9 231.3L328.3 231.4L328.6 231.6L328.8 231.7L329 231.9ZM329.1 232.1L329.1 232L329 231.9L328.8 231.7L328.6 231.6L328.3 231.4L365.4 134.9L365.7 135L366 135.2L366.2 135.3L366.3 135.5L366.3 135.5Z\"/><path class=\"iso-shade\" data-shade=\"1\" d=\"M328.3 231.4L327.9 231.3L365.1 134.7L365.4 134.9Z\"/><path class=\"iso-shade\" data-shade=\"2\" d=\"M327.9 231.3L327.5 231.1L327.2 230.9L364.3 134.4L364.7 134.6L365.1 134.7Z\"/><path class=\"iso-shade\" data-shade=\"3\" d=\"M327.2 230.9L326.8 230.8L363.9 134.3L364.3 134.4Z\"/><path class=\"iso-top\" d=\"M326.8 230.8L326.4 230.7L326 230.6L325.7 230.5L325.5 230.5L325.3 230.5L325.2 230.5L325.2 230.6L362.3 134.1L362.4 134L362.5 134L362.7 134L362.9 134L363.2 134.1L363.6 134.2L363.9 134.3Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M329.1 232.1L328.8 231.8L327.9 231.2L326.7 230.8L325.6 230.5L325.2 230.6\"/><path class=\"iso-line iso-edge\" data-tone=\"hi\" d=\"M325.2 230.6L362.3 134.1L362.4 134L362.5 134L362.7 134L362.9 134L363.2 134.1L363.6 134.2L363.9 134.3L364.3 134.4L364.7 134.6L365.1 134.7L365.4 134.9L365.7 135L366 135.2L366.2 135.3L366.3 135.5L366.3 135.5L329.1 232.1L329.1 232.1L329 232.2L328.8 232.2L328.5 232.1L328.2 232.1L327.9 232L327.5 231.9L327.1 231.7L326.7 231.6L326.4 231.4L326 231.3L325.7 231.1L325.5 230.9L325.3 230.8L325.2 230.7Z\"/></g><path class=\"iso-line\" data-tone=\"faint\" d=\"M330.7 226.5L330.4 226.3L330 226.1L329.5 225.9L329.1 225.7L328.6 225.5L328.1 225.4L327.8 225.3M334.7 216L334.4 215.8L334 215.6L333.5 215.4L333.1 215.2L332.6 215.1L332.2 215L331.8 214.9M338.8 205.6L338.4 205.4L338 205.2L337.6 205L337.1 204.8L336.6 204.7L336.2 204.5L335.8 204.4M342.8 195.1L342.4 195L342 194.8L341.6 194.6L341.1 194.4L340.6 194.2L340.2 194.1L339.8 194M346.8 184.7L346.5 184.5L346 184.3L345.6 184.1L345.1 183.9L344.7 183.8L344.2 183.7L343.8 183.6M350.8 174.3L350.5 174.1L350.1 173.9L349.6 173.7L349.1 173.5L348.7 173.3L348.2 173.2L347.9 173.1M354.8 163.8L354.5 163.6L354.1 163.4L353.6 163.2L353.2 163.1L352.7 162.9L352.2 162.8L351.9 162.7M358.8 153.4L358.5 153.2L358.1 153L357.6 152.8L357.2 152.6L356.7 152.5L356.3 152.3L355.9 152.3M362.9 143L362.5 142.8L362.1 142.6L361.7 142.4L361.2 142.2L360.7 142L360.3 141.9L359.9 141.8\"/>"},{"name":"xmotor.bracket","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M352.1 127.4L353.3 124.2L370.5 129.1L379.6 137L378.3 140.2L361.1 135.3Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M378.3 140.2L369.3 132.4L370.5 129.1L379.6 137ZM361.1 135.3L378.3 140.2L369.3 132.4L352.1 127.4Z\"/><path class=\"iso-top\" d=\"M369.3 132.4L352.1 127.4L353.3 124.2L370.5 129.1Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M378.3 140.2L369.3 132.4M369.3 132.4L370.5 129.1M369.3 132.4L352.1 127.4\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M352.1 127.4L353.3 124.2L370.5 129.1L379.6 137L378.3 140.2L361.1 135.3Z\"/></g><g class=\"iso-dots\" data-tone=\"mid\"><circle cx=\"356.8\" cy=\"125.7\" r=\"0.45\"/><circle cx=\"369.1\" cy=\"129.3\" r=\"0.45\"/><circle cx=\"363.8\" cy=\"131.8\" r=\"0.45\"/><circle cx=\"376.1\" cy=\"135.4\" r=\"0.45\"/></g>"},{"name":"xmotor","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M358.8 127.4L366.1 108.5L366.3 108.3L369.2 106.5L369.6 106.5L370.1 106.5L370.8 106.6L371.7 106.8L372.6 107L373.6 107.4L374.6 107.7L375.6 108.1L376.5 108.5L377.4 109L378.2 109.4L378.8 109.8L379.3 110.1L379.6 110.4L379.7 110.7L380.7 114L373.4 132.9L373.2 133.2L372.9 133.3L372.2 133.3L371.4 133.2L370.3 133L369.1 132.7L367.8 132.3L366.5 131.9L365.1 131.3L363.7 130.8L362.5 130.2L361.3 129.6L360.3 129L359.6 128.5L359.1 128.1L358.8 127.7Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L366.1 130.2L372.8 132.2L373.2 132.6L373.4 133L373.2 133.2L372.8 133.3L372.1 133.3L371.2 133.2L370.1 133L368.8 132.6L367.5 132.2L366 131.7L364.6 131.1L363.2 130.5L362 129.9L360.9 129.3L360 128.8L359.3 128.3L358.9 127.9L358.8 127.5L358.9 127.3L359.3 127.2L360 127.2L360.9 127.3L362 127.5L363.3 127.8L364.7 128.3L366.1 128.8L367.5 129.3L368.9 129.9L370.2 130.5L371.3 131.1L372.2 131.7L372.8 132.2ZM373.4 133L373.2 132.6L372.8 132.2L372.2 131.7L371.3 131.1L370.2 130.5L377.4 111.6L378.5 112.2L379.4 112.8L380.1 113.3L380.5 113.7L380.7 114ZM380.7 114L380.5 113.7L380.1 113.3L379.4 112.8L378.5 112.2L378.1 109.4L378.8 109.8L379.3 110.1L379.6 110.4L379.7 110.7Z\"/><path class=\"iso-shade\" data-shade=\"1\" d=\"M370.2 130.5L368.9 129.9L376.2 111L377.4 111.6ZM378.5 112.2L377.4 111.6L377.3 108.9L378.1 109.4Z\"/><path class=\"iso-shade\" data-shade=\"2\" d=\"M368.9 129.9L367.5 129.3L366.1 128.8L373.4 109.9L374.8 110.4L376.2 111ZM377.4 111.6L376.2 111L374.8 110.4L375.4 108.1L376.4 108.5L377.3 108.9Z\"/><path class=\"iso-shade\" data-shade=\"3\" d=\"M366.1 128.8L364.7 128.3L372 109.4L373.4 109.9ZM374.8 110.4L373.4 109.9L374.4 107.6L375.4 108.1Z\"/><path class=\"iso-top\" d=\"M364.7 128.3L363.3 127.8L362 127.5L360.9 127.3L360 127.2L359.3 127.2L358.9 127.3L358.8 127.5L366 108.6L366.2 108.4L366.6 108.2L367.3 108.2L368.2 108.4L369.3 108.6L370.6 108.9L372 109.4ZM373.4 109.9L372 109.4L370.6 108.9L369.3 108.6L368.2 108.4L367.3 108.2L366.6 108.2L366.2 108.4L369.1 106.6L369.4 106.5L369.9 106.5L370.6 106.6L371.4 106.7L372.3 107L373.3 107.3L374.4 107.6Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M373.4 133L373.3 132.8L373 132.4L372.5 131.9L371.8 131.4L370.9 130.9L369.8 130.3L368.5 129.8L367.2 129.2L365.9 128.7L364.5 128.2L363.3 127.8L362.1 127.5L361 127.3L360.1 127.2L359.4 127.2L359 127.2L358.8 127.4M380.6 113.9L380.4 113.6L379.9 113.1L379.2 112.6L378.3 112.1L377.1 111.5L375.9 110.9L374.5 110.3L373.1 109.8L371.8 109.3L370.4 108.9L369.2 108.6L368.1 108.4L367.3 108.2L366.6 108.2L366.2 108.4\"/><g opacity=\"0.85\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M373.3 130.9L380.1 113.3\"/></g><path class=\"iso-line\" data-tone=\"lo\" d=\"M372.5 130.3L379.3 112.6M371.3 129.5L378.1 111.9M369.8 128.8L376.6 111.2M368.1 128.1L374.9 110.5M366.4 127.4L373.2 109.8M364.6 126.8L371.4 109.2M363 126.3L369.8 108.7M361.6 126L368.4 108.4M373.8 131.4L373.4 131L372.8 130.5L372 129.9L370.9 129.4L369.7 128.8L368.4 128.2L367.1 127.6L365.7 127.1L364.3 126.7L363 126.3L361.9 126.1L360.9 125.9L360.1 125.8L359.6 125.9M380.5 113.7L380.2 113.3L379.6 112.9L378.7 112.3L377.7 111.8L376.5 111.2L375.2 110.6L373.8 110L372.4 109.5L371.1 109.1L369.8 108.7L368.7 108.4L367.7 108.3L366.9 108.2L366.4 108.3\"/><g opacity=\"0.95\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M360.4 125.9L367.2 108.2\"/></g><g opacity=\"0.30\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M359.7 125.9L366.4 108.3\"/></g><g opacity=\"0.15\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M373.8 131.4L380.6 113.8\"/></g><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M358.8 127.4L366.1 108.5L366.3 108.3L369.2 106.5L369.6 106.5L370.1 106.5L370.8 106.6L371.7 106.8L372.6 107L373.6 107.4L374.6 107.7L375.6 108.1L376.5 108.5L377.4 109L378.2 109.4L378.8 109.8L379.3 110.1L379.6 110.4L379.7 110.7L380.7 114L373.4 132.9L373.2 133.2L372.9 133.3L372.2 133.3L371.4 133.2L370.3 133L369.1 132.7L367.8 132.3L366.5 131.9L365.1 131.3L363.7 130.8L362.5 130.2L361.3 129.6L360.3 129L359.6 128.5L359.1 128.1L358.8 127.7Z\"/></g>"},{"name":"xmotor.plug","axis":"z","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M361.7 120.1L364.2 113.5L369.2 115L370.7 116.3L368.1 122.8L363.2 121.4Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M368.1 122.8L366.6 121.5L369.2 115L370.7 116.3ZM363.2 121.4L368.1 122.8L366.6 121.5L361.7 120.1Z\"/><path class=\"iso-top\" d=\"M366.6 121.5L361.7 120.1L364.2 113.5L369.2 115Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M368.1 122.8L366.6 121.5M366.6 121.5L369.2 115M366.6 121.5L361.7 120.1\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M361.7 120.1L364.2 113.5L369.2 115L370.7 116.3L368.1 122.8L363.2 121.4Z\"/></g>"},{"name":"xslide","axis":"x","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M318.6 187.6L334.7 145.9L371.6 156.5L374.6 159.2L358.5 200.9L321.6 190.2Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M358.5 200.9L355.5 198.3L371.6 156.5L374.6 159.2ZM321.6 190.2L358.5 200.9L355.5 198.3L318.6 187.6Z\"/><path class=\"iso-top\" d=\"M355.5 198.3L318.6 187.6L334.7 145.9L371.6 156.5Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M358.5 200.9L355.5 198.3M355.5 198.3L371.6 156.5M355.5 198.3L318.6 187.6\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M318.6 187.6L334.7 145.9L371.6 156.5L374.6 159.2L358.5 200.9L321.6 190.2Z\"/></g><g class=\"iso-dots\" data-tone=\"mid\"><circle cx=\"322.1\" cy=\"185.7\" r=\"0.5\"/><circle cx=\"354.1\" cy=\"195\" r=\"0.5\"/><circle cx=\"336.1\" cy=\"149.2\" r=\"0.5\"/><circle cx=\"368.1\" cy=\"158.4\" r=\"0.5\"/></g>"},{"name":"turret.housing","axis":"x","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M299.8 173.8L311.4 143.8L318.4 137.7L347.9 146.2L361.5 158L343.4 204.9L341.4 204.9L311.9 196.4L299.8 186Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M311.9 196.4L299.8 186L329.3 194.5L341.4 204.9ZM341.4 204.9L329.3 194.5L329.3 182.3L340.9 152.3L347.9 146.2L361.5 158L343.4 204.9Z\"/><path class=\"iso-shade\" data-shade=\"2\" d=\"M299.8 186L299.8 173.8L329.3 182.3L329.3 194.5Z\"/><path class=\"iso-top\" d=\"M299.8 173.8L311.4 143.8L340.9 152.3L329.3 182.3ZM311.4 143.8L318.4 137.7L347.9 146.2L340.9 152.3Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M341.4 204.9L329.3 194.5M299.8 186L329.3 194.5M329.3 194.5L329.3 182.3M299.8 173.8L329.3 182.3M329.3 182.3L340.9 152.3M311.4 143.8L340.9 152.3M340.9 152.3L347.9 146.2\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M299.8 173.8L311.4 143.8L318.4 137.7L347.9 146.2L361.5 158L343.4 204.9L341.4 204.9L311.9 196.4L299.8 186Z\"/></g><path class=\"iso-line\" data-tone=\"faint\" d=\"M343.9 193.2L356.4 160.6L345.9 151.4L333.3 184.1Z\"/><g class=\"iso-dots\" data-tone=\"mid\"><circle cx=\"343.9\" cy=\"189.7\" r=\"0.5\"/><circle cx=\"354.4\" cy=\"162.3\" r=\"0.5\"/><circle cx=\"335.4\" cy=\"182.3\" r=\"0.5\"/><circle cx=\"345.9\" cy=\"154.9\" r=\"0.5\"/></g>"},{"name":"turret.motor","axis":"x","svg":"<g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M339.1 181.3L339.1 180L339.2 178.7L339.4 177.2L339.7 175.8L340.1 174.4L340.6 173L341.2 171.6L341.8 170.4L342.5 169.3L343.2 168.3L343.9 167.4L344.7 166.8L345.4 166.3L346.1 166L346.8 165.9L347.4 166L351.1 167.1L351.7 167.4L352.2 167.9L352.6 168.6L353 169.5L353.2 170.5L353.4 171.6L353.4 172.9L353.3 174.2L353.2 175.6L352.9 177L352.5 178.5L352.1 179.9L351.6 181.2L351 182.5L350.3 183.7L349.6 184.8L348.9 185.7L348.2 186.4L347.4 187L346.7 187.4L346 187.6L345.3 187.6L341.7 186.5L341 186.3L340.5 185.9L340 185.3L339.6 184.5L339.4 183.6L339.2 182.5Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M341.4 186.5L340.6 186L340 185.2L339.5 184L343.2 185.1L343.7 186.3L344.3 187.1L345.1 187.5ZM344.3 174L345.1 172.2L346 170.5L347 169.2L348.1 168.1L349.1 167.4L350.1 167L351 167.1L351.8 167.5L352.5 168.3L353 169.5L353.3 171L353.4 172.7L353.3 174.6L353 176.6L352.5 178.6L351.8 180.6L351 182.4L350.1 184.1L349.1 185.5L348.1 186.5L347 187.3L346 187.6L345.1 187.5L344.3 187.1L343.7 186.3L343.2 185.1L342.9 183.6L342.8 181.9L342.9 180L343.2 178L343.7 176L344.3 174L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3L348.1 177.3Z\"/><path class=\"iso-shade\" data-shade=\"1\" d=\"M339.5 184L339.2 182.6L342.9 183.6L343.2 185.1Z\"/><path class=\"iso-shade\" data-shade=\"2\" d=\"M339.2 182.6L339.1 180.8L339.2 179L342.9 180L342.8 181.9L342.9 183.6Z\"/><path class=\"iso-shade\" data-shade=\"3\" d=\"M346.4 165.9L347.4 166L351 167.1L350.1 167ZM339.2 179L339.5 177L343.2 178L342.9 180Z\"/><path class=\"iso-top\" d=\"M339.5 177L340 174.9L340.6 173L341.4 171.1L342.4 169.5L343.4 168.1L344.4 167L345.4 166.3L346.4 165.9L350.1 167L349.1 167.4L348.1 168.1L347 169.2L346 170.5L345.1 172.2L344.3 174L343.7 176L343.2 178Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M345.1 187.5L344.6 187.3L344 186.8L343.6 186.2L343.3 185.4L343 184.4L342.8 183.4L342.8 182.2L342.8 180.9L342.9 179.5L343.1 178.1L343.5 176.7L343.9 175.3L344.3 174L344.9 172.7L345.5 171.5L346.2 170.4L346.9 169.4L347.6 168.6L348.3 167.9L349 167.4L349.7 167.1L350.4 167L351 167.1\"/><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M339.1 181.3L339.1 180L339.2 178.7L339.4 177.2L339.7 175.8L340.1 174.4L340.6 173L341.2 171.6L341.8 170.4L342.5 169.3L343.2 168.3L343.9 167.4L344.7 166.8L345.4 166.3L346.1 166L346.8 165.9L347.4 166L351.1 167.1L351.7 167.4L352.2 167.9L352.6 168.6L353 169.5L353.2 170.5L353.4 171.6L353.4 172.9L353.3 174.2L353.2 175.6L352.9 177L352.5 178.5L352.1 179.9L351.6 181.2L351 182.5L350.3 183.7L349.6 184.8L348.9 185.7L348.2 186.4L347.4 187L346.7 187.4L346 187.6L345.3 187.6L341.7 186.5L341 186.3L340.5 185.9L340 185.3L339.6 184.5L339.4 183.6L339.2 182.5Z\"/></g><g class=\"iso-solid\"><path class=\"iso-fill\" d=\"M343.8 180.3L344 179L344.2 177.5L344.6 176.1L345.1 174.7L345.6 173.4L346.3 172.2L347 171.1L347.7 170.3L348.5 169.6L349.2 169.2L349.9 169.1L350.5 169.1L361.6 172.3L362.2 172.7L362.6 173.2L363 174L363.9 176.2L364.1 176.9L364.2 177.8L364.2 178.8L364.1 179.8L363.9 180.9L363.6 181.9L363.3 183L362.8 184L362.3 184.9L361.8 185.7L361.3 186.3L360.7 186.8L358.8 188.2L358.1 188.6L357.4 188.7L356.7 188.7L345.6 185.5L345.1 185.1L344.6 184.6L344.2 183.8L344 182.8L343.8 181.6Z\"/><path class=\"iso-shade\" data-shade=\"0\" d=\"M345.7 185.5L345.1 185.1L344.5 184.5L344.1 183.5L355.2 186.7L355.6 187.7L356.1 188.3L356.8 188.7ZM360.8 172.3L361.5 172.3L362.2 172.7L362.7 173.3L363.1 174.3L364 176.4L363.7 175.7L363.3 175.2L362.8 174.9L362.2 174.9ZM359.2 187.9L358.3 188.5L357.5 188.7L356.8 188.7L356.1 188.3L355.6 187.7L355.2 186.7L355 185.6L354.9 184.2L355 182.7L355.2 181.1L358 181.5L357.9 182.7L357.8 183.8L357.9 184.8L358 185.7L358.3 186.4L358.7 186.9L359.2 187.2L359.8 187.2L360.4 187L361 186.6ZM358.7 179.1L359.2 178L359.8 177L360.4 176.1L361 175.5L361.6 175.1L362.2 174.9L362.8 174.9L363.3 175.2L363.7 175.7L364 176.4L364.1 177.2L364.2 178.3L364.1 179.4L364 180.6L363.7 181.8L363.3 183L362.8 184.1L362.2 185.1L361.6 185.9L361 186.6L360.4 187L359.8 187.2L359.2 187.2L358.7 186.9L358.3 186.4L358 185.7L357.9 184.8L357.8 183.8L357.9 182.7L358 181.5L358.3 180.3L358.7 179.1L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181L361 181Z\"/><path class=\"iso-shade\" data-shade=\"1\" d=\"M344.1 183.5L343.9 182.4L355 185.6L355.2 186.7ZM355.2 181.1L355.6 179.5L356.1 177.9L356.8 176.4L357.5 175.1L358.3 174L359.2 173.1L360 172.5L360.8 172.3L362.2 174.9L361.6 175.1L361 175.5L360.4 176.1L359.8 177L359.2 178L358.7 179.1L358.3 180.3L358 181.5Z\"/><path class=\"iso-shade\" data-shade=\"2\" d=\"M343.9 182.4L343.8 181L343.9 179.5L355 182.7L354.9 184.2L355 185.6Z\"/><path class=\"iso-shade\" data-shade=\"3\" d=\"M349.7 169.1L350.5 169.1L361.5 172.3L360.8 172.3ZM343.9 179.5L344.1 177.9L355.2 181.1L355 182.7Z\"/><path class=\"iso-top\" d=\"M344.1 177.9L344.5 176.3L345.1 174.7L345.7 173.2L346.5 171.9L347.3 170.8L348.1 169.9L348.9 169.3L349.7 169.1L360.8 172.3L360 172.5L359.2 173.1L358.3 174L357.5 175.1L356.8 176.4L356.1 177.9L355.6 179.5L355.2 181.1Z\"/><path class=\"iso-line iso-crease\" data-tone=\"faint\" d=\"M356.8 188.7L356.2 188.4L355.7 187.8L355.3 187.1L355.1 186.1L354.9 185L354.9 183.7L355 182.3L355.3 180.9L355.6 179.5L356.1 178.1L356.6 176.7L357.3 175.5L358 174.5L358.7 173.6L359.4 172.9L360.2 172.5L360.9 172.3L361.5 172.3M360.7 186.8L360 187.2L359.3 187.2L358.8 186.9L358.3 186.3L358 185.5L357.8 184.4L357.8 183.1L358 181.7L358.3 180.3L358.8 178.9L359.4 177.6L360.1 176.5L360.8 175.7L361.5 175.1L362.2 174.9L362.9 174.9L363.4 175.3L363.8 176\"/><path class=\"iso-line\" data-tone=\"lo\" d=\"M345.1 174.7L356.1 177.9M346 172.8L357 176M347 171.1L358.1 174.3M344 182.8L355 186M343.8 181L354.9 184.2M344 179L355 182.2M344.4 176.8L355.5 180M345.4 185.3L344.8 184.9L344.4 184.2L344.1 183.4L343.9 182.3L343.8 181.1L343.9 179.8L344.1 178.4L344.3 177L344.8 175.6L345.3 174.2L345.9 172.9L346.5 171.8L347.2 170.8L347.9 170L348.7 169.5L349.4 169.1L350.1 169.1M356.4 188.5L355.9 188.1L355.5 187.4L355.2 186.6L355 185.5L354.9 184.3L354.9 183L355.1 181.6L355.4 180.2L355.8 178.8L356.3 177.4L356.9 176.1L357.6 175L358.3 174L359 173.2L359.7 172.7L360.5 172.3L361.1 172.2\"/><g opacity=\"0.95\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M348.1 169.9L359.2 173.1\"/></g><g opacity=\"0.40\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M349.2 169.2L360.3 172.4\"/></g><g opacity=\"0.10\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M345.1 185.1L356.1 188.3\"/></g><g opacity=\"0.75\"><path class=\"iso-line\" data-tone=\"lo\" d=\"M344.4 184.2L355.5 187.4\"/></g><path class=\"iso-line iso-edge\" data-tone=\"mid\" d=\"M343.8 180.3L344 179L344.2 177.5L344.6 176.1L345.1 174.7L345.6 173.4L346.3 172.2L347 171.1L347.7 170.3L348.5 169.6L349.2 169.2L349.9 169.1L350.5 169.1L361.6 172.3L362.2 172.7L362.6 173.2L363 174L363.9 176.2L364.1 176.9L364.2 177.8L364.2 178.8L364.1 179.8L363.9 180.9L363.6 181.9L363.3 183L362.8 184L362.3 184.9L361.8 185.7L361.3 186.3L360.7 186.8L358.8 188.2L358.1 188.6L357.4 188.7L356.7 188.7L345.6 185.5L345.1 185.1L344.6 184.6L344.2 183.8L344 182.8L343.8 181.6Z\"/></g>"}],"shift":{"z":[0.6149950300704745,0.17753377308071094],"x":[0.25107066967004243,-0.6523007342382812]},"screen":{"u0":4,"u1":44,"w0":5,"w1":36,"pitch":3.7,"rows":4},"program":["N01 G50 S3000","N02 G00 X200. Z50. T0101","N03 G96 S200 M03","N04 G00 X64. Z0 M08","N05 G01 X-1.6 F0.15","N06 G00 Z2.","N07 X54.","N08 G01 Z-30. F0.25","N09 X62.","N10 G00 Z2.","N11 X48.8","N12 G01 Z-30. F0.25","N13 X62.","N14 G00 X44. Z1.","N15 G01 X48. Z-1. F0.12","N16 Z-30.","N17 X62.","N18 G00 X200. Z50. M09","N19 T0303","N20 G97 S1500","N21 G00 X0 Z5. M08","N22 G01 Z-20. F0.1","N23 G00 Z5.","N24 X200. Z50. M09 M05","N25 T0101","N26 M30"]};
const P = DD.P, V = DD.V, SQ = DD.SQ, ZC = DD.ZC, HN = DD.HN, P0 = DD.P0, REF = DD.REF, CH = DD.chuck;
const SHT = [0, -SQ, SQ], NHT = [0, SQ, SQ], XHT = [1, 0, 0];
const PLT = (x, s, n) => [x, P0[1] - s * SQ + n * SQ, P0[2] + s * SQ + n * SQ];
const at = (p) => iso(p, P);
const S = (paths, style) => solidSvg(paths, style);
const NS = "http://www.w3.org/2000/svg";
const TLN = buildTimeline();
const TOTAL = TLN.total;

const stage = document.querySelector(".lc-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const status = stage.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const jawsG = svg.querySelector('[data-part="jaws"]');
const stackG = svg.querySelector('[data-part="stack"]');
const screenG = svg.querySelector('[data-part="screen"]');
const startKey = svg.querySelector('[data-part="start"]');
const holdKey = svg.querySelector('[data-part="hold"]');

// ---------- moving group ----------
const turretG = document.createElementNS(NS, "g");
turretG.setAttribute("data-part", "turret");
const workG = document.createElementNS(NS, "g");
workG.setAttribute("data-part", "work");
const topG = document.createElementNS(NS, "g");
topG.setAttribute("data-part", "top");
stackG.append(turretG, workG, topG);
const nodes = [];
let toolsNode = null, discNode = null;
for (const part of DD.moving) {
  const g = document.createElementNS(NS, "g");
  g.dataset.axis = part.axis;
  g.innerHTML = part.svg;
  if (part.name === "@tools") toolsNode = g;
  if (part.name === "@disc") discNode = g;
  turretG.append(g);
  nodes.push(g);
}
const shiftOf = (D, xc, axis) => {
  const dz = xc - REF.xc, dx = axis === "x" ? D - REF.D : 0;
  const v = [DD.shift.z[0] * dz + DD.shift.x[0] * dx, DD.shift.z[1] * dz + DD.shift.x[1] * dx];
  return `translate(${v[0].toFixed(2)} ${v[1].toFixed(2)})`;
};

// ---------- turret disc and tools, rebuilt when the turret indexes ----------
const C0 = PLT(0, REF.D, HN);
const dirOf = (theta) => { const t = (theta * Math.PI) / 180; return G.add3(G.mul3(SHT, -Math.cos(t)), G.mul3(NHT, Math.sin(t))); };
const STATIONS = { 0: "od", 2: "drill", 4: "bore", 6: "od", 8: "cut", 10: "thread" };
function discSvg(phi) {
  const F = G.frameOf(C0, XHT, NHT, SHT); // u = n, v = s, so u × v = x
  const poly = [];
  for (let k = 0; k < 12; k++) {
    const th = ((30 * k - phi + 15) * Math.PI) / 180;
    // direction in (u = n, v = s): -s cos + n sin
    poly.push([43.5 * Math.sin(th), -43.5 * Math.cos(th)]);
  }
  const xc = REF.xc;
  const paths = G.prismOf(F, poly, xc - 14, xc + 14, P);
  // two clamp screws on each flat that faces the viewer
  const dots = [];
  for (let k = 0; k < 12; k++) {
    const d = dirOf(30 * k - phi);
    if (G.dot3(d, V) < 0.12) continue;
    for (const x of [xc - 7, xc + 7]) dots.push(at(G.add3([x, C0[1], C0[2]], G.mul3(d, 42))));
  }
  const hub = G.frameOf([xc - 14, C0[1], C0[2]], XHT, NHT, SHT);
  return S(paths, { tone: "hi", crease: "lo" }) + dotsSvg(dots, { size: 0.5, tone: "mid" });
}
function radialPrism(c, d, r0, r1, t0, t1, x0, x1) {
  const F = G.frameOf(c, XHT, d, G.cross3(XHT, d));
  return G.prismOf(F, [[r0, t0], [r1, t0], [r1, t1], [r0, t1]], x0, x1, P);
}
function toolsSvg(phi, active, drillFace) {
  const xc = REF.xc;
  const c = C0;
  const parts = [];
  for (const [kText, kind] of Object.entries(STATIONS)) {
    const k = Number(kText);
    const d = dirOf(30 * k - phi);
    const tang = G.cross3(XHT, d);
    const on = k === active;
    const key = (r, x) => G.dot3(G.add3([x, c[1], c[2]], G.mul3(d, r)), V);
    if (kind === "od" || kind === "thread" || kind === "cut") {
      parts.push({ k: key(38, xc - 19), svg: S(radialPrism(c, d, 30, 46, -6, 6, xc - 24, xc - 14), { tone: "mid" }) + dotsSvg([at(G.add3([xc - 19, c[1], c[2]], G.mul3(d, 33)))], { size: 0.5 }) });
      if (kind === "cut") {
        parts.push({ k: key(50, xc - 20) + 0.1, svg: S(radialPrism(c, d, 42, 58, -1, 1, xc - 24, xc - 16), { tone: "hi" }) });
      } else {
        parts.push({ k: key(49, xc - 20) + 0.1, svg: S(radialPrism(c, d, 44, 52, -3.5, 3.5, xc - 23, xc - 16), { tone: "mid" }) });
        const F = G.frameOf(c, XHT, d, tang);
        const insert = kind === "thread" ? [[51, -2.5], [56, 0], [51, 2.5]] : [[50, -3.2], [56, 0], [50, 3.2], [48.6, 0]];
        parts.push({ k: key(53, xc - 24) + 0.2, svg: S(G.prismOf(F, insert, xc - 26, xc - 22, P), { tone: "hi", crease: "lo" }) });
      }
      if (on) {
        // coolant nozzle on the holder, aimed at the tip
        const base = G.add3(G.add3([xc - 20, c[1], c[2]], G.mul3(d, 46)), G.mul3(tang, 6));
        const tip = G.add3([xc - 26, c[1], c[2]], G.mul3(d, 56));
        const aim = G.unit3(G.sub3(tip, base));
        const F = G.frameOf(base, aim, tang, G.cross3(aim, tang));
        parts.push({ k: G.dot3(base, V) + 0.3, svg: S(G.disc(0, 5, 1.1, F, P, { steps: 14 }), { tone: "mid" }) });
      }
    } else {
      // axial tools: a block on the face and a sleeve, then the drill or bar pointing at the chuck
      const o = G.add3([0, c[1], c[2]], G.mul3(d, 34));
      const F = G.frameOf(o, XHT, d, tang);
      parts.push({ k: key(34, xc - 18), svg: S(radialPrism(c, d, 25, 43, -8, 8, xc - 22, xc - 14), { tone: "mid" }) });
      parts.push({ k: key(34, xc - 25) + 0.1, svg: S(G.disc(xc - 30, xc - 22, 7, F, P, { steps: 28 }), { tone: "mid" }) + linesvg(G.arcOf(F, xc - 26, 7, P), "faint") });
      if (kind === "drill") {
        const tipX = xc - 54;
        const from = Math.max(tipX, drillFace ?? -1e9);
        const prof = from > tipX + 1.2 ? [[from, 2], [xc - 30, 2]] : [[tipX, 0.2], [tipX + 1.2, 2], [xc - 30, 2]];
        const flutes = G.ribsOf(F, Math.max(from, tipX + 1.4), xc - 34, 2, 2, P, { twist: 1.6, fade: [0.05, 0.5] });
        parts.push({ k: key(34, xc - 40) + 0.2, svg: S(G.solidOf(prof, F, P, { smooth: false }), { tone: "hi", inner: fadedSvg(flutes, { tone: "lo" }) }) });
      } else {
        const tipX = xc - 48;
        parts.push({ k: key(34, xc - 40) + 0.2, svg: S(G.solidOf([[tipX, 2.6], [xc - 30, 2.6]], F, P), { tone: "hi" }) });
        parts.push({ k: key(36, tipX) + 0.3, svg: S(radialPrism(o, d, 1.6, 4.4, -1.2, 1.2, tipX, tipX + 3), { tone: "hi" }) });
      }
    }
  }
  parts.sort((a, b) => a.k - b.k);
  return parts.map((p) => p.svg).join("");
}
const linesvg = (d, tone) => lineSvg(d, { tone });

// ---------- jaws: three master jaws with soft jaws, turning about the spindle axis ----------
const FAX = (u) => G.frameOf([0, 0, ZC], XHT, u, G.cross3(XHT, u));
function jawSvg(alpha, open, side) {
  const out = [];
  for (let j = 0; j < 3; j++) {
    const a = alpha + (j * 2 * Math.PI) / 3;
    const u = [0, Math.cos(a), Math.sin(a)];
    const front = G.dot3(u, V) > 0;
    if (front !== side) continue;
    const F = FAX(u);
    const master = G.prismOf(F, [[17 + open, -6], [40 + open, -6], [40 + open, 6], [17 + open, 6]], CH.x1, CH.x1 + 4, P);
    const soft = G.prismOf(F, [[12 + open, -5], [30 + open, -5], [30 + open, 5], [12 + open, 5]], CH.x1 + 4, CH.x1 + 12, P);
    const bolts = [20, 27].map((r) => at(G.add3([CH.x1 + 12, 0, ZC], G.mul3(u, r + open))));
    out.push({ k: G.dot3(G.add3([CH.x1 + 6, 0, ZC], G.mul3(u, 26)), V), svg: S(master, { tone: "mid" }) + S(soft, { tone: "hi", crease: "lo" }) + dotsSvg(bolts, { size: 0.5, tone: "mid" }) });
  }
  return out.sort((p, q) => p.k - q.k).map((p) => p.svg).join("");
}

// ---------- the work: a profile r(x) cut by the tool, drawn as a turned solid ----------
const X0 = 108, X1 = DD.LNC.STOCK_FACE, STEP = 0.2;
const NSAMP = Math.round((X1 - X0) / STEP) + 1;
const xs = Float64Array.from({ length: NSAMP }, (_, i) => X0 + i * STEP);
let prof = new Float64Array(NSAMP).fill(DD.LNC.STOCK_R);
let hole = 0; // drilled depth (world units)
let parts = 0;
let lastCut = null; // last tip sample { x, r, tool }
function cutTo(x, r) {
  for (let i = NSAMP - 1; i >= 0 && xs[i] >= x - 1e-6; i--) if (prof[i] > r) prof[i] = Math.max(0, r);
}
function sweep(a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.r - a.r) / 0.08));
  for (let i = 1; i <= n; i++) cutTo(a.x + ((b.x - a.x) * i) / n, a.r + ((b.r - a.r) * i) / n);
}
function freshBlank() { prof = new Float64Array(NSAMP).fill(DD.LNC.STOCK_R); hole = 0; lastCut = null; }
function applyCut(st) {
  const seg = st.seg;
  const tipX = DD.LNC.XF0 + st.Z / DD.LNC.U, tipR = st.X / 2 / DD.LNC.U;
  const here = { x: tipX, r: tipR, tool: st.tool, feed: st.moving === "feed" };
  if (lastCut && lastCut.tool === here.tool && here.feed && lastCut.feed !== undefined) {
    if (here.tool === 1) sweep(lastCut, here);
    if (here.tool === 3) hole = Math.max(hole, faceX() - tipX);
  }
  lastCut = here;
}
const faceX = () => { for (let i = NSAMP - 1; i >= 0; i--) if (prof[i] > 0.05) return xs[i]; return X0; };
function meridian() {
  // the end of each run of equal radius, then simplify the slopes (chamfer) with a tolerance
  const pts = [];
  let i = 0;
  while (i < NSAMP && prof[i] > 0.05) {
    pts.push([xs[i], prof[i]]);
    i++;
  }
  const end = pts.length ? pts[pts.length - 1][0] : X0;
  const simple = dp(pts, 0.06);
  return { pts: simple, end };
}
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = -1, bi = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / L;
    if (d > best) { best = d; bi = i; }
  }
  if (best <= eps) return [a, b];
  return [...dp(pts.slice(0, bi + 1), eps).slice(0, -1), ...dp(pts.slice(bi), eps)];
}
// grip section [108, 118] is drawn between the back and front jaws; the free section after the turret or before it
const FW = G.frameOf([0, 0, ZC], XHT, [0, 1, 0], [0, 0, 1]);
const GRIP_END = CH.x1 + 12;
function workSvg(shift, fade) {
  const { pts, end } = meridian();
  const free = pts.filter(([x]) => x >= GRIP_END - 1e-6);
  const out = { grip: "", free: "" };
  if (!pts.length) return out;
  const F = G.frameOf([shift, 0, ZC], XHT, [0, 1, 0], [0, 0, 1]);
  out.grip = S(G.solidOf([[X0, DD.LNC.STOCK_R], [GRIP_END, DD.LNC.STOCK_R]], F, P, { smooth: false }), { tone: "hi", lit: true });
  // meridian for the free part: hard steps where the radius jumps
  const m = [[GRIP_END, DD.LNC.STOCK_R]];
  let prev = DD.LNC.STOCK_R;
  for (const [x, r] of free) {
    const lastPt = m[m.length - 1];
    if (Math.abs(r - prev) > 3 * Math.max(0.05, x - lastPt[0]) && x - lastPt[0] > 0.05) m.push([x, prev]);
    m.push([x, r]);
    prev = r;
  }
  const clean = m.filter((p, i) => i === 0 || Math.abs(p[0] - m[i - 1][0]) > 1e-6 || Math.abs(p[1] - m[i - 1][1]) > 1e-6);
  let faceSvg = "";
  if (hole > 0.1) faceSvg = `<path class="lc-void" d="${G.circleOf(F, end, 2, P)}"/>` + lineSvg(G.circleOf(F, end, 2, P), { tone: "lo" });
  // split at vertical steps so every piece is convex, and draw them from the chuck outward (nearer each time)
  const pieces = [[clean[0]]];
  for (let i = 1; i < clean.length; i++) {
    if (Math.abs(clean[i][0] - clean[i - 1][0]) < 1e-6) pieces.push([clean[i]]);
    else pieces[pieces.length - 1].push(clean[i]);
  }
  const body = pieces.filter((pc) => pc.length > 1).map((pc) => S(G.solidOf(pc, F, P, { smooth: false }), { tone: "hi", lit: true })).join("");
  out.free = `<g${fade < 1 ? ` opacity="${fade.toFixed(3)}"` : ""}>` + body + faceSvg + "</g>";
  if (fade < 1) out.grip = `<g opacity="${fade.toFixed(3)}">${out.grip}</g>`;
  return out;
}

// ---------- chips and coolant ----------
const chips = [];
let chipClock = 0;
function spawnChips(dt, tip, rpm, feed) {
  if (still.matches || rpm < 50) return;
  chipClock += dt * (rpm / 1200) * (feed / 0.2);
  while (chipClock > 0.06) {
    chipClock -= 0.06;
    if (chips.length > 90) chips.shift();
    const spread = Math.random();
    chips.push({ p: [...tip], v: [-30 + Math.random() * 50, 60 + spread * 140, 40 + Math.random() * 120], age: 0, rot: Math.random() * 6.28, size: 0.6 + Math.random() * 0.9 });
  }
}
function stepChips(dt) {
  for (const c of chips) {
    c.age += dt;
    if (c.p[2] > 1.8) {
      c.v[2] -= 3924 * dt; // 9.81 m/s² in 2.5 mm units
      c.p = G.add3(c.p, G.mul3(c.v, dt));
      if (c.p[2] < 1.8) { c.p[2] = 1.8; c.v = [0, 0, 0]; }
    }
  }
  while (chips.length && chips[0].age > 6) chips.shift();
}
function chipsSvg() {
  return chips.map((c) => {
    const [x, y] = at(c.p);
    const s = c.size * 1.2, a = c.rot + c.age * 9 * (c.p[2] > 1.8 ? 1 : 0);
    const op = Math.min(1, (6 - c.age) / 1.5);
    return `<path class="lc-chip" opacity="${op.toFixed(2)}" d="M${(x + Math.cos(a) * s).toFixed(1)} ${(y + Math.sin(a) * s).toFixed(1)}Q${(x + Math.cos(a + 2) * s * 1.4).toFixed(1)} ${(y + Math.sin(a + 2) * s * 1.4).toFixed(1)} ${(x + Math.cos(a + 4) * s).toFixed(1)} ${(y + Math.sin(a + 4) * s).toFixed(1)}"/>`;
  }).join("");
}

// ---------- screen ----------
const SC = DD.screen;
function screenSvg(st, rpm) {
  const lines = [];
  const i = st.i;
  const rows = SC.rows ?? 5;
  const first = Math.max(0, Math.min(DD.program.length - rows, i - 1));
  const pitch = SC.pitch ?? 4.7;
  let y = SC.w0 + pitch;
  lines.push(`<text x="${SC.u0 + 2}" y="${y}" data-dim>O1234  AUTO ${hold ? "HOLD" : "RUN"}</text>`);
  y += pitch + 0.6;
  for (let j = first; j < first + rows; j++) {
    const on = j === i;
    if (on) lines.push(`<rect x="${SC.u0 + 1}" y="${(y - pitch * 0.74).toFixed(2)}" width="${SC.u1 - SC.u0 - 2}" height="${(pitch * 0.95).toFixed(2)}" rx=".5"/>`);
    lines.push(`<text x="${SC.u0 + 2}" y="${y.toFixed(2)}"${on ? " data-on" : ""}>${DD.program[j]}</text>`);
    y += pitch;
  }
  y += pitch * 0.3;
  const f = (v) => (v < 0 ? "-" : " ") + Math.abs(v).toFixed(3).padStart(7, " ");
  lines.push(`<text x="${SC.u0 + 2}" y="${y.toFixed(2)}">X${f(st.X)}  S${String(Math.round(rpm)).padStart(5, " ")}</text>`);
  y += pitch;
  lines.push(`<text x="${SC.u0 + 2}" y="${y.toFixed(2)}">Z${f(st.Z)}  T${String(st.tool).padStart(2, "0")}0${st.tool}</text>`);
  return lines.join("");
}

// ---------- the loop ----------
let clock = still.matches ? 30 : 0; // seconds into the cycle
let hold = false, holdUntilBlock = -1;
let frame = 0, last = 0, visible = false;
let rpmShown = 0, spinAngle = 0, phiBuilt = null, dFace = null, lastState = null, lastSay = "";
function stateNow() { return stateAt(TLN, clock); }
function replayTo(t) {
  freshBlank();
  for (let tt = 0; tt <= t; tt += 0.01) applyCut(stateAt(TLN, tt));
  applyCut(stateAt(TLN, t));
}
function place(st) {
  // slides
  for (const g of nodes) g.setAttribute("transform", shiftOf(st.D, st.xc, g.dataset.axis));
  // disc and tools at the turret's angle
  const active = DD.TOOLS[st.tool].station;
  const drilling = st.tool === 3;
  const fx = faceX();
  const key = `${st.phi.toFixed(2)}|${active}|${drilling ? (st.xc - 54 < fx ? fx.toFixed(2) : "out") : ""}`;
  if (key !== phiBuilt) {
    discNode.innerHTML = discSvg(st.phi);
    toolsNode.innerHTML = toolsSvg(st.phi, active, drilling ? fx - (st.xc - REF.xc) : null);
    phiBuilt = key;
  }
}
function render(dt, wdt) {
  const st = stateNow();
  const calm = still.matches;
  // spindle speed follows its command
  const target = interlocked() ? 0 : st.rpm;
  rpmShown = calm ? target : rpmShown + (target - rpmShown) * (1 - Math.exp(-dt / 0.35));
  spinAngle += dt * (rpmShown / 60) * 2 * Math.PI / 40;
  if (!calm || !lastState) applyCut(st);
  place(st);
  // load / unload
  let open = 0, shift = 0, fade = 1;
  if (st.load !== null) {
    const u = st.load;
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    open = 2.2 * (sm(0.13, 0.2, u) - sm(0.78, 0.84, u));
    if (u < 0.5) { shift = 70 * sm(0.22, 0.48, u); fade = 1 - sm(0.36, 0.49, u); }
    else {
      if (!st.reset) { freshBlank(); st.reset = true; }
      shift = 70 * (1 - sm(0.51, 0.76, u)); fade = sm(0.51, 0.62, u);
    }
  }
  const w = workSvg(shift, fade);
  // jaws and grip: back jaws, grip, front jaws
  jawsG.innerHTML = jawSvg(spinAngle, open, false) + w.grip + jawSvg(spinAngle, open, true);
  // order: the turret is in front of the work when its tool is clear of the face, or when drilling
  const tipX = DD.LNC.XF0 + st.Z / DD.LNC.U;
  const turretFront = st.tool === 3 || tipX >= faceX() - 0.6 || st.load !== null;
  workG.innerHTML = w.free;
  if (turretFront && stackG.firstChild !== workG) stackG.insertBefore(workG, turretG);
  if (!turretFront && stackG.firstChild !== turretG) stackG.insertBefore(turretG, workG);
  // coolant and chips
  let top = "";
  const tipW = [tipX, -st.X / 2 / DD.LNC.U * SQ, ZC + (st.X / 2 / DD.LNC.U) * SQ];
  if (st.coolant && st.tool === 1) {
    const c = PLT(st.xc - 20, st.D, HN), d = dirOf(0), tang = G.cross3(XHT, d);
    const base = G.add3(G.add3(c, G.mul3(d, 46)), G.mul3(tang, 6));
    const aim = G.unit3(G.sub3([tipX, tipW[1], tipW[2]], base));
    top += `<path class="lc-coolant" d="${pathOf([at(G.add3(base, G.mul3(aim, 5.4))), at(tipW)])}"/>`;
  }
  if (st.coolant && st.tool === 3) {
    const base = [st.xc - 30, 0, ZC + 11];
    top += `<path class="lc-coolant" d="${pathOf([at(base), at([Math.max(tipX, faceX()) + 0.5, 0, ZC + 2.5])])}"/>`;
  }
  if (st.moving === "feed" && st.tool === 1 && !hold && !interlocked()) spawnChips(dt, [tipX, tipW[1], tipW[2]], rpmShown, st.feed);
  if (st.moving === "feed" && st.tool === 3 && !hold && !interlocked()) spawnChips(dt * 0.6, [faceX() + 1, 0, ZC + 2], rpmShown, st.feed);
  stepChips(dt);
  top += chipsSvg();
  topG.innerHTML = top;
  // screen and keys
  screenG.innerHTML = screenSvg(st, rpmShown);
  if (hold) { holdKey.setAttribute("data-on", ""); startKey.removeAttribute("data-on"); } else { startKey.setAttribute("data-on", ""); holdKey.removeAttribute("data-on"); }
  placeDoor(st, wdt ?? dt);
  const word = st.load !== null ? "door open · loading the next blank" : interlocked() ? "door open · interlock" : st.seg.note ? st.seg.note : st.moving === "index" ? "turret indexing" : st.moving === "rapid" ? "rapid" : "";
  const text = `N${String(st.seg.n).padStart(2, "0")}${word ? " " + word : ""} · ${Math.round(rpmShown)} min⁻¹${hold && !interlocked() ? " · hold" : ""}`;
  if (readout.textContent !== text) readout.textContent = text;
  if (st.seg.n !== lastState?.seg.n) {
    const say = `Block ${st.seg.n}: ${st.seg.text}${st.seg.note ? ", " + st.seg.note : ""}`;
    if (hold && say !== lastSay) { status.textContent = say; lastSay = say; }
  }
  lastState = st;
}
// the door moves on wall time: the machine's own clock stands still while it waits for a part or is stopped
let lastWall = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const wall = window.performance.now();
  const wdt = lastWall ? Math.min((wall - lastWall) / 1000, 1 / 30) : 1 / 60;
  lastWall = wall;
  if (!hold && !interlocked() && !still.matches) {
    clock += dt;
    if (holdUntilBlock >= 0 && clock >= TLN.segs[holdUntilBlock].t1 - 1e-4) { clock = TLN.segs[holdUntilBlock].t1 - 1e-4; hold = true; holdUntilBlock = -1; }
    if (clock >= TOTAL) { clock = 0; parts++; freshBlank(); lastCut = null; }
  }
  render(dt, wdt);
  frame = visible ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; lastWall = 0; frame = requestAnimationFrame(tick); } };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); else { cancelAnimationFrame(frame); frame = 0; } }, { rootMargin: "120px 0px" }).observe(stage);

// ---------- the sliding door ----------
// The operator's door: the program opens it for the part change (M30); the reader can open it any time.
// Opened outside the part change it trips the interlock: the axes stop and the spindle runs down.
const doorG = svg.querySelector('[data-part="door"]');
const doorBtn = document.querySelector('[data-act="door"]');
const holdBtn = document.querySelector('[data-act="hold"]');
let doorWant = false; // the reader's choice
const door = { x: 0, v: 0 };
const loadDoor = (u) => { const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }; return sm(0, 0.12, u) - sm(0.87, 1, u); };
let coversOn = true;
const coversG = svg.querySelector('[data-part="covers"]');
const railsG = svg.querySelector('[data-part="rails"]');
const coversBtn = document.querySelector('[data-act="covers"]');
function interlocked() { return coversOn && (doorWant || (door.x > 0.02 && stateNow().load === null)); }
function toggleCovers() {
  coversOn = !coversOn;
  // lifting off: the door slides open first, then the guards lift away; put back, they drop on and the door closes
  if (!coversOn && !still.matches) { doorWant = true; setTimeout(() => coversOn || svg.toggleAttribute("data-covers-off", true), 700); }
  else svg.toggleAttribute("data-covers-off", !coversOn);
  if (coversOn) doorWant = false;
  coversBtn.textContent = coversOn ? "Covers off" : "Covers on";
  coversBtn.setAttribute("aria-pressed", String(!coversOn));
  doorBtn.disabled = !coversOn;
  status.textContent = coversOn ? "Covers on" : "Covers off: the inside of the lathe";
  render(0); run();
}
coversBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleCovers(); });
function placeDoor(st, dt) {
  const auto = st.load !== null ? loadDoor(st.load) : 0;
  const target = Math.max(auto, doorWant ? 1 : 0);
  if (still.matches || (st.load !== null && !doorWant)) { door.x = target; door.v = 0; }
  else {
    // a heavy door on rollers: critically damped, about 0.9 s end to end
    const w = 6.5;
    for (let i = 0; i < 4; i++) { door.v += (w * w * (target - door.x) - 2 * w * door.v) * (dt / 4); door.x += door.v * (dt / 4); }
    if (Math.abs(target - door.x) < 1e-4 && Math.abs(door.v) < 1e-4) { door.x = target; door.v = 0; }
  }
  const d = door.x * DD.door.travel;
  doorG.setAttribute("transform", d ? `translate(${(DD.door.shift[0] * d).toFixed(2)} ${(DD.door.shift[1] * d).toFixed(2)})` : "");
  const open = doorWant || door.x > 0.5;
  doorBtn.textContent = open ? "Close door" : "Open door";
  doorBtn.setAttribute("aria-pressed", String(doorWant));
  holdBtn.textContent = hold ? "Cycle start" : "Feed hold";
}
function toggleDoor() {
  doorWant = !doorWant;
  status.textContent = doorWant ? "Door open: interlock stops the axes and spindle" : "Door closed: cycle resumes";
  render(0); run();
}
doorBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleDoor(); });
holdBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleHold(); });
function toggleHold() { hold = !hold; holdUntilBlock = -1; status.textContent = hold ? "Feed hold" : "Cycle running"; render(0); }
function stepBlock(dir) {
  const st = stateNow();
  let i = st.i + dir;
  if (dir < 0 && clock - TLN.segs[st.i].t0 > 0.3) i = st.i;
  i = Math.max(0, Math.min(TLN.segs.length - 1, i));
  if (dir > 0) {
    // run the current block to its end, then stop: single block
    const cur = clock >= TLN.segs[st.i].t1 - 2e-4 ? Math.min(TLN.segs.length - 1, st.i + 1) : st.i;
    hold = false; holdUntilBlock = cur; if (still.matches) { clock = TLN.segs[cur].t1 - 1e-4; replayTo(clock); hold = true; holdUntilBlock = -1; }
  } else {
    clock = TLN.segs[i].t0 + 1e-4; replayTo(clock); hold = true; holdUntilBlock = -1;
  }
  render(0);
}
stage.addEventListener("click", () => { stage.focus({ preventScroll: true }); toggleHold(); });
stage.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggleHold(); }
  else if (event.key === "o" || event.key === "O") { event.preventDefault(); if (coversOn) toggleDoor(); }
  else if (event.key === "c" || event.key === "C") { event.preventDefault(); toggleCovers(); }
  else if (event.key === "ArrowRight") { event.preventDefault(); stepBlock(1); }
  else if (event.key === "ArrowLeft") { event.preventDefault(); stepBlock(-1); }
  else if (event.key === "Home") { event.preventDefault(); clock = 0; freshBlank(); hold = true; render(0); }
});
stage.addEventListener("focus", () => { status.textContent = `${hold ? "Feed hold" : "Cycle running"}, block ${stateNow().seg.n}`; });
if (still.matches) replayTo(clock);
render(1 / 60);
window.__lnc = { seek(t, h = true) { clock = t; replayTo(t); hold = h; render(0); }, get clock() { return clock; } };
})();
