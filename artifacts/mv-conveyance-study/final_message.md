The conveyance study package for the 13.8 kV site distribution at Pacific Crest Space Force Annex (Solicitation `FA4610-26-R-0031`, Project `PCSFA 24-0117`) has been completed and written to `/filesystem/final_batch4__electrical_task12_conveyance_study__blind/output/submission.zip`.

### Deliverable Contents
- **`output/submission.zip`** (containing at its root):
  1. **`conveyance_study.xlsx`** — Complete workbook conforming to `templates/conveyance_study_TEMPLATE.xlsx` across all 11 sheets (`Items`, `Segments`, `Structures`, `Pulls`, `Alternatives`, `Takeoff`, `LaborRates`, `EquipmentRates`, `Markups`, `Register`, and `Findings`), including live Excel formulas in `Alternatives` (`direct_cost_usd` through `cost_per_lf_usd`) and `LaborRates` (`loaded_rate_usd`).
  2. **`conveyance_study_report.md`** — Full engineering and cost study report presenting per-item recommendations, governing criteria, route designs, cable pulling calculations, labor/equipment/material rates, take-offs, cost roll-ups, and documented discrepancies in the Government-furnished documents.

---

### Governing Documents Applied
Per `Transmittal T-0117-09` (2026-09-02) and the Order of Precedence in `PCSFA-IEDS Rev 3` (2026-05-01, Section 1.3):
1. **Solicitation & Study Requirements:** `RFP FA4610-26-R-0031 Section 01 11 00 Amendment 0002` (2026-08-28, superseding Amendment 0001) and `RFI Log FA4610-26-R-0031`.
2. **Installation & DoD Criteria:** `PCSFA-IEDS Rev 3` (superseding Rev 2), `UFC 3-550-01` (2016 C3), `UFC 3-520-01` (2025), `UFC 3-501-01` (2024), `UFC 3-301-01` (2023 C5), `UFC 3-740-05` (2022 C1), `UFS 3-701-01` (2026 & Data Tables), `UFGS 33 71 02` (02/26 C1), `UFGS 33 71 01`, `UFGS 26 20 00` (05/25 C2), `UFGS 31 00 00`, `UFGS 03 30 00`, `29 CFR 1926 Subpart P`, and `29 CFR Part 1`.
3. **Electrical & Cable Data:** `Protective Device Settings Schedule Rev D` (2026-06-30, superseding Rev C and governing over `E-001 Rev B`), Approved Cable Submittal `SUB-33 71 02-07` (2026-08-21, governing over general catalogue `TD-15AL-133 Rev 3`), `TD-15AL-133 Ampacity Tables`, and `ACSR Conductor Data (OH-ACSR-01)`.
4. **Site, Survey & Geotechnical Data:** `C-101 Rev 4`, `E-101 Rev 2`, `A-501 Rev 1`, `SUE-24-0117` (governing over record utility depths on `C-101`), Boring Logs `B-01.csv`–`B-12.csv` & `Thermal_Resistivity_Field_Tests.xlsx` (governing over summary tables in `GEO-24-0117`), and Arborist Tree Survey `TS-24-0117` (governing over tree graphics on `C-101`).
5. **Cost & Wage Data:** Davis-Bacon Wage Determination `CA20260022 Modification 5` (published 2026-08-06, effective per `29 CFR 1.6(c)(2)(ii)(A)` over Attachment J-3 `Mod 2`), `Labor_Unit_Database_PCEC_2026.xlsx`, `Payroll_Burden_and_Insurance_2026.xlsx`, `EP 1110-1-8` (2021 & Vol. 7 Region VII adjusted using `Fuel_Supplier_Invoice_FSI-0826-2207.pdf`), `Rental_Quote_RQ-26-0419.pdf`, `Supplier_Quote_Q-2608-114.pdf` adjusted by `BLS_PPI_WPU102603_2024-2026.json` (August 2026 index `494.096` / July 2026 base `482.612`), `Subcontract_Quote_ADD-26-311_HDD.pdf`, `Subcontract_Quote_PJB-8817_Jack_and_Bore.pdf`, and `Surety_Bond_Rate_Letter_2026.pdf`.

---

### Summary of Recommended Designs and Key Results

| Item | Feeder | Circuit | Rec. Type | Cable / Sets | OH ACSR | Design Current (A) | Ampacity / Set (A) | Route Length (ft) | Labor (MH) | Direct Cost ($) | Total Project Cost ($) | Cost / LF ($/LF) |
|---|---|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| **C01** | F1 | SS-1 to MB-1 MSG-A | **CEDB** | 500 kcmil (2 sets) | — | 640 | 331.55 | 910.00 | 683.27 | $210,104.24 | **$297,291.88** | **$326.69** |
| **C02** | F2 | SS-1 to MB-1 MSG-B | **CEDB** | 500 kcmil (2 sets) | — | 560 | 331.55 | 1,230.00 | 939.50 | $292,050.92 | **$413,244.25** | **$335.97** |
| **C03** | F3 | SS-1 to CUP-1 SWG-C1 | **CEDB** | 350 kcmil (1 set) | — | 400 | 410.12 | 447.11 | 220.03 | $69,700.17 | **$98,623.87** | **$220.58** |
| **C04** | CF-2 | CUP-1 to LS-2 TX-LS2 | **CEDB** | 250 kcmil (1 set) | — | 60 | 330.48 | 1,315.00 | 574.16 | $195,216.12 | **$276,225.58** | **$210.06** |
| **C05** | A-3 | MB-1 MSG-A to USS-A1 | **RMC** | 250 kcmil (2 sets) | — | 200 | 160.00 | 400.00 | 530.47 | $147,514.98 | **$208,729.76** | **$521.82** |
| **C06** | F4 | SS-1 to GH-1 TX-GH1 | **OH** | 250 kcmil (1 set) | 1/0 | 40 | 196.00 | 1,804.67 | 296.23 | $77,881.36 | **$110,200.05** | **$61.06** |
| **C07** | CF-1 | CUP-1 to W-3 TX-W3 | **CEDB** | 250 kcmil (1 set) | — | 120 | 330.48 | 710.00 | 337.54 | $145,972.60 | **$206,547.32** | **$290.91** |
| **Total** | — | **All 7 Circuits** | — | — | — | — | — | **6,816.79** | **3,581.20** | **$1,138,440.39** | **$1,610,862.71** | — |

### Key Roll-Up Markups (`Markups`)
- **JOOH:** `9.5%` | **HOOH:** `4.5%` | **Profit (Weighted Guidelines):** `7.9494%` (`7.95%`)
- **Performance & Payment Bond Rate:** `1.2497%` (`$17,574.32` premium with 3% 15-month surcharge on `$1,406,245.06` recommended sum)
- **Escalation Factor:** `1.019388` (`UFS 3-701-01 Table 4-2` linear day interpolation from `2026-09-15` to `2027-08-18`)
- **Design Contingency:** `5.0%` | **SIOH:** `5.7%` | **Area Cost Factor Applied:** `1`
- **Wage Determination:** `CA20260022 Mod 5`