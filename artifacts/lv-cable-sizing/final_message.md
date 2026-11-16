The low-voltage conductor, raceway, equipment grounding, and duct-bank design for **Project P-4210 (Building 4210, Consolidated Support Facility)** has been completed and packaged in `/filesystem/electrical__lv_cable_sizing__blind/output/submission.zip` (as well as written individually in `/filesystem/electrical__lv_cable_sizing__blind/output/`).

### Deliverables Produced
1. **`wire_schedule.csv`** (and inside `output/submission.zip`): All 32 low-voltage power circuits (`B-01` through `B-18`, `F-01` through `F-13`, and `SE-1`) with all 27 required columns, lengths, parallel sets, conductor/EGC sizes and materials, conduit trade sizes, duct IDs, ampacities, voltage drops, and audit parameters.
2. **`E-621_wire_schedule.dxf`**: Contract drawing Sheet `E-621` carrying the Project `P-4210` title block, abbreviation list, general notes, and the 32-circuit wire schedule matching `wire_schedule.csv`.
3. **`calc_book.xlsx`**: Workbook containing `front_sheet` (all 17 required design parameters plus the rejected `0.95 K·m/W` native soil resistivity), `duct_assignment` (all 11 duct-bank parallel sets across `DB-1` and `DB-2`), and `cost_ledger` (material, labour, and total installed costs including the `-6%` campus quantity break, totaling **`$150,532.58`**).
4. **`design_basis.md`**: Opening JSON summary block and complete engineering narrative covering the codes of record, environmental derivations, voltage-drop chain allocations, service-entrance sizing, duct-bank mutual-heating optimization, roof cable tray coupling, material/standardisation decisions, and cost ledger.
5. **`constraint_register.xlsx`**: Code-compliance matrix containing 84 atomic, single-requirement rows tracing every governing requirement and resolution (including explicit rejection of superseded `EDS-26 Rev 2`, `E-601 Rev A`, and non-basis-of-design `Meridian Cable`).

---

### Governing Criteria Applied
- **Codes of Record (`G-001`, `EDS-26 Rev 4` Clause 1.1)**: Adopted by **`UFC 1-200-01`** (*DoD Building Code*, Change 4, 17 Dec 2024), which adopts **`IBC 2024`** and directs electrical references to **`UFC 3-501-01`** (27 Nov 2024), **`UFC 3-520-01`** (16 Jan 2025), and **`NFPA 70` (NEC) 2023 Edition**, augmented by **`NSA-WR EDS-26 Rev 4`** (12 June 2026) and Project Specifications `26 05 19`, `26 05 33`, and `26 24 16` (with **`Cascadia Wire Engineering Data Section 4, Issue 2026-1`** as the basis of design). Where two documents set different limits, the **most restrictive requirement governs**.

---

### Key Engineering Results
- **Environmental & Thermal Parameters**:
  - Outdoor design dry-bulb: **`42 °C`** (from `106.8 °F = 41.56 °C` peak daily normal maximum in `NOAA_daily_normals_1991-2020_USW00003145.csv`, rounded up per `EDS-26 Rev 4` 5.4).
  - Roof cable tray ambient: **`46 °C`** (`42 °C + 4 K` roof film allowance, `S = 1030 W/m²`, `alpha_s = 0.6`, `h = 14.0 W/(m²·K)`).
  - Interior space ambients (`M-501-C`): **`45 °C`** in Mechanical Room 121 and Fire Pump Room 105 (`F-01`, `F-03`, `B-11`–`B-15`); **`40 °C`** in Level 1/2 ceiling cavities and Building 4212 shop.
  - Earth ambient at duct-bank depth: **`27.45 °C`** (`24.45 °C` annual mean of daily average normals + `3 K` per `EDS-26 Rev 4` 5.3.2).
  - Thermal resistivities (`GEO-4210-T`): **`0.60 K·m/W`** fluidised thermal backfill (`2.2`, rejecting `0.95 K·m/W` native SP-SM soil in `2.1`) and **`0.55 K·m/W`** concrete encasement (`2.3`).
- **Duct-Bank Assignment & Mutual Heating (`E-619`, `EDS-26 Rev 4` 5.3)**:
  - **`DB-1`** (`10` available ducts `D1`–`D10`; `D11` and `D12` reserved): `SE-1` (`6x 500 kcmil CU`, `4/0 CU` EGC, sized to `MSB-1` `2000 A` main bus per `UFC 3-501-01` 3-2.3.3) is assigned to perimeter ducts **`D1, D2, D3, D5, D9, D10`** (`367.00 A/set`, `2202.0 A >= 2000 A`), and `F-10` (`2x 500 kcmil AL`, `#1 CU` EGC) to east perimeter ducts **`D4, D8`** (`300.23 A/set`, `600.46 A >= 600 A`), leaving interior middle-row ducts `D6, D7` empty and limiting maximum mutual-heating rise to **`27.59 K`** (`24.05 K` on `F-10`).
  - **`DB-2`** (`3` available ducts `E1`–`E3`; `E4` reserved): `F-05` (`3x 600 kcmil AL`, `250 kcmil CU` EGC) occupies **`E1, E2, E3`** (`dT_m = 1.54 K`, `336.00 A/set`).
- **Roof Cable Tray (`CT-R1`) & Project Size Standardisation (`EDS-26 Rev 4` 3.4.2 & 6.3.2)**:
  - All four roof tray circuits (`F-04` `2x 4/0 AL`, `F-08` `1x 4/0 AL`, `F-12` `2x 4/0 AL`, `F-13` `1x 4/0 AL`) share `N = 18` current-carrying conductors (`171.93 A/set`) and a total cable OD sum of **`12.206 in`** (`10.404 in` phase cables only, `<= 16.20 in` tray fill limit).
  - Exactly **5 distinct phase-conductor sizes larger than `#1 AWG`** are used across the project: **`4/0`, `300 kcmil`, `400 kcmil`, `500 kcmil`, and `600 kcmil`**.
- **Voltage-Drop Chains (`UFC 3-501-01` 3-2.7)**:
  - Count starts at **`T-1 secondary lugs`** and does **not** reset at low-voltage transformers (`K-13` or `DP-3`).
  - Feeder chain drops: `MSB-1` **`1.04%`**, `DP-2` **`1.41%`**, `MCC-1` **`2.58%`**, `DP-3` **`2.58%`**, `ATS-1` **`2.78%`**, and `LP-1` **`2.77%`** (all `<= 3.0%`). All branch/motor/equipment circuits satisfy `<= 3.0%` individual drop and `<= 5.0%` cumulative drop (max `4.93%` on `B-17`).
- **Installed Cost Summary**:
  - Total installed conductor length is **`40,888 ft`** (`>= 38,000 ft`), earning the **`-6%` campus quantity break** (`-$5,957.47`).
  - Net Conductors: **`$93,333.66`** (`$70,341.81` material + `$22,991.85` labour)
  - Terminations: **`$9,609.32`** (`$5,105.26` material + `$4,504.06` labour)
  - Interior Raceway: **`$47,589.60`** (`$21,406.08` material + `$26,183.52` labour)
  - **Total Installed Cost**: **`$150,532.58`** (`$96,853.15` material + `$53,679.43` labour).