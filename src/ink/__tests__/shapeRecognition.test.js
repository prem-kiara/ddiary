/**
 * Shape recognition tests.
 *
 * Every fixture is drawn the way a hand actually draws — with wobble, with the
 * corners rounded off, and (for closed shapes) not quite meeting at the start.
 * A recogniser that only works on mathematically perfect input is useless.
 */
import { describe, it, expect } from 'vitest';
import { recognizeShape, _internal } from '../shapeRecognition.js';

const { moments, roundness } = _internal;

/** Deterministic jitter so the tests never flake. */
function noise(seed) {
  let s = seed;
  return (amp) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return ((s / 0x7fffffff) - 0.5) * 2 * amp;
  };
}

/** Walk a list of corners, emitting jittered points along each edge. */
function drawPath(corners, { perEdge = 24, wobble = 1.6, seed = 5, close = true } = {}) {
  const j = noise(seed);
  const pts = [];
  const list = close ? [...corners, corners[0]] : corners;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge;
      pts.push({
        x: a[0] + (b[0] - a[0]) * t + j(wobble),
        y: a[1] + (b[1] - a[1]) * t + j(wobble),
        p: 0.5,
      });
    }
  }
  const last = list[list.length - 1];
  pts.push({ x: last[0] + j(wobble), y: last[1] + j(wobble), p: 0.5 });
  return { points: pts };
}

function drawCircle({ cx = 200, cy = 200, r = 90, n = 120, wobble = 2.5, seed = 9, arc = 1 } = {}) {
  const j = noise(seed);
  const pts = [];
  for (let i = 0; i <= n * arc; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(t) + j(wobble), y: cy + r * Math.sin(t) + j(wobble), p: 0.5 });
  }
  return { points: pts };
}

/** Interior angles of a closed polygon point list (last point repeats first). */
function cornerAngles(points) {
  const p = points.slice(0, -1);
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    const v1 = Math.atan2(a.y - b.y, a.x - b.x);
    const v2 = Math.atan2(c.y - b.y, c.x - b.x);
    let d = Math.abs((v1 - v2) * 180 / Math.PI) % 360;
    if (d > 180) d = 360 - d;
    out.push(d);
  }
  return out;
}

describe('roundness scalar', () => {
  it('is ~0 for a straight line and ~1 for a circle', () => {
    const line = { points: Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: 100, p: 0.5 })) };
    expect(roundness(moments(line.points))).toBeLessThan(0.001);

    const circle = drawCircle({ wobble: 0 });
    expect(roundness(moments(circle.points))).toBeGreaterThan(0.99);
  });

  it('is scale and rotation invariant', () => {
    const small = drawCircle({ cx: 0, cy: 0, r: 20, wobble: 0 });
    const big   = drawCircle({ cx: 900, cy: -400, r: 400, wobble: 0 });
    expect(roundness(moments(small.points)))
      .toBeCloseTo(roundness(moments(big.points)), 3);
  });
});

describe('lines', () => {
  it('recognises a wobbly line and returns exactly two points', () => {
    const s = drawPath([[40, 300], [400, 302]], { perEdge: 60, wobble: 2, close: false });
    const r = recognizeShape(s);
    expect(r?.kind).toBe('line');
    expect(r.points).toHaveLength(2);
  });

  it('snaps a near-horizontal line to exactly horizontal', () => {
    const s = drawPath([[40, 300], [400, 308]], { perEdge: 60, wobble: 1.2, close: false });
    const r = recognizeShape(s);
    expect(r.kind).toBe('line');
    expect(r.points[0].y).toBeCloseTo(r.points[1].y, 6);
  });

  it('snaps a near-vertical line to exactly vertical', () => {
    const s = drawPath([[200, 40], [207, 400]], { perEdge: 60, wobble: 1.2, close: false });
    const r = recognizeShape(s);
    expect(r.kind).toBe('line');
    expect(r.points[0].x).toBeCloseTo(r.points[1].x, 6);
  });

  it('leaves a deliberately diagonal line alone (no false snapping)', () => {
    const s = drawPath([[40, 40], [400, 400]], { perEdge: 60, wobble: 1.2, close: false });
    const r = recognizeShape(s);
    expect(r.kind).toBe('line');
    expect(Math.abs(r.points[0].y - r.points[1].y)).toBeGreaterThan(100);
  });
});

describe('circles', () => {
  it('recognises a hand-drawn circle', () => {
    const r = recognizeShape(drawCircle({ wobble: 3 }));
    expect(r?.kind).toBe('circle');
  });

  it('produces points equidistant from its own centre', () => {
    const r = recognizeShape(drawCircle({ cx: 200, cy: 200, r: 90, wobble: 3 }));
    // Measure from the recognised centre, not the drawn one — wobble shifts the
    // centroid by ~1px, which is expected and not an error in the shape.
    // Exclude the duplicated closing point, which would otherwise pull the mean
    // off-centre by r/n and manufacture an apparent ~2px radius spread.
    const ring = r.points.slice(0, -1);
    const cx = ring.reduce((a, p) => a + p.x, 0) / ring.length;
    const cy = ring.reduce((a, p) => a + p.y, 0) / ring.length;
    const radii = r.points.map(p => Math.hypot(p.x - cx, p.y - cy));
    const min = Math.min(...radii), max = Math.max(...radii);
    expect(max - min).toBeLessThan(0.01);      // exactly circular
    expect(min).toBeGreaterThan(70);
    expect(min).toBeLessThan(110);
    // ...and centred close to where it was actually drawn.
    expect(Math.hypot(cx - 200, cy - 200)).toBeLessThan(6);
  });

  it('rejects an open arc (not a closed shape)', () => {
    expect(recognizeShape(drawCircle({ arc: 0.55, wobble: 2 }))?.kind).not.toBe('circle');
  });
});

describe('rectangles', () => {
  const rect = (seed = 3, wobble = 2.5) =>
    drawPath([[60, 60], [360, 66], [356, 260], [58, 254]], { perEdge: 26, wobble, seed });

  it('recognises a wobbly rectangle', () => {
    expect(recognizeShape(rect())?.kind).toBe('rectangle');
  });

  it('forces the corners to exactly 90°', () => {
    const r = recognizeShape(rect());
    for (const a of cornerAngles(r.points)) expect(a).toBeCloseTo(90, 4);
  });

  it('returns a closed path', () => {
    const r = recognizeShape(rect());
    const first = r.points[0], last = r.points[r.points.length - 1];
    expect(first.x).toBeCloseTo(last.x, 6);
    expect(first.y).toBeCloseTo(last.y, 6);
  });

  it('keeps a deliberately rotated rectangle rotated', () => {
    const ang = 28 * Math.PI / 180;
    const rot = ([x, y]) => [
      200 + (x - 200) * Math.cos(ang) - (y - 160) * Math.sin(ang),
      160 + (x - 200) * Math.sin(ang) + (y - 160) * Math.cos(ang),
    ];
    const s = drawPath([[60, 60], [360, 60], [360, 260], [60, 260]].map(rot),
                       { perEdge: 26, wobble: 2, seed: 11 });
    const r = recognizeShape(s);
    expect(r?.kind).toBe('rectangle');
    for (const a of cornerAngles(r.points)) expect(a).toBeCloseTo(90, 4);
    // Must NOT have been snapped upright.
    const edge = Math.atan2(r.points[1].y - r.points[0].y, r.points[1].x - r.points[0].x);
    expect(Math.abs(edge % (Math.PI / 2))).toBeGreaterThan(0.05);
  });
});

describe('triangles', () => {
  it('recognises a hand-drawn triangle with straight sides', () => {
    const s = drawPath([[200, 50], [360, 300], [40, 296]], { perEdge: 30, wobble: 2.5, seed: 7 });
    const r = recognizeShape(s);
    expect(r?.kind).toBe('triangle');
    expect(r.points).toHaveLength(4);          // 3 corners + closure
    for (const a of cornerAngles(r.points)) {
      expect(a).toBeGreaterThan(15);
      expect(a).toBeLessThan(150);
    }
  });
});

describe('false positives that destroy ink (regression)', () => {
  /** Largest distance from any input sample to the emitted outline. */
  const residual = (input, out) => {
    const seg = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    let worst = 0;
    for (const p of input.points) {
      let best = Infinity;
      for (let i = 1; i < out.points.length; i++) best = Math.min(best, seg(p, out.points[i-1], out.points[i]));
      worst = Math.max(worst, best);
    }
    return worst;
  };

  it('does not turn a square box into a circle', () => {
    // roundness() is exactly 1.0 for a square — identical to a circle — and a
    // square's *mean* radial deviation also slips under the circle gate. Only
    // the residual check separates them.
    const sq = drawPath([[60, 60], [260, 60], [260, 260], [60, 260]], { perEdge: 26, wobble: 2, seed: 4 });
    expect(recognizeShape(sq)?.kind).not.toBe('circle');
  });

  it('handles boxes across the aspect ratios that used to flip to a circle', () => {
    for (const w of [200, 220, 250, 280, 300]) {
      const box = drawPath([[60, 60], [60 + w, 60], [60 + w, 260], [60, 260]],
                           { perEdge: 24, wobble: 2, seed: 6 });
      const r = recognizeShape(box);
      expect(r?.kind, `box ${w}×200`).not.toBe('circle');
    }
  });

  it('does not amputate an arrowhead by collapsing the arrow to a line', () => {
    // 240px shaft + a 24px head at 30°: roundness 0.0069, well inside the line gate.
    const arrow = drawPath([[60, 200], [300, 200], [279, 188]], { perEdge: 40, wobble: 1, close: false, seed: 8 });
    const r = recognizeShape(arrow);
    if (r) expect(residual(arrow, r)).toBeLessThan(30);
    expect(r?.points?.length === 2 && r.kind === 'line').toBe(false);
  });

  it('does not flatten a square bracket into a line', () => {
    const bracket = drawPath([[100, 60], [82, 60], [82, 260], [100, 260]], { perEdge: 30, wobble: 1, close: false, seed: 12 });
    const r = recognizeShape(bracket);
    expect(r?.kind).not.toBe('line');
  });

  it('does not replace a capital U with a triangle', () => {
    const u = drawPath([[40, 40], [40, 150], [90, 168], [140, 150], [140, 40]],
                       { perEdge: 22, wobble: 1.2, close: false, seed: 14 });
    const r = recognizeShape(u);
    expect(['triangle', 'quadrilateral']).not.toContain(r?.kind);
  });

  it('never emits a corner far outside the stroke it came from', () => {
    // Near-parallel fitted sides used to intersect thousands of px off-canvas
    // and that garbage was written straight into the saved document.
    const shapes = [
      drawPath([[40, 40], [40, 150], [90, 168], [140, 150], [140, 40]], { perEdge: 22, wobble: 1.2, close: false, seed: 3 }),
      drawPath([[40, 170], [60, 40], [90, 120], [120, 40], [140, 170]], { perEdge: 20, wobble: 1.2, close: false, seed: 5 }),
      drawPath([[40, 100], [300, 104], [40, 112], [300, 116]], { perEdge: 30, wobble: 1.5, close: false, seed: 9 }),
    ];
    for (const s of shapes) {
      const r = recognizeShape(s);
      if (!r) continue;
      const b = {
        minX: Math.min(...s.points.map(p => p.x)), maxX: Math.max(...s.points.map(p => p.x)),
        minY: Math.min(...s.points.map(p => p.y)), maxY: Math.max(...s.points.map(p => p.y)),
      };
      const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
      for (const p of r.points) {
        expect(p.x).toBeGreaterThan(b.minX - diag);
        expect(p.x).toBeLessThan(b.maxX + diag);
        expect(p.y).toBeGreaterThan(b.minY - diag);
        expect(p.y).toBeLessThan(b.maxY + diag);
      }
    }
  });

  it('returns null for a degenerate tensor instead of a bogus line', () => {
    // Duplicate samples used to yield a zero-length line, or a horizontal one
    // for a diagonal stroke.
    const dup = { points: [
      { x: 5, y: 5, p: 0.5 }, { x: 5, y: 5, p: 0.5 }, { x: 5, y: 5, p: 0.5 }, { x: 5, y: 5, p: 0.5 },
    ] };
    expect(recognizeShape(dup)).toBeNull();
  });

  it('every accepted shape stays close to the stroke it replaced', () => {
    const cases = [
      drawPath([[60, 60], [360, 66], [356, 260], [58, 254]], { perEdge: 26, wobble: 2.5, seed: 3 }),
      drawCircle({ wobble: 3 }),
      drawPath([[200, 50], [360, 300], [40, 296]], { perEdge: 30, wobble: 2.5, seed: 7 }),
      drawPath([[40, 300], [400, 302]], { perEdge: 60, wobble: 2, close: false }),
    ];
    for (const c of cases) {
      const r = recognizeShape(c);
      expect(r).toBeTruthy();
      const xs = c.points.map(p => p.x), ys = c.points.map(p => p.y);
      const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      expect(residual(c, r)).toBeLessThan(diag * 0.075 + 1e-6);
    }
  });
});

describe('rejection — freehand must survive untouched', () => {
  it('ignores a stroke that is too small to be a deliberate shape', () => {
    expect(recognizeShape(drawPath([[0, 0], [12, 0], [12, 12], [0, 12]], { perEdge: 4, wobble: 0.3 })))
      .toBeNull();
  });

  it('ignores a scribble', () => {
    const j = noise(21);
    const pts = [];
    for (let i = 0; i < 200; i++) {
      pts.push({ x: 100 + Math.sin(i / 3) * 60 + j(14), y: 100 + Math.cos(i / 5) * 55 + j(14), p: 0.5 });
    }
    const r = recognizeShape({ points: pts });
    expect(r === null || r.kind !== 'rectangle').toBe(true);
  });

  it('ignores handwriting-like input', () => {
    const j = noise(33);
    const pts = [];
    for (let i = 0; i <= 260; i++) {
      const t = i / 260;
      pts.push({ x: 40 + t * 420, y: 120 - Math.sin(t * 22) * 26 - Math.sin(t * 5) * 9 + j(1.5), p: 0.5 });
    }
    expect(recognizeShape({ points: pts })).toBeNull();
  });

  it('returns null rather than throwing on degenerate input', () => {
    expect(recognizeShape(null)).toBeNull();
    expect(recognizeShape({ points: [] })).toBeNull();
    expect(recognizeShape({ points: [{ x: 1, y: 1, p: 0.5 }] })).toBeNull();
    const same = Array.from({ length: 20 }, () => ({ x: 5, y: 5, p: 0.5 }));
    expect(recognizeShape({ points: same })).toBeNull();
  });
});
