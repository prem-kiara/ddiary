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
  hitTestStroke, splitStrokeAt, strokeBounds, TOOL,
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

  it('drops a hard-zero pressure sample mid-stroke (lift-off artefact)', () => {
    const r = createPressureResolver({});
    r.resolve({ x: 0, y: 0, pressure: 0.7, type: 'pen', t: 0 });
    expect(r.resolve({ x: 1, y: 1, pressure: 0, type: 'pen', t: 8 })).toBe(-1);
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
    expect(splitStrokeAt(s, 45, 50, 500)).toHaveLength(0);
    expect(splitStrokeAt(s, 45, 400, 5)).toHaveLength(1);
  });

  it('bounds include the rendered half-width padding', () => {
    const s = makeStroke();
    const b = strokeBounds(s);
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(90);
  });
});
