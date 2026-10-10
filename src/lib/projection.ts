import { startOfMonth, addMonths } from 'date-fns';

// Pure projection maths — no React, so it can be unit-tested and back-tested on its own.

export type Stage = '1st Year' | '2nd Year' | '3rd Year+';
export const STAGES: Stage[] = ['1st Year', '2nd Year', '3rd Year+'];
export interface Sub { stage: Stage; expiryDate: Date; renewalDate: Date | null }

// ─── PROJECTION MODEL ────────────────────────────────────────────────────────
// Renewal timing is bucketed relative to the expiry month: M<0, M0, M+1, M+2, M+3, M3+ (k = 0..5).
// Bucket k's window ENDS at the start of month (expiry month + WIN_END[k]); M3+ is treated as closed after 12 months.
// A renewal only counts if it has already happened (as-of date); open windows are "right-censored".
export const WIN_END = [0, 1, 2, 3, 4, 12];
export const renewalBucket = (d: Sub): number => {
  if (!d.renewalDate) return -1;
  const off = (d.renewalDate.getFullYear() - d.expiryDate.getFullYear()) * 12 + (d.renewalDate.getMonth() - d.expiryDate.getMonth());
  return off < 0 ? 0 : off === 0 ? 1 : off === 1 ? 2 : off === 2 ? 3 : off === 3 ? 4 : 5;
};
export const windowClosed = (k: number, expiry: Date, asOf: Date) => startOfMonth(addMonths(expiry, WIN_END[k])) <= asOf;
export const SHRINK_M = 30;     // pseudo-observations: how strongly small samples are pulled toward long-run history
export const MIN_HIST = 30;     // minimum matured observations before a stage uses its own long-run rate

export type ProjGroup = { date: Date; st: Partial<Record<Stage, { n: number; known: number[]; E: number[] }>> };

// Learn P(renewed in bucket k | stage) from the training period.
// Only subscriptions whose bucket-k window has fully closed are "at risk" for that column (no censoring bias),
// and the estimate is shrunk toward long-run history (empirical-Bayes), so thin or too-recent periods stay stable.
export function fitPattern(history: Sub[], train: Sub[], asOf: Date) {
  const tally = (rows: Sub[]) => {
    const t = {} as Record<Stage, { n: number[]; r: number[] }>;
    STAGES.forEach(st => { t[st] = { n: Array(6).fill(0), r: Array(6).fill(0) }; });
    rows.forEach(d => {
      const kr = renewalBucket(d);
      for (let k = 0; k < 6; k++) if (windowClosed(k, d.expiryDate, asOf)) { t[d.stage].n[k]++; if (kr === k) t[d.stage].r[k]++; }
    });
    return t;
  };
  const hist = tally(history.filter(d => d.expiryDate <= asOf));
  const tr = tally(train);
  const pooled = { n: Array(6).fill(0) as number[], r: Array(6).fill(0) as number[] };
  STAGES.forEach(st => { for (let k = 0; k < 6; k++) { pooled.n[k] += hist[st].n[k]; pooled.r[k] += hist[st].r[k]; } });
  const p = {} as Record<Stage, number[]>;
  STAGES.forEach(st => {
    const arr = [0, 1, 2, 3, 4, 5].map(k => {
      const prior = hist[st].n[k] >= MIN_HIST ? hist[st].r[k] / hist[st].n[k] : (pooled.n[k] ? pooled.r[k] / pooled.n[k] : 0);
      return (tr[st].r[k] + SHRINK_M * prior) / (tr[st].n[k] + SHRINK_M);
    });
    const sum = arr.reduce((a, x) => a + x, 0);
    p[st] = sum > 1 ? arr.map(x => x / sum) : arr;     // a subscription renews at most once
  });
  return p;
}

// Expected final renewals per bucket for one (expiry month, stage) group:
//  • closed windows  → exactly what already happened
//  • open windows    → P(bucket | not renewed in the closed buckets) × the subscriptions still unrenewed,
//                      never below what has already happened, and never more than the unrenewed pool.
export function expectedForGroup(n: number, known: number[], p: number[], monthStart: Date, asOf: Date): number[] {
  const closed = [0, 1, 2, 3, 4, 5].map(k => windowClosed(k, monthStart, asOf));
  const closedP = closed.reduce((a, c, k) => a + (c ? p[k] : 0), 0);
  const knownClosed = closed.reduce((a, c, k) => a + (c ? known[k] : 0), 0);
  const pool = Math.max(0, n - knownClosed);
  const denom = 1 - closedP;
  const E = known.slice();
  const openK = [0, 1, 2, 3, 4, 5].filter(k => !closed[k]);
  if (denom > 0.05) openK.forEach(k => { E[k] = Math.max(known[k], (pool * p[k]) / denom); });
  const knownOpen = openK.reduce((a, k) => a + known[k], 0);
  const room = Math.max(0, pool - knownOpen);
  const extra = openK.reduce((a, k) => a + (E[k] - known[k]), 0);
  if (extra > room && extra > 0) openK.forEach(k => { E[k] = known[k] + (E[k] - known[k]) * (room / extra); });
  return E;
}

// Split whole number T across buckets in proportion to weights (largest remainder), never exceeding caps
export const allocate = (T: number, weights: number[], caps: number[]): number[] => {
  const w = weights.reduce((a, x) => a + x, 0) > 0 ? weights : caps;
  const sw = w.reduce((a, x) => a + x, 0);
  if (sw === 0) return weights.map(() => 0);
  const raw = w.map(x => (x * T) / sw);
  const out = raw.map((x, k) => Math.min(Math.floor(x), caps[k]));
  let rem = T - out.reduce((a, x) => a + x, 0);
  for (let guard = 0; rem > 0 && guard < 1000; guard++) {
    let best = -1;
    raw.forEach((x, k) => { if (out[k] < caps[k] && (best < 0 || x - out[k] > raw[best] - out[best])) best = k; });
    if (best < 0) break;
    out[best]++; rem--;
  }
  return out;
};

