# Renewal Projection — Logic

How the Projection section calculates its numbers, with worked examples.

---

## 1. The logic in 6 lines

1. Only renewals that have **already happened** (as of today) count.
2. Each renewal is placed in one of 6 timing columns: **M<0, M0, M+1, M+2, M+3, M3+** (when it renewed, compared with the expiry month).
3. From the **past period**, the model learns for each stage (1st, 2nd, 3rd Year+): "out of 100 subscriptions due, how many renew in each column".
4. In the **forecast period**, renewals that have already happened stay as actual. For the rest, the learned percentages are applied.
5. **Pending = Due − Renewed. Retention = Renewed ÷ Due.**
6. Only the forecast can be edited, for what-if checks. Past data and Due never change.

---

## 2. Data rules

### 2.1 Which renewals count

The as-of moment is the end of today. A record whose **renewal date** is after it is treated as "not renewed yet". The rule is about the **renewal date**, not the expiry date.

**Example** (today = 10 Oct 2026, subscription expires 20 Dec 2026):

| Renewal date | Counted? | Why |
| --- | --- | --- |
| 5 Oct 2026 | Yes, as M<0 | The customer renewed early. It already happened |
| 15 Nov 2026 | No | After today |
| none | No | Not renewed |

### 2.2 Which subscriptions belong to a period

A subscription belongs to a period when its **expiry date** is between the start and end date, both days included.

### 2.3 Six timing columns

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

### 2.4 Closed and open windows

A column's window **closes** at the start of a month. If that moment is on or before today, the column is **closed** (final). Otherwise it is **open** (still happening).

| Column | Window closes at the start of |
| --- | --- |
| M<0 | expiry month |
| M0 | expiry month + 1 |
| M+1 | expiry month + 2 |
| M+2 | expiry month + 3 |
| M+3 | expiry month + 4 |
| M3+ | expiry month + 12 |

**Example** (expiry month = Sep 2026, today = 10 Oct 2026): M<0 closed on 1 Sep, M0 closed on 1 Oct, **M+1 is open** (closes 1 Nov), M+2 is open (closes 1 Dec).
Missing renewals in an open window are never treated as lost.

---

## 3. Learning the pattern from the past period

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

## 4. Projecting the forecast period

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

### Example 4 — from groups to the period total (two months)

Take the 1st Year groups above: **Oct** (Example 3) and **Nov** (Example 2). Due = 100 + 100 = **200**.

**Step 1 — add the expected counts over the months**

| | M<0 | M0 | M+1 | M+2 | M+3 | M3+ |
| --- | --- | --- | --- | --- | --- | --- |
| Oct | 18 | 30.75 | 11.07 | 4.10 | 2.05 | 0 |
| Nov | 20 | 30 | 10.8 | 4 | 2 | 0 |
| Sum | 38 | 60.75 | 21.87 | 8.10 | 4.05 | 0 |

**Step 2 — round to whole subscriptions**

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

---

## 5. What-if edits

Past data is read-only. **Due is never editable.** Edits only change how many renew.

| Where you edit | What it sets | Limit |
| --- | --- | --- |
| **Stage cell** | That stage and column for the whole period, spread over the months | Due − the other cells in that row |
| **Total row cell** | The column total, split across stages in proportion to what each has now | Remaining room in each stage |
| **Month × stage cell** | That single group exactly | The group's Due − the other cells in its row |

- A stage or Total edit clears month-level edits in the same column.
- A month-level edit stays until Reset, a period change, or a higher-level edit of that column.
- If a change pushes a group above its Due, the cells that were not edited are reduced first (largest first), then the edited ones.
- Edits never change the learned pattern.
