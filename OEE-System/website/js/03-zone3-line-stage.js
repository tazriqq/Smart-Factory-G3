// 03-zone3-line-stage.js - ZONE 3 - isometric engine and the line stage (camera, controls, live status)
// was <script type="module">: wrapped so its names stay private, loaded with defer (same order)
(function () {
"use strict";
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
const GLSL_ISO = `precision highp float;
uniform vec2 uCanvas;
uniform vec2 uView;
uniform vec2 uOrigin;
uniform float uK;
uniform vec4 uCam;
uniform float uTime;
vec2 viewOf(vec2 frag){return vec2(frag.x,uCanvas.y-frag.y)*(uView.x/uCanvas.x);}
vec2 project(vec3 p){return uOrigin+uK*vec2(p.x*uCam.x-p.y*uCam.y,(p.x*uCam.y+p.y*uCam.x)*uCam.z-p.z*uCam.w);}
vec3 towardViewer(){return vec3(uCam.y*uCam.w,uCam.x*uCam.w,uCam.z);}
vec3 rayOf(vec2 vb){vec2 q=(vb-uOrigin)/uK;return vec3(q.x*uCam.x,-q.x*uCam.y,-q.y/uCam.w);}
float pixelOf(){return (uView.x/uCanvas.x)/uK;}
vec3 lightDir(){return normalize(vec3(-uCam.x,uCam.y,1.2));}
vec3 onFloor(vec2 vb,float h){vec2 q=(vb-uOrigin)/uK;float b=(q.y+h*uCam.w)/uCam.z;return vec3(q.x*uCam.x+b*uCam.y,-q.x*uCam.y+b*uCam.x,h);}
vec3 onWallY(vec2 vb,float y){vec2 q=(vb-uOrigin)/uK;float x=(q.x+y*uCam.y)/uCam.x;return vec3(x,y,((x*uCam.y+y*uCam.x)*uCam.z-q.y)/uCam.w);}
vec3 onWallX(vec2 vb,float x){vec2 q=(vb-uOrigin)/uK;float y=(x*uCam.x-q.x)/uCam.y;return vec3(x,y,((x*uCam.y+y*uCam.x)*uCam.z-q.y)/uCam.w);}
float hash12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float hash13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float noise2(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash12(i),hash12(i+vec2(1.,0.)),f.x),mix(hash12(i+vec2(0.,1.)),hash12(i+vec2(1.,1.)),f.x),f.y);}
float noise3(vec3 p){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.-2.*f);
  float a=mix(mix(hash13(i),hash13(i+vec3(1.,0.,0.)),f.x),mix(hash13(i+vec3(0.,1.,0.)),hash13(i+vec3(1.,1.,0.)),f.x),f.y);
  float b=mix(mix(hash13(i+vec3(0.,0.,1.)),hash13(i+vec3(1.,0.,1.)),f.x),mix(hash13(i+vec3(0.,1.,1.)),hash13(i+vec3(1.,1.,1.)),f.x),f.y);
  return mix(a,b,f.z);}
float fbm2(vec2 p){float s=0.;float a=.5;for(int i=0;i<4;i++){s+=a*noise2(p);p=p*2.07+vec2(17.1,9.2);a*=.5;}return s/.9375;}
float fbm3(vec3 p){float s=0.;float a=.5;for(int i=0;i<4;i++){s+=a*noise3(p);p=p*2.07+vec3(17.1,9.2,4.7);a*=.5;}return s/.9375;}
float window(float x,float a,float b,float soft){return smoothstep(a-soft,a+soft,x)*(1.-smoothstep(b-soft,b+soft,x));}
vec3 tonemap(vec3 c,float exposure){return 1.-exp(-c*exposure);}
`;

const GLSL_TURN = `uniform vec3 uGroupX;
uniform vec3 uGroupY;
uniform vec3 uGroupZ;
uniform vec3 uGroupT;
uniform vec3 uCoverEdge[60];
uniform float uCoverCount[6];
vec3 toGroup(vec3 p){vec3 q=p-uGroupT;return vec3(dot(q,uGroupX),dot(q,uGroupY),dot(q,uGroupZ));}
vec3 toWorld(vec3 g){return uGroupT+g.x*uGroupX+g.y*uGroupY+g.z*uGroupZ;}
vec3 dirToGroup(vec3 d){return vec3(dot(d,uGroupX),dot(d,uGroupY),dot(d,uGroupZ));}
vec3 dirToWorld(vec3 d){return d.x*uGroupX+d.y*uGroupY+d.z*uGroupZ;}
float coverOf(vec2 vb,float soft){float c=0.;for(int p=0;p<6;p++){float n=uCoverCount[p];float inside=-1e4;for(int e=0;e<10;e++){if(float(e)>=n)break;vec3 h=uCoverEdge[p*10+e];inside=max(inside,h.x*vb.x+h.y*vb.y+h.z);}if(n>0.)c=max(c,1.-smoothstep(-soft,soft,inside));}return c;}
`;

function glslPose(name, prefix = `u${name}`) {
  return `uniform vec3 ${prefix}X;uniform vec3 ${prefix}Y;uniform vec3 ${prefix}Z;uniform vec3 ${prefix}T;
vec3 to${name}(vec3 p){vec3 q=p-${prefix}T;return vec3(dot(q,${prefix}X),dot(q,${prefix}Y),dot(q,${prefix}Z));}
vec3 from${name}(vec3 g){return ${prefix}T+g.x*${prefix}X+g.y*${prefix}Y+g.z*${prefix}Z;}
vec3 dirTo${name}(vec3 d){return vec3(dot(d,${prefix}X),dot(d,${prefix}Y),dot(d,${prefix}Z));}
vec3 dirFrom${name}(vec3 d){return d.x*${prefix}X+d.y*${prefix}Y+d.z*${prefix}Z;}
`;
}

function glCamera(projection) {
  const a = ((projection.azimuth ?? 45) * Math.PI) / 180;
  const e = ((projection.elevation ?? 30) * Math.PI) / 180;
  return {
    origin: [projection.origin[0], projection.origin[1]],
    k: projection.scale * Math.sqrt(1.6),
    cam: [Math.sin(a), Math.cos(a), Math.sin(e), Math.cos(e)],
  };
}

const VERTEX = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

function glLayer({ canvas, fragment, view, camera, uniforms = [], fixed = {}, extensions = [], maxRatio = 1.5, onError = (message) => console.error(message) }) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    onError(gl.getShaderInfoLog(shader));
    return null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const enabled = extensions.filter((name) => gl.getExtension(name.replace(/^GL_/, "")));
  const fs = compile(gl.FRAGMENT_SHADER, enabled.map((name) => `#extension ${name} : enable\n`).join("") + GLSL_ISO + fragment);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    onError(gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const where = {};
  for (const name of ["uCanvas", "uView", "uOrigin", "uK", "uCam", "uTime", ...uniforms, ...Object.keys(fixed)]) where[name] = gl.getUniformLocation(program, name);
  const types = {};
  const active = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < active; index++) {
    const info = gl.getActiveUniform(program, index);
    if (info) types[info.name.replace(/\[0\]$/, "")] = info.type;
  }
  let painted = false;
  const fit = () => {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(maxRatio, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  const set = (name, value) => {
    const at = where[name];
    if (at === undefined || at === null) return;
    if (typeof value === "number") gl.uniform1f(at, value);
    else if (value.length > 4) {
      const data = value instanceof Float32Array ? value : new Float32Array(value);
      const type = types[name];
      if (type === gl.FLOAT_VEC2) gl.uniform2fv(at, data);
      else if (type === gl.FLOAT_VEC3) gl.uniform3fv(at, data);
      else if (type === gl.FLOAT_VEC4) gl.uniform4fv(at, data);
      else gl.uniform1fv(at, data);
    }
    else if (value.length === 1) gl.uniform1f(at, value[0]);
    else if (value.length === 2) gl.uniform2f(at, value[0], value[1]);
    else if (value.length === 3) gl.uniform3f(at, value[0], value[1], value[2]);
    else if (value.length === 4) gl.uniform4f(at, value[0], value[1], value[2], value[3]);
  };
  for (const [name, value] of Object.entries(fixed)) set(name, value);
  return {
    gl,
    extensions: enabled,
    set(values = {}) {
      for (const [name, value] of Object.entries(values)) set(name, value);
    },
    draw(values = {}, time = 0) {
      fit();
      gl.viewport(0, 0, canvas.width, canvas.height);
      set("uCanvas", [canvas.width, canvas.height]);
      set("uView", view);
      set("uOrigin", camera.origin);
      set("uK", camera.k);
      set("uCam", camera.cam);
      set("uTime", time);
      for (const [name, value] of Object.entries(values)) set(name, value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      painted = true;
    },
    clear() {
      if (!painted) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      painted = false;
    },
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const burst = (age, rise, fall) => (age > 0 ? smooth(0, rise, age) * Math.exp(-Math.max(0, age - rise) / fall) : 0);

function settle(state, target, dt, seconds, calm = false) {
  if (calm) {
    state.x = target;
    state.v = 0;
    return false;
  }
  const w = 1 / seconds;
  for (let index = 0; index < 4; index++) {
    const h = dt / 4;
    state.v += (w * w * (target - state.x) - 2 * w * state.v) * h;
    state.x += state.v * h;
  }
  if (Math.abs(target - state.x) < 1e-4 && Math.abs(state.v) < 1e-4) {
    state.x = target;
    state.v = 0;
    return false;
  }
  return true;
}

const DATA = {"W":640,"H":600,"P":{"origin":[320,397.0551023753576],"scale":0.8232484832234801,"azimuth":48,"elevation":30},"MACHINE":{"fullSteps":200,"micro":16,"lead":4,"stepsPerMm":800,"rapid":1000,"rpm":10000,"bit":3.175,"speedup":8,"limits":[[-130,130],[-90,90],[-3,40]]},"WOOD_TOP":96,"T0":106,"BED_TOP":84,"WOOD":{"x":-80,"y":-55,"w":160,"d":110,"r":1.2},"BED":{"x":-150,"y":-90,"w":300,"d":180,"r":2},"GY":-68,"XROD_Z":[175,225],"XSCREW_Z":200,"CW":35,"BLOCK":{"y0":-82,"y1":-56,"z0":163,"z1":237},"ZROD_Y":-35,"ZROD_DX":20,"BOT":{"y0":-46,"y1":-25,"z0":128,"z1":138},"ZCOUP":[242,262],"STACK":{"bit":14,"nut":[14,22],"chuck":[22,28],"nose":[28,32],"body":[32,92],"ring":[52,80],"cap":[92,95],"slide":[46,92]},"BODY_R":22,"UP_TOP":275,"CLIP_AT":[204,0,262],"PCB":{"x0":208,"x1":209.6,"y0":-100,"y1":-10,"z0":55,"z1":135},"SLIDE":{"x":28,"y0":-43,"y1":-27},"lines":["G21 G90 G17","G54","M3 S10000","G4 P1.5","G0 Z5","G0 X-58 Y-43","G1 Z-1.5 F150","G1 X58 F400","G3 X68 Y-33 I0 J10","G1 Y33","G3 X58 Y43 I-10 J0","G1 X-58","G3 X-68 Y33 I0 J-10","G1 Y-33","G3 X-58 Y-43 I10 J0","G0 Z3","G0 X-55 Y-30","G1 Z-2 F150","G0 Z3","G0 X55 Y-30","G1 Z-2 F150","G0 Z3","G0 X55 Y30","G1 Z-2 F150","G0 Z3","G0 X-55 Y30","G1 Z-2 F150","G0 Z3","G0 X31 Y0","G1 Z-1.5 F150","G1 X29.31 Y3.08 F400","G1 X24.92 Y5.3","G1 X19.52 Y6.34","G1 X15.1 Y6.72","G1 X12.99 Y7.5","G1 X13.37 Y9.71","G1 X15.26 Y13.74","G1 X17.04 Y18.93","G1 X17.32 Y23.84","G1 X15.5 Y26.85","G1 X11.99 Y26.92","G1 X7.87 Y24.23","G1 X4.27 Y20.08","G1 X1.73 Y16.44","G1 X0 Y15","G1 X-1.73 Y16.44","G1 X-4.27 Y20.08","G1 X-7.87 Y24.23","G1 X-11.99 Y26.92","G1 X-15.5 Y26.85","G1 X-17.32 Y23.84","G1 X-17.04 Y18.93","G1 X-15.26 Y13.74","G1 X-13.37 Y9.71","G1 X-12.99 Y7.5","G1 X-15.1 Y6.72","G1 X-19.52 Y6.34","G1 X-24.92 Y5.3","G1 X-29.31 Y3.08","G1 X-31 Y0","G1 X-29.31 Y-3.08","G1 X-24.92 Y-5.3","G1 X-19.52 Y-6.34","G1 X-15.1 Y-6.72","G1 X-12.99 Y-7.5","G1 X-13.37 Y-9.71","G1 X-15.26 Y-13.74","G1 X-17.04 Y-18.93","G1 X-17.32 Y-23.84","G1 X-15.5 Y-26.85","G1 X-11.99 Y-26.92","G1 X-7.87 Y-24.23","G1 X-4.27 Y-20.08","G1 X-1.73 Y-16.44","G1 X0 Y-15","G1 X1.73 Y-16.44","G1 X4.27 Y-20.08","G1 X7.87 Y-24.23","G1 X11.99 Y-26.92","G1 X15.5 Y-26.85","G1 X17.32 Y-23.84","G1 X17.04 Y-18.93","G1 X15.26 Y-13.74","G1 X13.37 Y-9.71","G1 X12.99 Y-7.5","G1 X15.1 Y-6.72","G1 X19.52 Y-6.34","G1 X24.92 Y-5.3","G1 X29.31 Y-3.08","G1 X31 Y0","G0 Z3","G0 X6 Y0","G1 Z-1.5 F150","G2 X-6 Y0 I-6 J0 F300","G2 X6 Y0 I6 J0","G0 Z10","M5","G0 X0 Y0","M30"],"blockD":["","","","","M320 301.5L320 306","M320 306L245.2 302.4","M245.2 302.4L245.2 308.3","M245.2 308.3L334.9 348.7","M334.9 348.7L336.1 349.1L337.4 349.5L338.8 349.8L340.2 349.9L341.7 350L343.2 350L344.6 349.8L346 349.6L347.4 349.2L348.6 348.8L349.6 348.3","M349.6 348.3L395.6 322.8","M395.6 322.8L396.5 322.2L397.3 321.5L397.8 320.8L398.2 320.1L398.3 319.4L398.2 318.6L397.9 317.9L397.4 317.2L396.7 316.5L395.9 315.9L394.8 315.4","M394.8 315.4L305.1 275","M305.1 275L303.9 274.5L302.6 274.2L301.2 273.9L299.8 273.7L298.3 273.7L296.8 273.7L295.4 273.8L294 274.1L292.6 274.4L291.4 274.9L290.4 275.4","M290.4 275.4L244.4 300.9","M244.4 300.9L243.5 301.5L242.7 302.1L242.2 302.8L241.8 303.6L241.7 304.3L241.8 305L242.1 305.8L242.6 306.5L243.3 307.1L244.1 307.7L245.2 308.3","M245.2 308.3L245.2 304.2","M245.2 304.2L256.5 300.2","M256.5 300.2L256.5 304.7","M256.5 304.7L256.5 300.2","M256.5 300.2L341.7 338.5","M341.7 338.5L341.7 343.1","M341.7 343.1L341.7 338.5","M341.7 338.5L383.5 315.3","M383.5 315.3L383.5 319.8","M383.5 319.8L383.5 315.3","M383.5 315.3L298.3 277","M298.3 277L298.3 281.5","M298.3 281.5L298.3 277","M298.3 277L344 318.6","M344 318.6L344 322.6","M344 322.6L344.8 320.9","M344.8 320.9L343 318.5","M343 318.5L339.5 316.2","M339.5 316.2L336.4 314.5","M336.4 314.5L335.3 313.5","M335.3 313.5L337.1 312.7","M337.1 312.7L341.4 311.8","M341.4 311.8L346.4 310.4","M346.4 310.4L350 308.6","M350 308.6L350.7 306.8","M350.7 306.8L348 305.6","M348 305.6L343 305.2","M343 305.2L337.3 305.6","M337.3 305.6L332.8 306.1","M332.8 306.1L330.5 306","M330.5 306L330.1 304.9","M330.1 304.9L330.7 302.6","M330.7 302.6L330.8 299.7","M330.8 299.7L329.5 297.2","M329.5 297.2L326.7 296","M326.7 296L323.2 296.6","M323.2 296.6L320 298.6","M320 298.6L317.8 301.2","M317.8 301.2L316.4 303.4","M316.4 303.4L315.2 304.4","M315.2 304.4L313 304","M313 304L309.3 302.6","M309.3 302.6L304.4 301.1","M304.4 301.1L299.5 300.4","M299.5 300.4L296 301","M296 301L295.2 302.8","M295.2 302.8L297 305.2","M297 305.2L300.5 307.5","M300.5 307.5L303.6 309.2","M303.6 309.2L304.7 310.2","M304.7 310.2L302.9 310.9","M302.9 310.9L298.6 311.8","M298.6 311.8L293.6 313.2","M293.6 313.2L290 315","M290 315L289.3 316.8","M289.3 316.8L292 318.1","M292 318.1L297 318.5","M297 318.5L302.7 318.1","M302.7 318.1L307.2 317.6","M307.2 317.6L309.5 317.6","M309.5 317.6L309.9 318.8","M309.9 318.8L309.3 321.1","M309.3 321.1L309.2 324","M309.2 324L310.5 326.4","M310.5 326.4L313.3 327.6","M313.3 327.6L316.8 327.1","M316.8 327.1L320 325.1","M320 325.1L322.2 322.5","M322.2 322.5L323.6 320.2","M323.6 320.2L324.8 319.3","M324.8 319.3L327 319.7","M327 319.7L330.7 321.1","M330.7 321.1L335.6 322.6","M335.6 322.6L340.5 323.2","M340.5 323.2L344 322.6","M344 322.6L344 318.6","M344 318.6L324.6 309.9","M324.6 309.9L324.6 313.9","M324.6 313.9L323.5 314.4L322.2 314.8L320.7 314.9L319.2 314.9L317.7 314.7L316.4 314.4L315.3 313.9L314.4 313.3L313.9 312.6L313.8 311.8L313.9 311.1L314.5 310.4L315.4 309.7","M315.4 309.7L316.5 309.2L317.8 308.9L319.3 308.7L320.8 308.7L322.3 308.9L323.6 309.3L324.7 309.8L325.6 310.4L326.1 311.1L326.2 311.9L326.1 312.6L325.5 313.3L324.6 313.9","M324.6 313.9L324.6 303.6","","M324.6 303.6L320 301.5",""],"zThreads":"M347.5 271.3L347.1 271.2L346.7 271.2L346.2 271.1L345.7 271L345.1 270.8L344.6 270.6L344.1 270.4L343.5 270.1L343 269.8L342.5 269.5L342 269.1L341.6 268.7L341.2 268.3L340.9 267.9L340.6 267.4L340.4 266.9L340.3 266.4L340.2 265.9M348.5 260.4L348.5 260.4L348.3 260.4L348.1 260.5L347.8 260.5L347.5 260.5M347.5 265.9L347.1 265.8L346.7 265.8L346.2 265.7L345.7 265.6L345.1 265.4L344.6 265.2L344.1 265L343.5 264.7L343 264.4L342.5 264.1L342 263.7L341.6 263.3L341.2 262.9L340.9 262.4L340.6 262L340.4 261.5L340.3 261L340.2 260.5M348.5 254.9L348.5 255L348.3 255L348.1 255L347.8 255.1L347.5 255M347.5 260.5L347.1 260.4L346.7 260.4L346.2 260.3L345.7 260.1L345.1 260L344.6 259.8L344.1 259.6L343.5 259.3L343 259L342.5 258.7L342 258.3L341.6 257.9L341.2 257.5L340.9 257L340.6 256.6L340.4 256.1L340.3 255.6L340.2 255.1M348.5 249.5L348.5 249.6L348.3 249.6L348.1 249.6L347.8 249.6L347.5 249.6M347.5 255L347.1 255L346.7 254.9L346.2 254.9L345.7 254.7L345.1 254.6L344.6 254.4L344.1 254.1L343.5 253.9L343 253.6L342.5 253.3L342 252.9L341.6 252.5L341.2 252.1L340.9 251.6L340.6 251.2L340.4 250.7L340.3 250.2L340.2 249.7M348.5 244.1L348.5 244.2L348.3 244.2L348.1 244.2L347.8 244.2L347.5 244.2M347.5 249.6L347.1 249.6L346.7 249.5L346.2 249.4L345.7 249.3L345.1 249.2L344.6 249L344.1 248.7L343.5 248.5L343 248.2L342.5 247.8L342 247.5L341.6 247.1L341.2 246.7L340.9 246.2L340.6 245.8L340.4 245.3L340.3 244.8L340.2 244.3M348.5 238.7L348.5 238.8L348.3 238.8L348.1 238.8L347.8 238.8L347.5 238.8M347.5 244.2L347.1 244.2L346.7 244.1L346.2 244L345.7 243.9L345.1 243.7L344.6 243.6L344.1 243.3L343.5 243.1L343 242.8L342.5 242.4L342 242.1L341.6 241.7L341.2 241.2L340.9 240.8L340.6 240.3L340.4 239.9L340.3 239.4L340.2 238.9M348.5 233.3L348.5 233.3L348.3 233.4L348.1 233.4L347.8 233.4L347.5 233.4M347.5 238.8L347.1 238.8L346.7 238.7L346.2 238.6L345.7 238.5L345.1 238.3L344.6 238.1L344.1 237.9L343.5 237.7L343 237.4L342.5 237L342 236.7L341.6 236.3L341.2 235.8L340.9 235.4L340.6 234.9L340.4 234.5L340.3 234L340.2 233.5M348.5 227.9L348.5 227.9L348.3 228L348.1 228L347.8 228L347.5 228M347.5 233.4L347.1 233.4L346.7 233.3L346.2 233.2L345.7 233.1L345.1 232.9L344.6 232.7L344.1 232.5L343.5 232.2L343 231.9L342.5 231.6L342 231.2L341.6 230.8L341.2 230.4L340.9 230L340.6 229.5L340.4 229L340.3 228.6L340.2 228.1M348.5 222.5L348.5 222.5L348.3 222.6L348.1 222.6L347.8 222.6L347.5 222.6M347.5 228L347.1 228L346.7 227.9L346.2 227.8L345.7 227.7L345.1 227.5L344.6 227.3L344.1 227.1L343.5 226.8L343 226.5L342.5 226.2L342 225.8L341.6 225.4L341.2 225L340.9 224.6L340.6 224.1L340.4 223.6L340.3 223.1L340.2 222.6M348.5 217.1L348.5 217.1L348.3 217.1L348.1 217.2L347.8 217.2L347.5 217.2M347.5 222.6L347.1 222.5L346.7 222.5L346.2 222.4L345.7 222.3L345.1 222.1L344.6 221.9L344.1 221.7L343.5 221.4L343 221.1L342.5 220.8L342 220.4L341.6 220L341.2 219.6L340.9 219.2L340.6 218.7L340.4 218.2L340.3 217.7L340.2 217.2M348.5 211.7L348.5 211.7L348.3 211.7L348.1 211.8L347.8 211.8L347.5 211.8M347.5 217.2L347.1 217.1L346.7 217.1L346.2 217L345.7 216.9L345.1 216.7L344.6 216.5L344.1 216.3L343.5 216L343 215.7L342.5 215.4L342 215L341.6 214.6L341.2 214.2L340.9 213.8L340.6 213.3L340.4 212.8L340.3 212.3L340.2 211.8M348.5 206.2L348.5 206.3L348.3 206.3L348.1 206.3L347.8 206.4L347.5 206.3M347.5 211.8L347.1 211.7L346.7 211.7L346.2 211.6L345.7 211.4L345.1 211.3L344.6 211.1L344.1 210.9L343.5 210.6L343 210.3L342.5 210L342 209.6L341.6 209.2L341.2 208.8L340.9 208.3L340.6 207.9L340.4 207.4L340.3 206.9L340.2 206.4M348.5 200.8L348.5 200.9L348.3 200.9L348.1 200.9L347.8 200.9L347.5 200.9M347.5 206.3L347.1 206.3L346.7 206.2L346.2 206.2L345.7 206L345.1 205.9L344.6 205.7L344.1 205.4L343.5 205.2L343 204.9L342.5 204.6L342 204.2L341.6 203.8L341.2 203.4L340.9 202.9L340.6 202.5L340.4 202L340.3 201.5L340.2 201M348.5 195.4L348.5 195.5L348.3 195.5L348.1 195.5L347.8 195.5L347.5 195.5M347.5 200.9L347.1 200.9L346.7 200.8L346.2 200.7L345.7 200.6L345.1 200.5L344.6 200.3L344.1 200L343.5 199.8L343 199.5L342.5 199.1L342 198.8L341.6 198.4L341.2 198L340.9 197.5L340.6 197.1L340.4 196.6L340.3 196.1L340.2 195.6M348.5 190L348.5 190.1L348.3 190.1L348.1 190.1L347.8 190.1L347.5 190.1M347.5 195.5L347.1 195.5L346.7 195.4L346.2 195.3L345.7 195.2L345.1 195.1L344.6 194.9L344.1 194.6L343.5 194.4L343 194.1L342.5 193.7L342 193.4L341.6 193L341.2 192.6L340.9 192.1L340.6 191.6L340.4 191.2L340.3 190.7L340.2 190.2M348.5 184.6L348.5 184.6L348.3 184.7L348.1 184.7L347.8 184.7L347.5 184.7M347.5 190.1L347.1 190.1L346.7 190L346.2 189.9L345.7 189.8L345.1 189.6L344.6 189.4L344.1 189.2L343.5 189L343 188.7L342.5 188.3L342 188L341.6 187.6L341.2 187.1L340.9 186.7L340.6 186.2L340.4 185.8L340.3 185.3L340.2 184.8M348.5 179.2L348.5 179.2L348.3 179.3L348.1 179.3L347.8 179.3L347.5 179.3M347.5 184.7L347.1 184.7L346.7 184.6L346.2 184.5L345.7 184.4L345.1 184.2L344.6 184L344.1 183.8L343.5 183.5L343 183.2L342.5 182.9L342 182.5L341.6 182.1L341.2 181.7L340.9 181.3L340.6 180.8L340.4 180.3L340.3 179.9L340.2 179.4M348.5 173.8L348.5 173.8L348.3 173.9L348.1 173.9L347.8 173.9L347.5 173.9M347.5 179.3L347.1 179.3L346.7 179.2L346.2 179.1L345.7 179L345.1 178.8L344.6 178.6L344.1 178.4L343.5 178.1L343 177.8L342.5 177.5L342 177.1L341.6 176.7L341.2 176.3L340.9 175.9L340.6 175.4L340.4 174.9L340.3 174.4L340.2 173.9M348.5 168.4L348.5 168.4L348.3 168.4L348.1 168.5L347.8 168.5L347.5 168.5M347.5 173.9L347.1 173.8L346.7 173.8L346.2 173.7L345.7 173.6L345.1 173.4L344.6 173.2L344.1 173L343.5 172.7L343 172.4L342.5 172.1L342 171.7L341.6 171.3L341.2 170.9L340.9 170.5L340.6 170L340.4 169.5L340.3 169L340.2 168.5M348.5 163L348.5 163L348.3 163L348.1 163.1L347.8 163.1L347.5 163.1M347.5 168.5L347.1 168.4L346.7 168.4L346.2 168.3L345.7 168.2L345.1 168L344.6 167.8L344.1 167.6L343.5 167.3L343 167L342.5 166.7L342 166.3L341.6 165.9L341.2 165.5L340.9 165.1L340.6 164.6L340.4 164.1L340.3 163.6L340.2 163.1M348.5 157.5L348.5 157.6L348.3 157.6L348.1 157.6L347.8 157.7L347.5 157.6M347.5 163.1L347.1 163L346.7 163L346.2 162.9L345.7 162.7L345.1 162.6L344.6 162.4L344.1 162.2L343.5 161.9L343 161.6L342.5 161.3L342 160.9L341.6 160.5L341.2 160.1L340.9 159.6L340.6 159.2L340.4 158.7L340.3 158.2L340.2 157.7M348.5 152.1L348.5 152.2L348.3 152.2L348.1 152.2L347.8 152.2L347.5 152.2M347.5 157.6L347.1 157.6L346.7 157.5L346.2 157.5L345.7 157.3L345.1 157.2L344.6 157L344.1 156.8L343.5 156.5L343 156.2L342.5 155.9L342 155.5L341.6 155.1L341.2 154.7L340.9 154.2L340.6 153.8L340.4 153.3L340.3 152.8L340.2 152.3M348.5 146.7L348.5 146.8L348.3 146.8L348.1 146.8L347.8 146.8L347.5 146.8","cam":{"sinA":0.7431448254773942,"cosA":0.6691306063588582,"sinE":0.49999999999999994,"cosE":0.8660254037844387,"k":1.0413361149060456}};
// The truth behind the figure: machine numbers, the G-code program and the executor.
// Shared by build.mjs (Node) and the live page (inlined with `export` stripped).

const MACHINE = {
  fullSteps: 200, // 1.8° NEMA 17 steppers
  micro: 16, // GRBL default microstepping on a 3018 board
  lead: 4, // T8 two-start lead screw: 2 mm pitch, 4 mm lead
  stepsPerMm: (200 * 16) / 4, // 800 steps per mm, GRBL $100-$102
  rapid: 1000, // mm/min, G0 max rate
  rpm: 10000, // 775 spindle at 24 V
  bit: 3.175, // 1/8" two-flute flat end mill
  speedup: 8, // the figure runs the program 8× faster than the machine would
  limits: [[-130, 130], [-90, 90], [-3, 40]], // work coordinates (mm) the axes may reach
};

// Work coordinates: X right, Y toward the back of the machine, Z up, zero at the centre of the board's top face.
function fmt(v) {
  const t = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return t === "-0" ? "0" : t;
}

function programLines() {
  const out = [];
  const say = (text) => out.push(text);
  say("G21 G90 G17");
  say("G54");
  say("M3 S10000");
  say("G4 P1.5");
  say("G0 Z5");
  // Border: a rounded rectangle, 136 × 86, corner radius 10
  const bx = 68, by = 43, r = 10;
  say(`G0 X${fmt(-bx + r)} Y${fmt(-by)}`);
  say("G1 Z-1.5 F150");
  say(`G1 X${fmt(bx - r)} F400`);
  say(`G3 X${fmt(bx)} Y${fmt(-by + r)} I0 J${fmt(r)}`);
  say(`G1 Y${fmt(by - r)}`);
  say(`G3 X${fmt(bx - r)} Y${fmt(by)} I${fmt(-r)} J0`);
  say(`G1 X${fmt(-bx + r)}`);
  say(`G3 X${fmt(-bx)} Y${fmt(by - r)} I0 J${fmt(-r)}`);
  say(`G1 Y${fmt(-by + r)}`);
  say(`G3 X${fmt(-bx + r)} Y${fmt(-by)} I${fmt(r)} J0`);
  say("G0 Z3");
  // Four drilled points inside the corners: Z alone does the work
  for (const [x, y] of [[-55, -30], [55, -30], [55, 30], [-55, 30]]) {
    say(`G0 X${fmt(x)} Y${fmt(y)}`);
    say("G1 Z-2 F150");
    say("G0 Z3");
  }
  // Six-petal rosette, r = 23 + 8·cos 6θ, as 60 straight moves
  const N = 60;
  const rose = (i) => {
    const t = (i / N) * Math.PI * 2;
    const rr = 23 + 8 * Math.cos(6 * t);
    return [rr * Math.cos(t), rr * Math.sin(t)];
  };
  const [x0, y0] = rose(0);
  say(`G0 X${fmt(x0)} Y${fmt(y0)}`);
  say("G1 Z-1.5 F150");
  for (let i = 1; i <= N; i++) {
    const [x, y] = rose(i);
    say(`G1 X${fmt(x)} Y${fmt(y)}${i === 1 ? " F400" : ""}`);
  }
  say("G0 Z3");
  // Centre ring, r 6, two clockwise half arcs
  say("G0 X6 Y0");
  say("G1 Z-1.5 F150");
  say("G2 X-6 Y0 I-6 J0 F300");
  say("G2 X6 Y0 I6 J0");
  say("G0 Z10");
  say("M5");
  say("G0 X0 Y0");
  say("M30");
  return out;
}

// Parse into blocks with true lengths and feeds.
function parseProgram(lines) {
  const blocks = [];
  let pos = [0, 0, 10];
  let feed = 400;
  let motion = 0;
  for (const text of lines) {
    const words = {};
    const gs = [];
    const ms = [];
    for (const m of text.toUpperCase().matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)) {
      const letter = m[1];
      const value = Number(m[2]);
      if (letter === "G") gs.push(value);
      else if (letter === "M") ms.push(value);
      else words[letter] = value;
    }
    if ("F" in words) feed = words.F;
    for (const g of gs) if ([0, 1, 2, 3].includes(g)) motion = g;
    const block = { text, kind: "none", from: [...pos], to: [...pos], feed, len: 0, time: 0 };
    if (gs.includes(4)) {
      block.kind = "dwell";
      block.time = words.P ?? 0;
    } else if (ms.includes(3) || ms.includes(5)) {
      block.kind = "spindle";
      block.rpm = ms.includes(3) ? words.S ?? MACHINE.rpm : 0;
    } else if (ms.includes(30)) {
      block.kind = "end";
    } else if ("X" in words || "Y" in words || "Z" in words) {
      const to = [words.X ?? pos[0], words.Y ?? pos[1], words.Z ?? pos[2]];
      block.to = to;
      if (motion === 0 || motion === 1) {
        block.kind = motion === 0 ? "rapid" : "line";
        block.feed = motion === 0 ? MACHINE.rapid : feed;
        block.len = Math.hypot(to[0] - pos[0], to[1] - pos[1], to[2] - pos[2]);
      } else {
        const cx = pos[0] + (words.I ?? 0);
        const cy = pos[1] + (words.J ?? 0);
        const r = Math.hypot(pos[0] - cx, pos[1] - cy);
        const a0 = Math.atan2(pos[1] - cy, pos[0] - cx);
        let a1 = Math.atan2(to[1] - cy, to[0] - cx);
        const cw = motion === 2;
        let sweep = a1 - a0;
        if (cw) { while (sweep >= -1e-9) sweep -= Math.PI * 2; }
        else { while (sweep <= 1e-9) sweep += Math.PI * 2; }
        block.kind = "arc";
        block.arc = { cx, cy, r, a0, sweep };
        block.len = Math.hypot(Math.abs(sweep) * r, to[2] - pos[2]);
      }
      if (block.len > 0) block.time = block.len / (block.feed / 60);
      pos = to;
    }
    blocks.push(block);
  }
  return blocks;
}

// Position inside a block after `d` mm (motion) or seconds (dwell).
function pointIn(block, d) {
  if (block.kind === "line" || block.kind === "rapid") {
    const t = block.len ? Math.min(1, d / block.len) : 1;
    return [0, 1, 2].map((i) => block.from[i] + (block.to[i] - block.from[i]) * t);
  }
  if (block.kind === "arc") {
    const t = block.len ? Math.min(1, d / block.len) : 1;
    const { cx, cy, r, a0, sweep } = block.arc;
    const a = a0 + sweep * t;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), block.from[2] + (block.to[2] - block.from[2]) * t];
  }
  return [...block.to];
}

// Dense points along a block, for drawing it.
function blockPoints(block, step = 1.5) {
  if (block.kind === "arc") {
    const n = Math.max(4, Math.ceil(block.len / step));
    return Array.from({ length: n + 1 }, (_, i) => pointIn(block, (block.len * i) / n));
  }
  if (block.kind === "line" || block.kind === "rapid") return [block.from, block.to];
  return [block.to];
}

// Advance the executor by dt seconds of machine time. Returns the events that happened.
function advance(state, blocks, dt) {
  const events = [];
  let guard = 0;
  while (dt > 1e-9 && state.i < blocks.length && guard++ < 400) {
    const b = blocks[state.i];
    if (b.kind === "line" || b.kind === "rapid" || b.kind === "arc" || b.kind === "dwell") {
      const total = b.kind === "dwell" ? b.time : b.len;
      const rate = b.kind === "dwell" ? 1 : b.feed / 60;
      const left = total - state.d;
      if (rate * dt >= left) {
        dt -= left / rate;
        state.d = 0;
        state.i += 1;
        events.push({ done: state.i - 1 });
        if (state.stopAfter !== undefined && state.i > state.stopAfter) { state.paused = true; dt = 0; }
      } else {
        state.d += rate * dt;
        dt = 0;
      }
    } else {
      if (b.kind === "spindle") events.push({ spindle: b.rpm });
      if (b.kind === "end") events.push({ end: true });
      state.d = 0;
      state.i += 1;
      events.push({ done: state.i - 1 });
      if (state.stopAfter !== undefined && state.i > state.stopAfter) { state.paused = true; dt = 0; }
    }
  }
  const b = blocks[Math.min(state.i, blocks.length - 1)];
  state.pos = state.i < blocks.length ? pointIn(b, state.d) : [...blocks[blocks.length - 1].to];
  return events;
}

// Spindle state at the start of block i (for jumps).
function spindleBefore(blocks, i) {
  let rpm = 0;
  for (let j = 0; j < i; j++) if (blocks[j].kind === "spindle") rpm = blocks[j].rpm;
  return rpm;
}

// Wood chips and dust: a small particle system in world millimetres, drawn as point sprites
// in the figure's own iso camera on two canvases (behind and in front of the spindle).
function makeChips({ stage, D, theme }) {
  const cam = D.cam; // { sinA, cosA, sinE, cosE, k }
  const view = [D.W, D.H];
  const origin = D.P.origin;
  const VIEW = [cam.cosA * cam.cosE, cam.sinA * cam.cosE, cam.sinE];
  const HV = (() => { const l = Math.hypot(cam.cosA, cam.sinA); return [cam.cosA / l, cam.sinA / l]; })();
  const GRAV = 4000; // mm/s², softened so the spray reads at screen scale
  const MAX = 900;
  const parts = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  const probe = (name) => {
    const raw = getComputedStyle(stage).getPropertyValue(name).trim();
    const m = raw.match(/^#([0-9a-f]{6})$/i);
    if (!m) return [0.85, 0.75, 0.6];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  const BODY = probe("--cnc-chip");
  const EDGE = probe("--cnc-chip-edge");

  const VERT = `
attribute vec3 aPos;
attribute vec4 aAttr;
uniform vec2 uView;
uniform vec2 uOrigin;
uniform vec2 uCanvas;
uniform float uK;
uniform vec4 uCam;
varying vec4 vAttr;
void main(){
  vec2 vb=uOrigin+uK*vec2(aPos.x*uCam.x-aPos.y*uCam.y,(aPos.x*uCam.y+aPos.y*uCam.x)*uCam.z-aPos.z*uCam.w);
  gl_Position=vec4(vb.x/uView.x*2.-1.,1.-vb.y/uView.y*2.,0.,1.);
  gl_PointSize=max(1.6,aAttr.x*uK*uCanvas.x/uView.x*2.2);
  vAttr=aAttr;
}`;
  const FRAG = `
precision mediump float;
uniform vec3 uBody;
uniform vec3 uEdge;
varying vec4 vAttr;
void main(){
  vec2 c=gl_PointCoord*2.-1.;
  float a=vAttr.w*6.2831;
  vec2 r=vec2(c.x*cos(a)+c.y*sin(a),-c.x*sin(a)+c.y*cos(a));
  float px=2./max(2.,vAttr.x*6.);
  if(vAttr.z>.5){
    // dust: a soft speck
    float d=length(c);
    float m=(1.-smoothstep(.15,1.,d))*vAttr.y*.55;
    gl_FragColor=vec4(mix(uEdge,uBody,.5)*m,m);
    return;
  }
  // chip: a curled flake, darker at its rim, lighter where its curl faces up
  r.y+=.35*r.x*r.x;
  float e=length(r/vec2(1.,.46));
  float body=1.-smoothstep(1.-px*1.6,1.,e);
  float shade=smoothstep(.95,.35,e)*(.55+.45*smoothstep(.4,-.6,r.y));
  vec3 col=mix(uEdge,uBody,shade);
  float m=body*vAttr.y;
  gl_FragColor=vec4(col*m,m);
}`;
  function layerOf(canvas) {
    if (!canvas || window.__noWebGL) return null;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    const aPos = gl.getAttribLocation(prog, "aPos"), aAttr = gl.getAttribLocation(prog, "aAttr");
    const U = (n) => gl.getUniformLocation(prog, n);
    gl.uniform2f(U("uView"), view[0], view[1]);
    gl.uniform2f(U("uOrigin"), origin[0], origin[1]);
    gl.uniform1f(U("uK"), cam.k);
    gl.uniform4f(U("uCam"), cam.sinA, cam.cosA, cam.sinE, cam.cosE);
    gl.uniform3f(U("uBody"), BODY[0], BODY[1], BODY[2]);
    gl.uniform3f(U("uEdge"), EDGE[0], EDGE[1], EDGE[2]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const uCanvas = U("uCanvas");
    let painted = false;
    return {
      draw(data, count) {
        const box = canvas.getBoundingClientRect();
        const ratio = Math.min(1.5, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(box.width * ratio)), h = Math.max(1, Math.round(box.height * ratio));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!count) { painted = false; return; }
        gl.uniform2f(uCanvas, w, h);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 7), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(aAttr);
        gl.vertexAttribPointer(aAttr, 4, gl.FLOAT, false, 28, 12);
        gl.drawArrays(gl.POINTS, 0, count);
        painted = true;
      },
      clear() { if (painted) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); painted = false; } },
    };
  }
  const back = layerOf(stage.querySelector('[data-gl-layer="back"]'));
  const front = back ? layerOf(stage.querySelector('[data-gl-layer="front"]')) : null;
  const gl = Boolean(back && front);
  if (gl) stage.setAttribute("data-gl", "");
  const bufBack = new Float32Array(MAX * 7), bufFront = new Float32Array(MAX * 7);

  // SVG fallback: two groups of small ellipses at the same slots in the stack
  const fbBack = stage.querySelector(".cnc-back .cnc-fallback");
  const fbFront = stage.querySelector(".cnc-mid .cnc-fallback");
  const iso3 = (x, y, z) => [origin[0] + (x * cam.sinA - y * cam.cosA) * cam.k, origin[1] + ((x * cam.cosA + y * cam.sinA) * cam.sinE - z * cam.cosE) * cam.k];

  const surface = (x, y, bedY) => {
    const lx = x, ly = y - bedY;
    if (lx >= D.WOOD.x && lx <= D.WOOD.x + D.WOOD.w && ly >= D.WOOD.y && ly <= D.WOOD.y + D.WOOD.d) return D.WOOD_TOP;
    if (lx >= D.BED.x && lx <= D.BED.x + D.BED.w && ly >= D.BED.y && ly <= D.BED.y + D.BED.d) return D.BED_TOP;
    return -Infinity;
  };

  return {
    gl,
    count: () => parts.length,
    // emit `n` chips and `dust` specks from the cutting edge at tip (world), the bit turning clockwise from above
    emit(tip, travel, n, dust) {
      const speed = Math.hypot(travel[0], travel[1]);
      const lead = speed > 1e-3 ? Math.atan2(travel[1], travel[0]) : rand() * Math.PI * 2;
      for (let i = 0; i < n + dust; i++) {
        if (parts.length >= MAX) {
          // recycle the oldest landed chip
          const j = parts.findIndex((q) => q.landed);
          if (j < 0) break;
          parts.splice(j, 1);
        }
        const isDust = i >= n;
        // the edge that is cutting faces the direction of travel; chips leave it tangentially (clockwise)
        const phi = lead + (rand() - 0.5) * Math.PI * 1.1;
        const R = 1.6;
        const tx = Math.sin(phi), ty = -Math.cos(phi);
        const u = (isDust ? 40 : 70) + rand() * (isDust ? 90 : 160);
        const out = 20 + rand() * 50;
        const up = (isDust ? 30 : 90) + rand() * (isDust ? 60 : 200);
        parts.push({
          p: [tip[0] + R * Math.cos(phi), tip[1] + R * Math.sin(phi), tip[2] + 0.4],
          v: [tx * u + Math.cos(phi) * out, ty * u + Math.sin(phi) * out, up],
          age: 0,
          life: isDust ? 0.7 + rand() * 0.9 : 9 + rand() * 6,
          size: isDust ? 0.45 + rand() * 0.4 : 0.8 + rand() * 1.0,
          dust: isDust,
          rot: rand(),
          spin: (rand() - 0.5) * 6,
          landed: false,
          fade: 1,
        });
      }
    },
    step(dt, bedY) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.age += dt;
        if (q.landed) {
          if (q.age > q.life) q.fade -= dt / 1.4;
          if (q.fade <= 0) parts.splice(i, 1);
          continue;
        }
        if (q.dust) {
          const drag = Math.exp(-dt * 7);
          q.v[0] *= drag; q.v[1] *= drag; q.v[2] = q.v[2] * drag + 6 * dt;
          q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
          if (q.age > q.life) parts.splice(i, 1);
          continue;
        }
        const drag = Math.exp(-dt * 1.6);
        q.v[0] *= drag; q.v[1] *= drag; q.v[2] = q.v[2] * drag - GRAV * dt;
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
        q.rot += q.spin * dt;
        const s = surface(q.p[0], q.p[1], bedY);
        if (q.p[2] <= s + q.size * 0.25) {
          if (q.v[2] < -160) { q.v[2] *= -0.22; q.v[0] *= 0.35; q.v[1] *= 0.35; q.p[2] = s + q.size * 0.25; }
          else { q.landed = true; q.p[2] = s + q.size * 0.25; q.p[1] -= bedY; q.age = 0; }
        } else if (q.p[2] < D.BED_TOP - 30) parts.splice(i, 1);
      }
    },
    // fade every landed chip out (a reset)
    sweep() { for (const q of parts) { q.landed ? (q.life = Math.min(q.life, q.age)) : (q.life = 0); } },
    clearAll() { parts.length = 0; },
    draw(bedY, axisX) {
      let nb = 0, nf = 0;
      const fb = [], ff = [];
      for (const q of parts) {
        const x = q.p[0], y = q.landed ? q.p[1] + bedY : q.p[1], z = q.p[2];
        let alpha = q.dust ? Math.max(0, 1 - q.age / q.life) * Math.min(1, q.age * 8) : q.fade;
        if (!q.landed && !q.dust && z < D.BED_TOP) alpha *= Math.max(0, 1 - (D.BED_TOP - z) / 25);
        if (alpha <= 0.01) continue;
        const ahead = (x - axisX) * HV[0] + y * HV[1] > 0 && y > -30;
        if (gl) {
          const buf = ahead ? bufFront : bufBack;
          const o = (ahead ? nf++ : nb++) * 7;
          buf[o] = x; buf[o + 1] = y; buf[o + 2] = z;
          buf[o + 3] = q.size; buf[o + 4] = alpha; buf[o + 5] = q.dust ? 1 : 0; buf[o + 6] = q.rot;
        } else if (!q.dust && (ahead ? ff.length : fb.length) < 260) {
          const [sx, sy] = iso3(x, y, z);
          const r = q.size * cam.k * 0.45;
          (ahead ? ff : fb).push(`<ellipse class="cnc-chip" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" rx="${r.toFixed(2)}" ry="${(r * 0.55).toFixed(2)}" opacity="${alpha.toFixed(2)}" transform="rotate(${((q.rot * 360) % 360).toFixed(0)} ${sx.toFixed(1)} ${sy.toFixed(1)})"/>`);
        }
      }
      if (gl) { back.draw(bufBack, nb); front.draw(bufFront, nf); }
      else {
        if (fbBack) fbBack.innerHTML = fb.join("");
        if (fbFront) fbFront.innerHTML = ff.join("");
      }
    },
  };
}

// ───────────────────────── live page ─────────────────────────
const D = DATA;
const P = D.P;
const M = D.MACHINE;
const stage = document.querySelector(".cnc-stage");
const plate = stage.closest(".iso-plate");
const readout = plate.querySelector("[data-readout]");
const sr = stage.querySelector(".cnc-sr");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const THEME = document.body.dataset.theme || "dark";
const blocks = parseProgram(D.lines);
const $ = (sel, root = stage) => root.querySelector(sel);
const $$ = (sel, root = stage) => [...root.querySelectorAll(sel)];
const f2 = (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace("-", "−");
const fmtInt = (v) => Math.round(v).toLocaleString("en-US").replace("-", "−");
const wrap = (v, m) => ((v % m) + m) % m;

// parts we move
const bedG = $('[data-part="bed"]');
const carBack = $('[data-part="carBack"]');
const carA = $('[data-part="carA"]');
const carB = $('[data-part="carB"]');
const slideG = $('[data-part="slide"]');
const spindleG = $('[data-part="spindle"]');
const nearClip = $("[data-near]");
const threadsX = $$('[data-thread="x"]');
const threadY = $('[data-thread="y"]');
const zClip = { lo: $('[data-zclip="lo"]'), hi: $('[data-zclip="hi"]') };
const zThread = { lo: $('[data-zthread="lo"]'), hi: $('[data-zthread="hi"]') };
for (const g of Object.values(zThread)) g.innerHTML = `<path class="iso-line" data-tone="lo" d="${D.zThreads}"/>`;
const spinDots = $(".cnc-spin-dots");
const setScrews = { x: $('.cnc-setscrews[data-axis="x"]'), y: $('.cnc-setscrews[data-axis="y"]'), z: $('.cnc-setscrews[data-axis="z"]') };
const groovePaths = { cut: $(".cnc-groove-cut"), wall: $(".cnc-groove-wall"), floor: $(".cnc-groove-floor") };
const workG = $(".cnc-work");
const nextPath = $(".cnc-next");
const target = $(".cnc-target");
const hang = { z: $('[data-hang="z"]'), spindle: $('[data-hang="spindle"]') };
const hangEnds = $(".cnc-hang-ends");
const pulses = { x: $$('.cnc-cable[data-axis="x"] .cb-pulse'), y: $$('.cnc-cable[data-axis="y"] .cb-pulse'), z: $$('.cnc-cable[data-axis="z"] .cb-pulse'), spindle: $$('.cnc-cable[data-axis="spindle"] .cb-pulse') };
const leds = Object.fromEntries($$(".cnc-led").map((el) => [el.dataset.led, el]));
const live = Object.fromEntries($$("[data-live]").map((g) => [g.dataset.live, g]));
const codeItems = $$(".cnc-code li", plate);
const codeList = $(".cnc-code", plate);
const status = { spindle: $('[data-s="spindle"]', plate), feed: $('[data-s="feed"]', plate), steps: $('[data-s="steps"]', plate) };
const playBtn = $('[data-act="play"]', plate);
status.state = $('[data-s="state"]', plate);
status.temp = $('[data-s="temp"]', plate);
const modeBtns = $$(".cnc-mode button", plate);
const urlInput = $("#cnc-ws", plate);
const connEl = $(".cnc-conn", plate);
const hintEl = $('[data-corner="hint"]', plate);
const hintSim = hintEl ? hintEl.textContent : "";
const motors = Object.fromEntries($$(".cnc-motor").map((g) => [g.dataset.axis, g]));
const axisBtns = $$(".cnc-axis", plate);

// wall and lip of the groove sit a little toward and away from the viewer, in work millimetres
{
  const far = [-Math.cos((P.azimuth * Math.PI) / 180), Math.sin((P.azimuth * Math.PI) / 180)]; // world (-cosA,-sinA) as work (X, -y)
  groovePaths.wall.setAttribute("transform", `translate(${(far[0] * 1.12).toFixed(3)} ${(far[1] * 1.12).toFixed(3)})`);
  groovePaths.floor.setAttribute("transform", `translate(${(-far[0] * 0.55).toFixed(3)} ${(-far[1] * 0.55).toFixed(3)})`);
}

function setSolid(g, paths) {
  if (!g) return;
  const kids = g.children;
  kids[0].setAttribute("d", paths.fill);
  for (let i = 0; i < 4; i++) kids[1 + i].setAttribute("d", paths.shades[i] || "");
  kids[5].setAttribute("d", paths.top || "");
  kids[6].setAttribute("d", paths.crease || "");
  kids[7].setAttribute("d", paths.outline);
}
const vcyl = (x, y, r, z0, z1, steps = 20) => cylinder(x, y, r, z0, Math.max(0.01, z1 - z0), P, steps);
const iso3 = (p) => iso(p, P);
const V = [D.cam.cosA * D.cam.cosE, D.cam.sinA * D.cam.cosE, D.cam.sinE];
function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const pathD = (pts, closed) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + (closed ? "Z" : "");

// ───────────────────────── state ─────────────────────────
const exec = { i: 0, d: 0, pos: [0, 0, 10], paused: false };
const act = [0, 0, 10]; // where the axes really are, work mm
const prev = [0, 0, 10];
const enabled = { x: true, y: true, z: true };
let jog = null; // a repositioning move after a jump: raise, travel, lower
let running = !still.matches;
let touring = !still.matches;
let finishedAt = -1;
let lastTouch = -1e9;
let clock = 0;
const spin = { rpm: 0, target: 0, x: 0, v: 0, angle: 0 };
const pulsePhase = { x: 0, y: 0, z: 0, spindle: 0 };
const rate = { x: 0, y: 0, z: 0 };
const rateShown = { x: 0, y: 0, z: 0 };
let rxAt = -1;
let lastLine = -1;
let feedNow = 0;

// carving record, in work coordinates
let grooveD = "";
let cutting = false;
let lastCut = null;
const WOODX = [D.WOOD.x, D.WOOD.x + D.WOOD.w];
const WOODY = [-(D.WOOD.y + D.WOOD.d), -D.WOOD.y];

const chips = makeChips({ stage, D, theme: THEME });

// ───────────────────────── geometry per frame ─────────────────────────
function place(dt) {
  const [X, Y, Z] = act;
  const T = D.WOOD_TOP + Z;
  bedG.setAttribute("transform", translateAlong(P, [0, Y, 0]));
  const tx = translateAlong(P, [X, 0, 0]);
  carBack.setAttribute("transform", tx);
  carA.setAttribute("transform", tx);
  carB.setAttribute("transform", tx);
  const tz = translateAlong(P, [X, 0, T - D.T0]);
  slideG.setAttribute("transform", tz);
  spindleG.setAttribute("transform", tz);

  // X rods to the right of the carriage are nearer than it: redraw that span on top
  {
    const x0 = X + D.CW, x1 = 205;
    const pts = [];
    for (const x of [x0, x1]) for (const y of [D.GY - 7, D.GY + 7]) for (const z of [D.XROD_Z[0] - 7, D.XROD_Z[1] + 7]) pts.push(iso3([x, y, z]));
    nearClip.setAttribute("d", pathD(hull(pts), true));
  }
  // screws: the thread pattern slides with the nut it drives
  for (const g of threadsX) g.setAttribute("transform", translateAlong(P, [wrap(X, 6) - 3, 0, 0]));
  threadY.setAttribute("transform", translateAlong(P, [0, wrap(Y, 6) - 3, 0]));

  // Z rods and screw: below and above the slide
  const s0 = T + D.STACK.slide[0], s1 = T + D.STACK.slide[1];
  const zb = D.BOT.z1, zt = D.ZCOUP[0];
  setSolid(live["zrod-l-lo"], vcyl(X - D.ZROD_DX, D.ZROD_Y, 4, zb, s0));
  setSolid(live["zrod-r-lo"], vcyl(X + D.ZROD_DX, D.ZROD_Y, 4, zb, s0));
  const scLo = vcyl(X, D.ZROD_Y, 4, zb, s0);
  setSolid(live["zscrew-lo"], scLo);
  setSolid(live["zrod-l-hi"], vcyl(X - D.ZROD_DX, D.ZROD_Y, 4, s1, 262));
  setSolid(live["zrod-r-hi"], vcyl(X + D.ZROD_DX, D.ZROD_Y, 4, s1, 262));
  const scHi = vcyl(X, D.ZROD_Y, 4, s1, zt);
  setSolid(live["zscrew-hi"], scHi);
  zClip.lo.setAttribute("d", scLo.fill);
  zClip.hi.setAttribute("d", scHi.fill);
  const zt3 = translateAlong(P, [X, 0, wrap(Z, 6) - 3]);
  zThread.lo.setAttribute("transform", zt3);
  zThread.hi.setAttribute("transform", zt3);

  // the end mill: it disappears into the cut below the surface
  const overWood = X >= WOODX[0] && X <= WOODX[1] && Y >= WOODY[0] && Y <= WOODY[1];
  const bitLow = overWood ? Math.max(T, D.WOOD_TOP) : T;
  setSolid(live.bit, vcyl(X, 0, 1.6, bitLow, T + D.STACK.bit, 14));

  // spinning: two marks on the collet nut, and the coupler set screws turning with their screws
  {
    const zc = T + 18;
    const out = [];
    for (const off of [0, Math.PI]) {
      const a = spin.angle + off;
      const n = [Math.cos(a), Math.sin(a), 0];
      const f = n[0] * V[0] + n[1] * V[1];
      if (f > 0.1) {
        const [sx, sy] = iso3([X + 8.6 * n[0], 8.6 * n[1], zc]);
        out.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r=".9" opacity="${Math.min(1, (f - 0.1) * 3).toFixed(2)}"/>`);
      }
    }
    spinDots.innerHTML = out.join("");
  }
  const screws = (axis, o, a, u, v, ss, turn) => {
    const out = [];
    for (const s of ss) for (const off of [0, Math.PI]) {
      const ang = turn + off;
      const n = [u[0] * Math.cos(ang) + v[0] * Math.sin(ang), u[1] * Math.cos(ang) + v[1] * Math.sin(ang), u[2] * Math.cos(ang) + v[2] * Math.sin(ang)];
      const f = n[0] * V[0] + n[1] * V[1] + n[2] * V[2];
      if (f <= 0.1) continue;
      const p = [o[0] + a[0] * s + n[0] * 9.6, o[1] + a[1] * s + n[1] * 9.6, o[2] + a[2] * s + n[2] * 9.6];
      const [sx, sy] = iso3(p);
      out.push(`<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r=".75" opacity="${Math.min(1, (f - 0.1) * 3).toFixed(2)}"/>`);
    }
    setScrews[axis].innerHTML = out.join("");
  };
  const turns = (mm) => (mm / M.lead) * Math.PI * 2;
  screws("x", [0, D.GY, D.XSCREW_Z], [1, 0, 0], [0, 1, 0], [0, 0, 1], [173.5, 186.5], turns(X));
  screws("y", [0, 0, 54], [0, 1, 0], [0, 0, 1], [1, 0, 0], [181.5, 194.5], turns(Y));
  screws("z", [X, D.ZROD_Y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [245.5, 258.5], turns(Z));

  // cables that hang from the clip on the upright to the carriage
  const bez = (p0, p1, p2, p3, n = 28) => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [0, 1, 2].map((j) => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j]);
  });
  const c = D.CLIP_AT;
  const zEnd = [X + 10, -5.6, 301];
  const zPts = bez([c[0], -4, 266], [c[0], -4, 330], [zEnd[0] + 20, 40, 316], zEnd);
  const sEnd = [X + 9, 0, T + D.STACK.cap[1] + 7];
  const sPts = bez([c[0], 0.5, 266], [c[0] - 4, 0.5, 336], [sEnd[0] + 10, 18, sEnd[2] + 60], sEnd);
  const zd = pathD(zPts.map(iso3)), sd = pathD(sPts.map(iso3));
  for (const p of hang.z.children) p.setAttribute("d", zd);
  for (const p of hang.spindle.children) p.setAttribute("d", sd);
  const [ex, ey] = iso3(sEnd);
  hangEnds.innerHTML = `<rect class="cnc-spade" x="${(ex - 1.8).toFixed(1)}" y="${(ey - 3.4).toFixed(1)}" width="3.6" height="3.6" rx=".6"/>`;

  // the move the controller is executing now, drawn on the board
  const b = blocks[Math.min(exec.i, blocks.length - 1)];
  const moving = exec.i < blocks.length && (b.kind === "line" || b.kind === "rapid" || b.kind === "arc");
  nextPath.setAttribute("d", moving ? D.blockD[exec.i] : "");
  nextPath.setAttribute("data-kind", moving ? b.kind : "");
  if (moving) {
    const [sx, sy] = iso3([b.to[0], -b.to[1], D.WOOD_TOP + b.to[2]]);
    target.setAttribute("transform", `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    target.style.opacity = "1";
  } else target.style.opacity = "0";
}

// ───────────────────────── program control ─────────────────────────
function say(text) { sr.textContent = text; }
function syncButtons() {
  playBtn.textContent = running && !exec.paused ? "❚❚" : "▶";
  playBtn.setAttribute("aria-label", running && !exec.paused ? "Pause" : "Run");
  for (const b of axisBtns) {
    const a = b.dataset.axis;
    b.setAttribute("aria-pressed", String(enabled[a]));
    b.querySelector("span").textContent = enabled[a] ? "on" : "off";
  }
  stage.setAttribute("data-off", Object.keys(enabled).filter((a) => !enabled[a]).join(" "));
}
function touch() { touring = false; lastTouch = clock; }
function play() {
  if (exec.i >= blocks.length) restart();
  delete exec.stopAfter;
  exec.paused = false;
  running = true;
  if (still.matches) runInstant();
  syncButtons();
  kick();
}
function pause() { running = false; syncButtons(); }
function stepLine() {
  if (exec.i >= blocks.length) return;
  exec.stopAfter = exec.i;
  exec.paused = false;
  running = true;
  if (still.matches) runInstant();
  syncButtons();
  kick();
}
function backLine() {
  running = false;
  exec.paused = true;
  if (exec.d > 0.01 && exec.i < blocks.length) exec.d = 0;
  else exec.i = Math.max(0, exec.i - 1), (exec.d = 0);
  exec.pos = [...blocks[exec.i].from];
  startJog();
  syncButtons();
  kick();
}
function startJog() { jog = { stage: 0 }; }
function restart() {
  exec.i = 0; exec.d = 0; exec.pos = [0, 0, 10]; delete exec.stopAfter;
  spin.target = 0;
  finishedAt = -1;
  startJog();
  clearBoard();
}
function clearBoard() {
  if (!grooveD) { chips.sweep(); return; }
  workG.classList.add("cnc-fading");
  chips.sweep();
  setTimeout(() => {
    grooveD = "";
    lastCut = null;
    for (const p of Object.values(groovePaths)) p.setAttribute("d", "");
    workG.classList.remove("cnc-fading");
  }, 950);
}
function toggleAxis(a) {
  enabled[a] = !enabled[a];
  say(`${a.toUpperCase()} axis ${enabled[a] ? "on" : "off"}`);
  syncButtons();
  kick();
}
function runInstant() {
  // reduced motion: finish the requested lines at once
  let guard = 0;
  while (running && !exec.paused && exec.i < blocks.length && guard++ < 5000) {
    const before = exec.i;
    const events = advance(exec, blocks, 0.05);
    handleEvents(events);
    for (let a = 0; a < 3; a++) if (enabled["xyz"[a]]) act[a] = exec.pos[a];
    carve(true);
    if (exec.i === before && exec.paused) break;
  }
  if (exec.i >= blocks.length) running = false;
  if (exec.paused) running = false;
  spin.x = spin.target / M.rpm;
}
function handleEvents(events) {
  for (const e of events) {
    if (e.spindle !== undefined) spin.target = e.spindle;
    if (e.end) { finishedAt = clock; running = false; say("program finished"); }
  }
}

// ───────────────────────── carving ─────────────────────────
function carve(force = false) {
  const [X, Y, Z] = act;
  const inWood = X >= WOODX[0] - 1.6 && X <= WOODX[1] + 1.6 && Y >= WOODY[0] - 1.6 && Y <= WOODY[1] + 1.6;
  const now = inWood && Z < -0.05 && (spin.x > 0.4 || force);
  if (now) {
    const p = [X, Y];
    if (!cutting || !lastCut) {
      grooveD += `M${X.toFixed(2)} ${Y.toFixed(2)}L${(X + 0.01).toFixed(2)} ${Y.toFixed(2)}`;
      lastCut = p;
    } else if (Math.hypot(p[0] - lastCut[0], p[1] - lastCut[1]) > 0.35) {
      grooveD += `L${X.toFixed(2)} ${Y.toFixed(2)}`;
      lastCut = p;
    }
  }
  cutting = now;
}
let shownGroove = "";
function paintGroove() {
  if (grooveD === shownGroove) return;
  shownGroove = grooveD;
  for (const p of Object.values(groovePaths)) p.setAttribute("d", grooveD);
}

// ───────────────────────── readout, listing, signals ─────────────────────────
let shownText = "";
function report(dt) {
  const n = mode === "live" ? Math.min(blocks.length, Math.max(1, wire.line)) - 1 : Math.min(exec.i, blocks.length - 1);
  const text = `${mode === "live" ? "live · " : ""}line ${n + 1} · X ${f2(act[0])} Y ${f2(act[1])} Z ${f2(act[2])}`;
  if (text !== shownText) { readout.textContent = text; shownText = text; }
  if (n !== lastLine) {
    for (let i = 0; i < codeItems.length; i++) {
      codeItems[i].toggleAttribute("data-now", i === n);
      codeItems[i].toggleAttribute("data-done", i < n);
    }
    codeList.style.transform = `translateY(${-n * 20}px)`;
    lastLine = n;
    rxAt = clock;
  }
  const rpm = mode === "live" ? wire.rpm : Math.round(spin.x * M.rpm / 10) * 10;
  const st = mode === "live" ? (wire.has && clock - wire.at < 2.5 ? wire.state : "idle") : (running && !exec.paused) || jog ? "run" : "idle";
  if (stage.dataset.state !== st) {
    stage.dataset.state = st;
    status.state.textContent = mode === "live" && wire.has && clock - wire.at >= 2.5 ? "no data" : st;
    status.state.dataset.state = st;
    if (st === "alarm") say("alarm");
  }
  if (mode === "live" && wire.has && clock - wire.at >= 2.5 && status.state.textContent !== "no data") status.state.textContent = "no data";
  status.spindle.textContent = `S ${fmtInt(rpm)} rpm`;
  status.feed.textContent = `F ${fmtInt(feedNow)} mm/min`;
  for (const a of "xyz") {
    rateShown[a] += (rate[a] - rateShown[a]) * (1 - Math.exp(-dt / 0.12));
    if (rate[a] === 0 && rateShown[a] < 8) rateShown[a] = 0;
  }
  status.steps.textContent = `pulses X ${fmtInt(rateShown.x)}/s · Y ${fmtInt(rateShown.y)}/s · Z ${fmtInt(rateShown.z)}/s`;

  // step pulses run along each motor cable; faster and denser with the step rate
  for (const a of ["x", "y", "z"]) {
    const r = rateShown[a];
    pulsePhase[a] -= dt * (12 + Math.min(90, r * 0.012));
    const o = Math.min(1, r / 300);
    for (const p of pulses[a]) { p.style.strokeDashoffset = pulsePhase[a].toFixed(2); p.style.opacity = o.toFixed(2); }
    leds[a].toggleAttribute("data-on", r > 30);
  }
  pulsePhase.spindle -= dt * 20 * spin.x;
  for (const p of pulses.spindle) { p.style.strokeDashoffset = pulsePhase.spindle.toFixed(2); p.style.opacity = (spin.x * 0.8).toFixed(2); }
  leds.power.toggleAttribute("data-on", true);
  leds.rx.toggleAttribute("data-on", clock - rxAt < 0.12);
}

// ───────────────────────── live mode: machine state over a WebSocket ─────────────────────────
// Each message: {"x","y","z" (work mm), "rpm", "feed" (mm/min), "state": idle|run|alarm, "line" (1-based), "temp": {"x","y","z"} (°C)}
let mode = "sim";
let ws = null;
let retry = 0;
let gen = 0;
const wire = { has: false, target: [0, 0, 10], rpm: 0, feed: 0, state: "idle", line: 1, temp: null, at: -1e9, count: 0 };
const STATES = new Set(["idle", "run", "alarm"]);
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
function setConn(kind, text) { connEl.dataset.conn = kind; connEl.textContent = text; }
function accept(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m !== "object") return;
  for (let a = 0; a < 3; a++) {
    const lim = M.limits[a];
    wire.target[a] = Math.min(lim[1], Math.max(lim[0], num(m["xyz"[a]], wire.target[a])));
  }
  wire.rpm = Math.max(0, num(m.rpm, wire.rpm));
  wire.feed = Math.max(0, num(m.feed, wire.feed));
  if (STATES.has(m.state)) wire.state = m.state;
  wire.line = Math.round(num(m.line, wire.line));
  if (m.temp && typeof m.temp === "object") wire.temp = { x: num(m.temp.x, NaN), y: num(m.temp.y, NaN), z: num(m.temp.z, NaN) };
  if (!wire.has) { act[0] = wire.target[0]; act[1] = wire.target[1]; act[2] = wire.target[2]; }
  wire.has = true;
  wire.at = clock;
  wire.count++;
  kick();
}
function connect() {
  if (window.__cncExternal) { setConn("on", "potentiometers"); return; }
  const my = ++gen;
  const url = urlInput.value.trim() || "ws://localhost:8080";
  setConn("wait", `connecting to ${url}`);
  try { ws = new WebSocket(url); } catch (e) { setConn("err", `can't open ${url}`); return; }
  ws.addEventListener("open", () => { if (my !== gen) return; retry = 0; setConn("on", "connected"); say("live machine connected"); });
  ws.addEventListener("message", (e) => { if (my === gen && typeof e.data === "string") accept(e.data); });
  ws.addEventListener("close", () => {
    if (my !== gen || mode !== "live") return;
    const wait = Math.min(8, 1 + retry++ * 1.5);
    setConn("err", `no connection · retrying in ${wait.toFixed(0)} s`);
    setTimeout(() => { if (my === gen && mode === "live") connect(); }, wait * 1000);
  });
}
function disconnect() {
  gen++;
  if (ws) { try { ws.close(); } catch {} ws = null; }
}
function setMode(next) {
  if (next === mode) return;
  mode = next;
  stage.dataset.mode = mode;
  for (const b of modeBtns) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  const simOnly = $$(".cnc-axes button, .cnc-run button:not([data-act=reset])", plate);
  for (const b of simOnly) b.disabled = mode === "live";
  if (mode === "live") {
    running = false; touring = false; jog = null;
    wire.has = false; wire.count = 0; wire.temp = null;
    clearBoard();
    if (hintEl) hintEl.textContent = "Live machine";
    connect();
    say("live mode");
  } else {
    disconnect();
    setConn("off", "simulated");
    if (hintEl) hintEl.textContent = hintSim;
    for (const g of Object.values(motors)) { g.style.removeProperty("--heat"); g.style.removeProperty("--heat-col"); }
    status.temp.textContent = "";
    exec.paused = true; running = false;
    spin.target = spindleBefore(blocks, exec.i);
    startJog();
    lastTouch = clock;
    say("simulation");
  }
  syncButtons();
  kick();
}
// motor temperature as a warm tint: none at 30 °C, amber toward red by 75 °C
function heatOf(t) {
  if (!Number.isFinite(t)) return null;
  const f = Math.min(1, Math.max(0, (t - 30) / 45));
  const amber = [240, 160, 48], red = [229, 72, 77];
  const c = amber.map((v, i) => Math.round(v + (red[i] - v) * f));
  return { pct: `${(f * 60).toFixed(0)}%`, col: `rgb(${c.join(",")})` };
}
function paintLive() {
  if (!wire.temp) return;
  const parts = [];
  for (const a of "xyz") {
    const h = heatOf(wire.temp[a]);
    const g = motors[a];
    if (h) { g.style.setProperty("--heat", h.pct); g.style.setProperty("--heat-col", h.col); parts.push(`${a.toUpperCase()} ${Math.round(wire.temp[a])}°`); }
  }
  status.temp.textContent = parts.length ? `motors ${parts.join(" · ")} C` : "";
}

// ───────────────────────── loop ─────────────────────────
let frame = 0, last = 0, visible = false;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;

  // idle tour: keep the program running; restart it a few seconds after it finishes
  if (mode === "sim" && !calm && !touring && clock - lastTouch > 14 && (!running || exec.paused)) touring = true;
  if (touring && !running && exec.i < blocks.length && finishedAt < 0) { running = true; exec.paused = false; delete exec.stopAfter; syncButtons(); }
  if (touring && finishedAt >= 0 && clock - finishedAt > 2.6) { restart(); running = true; exec.paused = false; syncButtons(); }

  // the controller: run the program in machine time
  const mdt = mode === "live" ? dt : dt * M.speedup;
  if (mode === "sim" && running && !exec.paused && !jog) {
    const events = advance(exec, blocks, mdt);
    handleEvents(events);
    if (exec.paused) { running = false; syncButtons(); }
  }
  const b = blocks[Math.min(exec.i, blocks.length - 1)];
  const progressing = running && !exec.paused && !jog && exec.i < blocks.length;
  feedNow = progressing && (b.kind === "line" || b.kind === "rapid" || b.kind === "arc") ? b.feed : 0;
  if (mode === "live") { feedNow = wire.feed; spin.target = wire.rpm; }

  // the axes: follow the controller exactly while enabled; a switched-off axis holds where it is
  prev[0] = act[0]; prev[1] = act[1]; prev[2] = act[2];
  const vmax = (M.rapid / 60) * M.speedup * dt;
  if (mode === "live") {
    // the machine is the truth: ease between messages so 10–20 Hz updates move smoothly
    const k = 1 - Math.exp(-dt / 0.07);
    for (let a = 0; a < 3; a++) act[a] += (wire.target[a] - act[a]) * k;
  } else if (jog) {
    // after a jump: raise, travel, lower
    const cmd = exec.pos;
    const safe = Math.max(3, cmd[2]);
    const moveTo = (a, v) => { if (!enabled["xyz"[a]]) return true; const d = v - act[a]; if (Math.abs(d) <= vmax) { act[a] = v; return true; } act[a] += Math.sign(d) * vmax; return false; };
    if (jog.stage === 0) { if (act[2] >= safe - 1e-6 || !enabled.z || moveTo(2, safe)) jog.stage = 1; }
    else if (jog.stage === 1) { const a = moveTo(0, cmd[0]); const c = moveTo(1, cmd[1]); if (a && c) jog.stage = 2; }
    else if (moveTo(2, cmd[2])) jog = null;
  } else {
    for (let a = 0; a < 3; a++) {
      if (!enabled["xyz"[a]]) continue;
      const d = exec.pos[a] - act[a];
      act[a] = Math.abs(d) <= vmax ? exec.pos[a] : act[a] + Math.sign(d) * vmax;
    }
  }
  for (let a = 0; a < 3; a++) {
    const lim = M.limits[a];
    act[a] = Math.min(lim[1], Math.max(lim[0], act[a]));
  }
  // step rates in real machine time (pulses per second at the driver)
  for (let a = 0; a < 3; a++) rate["xyz"[a]] = (Math.abs(act[a] - prev[a]) / Math.max(mdt, 1e-6)) * M.stepsPerMm;

  // spindle spins up and down on a critically damped envelope
  const spinning = settle(spin, spin.target / M.rpm, dt, mode === "live" ? 0.15 : 0.35, calm);
  spin.angle += dt * Math.PI * 2 * 2.2 * spin.x;

  // carving and chips
  const wasCutting = cutting;
  carve();
  paintGroove();
  if (!calm && cutting && spin.x > 0.4) {
    const travel = [(act[0] - prev[0]) / dt, -(act[1] - prev[1]) / dt];
    const plunge = Math.max(0, (prev[2] - act[2]) / dt);
    const sp = Math.hypot(travel[0], travel[1]);
    const n = (sp * 0.45 + plunge * 1.0 + 3) * dt;
    const whole = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
    const dust = Math.random() < (sp * 0.8 + plunge + 8) * dt ? 3 : 0;
    // tip in world: the tool is at world y = 0, the board under it at work Y
    chips.emit([act[0], 0, D.WOOD_TOP], travel, whole, dust);
  }
  chips.step(calm ? 0 : dt, act[1]);
  chips.draw(act[1], act[0]);

  place(dt);
  report(dt);

  if (mode === "live") paintLive();
  const settled = mode === "sim" && !running && !jog && !spinning && chips.count() === 0 && !touring && rateShown.x < 1 && rateShown.y < 1 && rateShown.z < 1;
  frame = visible && !(settled && clock - rxAt > 0.2) ? requestAnimationFrame(tick) : 0;
}
function kick() { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } }
new IntersectionObserver((entries) => { visible = true; kick(); }, { rootMargin: "120px 0px" }).observe(stage);

// ───────────────────────── input ─────────────────────────
plate.addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (!btn) return;
  if (btn.dataset.mode) { setMode(btn.dataset.mode); return; }
  touch();
  if (mode === "live") { if (btn.dataset.act === "reset") { clearBoard(); say("board cleared"); } return; }
  if (btn.dataset.axis) toggleAxis(btn.dataset.axis);
  const act2 = btn.dataset.act;
  if (act2 === "play") (running && !exec.paused ? pause : play)();
  if (act2 === "next") stepLine();
  if (act2 === "prev") backLine();
  if (act2 === "reset") { pause(); restart(); syncButtons(); kick(); say("board reset"); }
});
for (const b of axisBtns) {
  b.addEventListener("pointerenter", () => stage.setAttribute("data-focus", b.dataset.axis));
  b.addEventListener("pointerleave", () => stage.removeAttribute("data-focus"));
  b.addEventListener("focus", () => stage.setAttribute("data-focus", b.dataset.axis));
  b.addEventListener("blur", () => stage.removeAttribute("data-focus"));
}
stage.addEventListener("click", () => { if (mode === "live") return; touch(); (running && !exec.paused ? pause : play)(); });
stage.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (mode === "live") return;
  let used = true;
  if (key === " " || key === "enter") (running && !exec.paused ? pause : play)();
  else if (key === "arrowright") stepLine();
  else if (key === "arrowleft") backLine();
  else if (key === "x" || key === "y" || key === "z") toggleAxis(key);
  else if (key === "r" || key === "home") { pause(); restart(); syncButtons(); }
  else used = false;
  if (used) { event.preventDefault(); touch(); kick(); }
});
stage.addEventListener("focus", () => say(`line ${Math.min(exec.i, blocks.length - 1) + 1} of ${blocks.length}, ${running ? "running" : "paused"}`));

if (still.matches) {
  // one still frame: the finished carving
  running = true;
  spin.target = 0;
  runInstant();
  running = false;
  exec.paused = true;
}
urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && mode === "live") { disconnect(); connect(); } });
stage.dataset.mode = mode;
syncButtons();
place(0);
report(0);
paintGroove();
window.cnc = { setMode, accept: (m) => accept(JSON.stringify(m)), limits: M.limits, mode: () => mode, status: () => ({ pos: act.slice(), spindle: spin.x }) };
})();
