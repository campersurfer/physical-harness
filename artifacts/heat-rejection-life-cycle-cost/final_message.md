The condenser water heat rejection replacement design and life-cycle cost analysis package for the Papago Federal Center (Phoenix, Arizona) has been completed and written to `/filesystem/final_batch4__mechanical_task3_ct_heat_lcc__blind/output/submission.zip`.

### Deliverables Produced in `output/submission.zip`
1. **`CT_SCHEDULE_CUP.dxf`, `CT_SCHEDULE_ANNEX.dxf`, `CT_SCHEDULE_LAB.dxf`** — Cooling tower schedule sheets (`M-CTWR-SCHD`), roof support-frame layout polylines (`M-CTWR-PLAN`), and revisioned title blocks (`G-TBLK`) in the plan coordinates of **M-401 Revision C** and **S-401 Revision C**.
2. **`CT_CALC_CUP.xlsx`, `CT_CALC_ANNEX.xlsx`, `CT_CALC_LAB.xlsx`** — Five-sheet calculation workbooks (`DesignPoint`, `OffDesign` with 180 scenario bins summing to 8,760 hours/yr, `WaterBalance`, `Energy`, and `LifeCycleCost`) evaluated on the adopted EnergyPlus simulation basis.
3. **`constraint_register.csv`** — 192-row constraint register (`id, document, clause, requirement, value, items_bound`) citing the adopted governing project documents and clauses.
4. **`design_basis.md`** — Design basis memorandum documenting the governing criteria, conflict resolutions, climatic and psychrometric basis, water balance method (`SATURATED-EXIT`), equipment selections, and relative margin analysis.

---

### Governing Documents Applied & Conflict Resolutions
- **Conflict 1 (`CONFLICT 1: ADOPTED UFC 3-410-01 2-4.2.4 | SET ASIDE PBS-P100 5.3.1`):** Per **DC-02** paragraphs **2** and **5.2** and **RFI-031 Response 1**, tower sizing uses the 1.0% annual outdoor wet-bulb temperature from the 2022–2024 Phoenix Sky Harbor Airport NCEI LCD record (`75.0 °F`, `FM-15`/`FM-16` observations) plus the `5 °F` adder of **UFC 3-410-01** paragraph **2-4.2.4** (`WBDESIGN = 80.0 °F`). Cooling robustness (single largest cell out of service) uses the 0.4% annual wet-bulb basis of **GSA PBS-P100** paragraph **5.1.3** (`76.0 °F`) plus the same `5 °F` adder (`RedundancyWetBulb_F = 81.0 °F`). The 99.6% annual dry-bulb temperature is `41.0 °F > 32.0 °F`, so freeze protection is not required (`BASINHEATER = NO` per **DC-02** paragraph **5.4**). **UFC 3-400-02** is cancelled and not used.
- **Conflict 2 (`CONFLICT 2: ADOPTED UFM 3-230-13 2026 Chapter 5 | SET ASIDE UFC 3-230-13 2023 Chapter 5`):** Per **DC-02** paragraph **2** and **RFI-031 Response 3**, **UFM 3-230-13** (5 February 2026) and **WT-01** govern the water treatment programme, water balance, and Practical (Puckorius) Scaling Index (`PSI >= 5.60`) evaluated using the 2022-07-26 complete water quality analysis in `WQP_USGS-332255112182101_results.csv`.
- **Conflict 3 (`CONFLICT 3: ADOPTED M-401 Revision C | SET ASIDE M-401 Revision B`):** Per **DC-02** paragraph **2** and **RFI-031 Response 3**, **M-401 Revision C** governs the roof equipment zones and outdoor air intake positions (`>= 25 ft` separation per **PBS-P100** Table 5.2).
- **Amendments & RFIs:** **PW-LTR-019** reduces the **ANNEX** annual reclaimed-water allocation from `13,300 kgal/yr` to `12,600 kgal/yr`. **RFI-034** adds `18.86 kW` of continuous fume hood exhaust fan load (`EF-L7`, `EF-L8`, `EF-L9`) to **MCC-R3**, reducing the **LAB** electrical spare capacity on **E-601** from `660.0 kW` to `641.14 kW`. Economic factors are taken from the **2025 Annual Supplement to NIST Handbook 135** (**NIST IR 85-3273-40**, `d = 0.03`, `StudyPeriod_yr = 26`, `ConstructionPeriod_yr = 1`, `UPVStarElectricity = 15.3352`, `UPVStarWater = 21.8623`, `UPVNonFuel = 16.9060`).

---

### Summary of Key Results

| Metric | CUP | ANNEX | LAB |
|---|---|---|---|
| **Selected Model & Cell Count** | `4 x CTX-0600-S` | `4 x CTX-0600-S` | `3 x CTX-0900-H` |
| **Material / Eliminator / Motor** | `SS-304` / `DE-2` (`0.002%`) / `20 hp` (`91.7%` TEFC) | `SS-304` / `DE-2` (`0.002%`) / `20 hp` (`91.7%` TEFC) | `SS-304` / `DE-2` (`0.002%`) / `20 hp` (`91.7%` TEFC) |
| **Design CW Flow (`GPMTOTAL` / Cell)** | `1,800 gpm` (`450 gpm/cell`) | `1,800 gpm` (`450 gpm/cell`) | `2,025 gpm` (`675 gpm/cell`) |
| **Achieved Design `CWS_F` / `CWR_F`** | `85.36 °F` / `98.02 °F` | `85.69 °F` / `99.38 °F` | `85.99 °F` / `100.58 °F` |
| **Achieved `Approach_F` / `Range_F`** | `5.36 °F` / `12.66 °F` | `5.69 °F` / `13.68 °F` | `5.99 °F` / `14.60 °F` |
| **Scheduled `CWSDESIGN` / `APPROACHDESIGN`** | `85.80 °F` / `5.80 °F` | `86.20 °F` / `6.20 °F` | `86.50 °F` / `6.50 °F` |
| **Reset (`CWSMIN` / `CWSOFFSET`)** | `65.5 °F` / `11.5 °F` | `79.5 °F` / `11.5 °F` | `57.5 °F` / `9.0 °F` |
| **Redundancy Capacity (`81.0 °F` WB)** | `905.25 tons` (`>= 820 t`) | `932.93 tons` (`>= 880 t`) | `1,207.42 tons` (`>= 1,070 t`) |
| **`COC` / `MaxAllowableCOC` / `PSI`** | `4.14` / `4.1421` / `5.6004` | `4.00` / `4.0009` / `5.6002` | `3.87` / `3.8795` / `5.6019` |
| **Annual Makeup (`SATURATED-EXIT`)** | `9,564.38 kgal` (`<= 10,300`) | `12,577.78 kgal` (`<= 12,600`) | `16,904.44 kgal` (`<= 17,400`) |
| **Peak Day Makeup (`gal/day`)** | `49,034 gal/d` (`<= 58,000`) | `52,972 gal/d` (`<= 62,000`) | `72,852 gal/d` (`<= 80,000`) |
| **Annual Plant Energy (`kWh/yr`)** | `2,127,916.8 kWh` | `3,597,939.5 kWh` | `3,170,769.8 kWh` |
| **Peak Coincident Demand / MCC Limit** | `515.06 kW` / `528.00 kW` | `570.73 kW` / `590.00 kW` | `635.12 kW` / `641.14 kW` |
| **Investment / Proposed `LCC_USD`** | `$786,200` / `$5,647,758.08` | `$786,200` / `$7,642,695.61` | `$926,220` / `$7,772,539.08` |
| **`BasicDesignLCC_USD` / `NetSavings_USD`** | `$5,893,856.62` / **`$246,098.54`** | `$7,904,356.72` / **`$261,661.11`** | `$8,067,586.71` / **`$295,047.63`** |
| **Governing Constraint (Relative Margin)** | `electrical capacity (0.0245)` | `water allocation (0.0018)` | `electrical capacity (0.0094)` |