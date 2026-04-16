import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Calendar, Users, TrendingUp, CheckCircle2, ShieldAlert,
  History, ArrowUpRight, ArrowDownRight, Download, ChevronDown,
  BarChart3, PieChart as PieChartIcon, Activity, Info,
  ChevronRight, Clock, Layers, Monitor, X, CalendarDays, ArrowLeftRight,
  Eye, EyeOff, Lock, Mail, Database, Wifi, Shield, Zap, LogOut
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie,
  AreaChart, Area
} from 'recharts';
import {
  format, subDays, addDays, isWithinInterval, differenceInDays,
  parseISO, parse, startOfDay, endOfDay,
  startOfMonth, endOfMonth, subMonths,
  startOfWeek, endOfWeek, startOfYear, endOfYear, startOfQuarter, endOfQuarter
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { cn } from './lib/utils';

const CLOUD_PRODUCTS  = ['Spectrum Cloud', 'ExpressGST', 'ExpressITR', 'ExpressTDS'] as const;
const DESKTOP_PRODUCTS = ['Zen TDS', 'Zen IT', 'Spectrum', 'Zen PDF Signer', 'Zen eXBace', 'Taxsuite'] as const;
const ALL_PRODUCTS = [...CLOUD_PRODUCTS, ...DESKTOP_PRODUCTS] as const;
type Product = typeof ALL_PRODUCTS[number];

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface Subscription {
  id: string;
  expiryDate: Date;
  renewalDate: Date | null;
  stage: '1st Year' | '2nd Year' | '3rd Year+';
  salesGroup: 'KDK' | 'Self' | 'Partner';
  industry: 'DIFM' | 'DIY';
  platform: 'Cloud' | 'Desktop';
  product: Product;
  amount: number;
}

interface Stats {
  total: number;
  renewed: number;
  pending: number;
  retention: number;
  early: number;
  onTime: number;
  late: number;
}

// Renewal timing bucket — how many months after/before expiry was the renewal
interface BucketStats {
  total: number;
  mMinus: number;   // renewed before expiry month (M<0)
  m0: number;       // renewed same month as expiry (M0)
  m1: number;       // 1 month after (M+1)
  m2: number;       // 2 months after (M+2)
  m3: number;       // 3 months after (M+3)
  m3plus: number;   // more than 3 months after (M3+)
  pending: number;  // not yet renewed
}

interface MonthMatrixRow {
  month: string;
  sortKey: number;
  total: BucketStats;
  byStage: Partial<Record<Subscription['stage'], BucketStats>>;
}

// ─── MATRIX HELPERS ──────────────────────────────────────────────────────────

const emptyBucket = (): BucketStats =>
  ({ total: 0, mMinus: 0, m0: 0, m1: 0, m2: 0, m3: 0, m3plus: 0, pending: 0 });

const addToBucket = (b: BucketStats, d: Subscription) => {
  b.total++;
  if (!d.renewalDate) { b.pending++; return; }
  const offset =
    (d.renewalDate.getFullYear() - d.expiryDate.getFullYear()) * 12 +
    (d.renewalDate.getMonth() - d.expiryDate.getMonth());
  if (offset < 0) b.mMinus++;
  else if (offset === 0) b.m0++;
  else if (offset === 1) b.m1++;
  else if (offset === 2) b.m2++;
  else if (offset === 3) b.m3++;
  else b.m3plus++;
};

const buildMatrixRows = (data: Subscription[]): MonthMatrixRow[] => {
  const map: Record<string, MonthMatrixRow> = {};
  data.forEach(d => {
    const key = format(d.expiryDate, 'MMM yy');
    if (!map[key]) map[key] = {
      month: key,
      sortKey: parse(key, 'MMM yy', new Date()).getTime(),
      total: emptyBucket(),
      byStage: {},
    };
    const row = map[key];
    if (!row.byStage[d.stage]) row.byStage[d.stage] = emptyBucket();
    addToBucket(row.total, d);
    addToBucket(row.byStage[d.stage]!, d);
  });
  return Object.values(map).sort((a, b) => a.sortKey - b.sortKey);
};

// ─── MOCK DATA ────────────────────────────────────────────────────────────────

const generateMockData = (): Subscription[] => {
  const data: Subscription[] = [];
  const stages: Subscription['stage'][] = ['1st Year', '2nd Year', '3rd Year+'];
  const salesGroups: Subscription['salesGroup'][] = ['KDK', 'Self', 'Partner'];
  const industries: Subscription['industry'][] = ['DIFM', 'DIY'];
  const platforms: Subscription['platform'][] = ['Cloud', 'Desktop'];
  const now = new Date();

  for (let i = 1; i <= 2500; i++) {
    const daysOffset = Math.floor(Math.random() * 365) - 180;
    const expiryDate = addDays(now, daysOffset);
    const stage = stages[Math.floor(Math.random() * stages.length)];
    const baseRenewalProb = stage === '1st Year' ? 0.65 : stage === '2nd Year' ? 0.8 : 0.9;
    const isRenewed = Math.random() < baseRenewalProb;

    let renewalDate: Date | null = null;
    if (isRenewed) {
      const strategy = Math.random();
      if (strategy < 0.3) {
        renewalDate = subDays(expiryDate, Math.floor(Math.random() * 30) + 31);
      } else if (strategy < 0.8) {
        renewalDate = subDays(expiryDate, Math.floor(Math.random() * 60) - 30);
      } else {
        renewalDate = addDays(expiryDate, Math.floor(Math.random() * 45) + 1);
      }
    }

    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    const productPool = platform === 'Cloud' ? CLOUD_PRODUCTS : DESKTOP_PRODUCTS;
    const product = productPool[Math.floor(Math.random() * productPool.length)];
    data.push({
      id: `SUB-${i}`,
      expiryDate,
      renewalDate,
      stage,
      salesGroup: salesGroups[Math.floor(Math.random() * salesGroups.length)],
      industry: industries[Math.floor(Math.random() * industries.length)],
      platform,
      product,
      amount: Math.floor(Math.random() * 5000) + 1000,
    });
  }
  return data;
};

const RAW_DATA = generateMockData();

// ─── APP ─────────────────────────────────────────────────────────────────────

function Dashboard() {
  const [primaryRange, setPrimaryRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [activeDateLabel, setActiveDateLabel] = useState('This Month');
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const datePickerTriggerRef = useRef<HTMLButtonElement>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareRange, setCompareRange] = useState({
    start: format(subDays(new Date(), 60), 'yyyy-MM-dd'),
    end: format(subDays(new Date(), 31), 'yyyy-MM-dd'),
  });
  const [filters, setFilters] = useState({
    salesGroups: [] as string[],   // empty = All
    industry: 'All',
    platform: 'All',
    products: [] as string[],      // empty = All
  });
  const [viewMode, setViewMode] = useState<'numbers' | 'percentages'>('numbers');

  // ─── DERIVED DATA ──────────────────────────────────────────────────────────

  const { currentData, previousData } = useMemo(() => {
    const pStart = startOfDay(parseISO(primaryRange.start));
    const pEnd = endOfDay(parseISO(primaryRange.end));
    const cStart = startOfDay(parseISO(compareRange.start));
    const cEnd = endOfDay(parseISO(compareRange.end));

    const filterFn = (d: Subscription, s: Date, e: Date) => {
      const inDate     = isWithinInterval(d.expiryDate, { start: s, end: e });
      const inSales    = filters.salesGroups.length === 0 || filters.salesGroups.includes(d.salesGroup);
      const inIndustry = filters.industry === 'All' || d.industry === filters.industry;
      const inPlatform = filters.platform === 'All' || d.platform === filters.platform;
      const inProduct  = filters.products.length === 0 || filters.products.includes(d.product);
      return inDate && inSales && inIndustry && inPlatform && inProduct;
    };

    return {
      currentData: RAW_DATA.filter(d => filterFn(d, pStart, pEnd)),
      previousData: RAW_DATA.filter(d => filterFn(d, cStart, cEnd)),
    };
  }, [primaryRange, compareRange, filters]);

  // All data matching non-date filters only — used for charts that should show full history
  const allFilteredData = useMemo(() => RAW_DATA.filter(d => {
    const inSales    = filters.salesGroups.length === 0 || filters.salesGroups.includes(d.salesGroup);
    const inIndustry = filters.industry === 'All' || d.industry === filters.industry;
    const inPlatform = filters.platform === 'All' || d.platform === filters.platform;
    const inProduct  = filters.products.length === 0 || filters.products.includes(d.product);
    return inSales && inIndustry && inPlatform && inProduct;
  }), [filters]);

  // ─── ANALYTICS ─────────────────────────────────────────────────────────────

  const getStats = (data: Subscription[]): Stats => {
    const total = data.length;
    const renewed = data.filter(d => d.renewalDate !== null).length;
    const pending = total - renewed;
    const retention = total > 0 ? (renewed / total) * 100 : 0;
    const early = data.filter(d => d.renewalDate && differenceInDays(d.expiryDate, d.renewalDate) > 30).length;
    const onTime = data.filter(d => d.renewalDate && Math.abs(differenceInDays(d.expiryDate, d.renewalDate)) <= 30).length;
    const late = data.filter(d => d.renewalDate && differenceInDays(d.renewalDate, d.expiryDate) > 0).length;
    return { total, renewed, pending, retention, early, onTime, late };
  };

  const currentStats = getStats(currentData);
  const prevStats = getStats(previousData);

  const calculateDelta = (curr: number, prev: number) => {
    if (prev === 0) return 0;
    return ((curr - prev) / prev) * 100;
  };

  const matrixGroups = useMemo(() => buildMatrixRows(currentData), [currentData]);
  const prevMatrixGroups = useMemo(() => buildMatrixRows(previousData), [previousData]);

  // ─── CHART DATA ────────────────────────────────────────────────────────────

  // Monthly renewal trends — uses full history (date-range-independent), only segment filters apply
  const monthlyChartData = useMemo(() => {
    const months: Record<string, { name: string; renewed: number; pending: number }> = {};
    allFilteredData.forEach(d => {
      const key = format(d.expiryDate, 'MMM yy');
      if (!months[key]) months[key] = { name: key, renewed: 0, pending: 0 };
      if (d.renewalDate) months[key].renewed++;
      else months[key].pending++;
    });
    return Object.values(months).sort((a, b) =>
      parse(a.name, 'MMM yy', new Date()).getTime() - parse(b.name, 'MMM yy', new Date()).getTime()
    );
  }, [allFilteredData]);

  // Daily velocity — Due (expiry per day) vs Renewed (actual per day, past only)
  const dailyTrendData = useMemo(() => {
    const pStart = startOfDay(parseISO(primaryRange.start));
    const pEnd   = endOfDay(parseISO(primaryRange.end));
    const today  = startOfDay(new Date());

    // Seed a slot for every day in the range
    const map: Record<string, { date: string; ts: number; due: number; renewed: number | null }> = {};
    let cur = pStart;
    while (cur <= pEnd) {
      const key = format(cur, 'MMM dd');
      map[key] = { date: key, ts: cur.getTime(), due: 0, renewed: cur <= today ? 0 : null };
      cur = addDays(cur, 1);
    }

    // Due: subscriptions expiring each day
    currentData.forEach(sub => {
      const key = format(sub.expiryDate, 'MMM dd');
      if (map[key]) map[key].due++;
    });

    // Renewed: renewals processed each day (only past dates)
    allFilteredData.forEach(sub => {
      if (!sub.renewalDate) return;
      const rDay = startOfDay(sub.renewalDate);
      if (rDay > today) return;
      const rKey = format(rDay, 'MMM dd');
      if (map[rKey] !== undefined) map[rKey].renewed = (map[rKey].renewed ?? 0) + 1;
    });

    return Object.values(map).sort((a, b) => a.ts - b.ts);
  }, [currentData, allFilteredData, primaryRange]);

  // Renewal timing breakdown — 3 buckets
  const timingData = useMemo(() => {
    const b = emptyBucket();
    currentData.forEach(d => addToBucket(b, d));
    const onTime = b.mMinus + b.m0;          // renewed same month or before
    const late   = b.m1 + b.m2 + b.m3 + b.m3plus; // renewed after expiry month
    return [
      { name: 'On Time', desc: 'Renewed same month or before', value: onTime,   fill: '#10b981' },
      { name: 'Late',    desc: 'Renewed after expiry month',   value: late,     fill: '#f59e0b' },
      { name: 'Pending', desc: 'Not yet renewed',              value: b.pending, fill: '#f43f5e' },
    ];
  }, [currentData]);

  // Stage-wise retention % for bar chart
  const stageRetentionData = useMemo(() =>
    (['1st Year', '2nd Year', '3rd Year+'] as const).map(stage => {
      const s = currentData.filter(d => d.stage === stage);
      const total = s.length;
      const renewed = s.filter(d => d.renewalDate !== null).length;
      const retention = total > 0 ? (renewed / total) * 100 : 0;
      return { stage: stage.replace('3rd Year+', '3rd Yr+'), retention: parseFloat(retention.toFixed(1)), total };
    }), [currentData]);

  // Sales group distribution
  const salesGroupData = useMemo(() => [
    { name: 'KDK', value: currentData.filter(d => d.salesGroup === 'KDK').length, fill: '#6366f1' },
    { name: 'Self', value: currentData.filter(d => d.salesGroup === 'Self').length, fill: '#a855f7' },
    { name: 'Partner', value: currentData.filter(d => d.salesGroup === 'Partner').length, fill: '#ec4899' },
  ], [currentData]);

  // Industry split
  const industryData = useMemo(() => [
    { name: 'DIFM', value: currentData.filter(d => d.industry === 'DIFM').length, fill: '#3b82f6' },
    { name: 'DIY', value: currentData.filter(d => d.industry === 'DIY').length, fill: '#06b6d4' },
  ], [currentData]);

  // Platform split
  const platformData = useMemo(() => [
    { name: 'Cloud', value: currentData.filter(d => d.platform === 'Cloud').length, fill: '#8b5cf6' },
    { name: 'Desktop', value: currentData.filter(d => d.platform === 'Desktop').length, fill: '#f59e0b' },
  ], [currentData]);

  // ─── EXPORT ────────────────────────────────────────────────────────────────

  const exportToExcel = () => {
    try {
      const rows = currentData.map(d => ({
        'ID': d.id,
        'Expiry Date': format(d.expiryDate, 'yyyy-MM-dd'),
        'Renewal Date': d.renewalDate ? format(d.renewalDate, 'yyyy-MM-dd') : 'Pending',
        'Stage': d.stage,
        'Sales Group': d.salesGroup,
        'Industry': d.industry,
        'Platform': d.platform,
        'Product': d.product,
        'Amount': d.amount,
        'Status': d.renewalDate ? 'Renewed' : 'Pending',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Renewals');
      XLSX.writeFile(wb, `renewal_data_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    } catch {
      alert('Export failed. Please try again.');
    }
  };

  const generatePDFReport = () => {
    const rangeLabel   = `${format(parseISO(primaryRange.start), 'dd MMM yyyy')} – ${format(parseISO(primaryRange.end), 'dd MMM yyyy')}`;
    const compareLabel = `${format(parseISO(compareRange.start), 'dd MMM yyyy')} – ${format(parseISO(compareRange.end), 'dd MMM yyyy')}`;
    const generatedOn  = format(new Date(), 'dd MMM yyyy, hh:mm a');

    const rc = (r: number) => r >= 80 ? '#059669' : r >= 65 ? '#4f46e5' : '#e11d48';

    // ── Matrix rows HTML ──
    const matrixRowsHtml = (groups: MonthMatrixRow[]) => groups.map(row => {
      const b    = row.total;
      const done = bucketDone(b);
      const ret  = bucketRet(b);
      const STAGES = ['1st Year', '2nd Year', '3rd Year+'] as const;
      const stageAccent: Record<string, string> = { '1st Year': '#6366f1', '2nd Year': '#8b5cf6', '3rd Year+': '#10b981' };

      const stageHtml = STAGES.map(stage => {
        const sb = row.byStage[stage];
        if (!sb || sb.total === 0) return '';
        const sd = bucketDone(sb); const sr = bucketRet(sb);
        const c = stageAccent[stage];
        return `<tr style="background:#fafafe;border-left:3px solid ${c}">
          <td style="padding:5px 10px 5px 26px;font-size:10.5px;color:#64748b;font-weight:500">${stage}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;color:#475569">${sb.total}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;font-weight:600;color:${sb.mMinus>0?'#059669':'#d1d5db'}">${sb.mMinus||'—'}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;font-weight:600;color:${sb.m0>0?'#4f46e5':'#d1d5db'}">${sb.m0||'—'}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;color:${sb.m1>0?'#d97706':'#d1d5db'}">${sb.m1||'—'}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;color:${sb.m2>0?'#ea580c':'#d1d5db'}">${sb.m2||'—'}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;color:${sb.m3>0?'#dc2626':'#d1d5db'}">${sb.m3||'—'}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;color:${sb.m3plus>0?'#991b1b':'#d1d5db'}">${sb.m3plus||'—'}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;background:#fff1f2;font-weight:${sb.pending>0?'700':'400'};color:${sb.pending>0?'#e11d48':'#d1d5db'}">${sb.pending||'—'}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;color:#475569">${sd}</td>
          <td style="padding:5px 7px;text-align:right;font-size:10.5px;font-weight:700;color:${rc(sr)}">${sr.toFixed(1)}%</td>
        </tr>`;
      }).join('');

      return `<tr style="background:#f8fafc;border-top:2px solid #e2e8f0">
        <td style="padding:9px 10px;font-weight:800;font-size:12px;color:#1e293b">${row.month}</td>
        <td style="padding:9px 7px;text-align:right;font-weight:700;font-size:12px;color:#0f172a">${b.total}</td>
        <td style="padding:9px 7px;text-align:right;font-weight:700;font-size:12px;color:${b.mMinus>0?'#059669':'#d1d5db'}">${b.mMinus||'—'}</td>
        <td style="padding:9px 7px;text-align:right;font-weight:700;font-size:12px;color:${b.m0>0?'#4f46e5':'#d1d5db'}">${b.m0||'—'}</td>
        <td style="padding:9px 7px;text-align:right;font-size:12px;color:${b.m1>0?'#d97706':'#d1d5db'}">${b.m1||'—'}</td>
        <td style="padding:9px 7px;text-align:right;font-size:12px;color:${b.m2>0?'#ea580c':'#d1d5db'}">${b.m2||'—'}</td>
        <td style="padding:9px 7px;text-align:right;font-size:12px;color:${b.m3>0?'#dc2626':'#d1d5db'}">${b.m3||'—'}</td>
        <td style="padding:9px 7px;text-align:right;font-size:12px;color:${b.m3plus>0?'#991b1b':'#d1d5db'}">${b.m3plus||'—'}</td>
        <td style="padding:9px 7px;text-align:right;background:#fff1f2;font-weight:${b.pending>0?'800':'400'};font-size:12px;color:${b.pending>0?'#e11d48':'#d1d5db'}">${b.pending||'—'}</td>
        <td style="padding:9px 7px;text-align:right;font-weight:600;font-size:12px;color:#334155">${done}</td>
        <td style="padding:9px 7px;text-align:right;font-weight:800;font-size:12px;color:${rc(ret)}">${ret.toFixed(1)}%</td>
      </tr>${stageHtml}`;
    }).join('');

    const matrixTableHtml = (groups: MonthMatrixRow[], label: string, accent: string) => `
      ${label ? `<div style="display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;padding:4px 12px;border-radius:99px;background:${accent}18;border:1px solid ${accent}40">
        <div style="width:8px;height:8px;border-radius:50%;background:${accent}"></div>
        <span style="font-size:11px;font-weight:700;color:${accent}">${label}</span>
      </div>` : ''}
      <div style="border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px">
        <table style="width:100%;border-collapse:collapse;font-family:inherit">
          <thead>
            <tr style="background:linear-gradient(135deg,${accent},${accent}cc)">
              <th style="padding:9px 10px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:white">Month / Stage</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;color:white">Due</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:#86efac">M&lt;0</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:#bfdbfe">M 0</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:#fde68a">M+1</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:#fed7aa">M+2</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:#fca5a5">M+3</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:#fca5a5">M 3+</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:#fda4af;background:rgba(255,255,255,0.12)">Pending</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:white">Done</th>
              <th style="padding:9px 7px;text-align:right;font-size:10px;font-weight:700;color:white">Ret %</th>
            </tr>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
              <td style="padding:3px 10px;font-size:9.5px;color:#94a3b8"></td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#94a3b8">total</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#059669">before</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#4f46e5">same mo.</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#d97706">1 mo. late</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#ea580c">2 mo. late</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#dc2626">3 mo. late</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#991b1b">&gt;3 mo.</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#e11d48;background:#fff1f2">not renewed</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#94a3b8">renewed</td>
              <td style="padding:3px 7px;text-align:right;font-size:9.5px;color:#94a3b8">done/due</td>
            </tr>
          </thead>
          <tbody>${matrixRowsHtml(groups)}</tbody>
        </table>
      </div>`;

    // ── KPI card HTML ──
    const kpiCard = (label: string, val: string | number, prev: string | number | null, border: string, isRet = false) => {
      const numVal  = typeof val  === 'string' ? parseFloat(val)  : val;
      const numPrev = typeof prev === 'string' ? parseFloat(prev as string) : prev as number | null;
      const delta   = compareMode && numPrev !== null && numPrev !== undefined
        ? (isRet ? numVal - numPrev : ((numVal - numPrev) / (numPrev || 1)) * 100)
        : null;
      const dColor = delta !== null ? (delta > 0 ? '#059669' : '#e11d48') : '';
      return `<div style="background:white;border-radius:14px;padding:16px 18px;border-bottom:4px solid ${border};box-shadow:0 2px 12px rgba(0,0,0,0.06)">
        <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#94a3b8;margin-bottom:8px">${label}</div>
        <div style="font-size:26px;font-weight:900;color:#0f172a;line-height:1">${val}</div>
        ${compareMode && delta !== null ? `
          <div style="margin-top:8px;display:flex;align-items:center;gap:5px">
            <span style="font-size:10px;font-weight:700;color:${dColor};background:${dColor}20;padding:2px 8px;border-radius:99px">${delta>0?'+':''}${delta.toFixed(1)}${isRet?'pp':'%'}</span>
            <span style="font-size:9px;color:#94a3b8">vs compare</span>
          </div>
          <div style="font-size:9.5px;color:#94a3b8;margin-top:4px">Compare: ${prev}</div>
        ` : ''}
      </div>`;
    };

    // ── Timing HTML ──
    const bkt = emptyBucket(); currentData.forEach(d => addToBucket(bkt, d));
    const timingItems = [
      { name:'On Time', desc:'Same month or before', val: bkt.mMinus+bkt.m0, color:'#10b981' },
      { name:'Late',    desc:'After expiry month',   val: bkt.m1+bkt.m2+bkt.m3+bkt.m3plus, color:'#f59e0b' },
      { name:'Pending', desc:'Not yet renewed',      val: bkt.pending, color:'#f43f5e' },
    ];
    const timingHtml = timingItems.map(item => {
      const pct = bkt.total > 0 ? (item.val / bkt.total * 100).toFixed(1) : '0';
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <div><span style="font-size:12px;font-weight:700;color:${item.color}">${item.name}</span><span style="font-size:10px;color:#94a3b8;margin-left:6px">${item.desc}</span></div>
          <div><span style="font-size:13px;font-weight:800;color:#1e293b">${item.val}</span><span style="font-size:10px;color:#94a3b8;margin-left:6px">${pct}%</span></div>
        </div>
        <div style="height:6px;background:#f1f5f9;border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${item.color};border-radius:99px"></div>
        </div>
      </div>`;
    }).join('');

    // ── Monthly table HTML ──
    const monthlyHtml = monthlyChartData.map(r => {
      const tot = r.renewed + r.pending;
      const ret = tot > 0 ? r.renewed / tot * 100 : 0;
      return `<tr style="border-bottom:1px solid #f1f5f9">
        <td style="padding:6px 10px;font-size:11.5px;font-weight:600;color:#334155">${r.name}</td>
        <td style="padding:6px 7px;text-align:right;font-size:11.5px;font-weight:700;color:#0f172a">${tot}</td>
        <td style="padding:6px 7px;text-align:right;font-size:11.5px;font-weight:600;color:#059669">${r.renewed}</td>
        <td style="padding:6px 7px;text-align:right;font-size:11.5px;color:#e11d48">${r.pending}</td>
        <td style="padding:6px 7px;text-align:right;font-size:11.5px;font-weight:800;color:${rc(ret)}">${ret.toFixed(1)}%</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>KDK Renewal Intelligence Report</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#1e293b;background:#f0f4f8;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:20px}
  @page{margin:10mm 12mm;size:A4 landscape}
  @media print{body{background:white;padding:0}.no-print{display:none!important}}
  .page-break{page-break-before:always;padding-top:16px}
</style></head><body>

<!-- ── COVER HEADER ── -->
<div style="background:linear-gradient(135deg,#1e3a5f 0%,#2b5280 55%,#3a749b 100%);padding:24px 28px;border-radius:16px;margin-bottom:16px;position:relative;overflow:hidden">
  <div style="position:absolute;top:-50px;right:-50px;width:220px;height:220px;border-radius:50%;background:rgba(255,255,255,0.05)"></div>
  <div style="position:absolute;bottom:-30px;right:120px;width:100px;height:100px;border-radius:50%;background:rgba(245,124,115,0.18)"></div>
  <div style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:1">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:48px;height:48px;background:rgba(255,255,255,0.12);border-radius:12px;display:flex;align-items:center;justify-content:center;padding:5px">
        <svg width="38" height="38" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <path d="M 12 12 L 38 12 L 12 64 Z" fill="#7ec8e8" stroke="#7ec8e8" stroke-width="8" stroke-linejoin="round"/>
          <path d="M 55 12 L 88 12 L 88 43 L 18 85 Z" fill="#f57c73" stroke="#f57c73" stroke-width="8" stroke-linejoin="round"/>
          <path d="M 42 88 L 88 60 L 88 88 Z" fill="#7ec8e8" stroke="#7ec8e8" stroke-width="8" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <div style="color:rgba(255,255,255,0.55);font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px">KDK Softwares · Renewal Intelligence</div>
        <div style="color:white;font-size:20px;font-weight:900;line-height:1.1">Renewal Analytics Report</div>
      </div>
    </div>
    <div style="text-align:right;color:rgba(255,255,255,0.65)">
      <div style="font-size:10px;margin-bottom:3px">Generated on</div>
      <div style="font-size:12px;font-weight:700;color:white">${generatedOn}</div>
    </div>
  </div>
  <div style="display:flex;gap:8px;margin-top:14px;position:relative;z-index:1;flex-wrap:wrap">
    <div style="background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.25);border-radius:99px;padding:4px 13px;display:inline-flex;align-items:center;gap:5px">
      <div style="width:6px;height:6px;border-radius:50%;background:#34d399"></div>
      <span style="color:white;font-size:11px;font-weight:700">Primary: ${rangeLabel}</span>
    </div>
    ${compareMode ? `<div style="background:rgba(251,191,36,0.18);border:1px solid rgba(251,191,36,0.4);border-radius:99px;padding:4px 13px;display:inline-flex;align-items:center;gap:5px">
      <div style="width:6px;height:6px;border-radius:50%;background:#fbbf24"></div>
      <span style="color:#fef3c7;font-size:11px;font-weight:700">Compare: ${compareLabel}</span>
    </div>` : ''}
    ${filters.salesGroups.length > 0 ? `<div style="background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:99px;padding:4px 13px"><span style="color:#c7d2fe;font-size:11px;font-weight:600">Groups: ${filters.salesGroups.join(', ')}</span></div>` : ''}
    ${filters.platform !== 'All' ? `<div style="background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:99px;padding:4px 13px"><span style="color:#c7d2fe;font-size:11px;font-weight:600">Platform: ${filters.platform}</span></div>` : ''}
    ${filters.products.length > 0 ? `<div style="background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:99px;padding:4px 13px"><span style="color:#c7d2fe;font-size:11px;font-weight:600">Products: ${filters.products.join(', ')}</span></div>` : ''}
  </div>
</div>

<!-- ── KPI CARDS ── -->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
  ${kpiCard('Total Due',      currentStats.total,                  compareMode ? prevStats.total     : null, '#6366f1')}
  ${kpiCard('Renewed',        currentStats.renewed,                compareMode ? prevStats.renewed   : null, '#3b82f6')}
  ${kpiCard('Pending Risk',   currentStats.pending,                compareMode ? prevStats.pending   : null, '#f43f5e')}
  ${kpiCard('Retention Rate', currentStats.retention.toFixed(1)+'%', compareMode ? prevStats.retention.toFixed(1)+'%' : null, '#10b981', true)}
</div>

<!-- ── TIMING + MONTHLY ── -->
<div style="display:grid;grid-template-columns:220px 1fr;gap:12px;margin-bottom:14px">
  <div style="background:white;border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,0.06)">
    <div style="font-size:12px;font-weight:800;color:#1e293b;margin-bottom:3px">Renewal Timing</div>
    <div style="font-size:10px;color:#94a3b8;margin-bottom:12px">Month offset from expiry</div>
    ${timingHtml}
    <div style="font-size:9.5px;color:#94a3b8;margin-top:10px;padding-top:8px;border-top:1px solid #f1f5f9">${currentStats.renewed} renewed · ${currentStats.pending} pending · ${currentData.length} total</div>
  </div>
  <div style="background:white;border-radius:14px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,0.06)">
    <div style="font-size:12px;font-weight:800;color:#1e293b;margin-bottom:3px">Monthly Renewal Trends</div>
    <div style="font-size:10px;color:#94a3b8;margin-bottom:10px">All-time · renewed vs pending by expiry month</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8fafc">
        <th style="padding:6px 10px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;border-bottom:2px solid #e2e8f0">Month</th>
        <th style="padding:6px 7px;text-align:right;font-size:9.5px;font-weight:700;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0">Total</th>
        <th style="padding:6px 7px;text-align:right;font-size:9.5px;font-weight:700;text-transform:uppercase;color:#059669;border-bottom:2px solid #e2e8f0">Renewed</th>
        <th style="padding:6px 7px;text-align:right;font-size:9.5px;font-weight:700;text-transform:uppercase;color:#e11d48;border-bottom:2px solid #e2e8f0">Pending</th>
        <th style="padding:6px 7px;text-align:right;font-size:9.5px;font-weight:700;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0">Ret %</th>
      </tr></thead>
      <tbody>${monthlyHtml}</tbody>
    </table>
  </div>
</div>

<!-- ── STAGE MATRIX ── -->
<div class="page-break">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
    <div style="width:4px;height:18px;background:linear-gradient(180deg,#6366f1,#3a749b);border-radius:2px"></div>
    <span style="font-size:14px;font-weight:900;color:#1e293b">Renewal Stage Matrix</span>
    <span style="font-size:10px;font-weight:600;color:#94a3b8;background:#f1f5f9;padding:3px 10px;border-radius:99px">${rangeLabel}</span>
  </div>
  ${compareMode
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>${matrixTableHtml(matrixGroups,     `Primary · ${rangeLabel}`,   '#1e3a5f')}</div>
        <div>${matrixTableHtml(prevMatrixGroups, `Compare · ${compareLabel}`, '#92400e')}</div>
       </div>`
    : matrixTableHtml(matrixGroups, '', '#1e3a5f')
  }
</div>

<!-- ── PRINT BUTTON ── -->
<div class="no-print" style="position:fixed;bottom:20px;right:20px;z-index:9999">
  <button onclick="window.print()" style="background:linear-gradient(135deg,#2b5280,#3a749b);color:white;border:none;padding:11px 22px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 18px rgba(58,116,155,0.45);display:flex;align-items:center;gap:7px">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    Save as PDF
  </button>
</div>

</body></html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Please allow popups to generate the PDF report.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 900);
  };

  // ─── DATE PICKER ────────────────────────────────────────────────────────────

  const openDatePicker = () => {
    if (datePickerTriggerRef.current) {
      const rect = datePickerTriggerRef.current.getBoundingClientRect();
      setPickerAnchor({ top: rect.bottom + 6, left: rect.left });
    }
    setShowDatePicker(true);
  };

  const handleApplyRange = (range: { start: string; end: string }, label: string) => {
    setPrimaryRange(range);
    setActiveDateLabel(label);
    setShowDatePicker(false);
    setPickerAnchor(null);
    // Auto-update compare range to the equivalent previous period
    if (compareMode) {
      const pStart = parseISO(range.start);
      const pEnd = parseISO(range.end);
      const duration = differenceInDays(pEnd, pStart);
      const cEnd = subDays(pStart, 1);
      const cStart = subDays(cEnd, duration);
      setCompareRange({ start: format(cStart, 'yyyy-MM-dd'), end: format(cEnd, 'yyyy-MM-dd') });
    }
  };

  const handleToggleCompare = () => {
    if (!compareMode) {
      // Auto-set compare to the equivalent previous period
      const pStart = parseISO(primaryRange.start);
      const pEnd = parseISO(primaryRange.end);
      const duration = differenceInDays(pEnd, pStart);
      const cEnd = subDays(pStart, 1);
      const cStart = subDays(cEnd, duration);
      setCompareRange({ start: format(cStart, 'yyyy-MM-dd'), end: format(cEnd, 'yyyy-MM-dd') });
    }
    setCompareMode(m => !m);
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-16 relative">

      {/* Background blobs */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[55%] h-[55%] rounded-full bg-indigo-500/8 blur-[160px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-rose-500/8 blur-[160px] animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute top-[30%] right-[5%] w-[35%] h-[35%] rounded-full bg-emerald-500/8 blur-[120px] animate-pulse" style={{ animationDelay: '4s' }} />
      </div>

      {/* ── STICKY HEADER ────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-[100] bg-slate-50/96 backdrop-blur-xl border-b border-slate-200/70 shadow-sm">

        {/* Row 1: Brand + Actions */}
        <div className="px-4 sm:px-6 pt-4 pb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="KDK Softwares" className="w-10 h-10 rounded-xl object-contain shrink-0 shadow-md" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-slate-900 leading-tight">Renewal Intelligence</h1>
                <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded-full">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest">Live</span>
                </div>
              </div>
              <p className="text-xs text-slate-500 font-medium">KDK Softwares · Intelligent Dashboard</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Numbers / Percentages toggle */}
            <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200/60">
              {(['numbers', 'percentages'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-bold rounded-lg capitalize transition-all',
                    viewMode === mode ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  {mode === 'numbers' ? '#' : '%'}
                  <span className="hidden sm:inline ml-1">{mode === 'numbers' ? 'Numbers' : 'Percent'}</span>
                </button>
              ))}
            </div>

            <button onClick={exportToExcel} className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-sm">
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export Excel</span>
              <span className="sm:hidden">XLSX</span>
            </button>
          </div>
        </div>

        {/* Row 2: Date range + Compare + Filters — all in one flex-wrap row */}
        <div className="px-4 sm:px-6 pb-3 flex flex-wrap items-center gap-2">

          {/* Date range trigger button */}
          <button
            ref={datePickerTriggerRef}
            onClick={openDatePicker}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 px-3 py-1.5 rounded-xl transition-all group"
          >
            <CalendarDays className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span className="text-xs font-bold text-indigo-600">{activeDateLabel}:</span>
            <span className="text-xs font-semibold text-slate-600">
              {format(parseISO(primaryRange.start), 'MMM d')} – {format(parseISO(primaryRange.end), 'MMM d, yyyy')}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-400 transition-colors" />
          </button>

          {/* Compare toggle */}
          <button
            onClick={handleToggleCompare}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border shrink-0',
              compareMode
                ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300 hover:text-amber-700'
            )}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Compare
          </button>

          {/* Compare date inputs — appear inline when compare is active */}
          <AnimatePresence>
            {compareMode && (
              <motion.div
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-1.5"
              >
                <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest shrink-0">vs</span>
                <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-300 focus-within:ring-2 focus-within:ring-amber-100 transition-all">
                  <input
                    type="date"
                    className="bg-transparent text-xs font-semibold outline-none text-amber-900 w-28"
                    value={compareRange.start}
                    onChange={e => setCompareRange(p => ({ ...p, start: e.target.value }))}
                  />
                  <span className="text-amber-400 font-bold">→</span>
                  <input
                    type="date"
                    className="bg-transparent text-xs font-semibold outline-none text-amber-900 w-28"
                    value={compareRange.end}
                    onChange={e => setCompareRange(p => ({ ...p, end: e.target.value }))}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="w-px h-5 bg-slate-200 shrink-0" />

          {/* Filters — same row, separated by divider */}
          <MultiSelectFilter
            values={filters.salesGroups}
            onChange={v => setFilters(p => ({ ...p, salesGroups: v }))}
            options={['KDK', 'Self', 'Partner']}
            allLabel="All Groups"
          />
          <FilterSelect
            value={filters.industry}
            onChange={v => setFilters(p => ({ ...p, industry: v }))}
            options={['All', 'DIFM', 'DIY']}
            allLabel="All Industries"
          />
          <FilterSelect
            value={filters.platform}
            onChange={v => setFilters(p => ({ ...p, platform: v }))}
            options={['All', 'Cloud', 'Desktop']}
            allLabel="All Platforms"
          />
          <MultiSelectFilter
            values={filters.products}
            onChange={v => setFilters(p => ({ ...p, products: v }))}
            options={
              filters.platform === 'Cloud'   ? [...CLOUD_PRODUCTS] :
              filters.platform === 'Desktop' ? [...DESKTOP_PRODUCTS] :
              [...ALL_PRODUCTS]
            }
            allLabel="All Products"
          />
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <main className="px-4 sm:px-6 py-6 mx-auto max-w-[1600px] space-y-6 relative z-10">

        {/* KPI CARDS */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            title="Total Due"
            value={currentStats.total}
            delta={compareMode ? calculateDelta(currentStats.total, prevStats.total) : undefined}
            icon={<Users />}
            color="indigo"
            tooltip="Total subscriptions expiring in the selected date range."
          />
          <KPICard
            title="Retention Rate"
            value={`${currentStats.retention.toFixed(1)}%`}
            delta={compareMode ? currentStats.retention - prevStats.retention : undefined}
            icon={<TrendingUp />}
            color="emerald"
            tooltip="Percentage of subscriptions successfully renewed."
            deltaLabel="pp vs compare"
          />
          <KPICard
            title="Renewed"
            value={currentStats.renewed}
            delta={compareMode ? calculateDelta(currentStats.renewed, prevStats.renewed) : undefined}
            icon={<CheckCircle2 />}
            color="blue"
            tooltip="Subscriptions that have already been renewed."
          />
          <KPICard
            title="Pending Risk"
            value={currentStats.pending}
            delta={compareMode ? calculateDelta(currentStats.pending, prevStats.pending) : undefined}
            inverseDelta
            icon={<ShieldAlert />}
            color="rose"
            tooltip="Subscriptions that have not yet renewed — at risk of churn."
          />
        </section>

        {/* INSIGHTS PANEL (compare mode only) */}
        <InsightsPanel
          current={currentStats}
          prev={prevStats}
          compareMode={compareMode}
          primaryRange={primaryRange}
          compareRange={compareRange}
        />

        {/* RENEWAL STAGE MATRIX */}
        <section className={cn('grid grid-cols-1 gap-4', compareMode && 'xl:grid-cols-2')}>
          <div className="glass-card overflow-hidden flex flex-col">
            <div className="px-5 pt-5 pb-3 border-b border-slate-100">
              <SectionHeader
                icon={<Activity className="w-4 h-4" />}
                title="Renewal Stage Matrix"
                color="indigo"
                badge={`${format(parseISO(primaryRange.start), 'MMM d')} – ${format(parseISO(primaryRange.end), 'MMM d, yyyy')}`}
              />
            </div>
            <MatrixTable data={matrixGroups} viewMode={viewMode} />
          </div>

          <AnimatePresence>
            {compareMode && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                className="glass-card overflow-hidden flex flex-col border-amber-200/50"
              >
                <div className="px-5 pt-5 pb-3 border-b border-amber-100">
                  <SectionHeader
                    icon={<History className="w-4 h-4" />}
                    title="Compare Period Matrix"
                    color="amber"
                    badge={`${format(parseISO(compareRange.start), 'MMM d')} – ${format(parseISO(compareRange.end), 'MMM d, yyyy')}`}
                  />
                </div>
                <MatrixTable data={prevMatrixGroups} viewMode={viewMode} isCompare />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ── CHARTS ROW 1: Monthly Trends + Sales Group ────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Monthly Renewal Trends — 2 columns wide */}
          <div className="glass-card p-5 lg:col-span-2">
            <SectionHeader
              icon={<BarChart3 className="w-4 h-4" />}
              title="Monthly Renewal Trends"
              subtitle="Renewed vs pending by expiry month · All time"
              color="blue"
            />
            {monthlyChartData.length === 0 ? (
              <EmptyChart />
            ) : (
              <div className="h-[260px] mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData} barGap={2} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} dy={6} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} dx={-4} />
                    <Tooltip
                      wrapperStyle={{ zIndex: 9999 }}
                      contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: '10px 14px', fontSize: 12 }}
                      cursor={{ fill: '#f8fafc' }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 12 }}
                      formatter={(val) => <span style={{ color: '#64748b', textTransform: 'capitalize' }}>{val}</span>}
                    />
                    <Bar dataKey="renewed" name="Renewed" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={36} />
                    <Bar dataKey="pending" name="Pending" fill="#e2e8f0" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Sales Group Donut */}
          <div className="glass-card p-5">
            <SectionHeader
              icon={<PieChartIcon className="w-4 h-4" />}
              title="Sales Group Mix"
              subtitle="Distribution by channel"
              color="purple"
            />
            {currentStats.total === 0 ? (
              <EmptyChart />
            ) : (
              <div className="mt-4">
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={salesGroupData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {salesGroupData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        wrapperStyle={{ zIndex: 9999 }}
                        contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: '8px 12px', fontSize: 12 }}
                        formatter={(val: number) => [`${val} subs`, '']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-2 mt-2">
                  {salesGroupData.map(item => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
                        <span className="text-xs font-semibold text-slate-600">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800">{item.value}</span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {currentStats.total > 0 ? `${((item.value / currentStats.total) * 100).toFixed(0)}%` : '—'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── CHARTS ROW 2: Timing + Stage Retention + Industry + Platform ───── */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">

          {/* Renewal Timing Breakdown */}
          <div className="glass-card p-5 isolate overflow-hidden">
            <SectionHeader
              icon={<Clock className="w-4 h-4" />}
              title="Renewal Timing"
              subtitle="Month offset from expiry date"
              color="emerald"
            />
            <div className="mt-4 h-[220px] flex flex-col justify-between">
              <div className="space-y-0 flex flex-col justify-around h-full">
                {timingData.map(item => {
                  const total = currentData.length;
                  const pct = total > 0 ? (item.value / total) * 100 : 0;
                  if (item.value === 0) return null;
                  return (
                    <div key={item.name}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-black tabular-nums" style={{ color: item.fill }}>{item.name}</span>
                          <span className="text-[11px] text-slate-400 truncate">{item.desc}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-sm font-black text-slate-800">{item.value}</span>
                          <span className="text-xs font-semibold text-slate-400 w-8 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="h-3.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.7, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: item.fill }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {currentData.length > 0 && (
                <p className="text-[10px] text-slate-400 font-medium border-t border-slate-100 pt-3">
                  {currentStats.renewed} renewed · {currentStats.pending} pending · {currentData.length} total
                </p>
              )}
            </div>
          </div>

          {/* Stage Retention Rate */}
          <div className="glass-card p-5">
            <SectionHeader
              icon={<Layers className="w-4 h-4" />}
              title="Stage Retention"
              subtitle="Retention % by subscription year"
              color="indigo"
            />
            {stageRetentionData.every(d => d.total === 0) ? (
              <EmptyChart />
            ) : (
              <div className="h-[220px] mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stageRetentionData}
                    layout="vertical"
                    margin={{ top: 0, right: 32, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                      tickFormatter={v => `${v}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }}
                      width={62}
                    />
                    <Tooltip
                      wrapperStyle={{ zIndex: 9999 }}
                      contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: '8px 12px', fontSize: 12 }}
                      formatter={(val: number) => [`${val}%`, 'Retention']}
                    />
                    <Bar dataKey="retention" radius={[0, 6, 6, 0]} maxBarSize={28}>
                      {stageRetentionData.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.retention >= 80 ? '#10b981' : entry.retention >= 65 ? '#6366f1' : '#f43f5e'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Industry Split — separate pie chart */}
          <MiniDonutCard
            title="Industry Mix"
            subtitle="DIFM vs DIY"
            data={industryData}
            total={currentStats.total}
          />

          {/* Platform Split — separate pie chart */}
          <MiniDonutCard
            title="Platform Mix"
            subtitle="Cloud vs Desktop"
            data={platformData}
            total={currentStats.total}
          />
        </section>

        {/* ── CHARTS ROW 3: Daily Renewal Velocity ──────────────────────────── */}
        <section className="glass-card p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <SectionHeader
              icon={<TrendingUp className="w-4 h-4" />}
              title="Daily Renewal Velocity"
              subtitle={`Due vs Renewed per day · ${format(parseISO(primaryRange.start), 'MMM d')} – ${format(parseISO(primaryRange.end), 'MMM d, yyyy')}`}
              color="indigo"
            />
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-500 shrink-0">
              <div className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-slate-400 rounded inline-block" style={{ borderTop: '2px dashed #94a3b8' }} />Due (expiring)</div>
              <div className="flex items-center gap-1.5"><span className="w-5 h-0.5 bg-indigo-500 rounded inline-block" />Renewed</div>
            </div>
          </div>
          {dailyTrendData.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="h-[220px] mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrendData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="dueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="renewedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} interval="preserveStartEnd" dy={6} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }} dx={-4} />
                  <Tooltip
                    wrapperStyle={{ zIndex: 9999 }}
                    contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: '8px 12px', fontSize: 12 }}
                    formatter={(val: number | null, name: string) => [val ?? '—', name === 'due' ? 'Due (expiring)' : 'Renewed']}
                  />
                  <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} formatter={(v) => v === 'due' ? 'Due (expiring)' : 'Renewed'} />
                  <Area type="monotone" dataKey="due" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3" fillOpacity={1} fill="url(#dueGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="renewed" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#renewedGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

      </main>

      {/* Date Picker Dropdown */}
      <AnimatePresence>
        {showDatePicker && pickerAnchor && (
          <DatePickerModal
            currentRange={primaryRange}
            currentLabel={activeDateLabel}
            anchor={pickerAnchor}
            onApply={handleApplyRange}
            onClose={() => { setShowDatePicker(false); setPickerAnchor(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── DATE PICKER MODAL ───────────────────────────────────────────────────────

function DatePickerModal({
  currentRange,
  currentLabel,
  anchor,
  onApply,
  onClose,
}: {
  currentRange: { start: string; end: string };
  currentLabel: string;
  anchor: { top: number; left: number };
  onApply: (range: { start: string; end: string }, label: string) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const presets = [
    {
      label: 'This Week',
      range: {
        start: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        end: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      },
    },
    {
      label: 'This Month',
      range: {
        start: format(startOfMonth(now), 'yyyy-MM-dd'),
        end: format(endOfMonth(now), 'yyyy-MM-dd'),
      },
    },
    {
      label: 'Last Month',
      range: {
        start: format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'),
        end: format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'),
      },
    },
    {
      label: 'Last Quarter',
      range: (() => {
        // FY quarters: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
        const m = now.getMonth();
        const y = now.getFullYear();
        if (m >= 3 && m <= 5) return { start: format(new Date(y, 0, 1), 'yyyy-MM-dd'), end: format(new Date(y, 2, 31), 'yyyy-MM-dd') };         // Q1 → prev Q4
        if (m >= 6 && m <= 8) return { start: format(new Date(y, 3, 1), 'yyyy-MM-dd'), end: format(new Date(y, 5, 30), 'yyyy-MM-dd') };         // Q2 → Q1
        if (m >= 9 && m <= 11) return { start: format(new Date(y, 6, 1), 'yyyy-MM-dd'), end: format(new Date(y, 8, 30), 'yyyy-MM-dd') };        // Q3 → Q2
        return { start: format(new Date(y - 1, 9, 1), 'yyyy-MM-dd'), end: format(new Date(y - 1, 11, 31), 'yyyy-MM-dd') };                      // Q4 → Q3
      })(),
    },
    {
      label: 'This FY',
      range: (() => {
        const m = now.getMonth();
        const y = now.getFullYear();
        const fyStartYear = m >= 3 ? y : y - 1;
        return {
          start: format(new Date(fyStartYear, 3, 1), 'yyyy-MM-dd'),
          end:   format(new Date(fyStartYear + 1, 2, 31), 'yyyy-MM-dd'),
        };
      })(),
    },
    {
      label: 'Last FY',
      range: (() => {
        const m = now.getMonth();
        const y = now.getFullYear();
        const fyStartYear = (m >= 3 ? y : y - 1) - 1;
        return {
          start: format(new Date(fyStartYear, 3, 1), 'yyyy-MM-dd'),
          end:   format(new Date(fyStartYear + 1, 2, 31), 'yyyy-MM-dd'),
        };
      })(),
    },
  ];

  const [tempRange, setTempRange] = useState(currentRange);
  const [activePreset, setActivePreset] = useState(currentLabel);

  const handlePreset = (label: string, range: { start: string; end: string }) => {
    setActivePreset(label);
    setTempRange(range);
  };

  const handleCustomChange = (field: 'start' | 'end', value: string) => {
    setActivePreset('Custom');
    setTempRange(p => ({ ...p, [field]: value }));
  };

  // Clamp left so it never overflows the viewport
  const panelWidth = 360;
  const clampedLeft = Math.min(anchor.left, Math.max(0, window.innerWidth - panelWidth - 16));

  return (
    <>
      {/* Invisible backdrop — closes on click outside */}
      <div
        className="fixed inset-0 z-[200]"
        onClick={onClose}
      />

      {/* Dropdown panel */}
      <motion.div
        key="modal"
        initial={{ opacity: 0, scale: 0.97, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -6 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="fixed z-[201] w-[360px]"
        style={{ top: anchor.top, left: clampedLeft }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-bold text-slate-800">Select Date Range</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Presets */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Quick Select</p>
            <div className="grid grid-cols-2 gap-1.5">
              {presets.map(p => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p.label, p.range)}
                  className={cn(
                    'px-3 py-2 rounded-xl text-xs font-bold text-left transition-all border',
                    activePreset === p.label
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                  )}
                >
                  {p.label}
                  <span className={cn(
                    'block text-[10px] font-medium mt-0.5',
                    activePreset === p.label ? 'text-indigo-200' : 'text-slate-400'
                  )}>
                    {format(parseISO(p.range.start), 'MMM d')} – {format(parseISO(p.range.end), 'MMM d, yyyy')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Range */}
          <div className="px-5 pt-3 pb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Custom Range</p>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <input
                type="date"
                className="bg-transparent text-xs font-semibold outline-none text-slate-700 flex-1"
                value={tempRange.start}
                onChange={e => handleCustomChange('start', e.target.value)}
              />
              <span className="text-slate-300 font-bold">→</span>
              <input
                type="date"
                className="bg-transparent text-xs font-semibold outline-none text-slate-700 flex-1"
                value={tempRange.end}
                onChange={e => handleCustomChange('end', e.target.value)}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply(tempRange, activePreset)}
              className="px-5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all shadow-sm"
            >
              Apply
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

// Shared section header inside cards
function SectionHeader({
  icon, title, subtitle, color, badge
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  color: 'indigo' | 'blue' | 'emerald' | 'purple' | 'amber' | 'rose' | 'slate';
  badge?: string;
}) {
  const iconBg = {
    indigo: 'bg-indigo-50 text-indigo-600',
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-600',
  }[color];

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className={cn('p-1.5 rounded-lg shrink-0', iconBg)}>{icon}</div>
        <div>
          <h2 className="text-sm font-bold text-slate-800 leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-slate-400 font-medium mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {badge && (
        <span className={cn(
          'text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shrink-0',
          color === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-500'
        )}>
          {badge}
        </span>
      )}
    </div>
  );
}

// Empty state for charts
function EmptyChart() {
  return (
    <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm font-medium">
      No data for the selected period
    </div>
  );
}

// ─── Matrix helpers ───────────────────────────────────────────────────────
const bucketDone = (b: BucketStats) => b.mMinus + b.m0 + b.m1 + b.m2 + b.m3 + b.m3plus;
const bucketRet  = (b: BucketStats) => b.total > 0 ? (bucketDone(b) / b.total) * 100 : 0;

function MatrixTable({
  data, viewMode, isCompare = false
}: {
  data: MonthMatrixRow[];
  viewMode: 'numbers' | 'percentages';
  isCompare?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const STAGES = ['1st Year', '2nd Year', '3rd Year+'] as const;

  const toggle = (m: string) => setExpanded(p => {
    const n = new Set(p);
    n.has(m) ? n.delete(m) : n.add(m);
    return n;
  });

  const fmt = (n: number, total: number) =>
    viewMode === 'percentages'
      ? (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—')
      : (n === 0 ? '—' : n);

  // Return true when a cell should show a real value (not a dash)
  const hasVal = (n: number) => n > 0;

  const retColor = (r: number) =>
    r >= 80 ? 'text-emerald-600 font-black' : r >= 65 ? 'text-indigo-600 font-bold' : 'text-rose-600 font-black';

  if (data.length === 0) {
    return <div className="py-10 text-center text-slate-400 text-sm">No data for the selected period</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm min-w-[560px]">

        {/* ── Column headers ── */}
        <thead>
          <tr className={cn('border-b-2 text-xs font-bold uppercase tracking-wide',
            isCompare ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50'
          )}>
            <th className="px-4 py-2.5 text-left text-slate-700 w-[22%]">Month / Stage</th>
            <th className="px-3 py-2.5 text-right text-slate-600 w-[7%]">Due</th>
            <th className="px-3 py-2.5 text-right text-emerald-700 w-[7%]" title="Renewed before expiry month">M &lt;0</th>
            <th className="px-3 py-2.5 text-right text-blue-700 w-[7%]"   title="Renewed in same month as expiry">M 0</th>
            <th className="px-3 py-2.5 text-right text-amber-700 w-[7%]"  title="Renewed 1 month after expiry">M+1</th>
            <th className="px-3 py-2.5 text-right text-orange-600 w-[7%]" title="Renewed 2 months after expiry">M+2</th>
            <th className="px-3 py-2.5 text-right text-red-500 w-[7%]"   title="Renewed 3 months after expiry">M+3</th>
            <th className="px-3 py-2.5 text-right text-red-700 w-[7%]"   title="Renewed more than 3 months after expiry">M 3+</th>
            <th className={cn('px-3 py-2.5 text-right w-[9%] font-black',
              isCompare ? 'text-rose-600 bg-rose-50/60' : 'text-rose-700 bg-rose-50'
            )}>Pending</th>
            <th className="px-3 py-2.5 text-right text-slate-700 w-[7%]">Done</th>
            <th className="px-3 py-2.5 text-right text-slate-600 w-[9%]">Ret %</th>
          </tr>
          {/* Subtitle row */}
          <tr className={cn('border-b text-[11px] text-slate-500',
            isCompare ? 'border-amber-100 bg-amber-50/20' : 'border-slate-100 bg-white'
          )}>
            <td className="px-4 py-1" />
            <td className="px-3 py-1 text-right">total</td>
            <td className="px-3 py-1 text-right text-emerald-600">before</td>
            <td className="px-3 py-1 text-right text-blue-600">same mo.</td>
            <td className="px-3 py-1 text-right text-amber-600">1 mo. late</td>
            <td className="px-3 py-1 text-right text-orange-500">2 mo. late</td>
            <td className="px-3 py-1 text-right text-red-500">3 mo. late</td>
            <td className="px-3 py-1 text-right text-red-600">&gt;3 mo.</td>
            <td className={cn('px-3 py-1 text-right text-rose-600 font-semibold',
              isCompare ? 'bg-rose-50/60' : 'bg-rose-50'
            )}>not renewed</td>
            <td className="px-3 py-1 text-right">renewed</td>
            <td className="px-3 py-1 text-right">done/due</td>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-100">
          {data.map(row => {
            const isExp = expanded.has(row.month);
            const b = row.total;
            const done = bucketDone(b);
            const r = bucketRet(b);

            return (
              <React.Fragment key={row.month}>

                {/* Month summary row */}
                <tr
                  onClick={() => toggle(row.month)}
                  className={cn(
                    'cursor-pointer select-none border-t-2 transition-colors',
                    isCompare
                      ? 'border-amber-200 bg-amber-50/50 hover:bg-amber-100/60'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100/70'
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ChevronRight className={cn(
                        'w-3.5 h-3.5 shrink-0 transition-transform',
                        isCompare ? 'text-amber-400' : 'text-slate-400',
                        isExp && 'rotate-90'
                      )} />
                      <span className={cn('font-bold text-sm', isCompare ? 'text-amber-900' : 'text-slate-800')}>
                        {row.month}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-800">{b.total}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums font-semibold', hasVal(b.mMinus) ? 'text-emerald-700' : 'text-slate-300')}>{fmt(b.mMinus, b.total)}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums font-semibold', hasVal(b.m0)     ? 'text-blue-700'    : 'text-slate-300')}>{fmt(b.m0,     b.total)}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums',              hasVal(b.m1)     ? 'text-amber-700'   : 'text-slate-300')}>{fmt(b.m1,     b.total)}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums',              hasVal(b.m2)     ? 'text-orange-600'  : 'text-slate-300')}>{fmt(b.m2,     b.total)}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums',              hasVal(b.m3)     ? 'text-red-600'     : 'text-slate-300')}>{fmt(b.m3,     b.total)}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums',              hasVal(b.m3plus) ? 'text-red-800'     : 'text-slate-300')}>{fmt(b.m3plus, b.total)}</td>
                  <td className={cn(
                    'px-3 py-3 text-right tabular-nums font-black',
                    isCompare ? 'bg-rose-50/60' : 'bg-rose-50',
                    b.pending > 0 ? 'text-rose-600' : 'text-slate-300'
                  )}>
                    {b.pending > 0 ? b.pending : '—'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800">{done}</td>
                  <td className={cn('px-3 py-3 text-right tabular-nums', retColor(r))}>{r.toFixed(1)}%</td>
                </tr>

                {/* Stage sub-rows */}
                <AnimatePresence>
                  {isExp && STAGES.map(stage => {
                    const sb = row.byStage[stage];
                    if (!sb || sb.total === 0) return null;
                    const sd = bucketDone(sb);
                    const sr = bucketRet(sb);
                    const accent =
                      stage === '1st Year'  ? 'border-l-indigo-400' :
                      stage === '2nd Year'  ? 'border-l-violet-400' : 'border-l-emerald-400';
                    return (
                      <motion.tr
                        key={stage}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className={cn(
                          'bg-white border-l-4 hover:bg-slate-50/60 transition-colors',
                          accent
                        )}
                      >
                        <td className="px-4 py-2.5 pl-9 text-slate-500 font-medium text-sm">{stage}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-600">{sb.total}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', hasVal(sb.mMinus) ? 'text-emerald-600 font-semibold' : 'text-slate-300')}>{fmt(sb.mMinus, sb.total)}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', hasVal(sb.m0)     ? 'text-blue-600 font-semibold'    : 'text-slate-300')}>{fmt(sb.m0,     sb.total)}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', hasVal(sb.m1)     ? 'text-amber-600'                 : 'text-slate-300')}>{fmt(sb.m1,     sb.total)}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', hasVal(sb.m2)     ? 'text-orange-600'                : 'text-slate-300')}>{fmt(sb.m2,     sb.total)}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', hasVal(sb.m3)     ? 'text-red-600'                   : 'text-slate-300')}>{fmt(sb.m3,     sb.total)}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', hasVal(sb.m3plus) ? 'text-red-800'                   : 'text-slate-300')}>{fmt(sb.m3plus, sb.total)}</td>
                        <td className={cn(
                          'px-3 py-2.5 text-right tabular-nums font-bold',
                          isCompare ? 'bg-rose-50/60' : 'bg-rose-50',
                          sb.pending > 0 ? 'text-rose-500' : 'text-slate-300'
                        )}>
                          {sb.pending > 0 ? sb.pending : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-slate-700">{sd}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums', retColor(sr))}>{sr.toFixed(1)}%</td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>

              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Multi-select filter dropdown — values=[] means "All"
function MultiSelectFilter({
  values, onChange, options, allLabel,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (opt: string) => {
    if (values.includes(opt)) {
      onChange(values.filter(v => v !== opt));
    } else {
      onChange([...values, opt]);
    }
  };

  const label = values.length === 0 ? allLabel
    : values.length === 1 ? values[0]
    : `${values.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(p => !p)}
        className={cn(
          'flex items-center gap-1.5 bg-white border rounded-xl pl-3 pr-2 py-1.5 text-xs font-semibold text-slate-700',
          'hover:border-slate-300 transition-all shadow-sm',
          open ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200',
          values.length > 0 && 'border-indigo-300 bg-indigo-50 text-indigo-700'
        )}
      >
        <span className="max-w-[110px] truncate">{label}</span>
        <ChevronDown className={cn('w-3 h-3 text-slate-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-[200] min-w-[160px] py-1 overflow-hidden"
          >
            <button
              onClick={() => onChange([])}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors text-left',
                values.length === 0 ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              <div className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                values.length === 0 ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300'
              )}>
                {values.length === 0 && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
              </div>
              {allLabel}
            </button>
            <div className="h-px bg-slate-100 mx-2 my-0.5" />
            {options.map(opt => (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors text-left',
                  values.includes(opt) ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
                )}
              >
                <div className={cn('w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                  values.includes(opt) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300'
                )}>
                  {values.includes(opt) && <div className="w-1.5 h-1.5 bg-white rounded-sm" />}
                </div>
                {opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Filter select dropdown — FIXED: proper allLabel prop instead of `All ${label}s`
function FilterSelect({
  value, onChange, options, allLabel
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-white border border-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-400 outline-none cursor-pointer hover:border-slate-300 transition-all shadow-sm"
      >
        {options.map(opt => (
          <option key={opt} value={opt}>{opt === 'All' ? allLabel : opt}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
    </div>
  );
}

// KPI Card — FIXED: tooltip now appears below the icon (top-full) to avoid sticky header overlap
function KPICard({
  title, value, delta, icon, color, tooltip, inverseDelta = false, deltaLabel = '% vs compare'
}: {
  title: string;
  value: string | number;
  delta?: number;
  icon: React.ReactNode;
  color: 'indigo' | 'emerald' | 'blue' | 'rose';
  tooltip?: string;
  inverseDelta?: boolean;
  deltaLabel?: string;
}) {
  const isPositive = delta !== undefined && delta > 0;
  const isNeutral = delta === 0;
  const isGood = inverseDelta ? !isPositive : isPositive;

  const colorMap = {
    indigo: { icon: 'from-indigo-500 to-indigo-600 shadow-indigo-500/20', border: 'border-indigo-500', bg: 'hover:bg-indigo-50/30' },
    emerald: { icon: 'from-emerald-400 to-emerald-500 shadow-emerald-500/20', border: 'border-emerald-500', bg: 'hover:bg-emerald-50/30' },
    blue: { icon: 'from-blue-400 to-blue-500 shadow-blue-500/20', border: 'border-blue-500', bg: 'hover:bg-blue-50/30' },
    rose: { icon: 'from-rose-400 to-rose-500 shadow-rose-500/20', border: 'border-rose-500', bg: 'hover:bg-rose-50/30' },
  }[color];

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn('glass-card p-5 flex flex-col justify-between border-b-[3px] transition-colors', colorMap.border, colorMap.bg)}
    >
      {/* Title row */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</span>
          {tooltip && <InfoTooltip text={tooltip} />}
        </div>
        <div className={cn('p-2.5 rounded-xl bg-gradient-to-br text-white shadow-md', colorMap.icon)}>
          {React.cloneElement(icon as React.ReactElement, { className: 'w-4 h-4' })}
        </div>
      </div>

      {/* Value + delta */}
      <div>
        <p className="text-3xl font-black text-slate-800 tracking-tight">{value}</p>
        {delta !== undefined && (
          <div className="flex items-center mt-2 gap-2">
            <span className={cn(
              'flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-lg',
              isNeutral ? 'bg-slate-100 text-slate-500'
                : isGood ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-rose-100 text-rose-700'
            )}>
              {!isNeutral && (isPositive
                ? <ArrowUpRight className="w-3 h-3" />
                : <ArrowDownRight className="w-3 h-3" />)}
              {delta > 0 ? '+' : ''}{delta.toFixed(1)}
            </span>
            <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">{deltaLabel}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// InfoTooltip — FIXED: appears BELOW the icon (top-full) instead of above (bottom-full)
// This prevents it from being hidden behind the sticky header.
function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group/tooltip relative inline-flex items-center justify-center ml-1">
      <Info className="w-3.5 h-3.5 text-slate-300 hover:text-indigo-400 transition-colors cursor-help" />
      <div className={cn(
        'absolute top-full left-1/2 -translate-x-1/2 mt-2 w-44 p-2.5',
        'bg-slate-900 text-white text-[10px] font-medium rounded-xl text-center leading-relaxed',
        'opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible',
        'transition-all duration-150 shadow-xl border border-white/10 pointer-events-none z-[500]'
      )}>
        {/* Arrow pointing up */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-b-slate-900" />
        {text}
      </div>
    </div>
  );
}

// Reusable mini donut chart card for Industry / Platform splits
function MiniDonutCard({
  title, subtitle, data, total
}: {
  title: string;
  subtitle: string;
  data: { name: string; value: number; fill: string }[];
  total: number;
}) {
  return (
    <div className="glass-card p-5 flex flex-col">
      <SectionHeader
        icon={<PieChartIcon className="w-4 h-4" />}
        title={title}
        subtitle={subtitle}
        color="slate"
      />
      {total === 0 ? (
        <EmptyChart />
      ) : (
        <div className="mt-4 flex flex-col items-center gap-3">
          <div className="h-[160px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={4}
                  dataKey="value"
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  wrapperStyle={{ zIndex: 9999 }}
                  contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: '8px 12px', fontSize: 12 }}
                  formatter={(val: number) => [`${val} subs (${total > 0 ? ((val / total) * 100).toFixed(0) : 0}%)`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-full flex flex-col gap-2">
            {data.map(item => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.fill }} />
                  <span className="text-xs font-semibold text-slate-600">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-800">{item.value}</span>
                  <span className="text-[10px] text-slate-400 font-medium w-8 text-right">
                    {total > 0 ? `${((item.value / total) * 100).toFixed(0)}%` : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Insights comparison banner
function InsightsPanel({
  current, prev, compareMode, primaryRange, compareRange
}: {
  current: Stats;
  prev: Stats;
  compareMode: boolean;
  primaryRange: { start: string; end: string };
  compareRange: { start: string; end: string };
}) {
  if (!compareMode) return null;

  const delta = current.retention - prev.retention;
  const improved = delta >= 0;
  const diff = Math.abs(delta).toFixed(1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-sm',
        improved ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
      )}
    >
      <div className={cn('p-2.5 rounded-xl text-white shrink-0', improved ? 'bg-emerald-500' : 'bg-rose-500')}>
        {improved ? <TrendingUp className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className={cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full',
            improved ? 'bg-emerald-200 text-emerald-800' : 'bg-rose-200 text-rose-800'
          )}>
            {improved ? 'Growth' : 'Risk'}
          </span>
          <span className="text-[9px] text-slate-400 font-medium">
            {primaryRange.start} – {primaryRange.end} &nbsp;vs&nbsp; {compareRange.start} – {compareRange.end}
          </span>
        </div>
        <p className={cn('font-bold text-sm', improved ? 'text-emerald-900' : 'text-rose-900')}>
          Retention rate {improved ? 'improved' : 'dropped'} by {diff} percentage points
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {improved
            ? 'Strong customer loyalty and effective renewal strategies.'
            : 'Potential churn risk. Review at-risk accounts and outreach strategy.'}
        </p>
      </div>

      <div className={cn('text-3xl font-black tabular-nums shrink-0', improved ? 'text-emerald-600' : 'text-rose-600')}>
        {improved ? '+' : '-'}{diff}%
      </div>
    </motion.div>
  );
}

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) {
      setError('Please enter your credentials.');
      return;
    }
    setLoading(true);
    setTimeout(() => onLogin(), 900);
  };

  return (
    <div className="min-h-screen flex bg-slate-50">

      {/* ── Left branding panel ── */}
      <motion.div
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="hidden lg:flex flex-col justify-between w-[52%] bg-gradient-to-br from-[#1e3a5f] via-[#2b5280] to-[#3a749b] p-12 relative overflow-hidden"
      >
        {/* Background decorative circles */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute top-1/3 -left-24 w-64 h-64 rounded-full bg-[#f57c73]/10" />
        <div className="absolute -bottom-20 right-12 w-72 h-72 rounded-full bg-white/5" />
        <div className="absolute bottom-1/3 right-1/3 w-32 h-32 rounded-full bg-[#f57c73]/15" />

        {/* Logo + product name */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <img src="/logo.svg" alt="KDK" className="w-12 h-12 rounded-2xl bg-white/10 p-1" />
            <div>
              <p className="text-white font-black text-lg leading-tight">KDK Softwares</p>
              <p className="text-white/50 text-xs font-medium">Intelligent Business Suite</p>
            </div>
          </div>

          <h1 className="text-4xl font-black text-white leading-tight mb-4">
            Renewal Intelligence<br />
            <span className="text-[#f57c73]">Dashboard</span>
          </h1>
          <p className="text-white/60 text-sm leading-relaxed max-w-xs">
            Track subscription renewals, analyse retention trends, and get actionable insights — all in one place.
          </p>
        </div>

        {/* Feature pills */}
        <div className="relative z-10 flex flex-col gap-4">
          {[
            { icon: <TrendingUp className="w-4 h-4" />, label: 'Retention analytics', desc: 'Month-wise renewal stage tracking' },
            { icon: <Database className="w-4 h-4" />, label: 'Live data insights', desc: 'Real-time subscription monitoring' },
            { icon: <Shield className="w-4 h-4" />, label: 'Churn prediction', desc: 'Early warning for at-risk accounts' },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
                {f.icon}
              </div>
              <div>
                <p className="text-white text-sm font-bold">{f.label}</p>
                <p className="text-white/50 text-xs">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom credit */}
        <p className="relative z-10 text-white/30 text-xs">© 2026 KDK Softwares Pvt. Ltd.</p>
      </motion.div>

      {/* ── Right login form panel ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="flex-1 flex items-center justify-center p-8"
      >
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <img src="/logo.svg" alt="KDK" className="w-8 h-8" />
            <span className="font-black text-slate-800">KDK Softwares</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-800 mb-1">Welcome back</h2>
            <p className="text-slate-500 text-sm">Sign in to your dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Email / Username</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@kdksoftwares.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wider">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-12 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-rose-600 text-xs font-semibold bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className="mt-2 w-full py-3 rounded-xl bg-gradient-to-r from-[#2b5280] to-[#3a749b] text-white text-sm font-bold shadow-md hover:shadow-lg hover:brightness-110 transition-all disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                  />
                  Signing in…
                </>
              ) : 'Sign In'}
            </motion.button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Use any credentials to sign in to the demo.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

// ─── DATA LOADING SCREEN ──────────────────────────────────────────────────────

const LOAD_PHASES = [
  { label: 'Connecting to server…',       icon: <Wifi className="w-4 h-4" />,         pct: 15  },
  { label: 'Authenticating session…',     icon: <Shield className="w-4 h-4" />,       pct: 30  },
  { label: 'Fetching subscriptions…',     icon: <Database className="w-4 h-4" />,     pct: 55  },
  { label: 'Building renewal analytics…', icon: <BarChart3 className="w-4 h-4" />,    pct: 78  },
  { label: 'Preparing dashboard…',        icon: <Zap className="w-4 h-4" />,          pct: 95  },
  { label: 'Ready!',                      icon: <CheckCircle2 className="w-4 h-4" />, pct: 100 },
];

function DataLoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [counter, setCounter] = useState(0);

  // Advance through phases
  useEffect(() => {
    const intervals = [400, 700, 800, 700, 600, 500];
    let idx = 0;
    const next = () => {
      idx++;
      if (idx >= LOAD_PHASES.length) { setTimeout(onComplete, 600); return; }
      setPhase(idx);
      setTimeout(next, intervals[idx]);
    };
    setTimeout(next, intervals[0]);
  }, [onComplete]);

  // Smoothly animate progress bar
  useEffect(() => {
    const target = LOAD_PHASES[phase].pct;
    const id = setInterval(() => {
      setProgress(p => {
        if (p >= target) { clearInterval(id); return p; }
        return Math.min(p + 1, target);
      });
    }, 12);
    return () => clearInterval(id);
  }, [phase]);

  // Subscription count-up
  useEffect(() => {
    if (phase < 2) return;
    const target = 2500;
    const id = setInterval(() => {
      setCounter(c => {
        if (c >= target) { clearInterval(id); return target; }
        return Math.min(c + 42, target);
      });
    }, 16);
    return () => clearInterval(id);
  }, [phase]);

  const currentPhase = LOAD_PHASES[phase];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 flex flex-col items-center justify-center p-8">

      {/* Logo */}
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="flex items-center gap-3 mb-10"
      >
        <img src="/logo.svg" alt="KDK" className="w-14 h-14 drop-shadow-lg" />
        <div>
          <p className="font-black text-slate-800 text-xl">KDK Softwares</p>
          <p className="text-slate-400 text-xs">Renewal Intelligence Dashboard</p>
        </div>
      </motion.div>

      {/* Main loading card */}
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="w-full max-w-md bg-white rounded-3xl shadow-[0_20px_60px_rgba(0,0,0,0.08)] border border-slate-100 p-8"
      >
        {/* Phase indicator */}
        <div className="flex items-center gap-3 mb-6">
          <motion.div
            key={phase}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
              phase === LOAD_PHASES.length - 1
                ? 'bg-emerald-100 text-emerald-600'
                : 'bg-indigo-100 text-indigo-600'
            )}
          >
            {currentPhase.icon}
          </motion.div>
          <div className="flex-1 min-w-0">
            <motion.p
              key={phase}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-sm font-bold text-slate-700"
            >
              {currentPhase.label}
            </motion.p>
            <p className="text-xs text-slate-400 mt-0.5">
              {phase < 2 ? 'Establishing secure connection' :
               phase < 4 ? `Loading ${counter.toLocaleString()} subscription records` :
               'Almost there…'}
            </p>
          </div>
          <span className="text-lg font-black tabular-nums text-indigo-600">{progress}%</span>
        </div>

        {/* Progress bar */}
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden mb-6">
          <motion.div
            className={cn(
              'h-full rounded-full transition-all duration-150',
              progress === 100
                ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                : 'bg-gradient-to-r from-[#3a749b] to-indigo-500'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Phase step dots */}
        <div className="flex items-center justify-between px-2">
          {LOAD_PHASES.map((_, i) => (
            <motion.div
              key={i}
              animate={{
                backgroundColor: i < phase ? '#10b981' : i === phase ? '#3a749b' : '#e2e8f0',
                scale: i === phase ? 1.4 : 1,
              }}
              transition={{ duration: 0.3 }}
              className="w-2.5 h-2.5 rounded-full"
            />
          ))}
        </div>
      </motion.div>

      {/* Skeleton preview cards — appear when analytics phase starts */}
      <motion.div
        animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 16 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md mt-5 grid grid-cols-2 gap-3"
      >
        {[
          { label: 'Total Due',  val: phase >= 4 ? '2,500' : '…', color: 'border-indigo-400' },
          { label: 'Renewed',    val: phase >= 4 ? '1,986' : '…', color: 'border-emerald-400' },
          { label: 'Pending',    val: phase >= 4 ? '514'   : '…', color: 'border-rose-400' },
          { label: 'Retention',  val: phase >= 4 ? '79.4%' : '…', color: 'border-blue-400' },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 10 }}
            transition={{ duration: 0.35, delay: i * 0.07 }}
            className={cn('bg-white rounded-2xl p-4 border-b-4 shadow-sm', card.color)}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">{card.label}</p>
            <motion.p
              key={card.val}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xl font-black text-slate-800"
            >
              {card.val}
            </motion.p>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

// ─── ROOT APP (auth router) ────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<'login' | 'loading' | 'dashboard'>('login');

  return (
    <AnimatePresence mode="wait">
      {screen === 'login' && (
        <motion.div key="login" exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <LoginPage onLogin={() => setScreen('loading')} />
        </motion.div>
      )}
      {screen === 'loading' && (
        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <DataLoadingScreen onComplete={() => setScreen('dashboard')} />
        </motion.div>
      )}
      {screen === 'dashboard' && (
        <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
          <Dashboard />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
