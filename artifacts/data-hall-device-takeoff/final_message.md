The device takeoff and priced bill of materials for **Meridian Data Center — Phase 1, Data Hall 1 (`ec_0205_d100`)** have been completed and packaged in `/filesystem/final_batch4__electrical_task17_ec_0205_d100__blind/output/submission.zip` (with the individual files also written under `output/`).

### Deliverables Produced

1. **`output/submission.zip`** containing:
   - **`takeoff.csv`** — One row per scheduled device type mark (`R1`–`R8`, `J1`, `P1`, `F1`–`F6`, `D1`), reporting exact project quantities (`234` total devices across 15 active type marks; `R8` and `F6` carried at `0`).
   - **`locations.csv`** — Aggregated by `(sheet, type_mark, grid_bay, condition, count)` across `E-201`, `E-202`, `E-203`, `E-204`, `E-211`, `E-231`, `E-232`, and `E-233`.
   - **`bom.csv`** — Priced Bill of Materials containing all 83 `(type_mark, condition)` attribution rows (totalling **$17,572.51** for the required work) and 17 `(PURCHASE)` / `(STOCK)` rows (totalling **$19,356.71** after adding 5% Owner spare stock and rounding up to whole cartons).
   - **`register.csv`** — Compliance register for all 23 clauses (`E-01` through `E-22`, including `E-04b`) of `criteria/takeoff_criteria_manual.md`.
   - **`basis.md`** — Complete Basis of Estimate documenting the counting conventions (`C1`–`C9`), sheet-by-sheet breakdown, governing revision/addendum hierarchy, unresolved symbols, condition split derivation, permitted assemblies, spare-stock/carton rounding method, and basket total.

---

### Summary of Key Results

- **Governing Issue (`C6`, `E-07`):**
  - Drawing Revision 2 (`2026-07-27`, `IN-ROW CRAH UNITS ADDED` / `ADDENDUM 1 — SEE CLOUDS`) established the 28-unit CRAH layout (`4` perimeter + `24` in-row across rows `A`–`F` on `A-101`, `A-102`, `M-101`, `E-201..E-204`, and `E-211`).
  - **Addendum No. 02 (`addenda/ADD-02_addendum_two.md`, dated `2026-08-07`)** postdates Revision 2 (`2026-07-27`) and governs for Grid Bay `A1` on `E-201`: deleting the `4` clouded `R1` duplex receptacles in Bay `A1` (`2` `DRY-MASONRY`, `2` `RATED-2HR`) and adding `2` `R2` quadraplex receptacles at the first and second deleted positions measured from the south (`+2` `R2` in Bay `A1`, `DRY-MASONRY`).
- **Unresolved Symbols (`C3`, `E-04`, `E-04b`):**
  - Two instances of an unscheduled square-with-inscribed-diamond symbol appear on the enlarged PDU Gallery plans — one on **`E-232`** (`PDU GALLERY — 2 OF 7`, structural grid bay **`A4`**, tile **`BQ09`**) and one on **`E-233`** (`PDU GALLERY — 6 OF 7`, structural grid bay **`C4`**, tile **`BQ31`**). Zero quantity is carried for both.
- **Device Takeoff Totals (`E-01`–`E-08`):**
  - `R1`: **51** (`19 DRY-STUD, 19 DRY-MASONRY, 10 RATED-2HR, 3 DAMP`)
  - `R2`: **8** (`6 DRY-STUD, 2 DRY-MASONRY`)
  - `R3`: **8** (`7 DRY-STUD, 1 DAMP`)
  - `R4`: **6** (`6 IG`)
  - `R5`: **32** (`28 DRY-STUD` from Keynote `K2`, `4 DAMP` drawn on `E-201`)
  - `R6`: **4** (`4 EMERGENCY`)
  - `R7`: **6** (`6 ACCESS-FLOOR` from Keynote `K3`)
  - `R8`: **0**
  - `J1`: **38** (`5 DRY-STUD, 18 DRY-MASONRY, 13 RATED-2HR, 2 DAMP`)
  - `P1`: **7** (`3 DRY-STUD, 1 RATED-2HR, 3 DAMP`)
  - `F1`: **12** (`8 DRY-MASONRY` from Keynote `K1`; `2 RATED-2HR, 2 DRY-STUD` from Keynote `K4`)
  - `F2`: **4** (`1 DRY-STUD, 2 RATED-2HR, 1 DAMP`)
  - `F3`: **3** (`1 DRY-MASONRY, 1 DRY-STUD, 1 RATED-2HR`)
  - `F4`: **6** (`6 CEILING`)
  - `F5`: **30** (`30 ACCESS-FLOOR`)
  - `F6`: **0**
  - `D1`: **27** (`27 CEILING`)
- **Priced Bill Summary (`E-12`–`E-21`):**
  - **Basket Total (Required Work):** **$17,572.51**
  - **Total Purchase Cost (with 5% Spare Stock & Carton Rounding):** **$19,356.71**