import { startOfMonth, addMonths, addDays, endOfMonth, format } from 'date-fns';
import { STAGES, fitPattern, expectedForGroup, renewalBucket, windowClosed, type Sub, type Stage } from '../src/lib/projection';

// ---------- deterministic RNG ----------
let seed = 1;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32

// ---------- synthetic world with a KNOWN truth ----------
const TRUE: Record<Stage, number[]> = {
  '1st Year': [0.15, 0.25, 0.12, 0.05, 0.02, 0.01],
  '2nd Year': [0.20, 0.30, 0.15, 0.06, 0.02, 0.01],
  '3rd Year+': [0.25, 0.35, 0.15, 0.05, 0.02, 0.01],
};
function run(sd: number, verbose: boolean) {
seed = sd;
const all: Sub[] = [];
for (let m = 0; m < 36; m++) {
  const ms = startOfMonth(new Date(2024, m, 1));
  for (let i = 0; i < 300; i++) {
    const stage = STAGES[Math.floor(rnd() * 3)];
    const exp = addDays(ms, Math.floor(rnd() * 28));
    const u = rnd(); let acc = 0, k = -1;
    for (let j = 0; j < 6; j++) { acc += TRUE[stage][j]; if (u < acc) { k = j; break; } }
    let ren: Date | null = null;
    if (k === 0) ren = addDays(ms, -1 - Math.floor(rnd() * 60));
    else if (k >= 1 && k <= 4) { const s2 = startOfMonth(addMonths(ms, k - 1)); ren = addDays(s2, Math.floor(rnd() * 27)); }
    else if (k === 5) ren = addDays(addMonths(ms, 4), Math.floor(rnd() * 120));
    all.push({ stage, expiryDate: exp, renewalDate: ren });
  }
}

// ---------- back-test setup ----------
const asOf = new Date(2026, 5, 15, 23, 59);                       // pretend today is 15 Jun 2026
const observed = all.map(d => (d.renewalDate && d.renewalDate > asOf ? { ...d, renewalDate: null } : d));
const trainFrom = new Date(2026, 2, 1), trainTo = endOfMonth(new Date(2026, 4, 31));   // Mar–May 2026 (recent, immature late columns)
const fcFrom = new Date(2026, 5, 1), fcTo = endOfMonth(new Date(2026, 7, 31));        // Jun–Aug 2026
const train = observed.filter(d => d.expiryDate >= trainFrom && d.expiryDate <= trainTo);
const fcObs = observed.filter(d => d.expiryDate >= fcFrom && d.expiryDate <= fcTo);
const fcTruth = all.filter(d => d.expiryDate >= fcFrom && d.expiryDate <= fcTo);   // what REALLY happened

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const truthCells: Record<Stage, number[]> = {} as any, D: Record<Stage, number> = {} as any;
STAGES.forEach(st => { truthCells[st] = Array(6).fill(0); D[st] = 0; });
fcTruth.forEach(d => { D[d.stage]++; const k = renewalBucket(d); if (k >= 0) truthCells[d.stage][k]++; });

// ---------- Method A: old approach (raw % from the past period, immature columns included) ----------
const naive: Record<Stage, number[]> = {} as any;
STAGES.forEach(st => {
  const rows = train.filter(d => d.stage === st); const c = Array(6).fill(0);
  rows.forEach(d => { const k = renewalBucket(d); if (k >= 0) c[k]++; });
  naive[st] = c.map(x => (x / rows.length) * D[st]);
});

// ---------- Method B: new model ----------
const p = fitPattern(observed, train, asOf);
const groups: Record<string, { date: Date; stage: Stage; n: number; known: number[] }> = {};
fcObs.forEach(d => {
  const key = format(d.expiryDate, 'yyyy-MM') + d.stage;
  const g = (groups[key] ??= { date: startOfMonth(d.expiryDate), stage: d.stage, n: 0, known: Array(6).fill(0) });
  g.n++; const k = renewalBucket(d); if (k >= 0) g.known[k]++;
});
const model: Record<Stage, number[]> = {} as any;
STAGES.forEach(st => { model[st] = Array(6).fill(0); });
let invariantErrors = 0;
Object.values(groups).forEach(g => {
  const E = expectedForGroup(g.n, g.known, p[g.stage], g.date, asOf);
  const closed = [0,1,2,3,4,5].map(k => windowClosed(k, g.date, asOf));
  E.forEach((e, k) => {
    if (e < g.known[k] - 1e-9) invariantErrors++;                       // never below what already happened
    if (closed[k] && Math.abs(e - g.known[k]) > 1e-9) invariantErrors++; // closed window = exactly the actual
    model[g.stage][k] += e;
  });
  if (sum(E) > g.n + 1e-6) invariantErrors++;                           // cannot renew more than exist
});


const colT = Array(6).fill(0), colN = Array(6).fill(0), colM = Array(6).fill(0);
let absN = 0, absM = 0, dueAll = 0;
STAGES.forEach(st => { for (let k = 0; k < 6; k++) { colT[k] += truthCells[st][k]; colN[k] += naive[st][k]; colM[k] += model[st][k]; absN += Math.abs(naive[st][k] - truthCells[st][k]); absM += Math.abs(model[st][k] - truthCells[st][k]); } dueAll += D[st]; });
const ret = (c: number[]) => sum(c) / dueAll * 100;
return { eOld: ret(colN) - ret(colT), eNew: ret(colM) - ret(colT), maeOld: absN / 18, maeNew: absM / 18, inv: invariantErrors, colT, colN, colM };
}

const N = 30; let so = 0, sn = 0, ao = 0, an = 0, inv = 0, bo = 0, bn = 0;
const colAvg = { T: Array(6).fill(0), O: Array(6).fill(0), M: Array(6).fill(0) };
for (let i = 1; i <= N; i++) {
  const r = run(i * 7919, false);
  so += r.eOld; sn += r.eNew; ao += Math.abs(r.eOld); an += Math.abs(r.eNew); inv += r.inv; bo += r.maeOld; bn += r.maeNew;
  for (let k = 0; k < 6; k++) { colAvg.T[k] += r.colT[k] / N; colAvg.O[k] += r.colN[k] / N; colAvg.M[k] += r.colM[k] / N; }
}
const f = (x: number) => x.toFixed(1).padStart(7);
console.log(`Backtest over ${N} random worlds | today = 15 Jun 2026 | learn from Mar–May | forecast Jun–Aug`);
console.log('\nAverage renewals per column (summed over stages)');
console.log('          ' + ['M<0', 'M0', 'M+1', 'M+2', 'M+3', 'M3+'].map(h => h.padStart(7)).join(''));
console.log('  truth   ' + colAvg.T.map(f).join('')); console.log('  OLD     ' + colAvg.O.map(f).join('')); console.log('  NEW     ' + colAvg.M.map(f).join(''));
console.log(`\nRetention error (forecast - truth), average over worlds`);
console.log(`  OLD  bias ${(so / N).toFixed(2)}pp   typical |error| ${(ao / N).toFixed(2)}pp`);
console.log(`  NEW  bias ${(sn / N).toFixed(2)}pp   typical |error| ${(an / N).toFixed(2)}pp`);
console.log(`Mean absolute error per cell   OLD ${(bo / N).toFixed(1)}   NEW ${(bn / N).toFixed(1)}`);
console.log(`Invariant violations across all worlds: ${inv}  (expect 0)`);
