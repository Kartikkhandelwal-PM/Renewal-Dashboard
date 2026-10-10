# Renewal Projection — Logic for Team Review

**Purpose of this document:** to let the team judge whether the projection logic is right, or what should change.
It explains the rules the dashboard uses today, with worked examples, and lists every decision that was made so each one can be agreed or changed.

**How to review**
1. Read Section 1 (the logic in 6 lines).
2. Go through the Review checklist (Section 2) and mark each row **Agree** or **Change**, with a comment.
3. Use Sections 3 to 6 to check the maths on the examples.

> The dashboard currently runs on generated demo data. The numbers show how the logic behaves, not real performance. The logic can be judged now; accuracy can only be judged once real data is connected.

Code: `src/lib/projection.ts` (calculation), `ProjectionsSection` in `src/App.tsx` (screen). Test: `npx tsx scripts/backtest.ts`.

---

## 1. The logic in 6 lines

1. Only renewals that have **already happened** (as of today) count.
2. Each renewal is placed in one of 6 timing columns: **M<0, M0, M+1, M+2, M+3, M3+** (when it renewed, compared with the expiry month).
3. From the **past period**, the model learns for each stage (1st, 2nd, 3rd Year+): "out of 100 subscriptions due, how many renew in each column".
4. In the **forecast period**, renewals that have already happened stay as actual. For the rest, the learned percentages are applied.
5. **Pending = Due − Renewed. Retention = Renewed ÷ Due.**
6. Only the forecast can be edited, for what-if checks. Past data and Due never change.

---

## 2. Review checklist

Each row is one decision. Please mark it and comment.

| # | Decision | What we do today | Why | Alternative | Team verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Which renewals count | Only those with a renewal date on or before today | A renewal cannot happen in the future | Also count booked renewals with a future date (needed only if real data has them) | ☐ Agree ☐ Change |
| 2 | Timing columns | 6 columns by calendar month versus the expiry month | Matches the existing Stage Matrix | Day-based windows (for example 0–30 days) | ☐ Agree ☐ Change |
| 3 | What the model learns from | Only columns whose window is already **closed** | Recent months have late renewals still to come; counting them as lost understates retention | Use all data as it stands | ☐ Agree ☐ Change |
| 4 | Small or recent samples | Blend the past period with long-run history, weight 30 | Keeps estimates stable when the past period is thin | Past period alone, or a different weight | ☐ Agree ☐ Change |
| 5 | Minimum history per stage | 30 observations, otherwise use all stages pooled | Avoids estimates from a handful of records | A different minimum | ☐ Agree ☐ Change |
| 6 | Late renewals (M3+) | Treated as complete after 12 months | Needed to know when the last column is final | A different cut-off | ☐ Agree ☐ Change |
| 7 | Already-renewed subscriptions | Kept as actual; only the rest are projected | Early renewals are real and should not be guessed | Project everything from the pattern | ☐ Agree ☐ Change |
| 8 | Stages | 1st, 2nd and 3rd Year+ are learned and projected separately | Their behaviour differs a lot | One combined pattern, or more segments | ☐ Agree ☐ Change |
| 9 | Default periods | Past = last 3 full months. Forecast = this month + next 2 (includes days already passed) | Equal-length, full-month periods compare cleanly | Forecast from tomorrow; longer past period | ☐ Agree ☐ Change |
| 10 | What can be edited | Forecast only. Past data and Due are read-only | Past is a record; Due is fact | Allow editing Due (volume what-if) | ☐ Agree ☐ Change |
| 11 | Edit limits | A row's cells can never add up to more than its Due | A subscription renews at most once | None needed | ☐ Agree ☐ Change |
| 12 | Not modelled | Seasonality, yearly trend, revenue, price, timing inside a month | Kept simple for a first version | Add them later | ☐ Agree ☐ Change |

Open points for the team: whether real data can contain future-dated renewals (row 1), and whether the forecast should start on the 1st or from tomorrow (row 9).

---

## 3. Data rules

### 3.1 Which renewals count (row 1)

The as-of moment is the end of today. A record whose **renewal date** is after it is treated as "not renewed yet".
The rule is about the **renewal date**, not the expiry date.

**Example** (today = 10 Oct 2026, subscription expires 20 Dec 2026):

| Renewal date | Counted? | Why |
| --- | --- | --- |
| 5 Oct 2026 | Yes, as M<0 | The customer renewed early. It already happened |
| 15 Nov 2026 | No | After today. In real data this cannot exist; it only appears in demo data |
| none | No | Not renewed |

### 3.2 Which subscriptions belong to a period

A subscription belongs to a period when its **expiry date** is between the start and end date, both days included. Past period, forecast period, Due and month rows all use this rule.

### 3.3 Six timing columns (row 2)

The column is the renewal month minus the expiry month (calendar months, not days).

**Example** (expiry 20 Dec 2026):

| Renewed on | Column |
| --- | --- |
| 5 Oct 2026 | **M<0** (before December) |
| 12 Dec 2026 | **M0** (same month) |
| 15 Jan 2027 | **M+1** |
| 10 Feb 2027 | **M+2** |
| 3 Mar 2027 | **M+3** |
| 8 Apr 2027 or later | **M3+** |

### 3.4 Closed and open windows (rows 3 and 6)

A column's window **closes** at the start of a month. If that moment is on or before today, the column is **closed** (final). Otherwise it is **open** (still happening).

| Column | Window closes at the start of |
| --- | --- |
| M<0 | expiry month |
| M0 | expiry month + 1 |
| M+1 | expiry month + 2 |
| M+2 | expiry month + 3 |
| M+3 | expiry month + 4 |
| M3+ | expiry month + 12 (assumed) |

**Example** (expiry month = Sep 2026, today = 10 Oct 2026): M<0 closed on 1 Sep, M0 closed on 1 Oct, **M+1 is open** (closes 1 Nov), M+2 is open (closes 1 Dec).
Missing renewals in an open window are never treated as lost.

The Past card uses the same "as of today" rule, so a recent month can look lower than it will finally end.

---

## 4. Learning the pattern from the past period (rows 3 to 6)

Goal: for each stage and column, `p` = the share of Due that renews in that column. A subscription renews only once, so one stage's shares add up to at most 100%.

1. **Count closed windows only.** For a column, only subscriptions whose window for that column is closed are counted.
2. **Build a prior from all history** (everything that expired up to today): the stage's own long-run rate if it has at least 30 such observations, otherwise the rate pooled over all stages, otherwise 0.
3. **Count the same way inside the past period.**
4. **Blend them:**

```
p = (past renewals + 30 × prior) / (past observations + 30)
```

5. If one stage's `p` values add up to more than 1, scale them down so they add up to 1.

If the past period has no closed windows for a column, `p` equals the prior. If it has plenty, its own data dominates.

### Example 1 — one column (1st Year, M+1)

Today = 10 Oct. Past period = Jul 1 to Sep 30.

- Long-run history, 1st Year: 600 observations, 84 renewed in M+1 → prior = 84 ÷ 600 = **14.0%**.
- Past period: M+1 is closed only for **Jul and Aug** expiries (Sep's closes on 1 Nov). Jul + Aug 1st Year = **120** subscriptions, **12** renewed in M+1.

```
p = (12 + 30 × 0.14) / (120 + 30) = 16.2 / 150 = 0.108  →  10.8%
```

Why closed windows only: counting Sep's 60 subscriptions as well would give 12 ÷ 180 = **6.7%**, because Sep's M+1 renewals have not happened yet. That understates late renewals.

**Pattern used in the next examples (1st Year):**

| M<0 | M0 | M+1 | M+2 | M+3 | M3+ | Sum |
| --- | --- | --- | --- | --- | --- | --- |
| 20% | 30% | 10.8% | 4% | 2% | 0% | 66.8% |

---

## 5. Projecting the forecast period (row 7)

Subscriptions expiring in the forecast period are grouped by **(expiry month × stage)**. For each group:

- `n` = subscriptions due
- `known[k]` = how many already renewed in column k as of today (actual)

| Column state | Final count |
| --- | --- |
| **Closed** | Exactly `known[k]`. It can no longer change |
| **Open** | `max( known[k], pool × p[k] ÷ (1 − sum of p for closed columns) )`, where `pool = n − renewals in closed columns` |
| **Cap** | The open columns together cannot exceed the pool; if they do, the part above `known` is scaled down |

If the closed columns already use almost the whole pattern (divisor 0.05 or less), nothing extra is projected.

### Example 2 — a future month (all columns open)

1st Year, expiry month **Nov 2026**, `n = 100`. Today, 12 have already renewed early (M<0). No column is closed, so divisor = 1 and pool = 100.

| Column | Calculation | Final |
| --- | --- | --- |
| M<0 | max(12, 100 × 0.20 = 20) | **20** |
| M0 | max(0, 100 × 0.30) | **30** |
| M+1 | 100 × 0.108 | **10.8** |
| M+2 | 100 × 0.04 | **4** |
| M+3 | 100 × 0.02 | **2** |
| M3+ | 100 × 0 | **0** |
| **Total** | | **66.8** (below 100, no cap) |

Retention = 66.8%, pending = 33.2.

### Example 3 — the current month (one column already closed)

1st Year, expiry month **Oct 2026**, `n = 100`, today = 10 Oct.
M<0 is **closed** and 18 actually renewed there. 9 renewed in M0 so far (M0 is still open).

- Closed share = p(M<0) = 0.20
- Pool = 100 − 18 = **82**
- Divisor = 1 − 0.20 = **0.80**

| Column | Calculation | Final |
| --- | --- | --- |
| M<0 (closed) | actual | **18** (not the expected 20) |
| M0 | max(9, 82 × 0.30 ÷ 0.80 = 30.75) | **30.75** |
| M+1 | 82 × 0.108 ÷ 0.80 | **11.07** |
| M+2 | 82 × 0.04 ÷ 0.80 | **4.10** |
| M+3 | 82 × 0.02 ÷ 0.80 | **2.05** |
| M3+ | 0 | **0** |
| **Total** | 18 + 30.75 + 11.07 + 4.10 + 2.05 | **65.97 ≈ 66** |

Cap check: the open columns add 47.97 against a pool of 82, so nothing is scaled down.

### Example 4 — from groups to the screen (a period of two months)

Take the 1st Year groups above: **Oct** (Example 3) and **Nov** (Example 2). Due = 100 + 100 = **200**.

**Step 1 — add the expected counts over the months**

| | M<0 | M0 | M+1 | M+2 | M+3 | M3+ |
| --- | --- | --- | --- | --- | --- | --- |
| Oct | 18 | 30.75 | 11.07 | 4.10 | 2.05 | 0 |
| Nov | 20 | 30 | 10.8 | 4 | 2 | 0 |
| Sum | 38 | 60.75 | 21.87 | 8.10 | 4.05 | 0 |
| % of Due (÷ 200) | 19.0% | 30.4% | 10.9% | 4.1% | 2.0% | 0% |

**Step 2 — round to whole subscriptions** (this is what the Forecast table shows)

`38 | 61 | 22 | 8 | 4 | 0` → Renewed = **133**, Pending = 200 − 133 = **67**, Retention = **66.5%**.
(If the cells added up to more than the Due, the largest cell would be reduced until they fit.)

**Step 3 — spread each count over the months** in proportion to each month's expected value, using **largest remainder**: give each month the whole-number part, then give the leftover subscriptions to the largest fractions.

Example for M0 (61 to split with weights 30.75 : 30):

```
Oct: 61 × 30.75 / 60.75 = 30.88      Nov: 61 × 30 / 60.75 = 30.12
Whole parts: 30 + 30 = 60  →  1 left over  →  goes to the larger fraction (.88, Oct)
Result: Oct 31, Nov 30
```

Doing the same for every column:

| | M<0 | M0 | M+1 | M+2 | M+3 | M3+ | Renewed | Pending | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Oct (Due 100) | 18 | 31 | 11 | 4 | 2 | 0 | **66** | 34 | 66% |
| Nov (Due 100) | 20 | 30 | 11 | 4 | 2 | 0 | **67** | 33 | 67% |
| Period (Due 200) | 38 | 61 | 22 | 8 | 4 | 0 | **133** | 67 | 66.5% |

The months add up exactly to the period row, and no month can renew more than its own Due.

**Retention vs past** (shown in the Forecast header): if the past period was 76.2% and the forecast is 74.4%, the header shows **−1.8 pp**.

---

## 6. What-if edits (rows 10 and 11)

Past data is read-only: it is a record, and the forecast learns from it. **Due is never editable**, it comes from the data. Edits only change how many renew.

| Where you edit | What it sets | Limit |
| --- | --- | --- |
| **Stage cell** (By stage rows) | That stage and column for the whole period, spread over the months | Due − the other cells in that row |
| **Total row cell** | The column total, split across stages in proportion to what each has now | Remaining room in each stage |
| **Month × stage cell** (open a month) | That single group exactly | The group's Due − the other cells in its row |

**Precedence**

- A stage or Total edit clears month-level edits in the same column.
- A month-level edit stays until Reset, a period change, or a higher-level edit of that column.
- Period totals are always recomputed from the groups. Edited cells are shown in amber. Edits never change the learned pattern.
- Changing either period, or pressing Reset, removes all edits.

### Example 5 — limit on a cell
2nd Year, Due = 80. The other cells in the row add up to 55, so the room is 80 − 55 = **25**. Typing 40 is accepted as **25**.

### Example 6 — Percent mode
Row Due = 60. Typing **25%** → round(0.25 × 60) = **15 subscriptions**.
For the Total row in Percent mode, the typed % is applied to each stage in proportion to its current %, each limited to `100% − its other cells`.

### Example 7 — editing a stage cell
From Example 4, the period cell 1st Year / M0 shows **61**. The user types **70**. It is stored as 70 ÷ 200 = 35% of Due, then spread with weights 30.75 : 30:

```
Oct: 70 × 30.75 / 60.75 = 35.43      Nov: 70 × 30 / 60.75 = 34.57
Whole parts: 35 + 34 = 69  →  1 left over  →  larger fraction (.57, Nov)
Result: Oct 35, Nov 35
```

### Example 8 — editing the Total row
M0 cells today: 1st Year **41**, 2nd Year **30**, 3rd Year+ **29** (total 100). The user types Total **75**.

```
1st: 75 × 41 / 100 = 30.75     2nd: 75 × 30 / 100 = 22.50     3rd: 75 × 29 / 100 = 21.75
Whole parts: 30 + 22 + 21 = 73  →  2 left over
The two largest fractions (.75 and .75) get +1  →  31, 22, 22 = 75
```

### Example 9 — editing one month and one stage
Nov, 1st Year, Due 100, cells `[20, 30, 11, 4, 2, 0]` = 67 renewed. The user sets **M0 = 45**.
Room = 100 − (20 + 11 + 4 + 2 + 0) = 63, so 45 is accepted. New cells `[20, 45, 11, 4, 2, 0]` = 82 renewed, pending 18. The period totals go up by 15.

### Example 10 — automatic trimming
Same group, but the user sets **M0 = 75**. The cells add up to 20 + 75 + 11 + 4 + 2 = **112**, which is 12 more than the Due of 100.
The edited cell stays at 75. The other cells are reduced one subscription at a time, always the largest first, until the group fits:

```
[20, 75, 11, 4, 2, 0]  →  [9, 75, 10, 4, 2, 0]   (total 100)
```

---

## 7. Consistency: why the numbers always agree on screen

Everything is built from one set of whole-number cells per month and stage.

- A stage row = the sum of its months. The Total row = the sum of the stages.
- Each card's header line and every month row are sums of the same cells.
- **Done** = sum of the cells shown, never above Due. **Pending = Due − Done.**
- All counts are whole subscriptions. Percentages come from counts, not the other way round.
- If a stage's typed values add up to more than 100%, a warning is shown and it is scaled down to 100%.
- A month the period covers only in part (for example 11 to 31 Oct) shows its day range under the month name.

**Messages for a wrong date selection**

| Situation | Message |
| --- | --- |
| Forecast end is before forecast start | "Forecast end date must be on or after the start date." |
| Past end is before past start | "Past period end date must be on or after the start date." |
| Past period ends on or after the forecast start | "Past period must end before the forecast starts." |
| No expiries in the past period | "No expiries found in the past period with the current filters." |

---

## 8. How it was tested

The model was back-tested on **30 random synthetic worlds** where the true behaviour is known (3 stages, 36 months, 300 subscriptions a month).
In each world: today = 15 Jun 2026, pattern learned from Mar–May, Jun–Aug forecast and compared with what really happened.
The **old method** used the raw past percentages and counted open windows as lost.

| Measure (average of 30 worlds) | Old | Current model |
| --- | --- | --- |
| Retention bias (forecast − truth) | −7.06 pp | +0.03 pp |
| Typical retention error | 7.06 pp | 2.15 pp |
| Mean absolute error per cell | 6.5 | 4.7 |
| M+2 renewals (truth 47.5) | 24.0 | 46.4 |
| M+3 renewals (truth 17.5) | 3.3 | 18.4 |
| Rule violations | – | 0 |

Three rules were checked in every group: the expected count is never below what already renewed, a closed window equals exactly what happened, and the total never exceeds the group's Due.
The remaining ~2 pp error is random sampling noise, not bias.

Re-run: `npx tsx scripts/backtest.ts`

**Limits of this test:** it uses synthetic data, so it proves the method is sound, not that it fits the real business. Real accuracy can only be measured once real renewal records are connected.
