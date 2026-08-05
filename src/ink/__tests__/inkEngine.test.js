/**
 * Tests for the ink engine's pure logic — the parts that determine whether
 * handwriting actually looks good. These are deliberately behavioural
 * ("does it reduce jitter?", "does the stroke end where the pen lifted?")
 * rather than asserting implementation details.
 */
import { describe, it, expect } from 'vitest';
import { createStabilizer, STABILIZER_PRESETS } from '../stabilizer.js';
import { createPressureResolver } from '../pressure.js';
import {
  createStroke, addPoint, serialize, deserialize,
  hitTestStroke, splitStrokeAt, strokeBounds, densify, TOOL,
} from '../strokeModel.js';

/** Deterministic pseudo-random so the tests never flake. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A horizontal pen sweep at y=100 with tremor of ±`noise` px. */
function jitteryLine({ n = 120, noise = 2, dx = 3, seed = 42 }) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: 20 + i * dx,
      y: 100 + (rnd() - 0.5) * 2 * noise,
      p: 0.5,
      t: i * 8,          // ~120 Hz
    });
  }
  return out;
}

const rms = (pts) => Math.sqrt(pts.reduce((a, p) => a + (p.y - 100) ** 2, 0) / pts.length);

describe('stabilizer', () => {
  it('reduces tremor on a shaky straight line', () => {
    const input = jitteryLine({ noise: 2 });
    const stab = createStabilizer(STABILIZER_PRESETS.medium);

    const output = [];
    for (const s of input) {
      const o = stab.push(s);
      if (o) output.push(o);
    }

    expect(output.length).toBeGreaterThan(5);
    // The smoothed path must hug y=100 markedly better than the raw input.
    expect(rms(output)).toBeLessThan(rms(input) * 0.6);
  });

  it('smooths harder at "strong" than at "light"', () => {
    const input = jitteryLine({ noise: 2 });

    const run = (preset) => {
      const stab = createStabilizer(STABILIZER_PRESETS[preset]);
      const out = [];
      for (const s of input) { const o = stab.push(s); if (o) out.push(o); }
      return rms(out);
    };

    expect(run('strong')).toBeLessThan(run('light'));
  });

  it('does not smooth away a deliberate sharp corner', () => {
    // An L: right along y=100, then down at x=200.
    const pts = [];
    for (let i = 0; i <= 30; i++) pts.push({ x: 100 + i * 3.3, y: 100, p: 0.5, t: i * 8 });
    for (let i = 1; i <= 30; i++) pts.push({ x: 199, y: 100 + i * 3.3, p: 0.5, t: (30 + i) * 8 });

    const stab = createStabilizer(STABILIZER_PRESETS.medium);
    const out = [];
    for (const s of pts) { const o = stab.push(s); if (o) out.push(o); }

    // The corner should still be reached — i.e. some point gets near (199,100).
    const nearCorner = out.some(p => Math.hypot(p.x - 199, p.y - 100) < 12);
    expect(nearCorner).toBe(true);
    // And the stroke must actually turn downward afterwards.
    expect(Math.max(...out.map(p => p.y))).toBeGreaterThan(160);
  });

  it('finalize() lands the stroke on the true pen-up position (no lag gap)', () => {
    const input = jitteryLine({ n: 40, noise: 1 });
    const stab = createStabilizer(STABILIZER_PRESETS.strong);

    const pts = [];
    for (const s of input) { const o = stab.push(s); if (o) pts.push(o); }

    const before = pts[pts.length - 1];
    const last = input[input.length - 1];
    const gapBefore = Math.hypot(before.x - last.x, before.y - last.y);

    const tail = stab.finalize(pts);
    expect(tail.length).toBeGreaterThan(0);

    const end = tail[tail.length - 1];
    const gapAfter = Math.hypot(end.x - last.x, end.y - last.y);

    // Strong smoothing lags; finalize must close essentially all of it.
    expect(gapAfter).toBeLessThan(0.01);
    expect(gapAfter).toBeLessThan(gapBefore);
  });

  it('finalize() is non-mutating, so it can drive per-frame catch-up rendering', () => {
    // The engine now calls finalize() every frame to draw a tail from the last
    // smoothed point to the pen's true position — that is what keeps the ink
    // under the nib, since the averager smooths hardest at low speed and the
    // start of every stroke is slow. Calling it repeatedly must not disturb the
    // stabiliser's state or the committed points.
    const input = jitteryLine({ n: 40, noise: 1 });
    const stab = createStabilizer(STABILIZER_PRESETS.strong);
    const pts = [];
    for (const s of input) { const o = stab.push(s); if (o) pts.push(o); }

    const snapshot = JSON.stringify(pts);
    const a = stab.finalize(pts);
    const b = stab.finalize(pts);
    const cc = stab.finalize(pts);

    expect(JSON.stringify(pts)).toBe(snapshot);      // committed points untouched
    expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // deterministic
    expect(JSON.stringify(cc)).toBe(JSON.stringify(a));

    // Pushing more samples afterwards still behaves.
    const more = stab.push({ x: 400, y: 100, p: 0.5, t: 999 });
    expect(more === null || Number.isFinite(more.x)).toBe(true);
  });

  it('the catch-up tail reaches the pen position mid-stroke, not just at the end', () => {
    const input = jitteryLine({ n: 30, noise: 1 });
    const stab = createStabilizer(STABILIZER_PRESETS.strong);
    const pts = [];
    for (const s of input) { const o = stab.push(s); if (o) pts.push(o); }

    const raw = input[input.length - 1];
    const trailing = Math.hypot(pts.at(-1).x - raw.x, pts.at(-1).y - raw.y);
    const tail = stab.finalize(pts);
    const end = tail.at(-1);

    expect(trailing).toBeGreaterThan(0.5);   // smoothing really does lag the nib
    expect(Math.hypot(end.x - raw.x, end.y - raw.y)).toBeLessThan(0.01);
  });

  it('emits the first point immediately', () => {
    const stab = createStabilizer(STABILIZER_PRESETS.medium);
    const first = stab.push({ x: 10, y: 20, p: 0.5, t: 0 });
    expect(first).toEqual({ x: 10, y: 20, p: 0.5 });
  });
});

describe('pressure', () => {
  it('uses real stylus pressure when present', () => {
    const r = createPressureResolver({});
    const v = r.resolve({ x: 0, y: 0, pressure: 0.8, type: 'pen', t: 0 });
    expect(v).toBeCloseTo(0.8, 5);
  });

  it('treats Chrome\'s constant 0.5 as "no pressure" and synthesises instead', () => {
    const r = createPressureResolver({});
    // 0.5 exactly => not a real axis; falls through to velocity synthesis.
    const v = r.resolve({ x: 0, y: 0, pressure: 0.5, type: 'pen', t: 0 });
    expect(v).not.toBeCloseTo(0.5, 5);
  });

  it('synthesises thicker strokes when writing slowly than quickly', () => {
    const slowR = createPressureResolver({});
    const fastR = createPressureResolver({});
    let slow = 0, fast = 0;

    for (let i = 0; i < 25; i++) {
      // Same distance, very different elapsed time.
      slow = slowR.resolve({ x: i * 1, y: 0, pressure: 0, type: 'touch', t: i * 40 });
      fast = fastR.resolve({ x: i * 12, y: 0, pressure: 0, type: 'touch', t: i * 4 });
    }
    expect(slow).toBeGreaterThan(fast);
  });

  it('does not disable real pressure when the pen reports 0 at pen-down', () => {
    // Regression: `real` was latched from sample 1. Many digitizers (and iOS,
    // where force is not populated on the first touch of a contact) report 0 at
    // pen-down, which permanently misclassified a pressure-capable Apple Pencil
    // as pressure-less for the whole stroke.
    const r = createPressureResolver({});
    r.resolve({ x: 0, y: 0, pressure: 0,    type: 'pen', t: 0 });   // inconclusive
    const v = r.resolve({ x: 2, y: 0, pressure: 0.83, type: 'pen', t: 8 });
    expect(v).toBeCloseTo(0.83, 5);            // real pressure honoured
  });

  it('does not start a synthesised stroke at maximum width', () => {
    // Regression: the first synthesised sample seeded from `target`, which is
    // always SYNTH_MAX because there is no velocity yet — producing the heavy
    // starting blob the ramp-in exists to avoid.
    const r = createPressureResolver({});
    const first = r.resolve({ x: 0, y: 0, pressure: 0, type: 'touch', t: 0 });
    expect(first).toBeLessThan(1);
  });

  it('never discards a sample for reporting zero pressure', () => {
    // Regression: a zero reading used to drop the whole sample, deleting part
    // of the stroke path. The remaining points were then joined by a straight
    // line — long sweeps across the page. The Apple Pencil reports 0 routinely
    // when writing fast or lightly, so this fired constantly during real use.
    const r = createPressureResolver({});
    r.resolve({ x: 0, y: 0, pressure: 0.7, type: 'pen', t: 0 });

    const v = r.resolve({ x: 1, y: 1, pressure: 0, type: 'pen', t: 8 });
    expect(v).toBeGreaterThan(0);          // sample kept, not dropped
    expect(v).toBeCloseTo(0.7, 5);         // width falls back to the last good reading

    // A whole run of drop-outs must still keep every position.
    for (let i = 0; i < 10; i++) {
      expect(r.resolve({ x: 2 + i, y: 2, pressure: 0, type: 'pen', t: 16 + i * 8 }))
        .toBeGreaterThan(0);
    }
    // ...and a real reading takes over again.
    expect(r.resolve({ x: 20, y: 2, pressure: 0.4, type: 'pen', t: 200 })).toBeCloseTo(0.4, 5);
  });
});

describe('strokeModel', () => {
  const makeStroke = () => {
    const s = createStroke({ tool: TOOL.PEN, color: '#123456', size: 3 });
    for (let i = 0; i < 10; i++) addPoint(s, { x: i * 10, y: 50, p: 0.5 });
    return s;
  };

  it('survives a serialize → deserialize round trip', () => {
    const s = makeStroke();
    const back = deserialize(serialize([s], 800, 600));

    expect(back.width).toBe(800);
    expect(back.strokes).toHaveLength(1);
    expect(back.strokes[0].color).toBe('#123456');
    expect(back.strokes[0].size).toBe(3);
    expect(back.strokes[0].points).toHaveLength(10);
    expect(back.strokes[0].points[4]).toEqual({ x: 40, y: 50, p: 0.5 });
  });

  it('deserialize tolerates empty/garbage input', () => {
    expect(deserialize(null).strokes).toEqual([]);
    expect(deserialize({}).strokes).toEqual([]);
  });

  it('discards a truncated trailing triple instead of inventing a point', () => {
    // Regression: the loop bound was `i + 2 < p.length + 1`, so a payload whose
    // length % 3 === 2 emitted a point with pressure `undefined`. That survived
    // rendering but round-tripped through serialize() as null, permanently
    // corrupting the stored content on the next autosave.
    const truncated = { v: 1, w: 100, h: 100, s: [{ t: 0, c: '#000', z: 2, p: [1, 2, 0.5, 9, 9] }] };
    const { strokes } = deserialize(truncated);
    expect(strokes[0].points).toHaveLength(1);
    expect(strokes[0].points[0]).toEqual({ x: 1, y: 2, p: 0.5 });

    // And the round trip stays clean — no nulls written back.
    expect(JSON.stringify(serialize(strokes, 100, 100))).not.toContain('null');
  });

  it('hit-tests against segments, not just vertices', () => {
    const s = makeStroke();
    // Midway between two samples, slightly off the line.
    expect(hitTestStroke(s, 45, 52, 5)).toBe(true);
    expect(hitTestStroke(s, 45, 200, 5)).toBe(false);
  });

  it('splits a stroke into two when erased through the middle', () => {
    const s = makeStroke();
    const pieces = splitStrokeAt(s, 45, 50, 12);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].points.at(-1).x).toBeLessThan(45);
    expect(pieces[1].points[0].x).toBeGreaterThan(45);
    // Style is carried onto both halves.
    expect(pieces[0].color).toBe('#123456');
  });

  it('erasing the whole stroke leaves nothing; missing it leaves it intact', () => {
    const s = makeStroke();
    expect(splitStrokeAt(s, 45, 500, 5)).toHaveLength(1);   // nowhere near it
    expect(splitStrokeAt(s, 45, 50, 500)).toHaveLength(0);  // swallows everything
  });

  it('cuts a segment the eraser crosses even when both endpoints survive', () => {
    // Regression: hitTestStroke measured distance to segments but splitStrokeAt
    // only tested vertices, so an eraser passing between two widely-spaced
    // samples reported a hit and then removed nothing — the eraser silently
    // no-opped on fast strokes, where samples are far apart.
    const sparse = createStroke({ tool: TOOL.PEN, color: '#000', size: 2 });
    addPoint(sparse, { x: 0,   y: 50, p: 0.5 });
    addPoint(sparse, { x: 100, y: 50, p: 0.5 });   // 100px apart
    addPoint(sparse, { x: 200, y: 50, p: 0.5 });

    // Eraser sits mid-segment, far from every vertex.
    expect(hitTestStroke(sparse, 50, 50, 8)).toBe(true);
    const pieces = splitStrokeAt(sparse, 50, 50, 8);
    expect(pieces).not.toEqual([sparse]);           // must not be the identity
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    // The 100→200 half must survive intact.
    const survivingXs = pieces.flatMap(p => p.points.map(q => q.x));
    expect(survivingXs).toContain(200);
  });

  it('returns the identical stroke reference when the eraser truly misses', () => {
    const s = makeStroke();
    expect(splitStrokeAt(s, 45, 500, 5)[0]).toBe(s);  // identity → caller skips it
  });

  it('densifies widely-spaced points before outlining', () => {
    // Regression: a fast pen on a ~60Hz event stream lands samples 50-120px
    // apart, and perfect-freehand's ribbon collapses at that spacing — strokes
    // rendered thin, faded and broken while slow handwriting on the same page
    // looked perfect. Proven by drawing one shape at 92px spacing (broken) and
    // 5.8px spacing (solid).
    const sparse = [
      { x: 0,   y: 0,   p: 0.6 },
      { x: 100, y: 0,   p: 0.6 },
      { x: 100, y: 120, p: 0.2 },
    ];
    const out = densify(sparse, 6);

    // No gap may exceed the threshold.
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i].x - out[i-1].x, out[i].y - out[i-1].y)).toBeLessThanOrEqual(6.001);
    }
    // Endpoints and shape preserved, pressure interpolated along the way.
    expect(out[0]).toEqual(sparse[0]);
    expect(out.at(-1)).toEqual(sparse.at(-1));
    expect(out.length).toBeGreaterThan(30);
    const mid = out[Math.floor(out.length * 0.9)];
    expect(mid.p).toBeGreaterThan(0.2);
    expect(mid.p).toBeLessThan(0.6);
  });

  it('leaves already-dense points untouched and tolerates degenerate input', () => {
    const dense = [{ x: 0, y: 0, p: 0.5 }, { x: 3, y: 0, p: 0.5 }, { x: 6, y: 0, p: 0.5 }];
    expect(densify(dense, 6)).toEqual(dense);
    expect(densify([], 6)).toEqual([]);
    expect(densify([{ x: 1, y: 1, p: 0.5 }], 6)).toHaveLength(1);
    // A pathological jump must not explode the point count.
    expect(densify([{ x: 0, y: 0, p: 0.5 }, { x: 1e6, y: 0, p: 0.5 }], 6).length).toBeLessThan(210);
  });

  it('bounds include the rendered half-width padding', () => {
    const s = makeStroke();
    const b = strokeBounds(s);
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(90);
  });
});
