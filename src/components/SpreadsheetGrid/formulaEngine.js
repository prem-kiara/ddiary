import { LETTERS } from './constants';

// ─── Cell key helper ──────────────────────────────────────────────────────────
export function ck(c, r) { return `${LETTERS[c] ?? '?'}${r + 1}`; }

// ─── Reference parsing ────────────────────────────────────────────────────────
export function parseRef(ref) {
  const m = String(ref).trim().match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  const col = m[1].toUpperCase().split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { col, row: parseInt(m[2]) - 1 };
}

export function expandRange(str) {
  const [s, e] = str.split(':');
  const a = parseRef(s), b = e ? parseRef(e) : a;
  if (!a || !b) return [];
  const out = [];
  for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++)
    for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++)
      out.push({ col: c, row: r });
  return out;
}

// ─── Formula evaluation ───────────────────────────────────────────────────────
export function evalCell(col, row, data, depth = 0) {
  if (depth > 16 || col < 0 || row < 0) return '#REF!';
  const cell = data[ck(col, row)];
  if (!cell?.v && cell?.v !== 0) return '';
  const raw = String(cell.v).trim();
  if (!raw.startsWith('=')) return raw === '' ? '' : isNaN(raw) ? raw : +raw;

  const expr = raw.slice(1).toUpperCase().trim();
  const fnM  = expr.match(/^(SUM|AVERAGE|AVG|COUNT|COUNTA|MIN|MAX)\((.+)\)$/);
  if (fnM) {
    const [, fn, argsRaw] = fnM;
    const nums = [];
    argsRaw.split(',').forEach(part => {
      part = part.trim();
      const cells = part.includes(':') ? expandRange(part) : (() => { const r = parseRef(part); return r ? [r] : []; })();
      cells.forEach(({ col: c, row: r }) => {
        const v = evalCell(c, r, data, depth + 1);
        if (v !== '' && !isNaN(+v)) nums.push(+v);
      });
    });
    if (fn === 'SUM')                      return nums.reduce((a, b) => a + b, 0);
    if (fn === 'AVERAGE' || fn === 'AVG')  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    if (fn === 'COUNT' || fn === 'COUNTA') return nums.length;
    if (fn === 'MIN') return nums.length ? Math.min(...nums) : 0;
    if (fn === 'MAX') return nums.length ? Math.max(...nums) : 0;
  }

  const substituted = expr.replace(/([A-Z]+\d+)/g, ref => {
    const r = parseRef(ref);
    if (!r) return '0';
    const v = evalCell(r.col, r.row, data, depth + 1);
    return (v === '' || isNaN(+v)) ? '0' : +v;
  });

  if (!/^[0-9+\-*/.() %]+$/.test(substituted)) return '#ERROR';
  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + substituted + ')')();
    if (!Number.isFinite(result)) return result === Infinity ? '#DIV/0!' : '#ERROR';
    return Math.round(result * 1e10) / 1e10;
  } catch { return '#ERROR'; }
}

export function displayVal(c, r, data) {
  const v = evalCell(c, r, data);
  return v === '' || v === null || v === undefined ? '' : String(v);
}

// ─── Row / column manipulation helpers ───────────────────────────────────────
export function insertRowInData(data, at) {
  const result = {};
  for (const [key, cell] of Object.entries(data)) {
    const ref = parseRef(key);
    if (!ref) { result[key] = cell; continue; }
    result[ref.row < at ? key : ck(ref.col, ref.row + 1)] = cell;
  }
  return result;
}

export function deleteRowFromData(data, at) {
  const result = {};
  for (const [key, cell] of Object.entries(data)) {
    const ref = parseRef(key);
    if (!ref) { result[key] = cell; continue; }
    if (ref.row === at) continue;
    result[ref.row < at ? key : ck(ref.col, ref.row - 1)] = cell;
  }
  return result;
}

export function insertColInData(data, at) {
  const result = {};
  for (const [key, cell] of Object.entries(data)) {
    const ref = parseRef(key);
    if (!ref) { result[key] = cell; continue; }
    result[ref.col < at ? key : ck(ref.col + 1, ref.row)] = cell;
  }
  return result;
}

export function deleteColFromData(data, at) {
  const result = {};
  for (const [key, cell] of Object.entries(data)) {
    const ref = parseRef(key);
    if (!ref) { result[key] = cell; continue; }
    if (ref.col === at) continue;
    result[ref.col < at ? key : ck(ref.col - 1, ref.row)] = cell;
  }
  return result;
}

export function shiftRowComments(rc, at, dir) {
  const result = {};
  for (const [rs, cmts] of Object.entries(rc)) {
    const r = parseInt(rs, 10);
    if (isNaN(r)) continue;
    if (dir === 'insert') {
      result[r < at ? r : r + 1] = cmts;
    } else {
      if (r === at) continue;
      result[r < at ? r : r - 1] = cmts;
    }
  }
  return result;
}
