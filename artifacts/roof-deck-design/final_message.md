The roof deck design package for Building A of the DC-2 Helena Data Centre has been completed and written to `/filesystem/final_batch4__structural_task7_roof_deck_design__blind/output/submission.zip`.

### Summary of Deliverables Inside `output/submission.zip`

1. **`deck_design.xlsx`**
   - **`DesignBasis`**:
     - Snow & Gravity: $p_g = 63\text{ psf}$ (`SNOW-2026-014` Rev 0), $C_e = 0.90$, $C_t = 1.00$, $I_s = 1.10$, $p_f = 43.66\text{ psf}$, $\gamma = 22.19\text{ pcf}$ ($h_b = 1.968\text{ ft}$), unreduced deck live load $L_r = 20\text{ psf}$ (`EOR-DC-RD-01` Rev 2 & `UFC 3-301-01` Table E-1).
     - Wind Uplift: $q_h = 29.93\text{ psf}$ ($V = 115\text{ mph}$, Exposure C, $h = 32\text{ ft}$), C&C zone width $a = 12.8\text{ ft}$ ($2a = 25.6\text{ ft}$).
     - Seismic & Lateral: $S_{DS} = 0.44$, $I_e = 1.25$, $R = 3.25$, effective seismic weight $w_{\text{seismic}} = 18.0 + 0.20(43.66) = 26.732\text{ psf}$, roof diaphragm design force $F_{px} = 195.43\text{ kip}$, wind lateral forces $W_x = 118.0\text{ kip}$ and $W_y = 152.0\text{ kip}$, and diaphragm classification `semi-rigid`.
   - **`Drifts`**:
     - `MEP-PH-1` face `W`: $104.28\text{ psf}$ peak surcharge, band from $60.0\text{ ft}$ to $41.20\text{ ft}$ (leeward fetch $\ell_u = 120\text{ ft}$).
     - `SCR-N` face `S`: $89.48\text{ psf}$ peak surcharge, band from $164.0\text{ ft}$ to $147.85\text{ ft}$ (windward fetch $\ell_u = 164\text{ ft}$, truncated at $h_c = 4.032\text{ ft}$).
     - `PARAPET` face `N`: $34.01\text{ psf}$ peak surcharge, band from $180.0\text{ ft}$ to $167.74\text{ ft}$ (windward fetch $\ell_u = 180\text{ ft}$, truncated at $h_c = 1.532\text{ ft}$, $w = 8h_c = 12.26\text{ ft}$).
     - `RTU-1` face `E`: $98.17\text{ psf}$ peak surcharge, band from $36.0\text{ ft}$ to $53.70\text{ ft}$ (windward fetch $\ell_u = 204\text{ ft}$).
   - **`Zones` & `CalcSummary`**:
     - Partitioned into **4 zones** and **14 non-overlapping rectangles** on the $6\text{ ft} \times 6\text{ ft}$ grid using **2 gages** (`18` and `22` gage; `16` gage is excluded due to its 14-week mill-order lead time exceeding the 9-week limit in `OBD-DC2-A` Section 5) and **3 attachment patterns**, covering all $42,192\text{ sq ft}$ ($1,172$ cells) net of framed openings `RO-1`, `RO-2`, and `RO-3`:
       - **`Z1`** (`18 gage`, `36/9`, `SCREW-10`, `5/span`, $15,552\text{ sq ft}$ across 3 rectangles): Governing scenario `S04` ($\text{D/C} = 0.909$, gravity $160.94 / 177.0\text{ psf}$; shear $955.2 / 1,225.7\text{ plf}$; uplift $101.2 / 126.05\text{ psf}$).
       - **`Z2`** (`18 gage`, `36/7`, `SCREW-10`, `3/span`, $12,528\text{ sq ft}$ across 7 rectangles): Governing scenario `S02` ($\text{D/C} = 0.909$, gravity $160.94 / 177.0\text{ psf}$; shear $640.7 / 742.7\text{ plf}$; uplift $47.3 / 99.44\text{ psf}$).
       - **`Z3`** (`22 gage`, `36/9`, `SCREW-10`, `3/span`, $5,760\text{ sq ft}$ across 2 rectangles): Governing scenario `S09` ($\text{D/C} = 0.928$, uplift $74.2 / 79.99\text{ psf}$; gravity $89.77 / 106.0\text{ psf}$; shear $514.7 / 569.8\text{ plf}$).
       - **`Z4`** (`22 gage`, `36/7`, `SCREW-10`, `3/span`, $8,352\text{ sq ft}$ across 2 rectangles): Governing scenario `S08` ($\text{D/C} = 0.974$, shear $483.4 / 496.3\text{ plf}$; gravity $84.90 / 106.0\text{ psf}$; uplift $47.3 / 63.43\text{ psf}$).
   - **`Diaphragm`**:
     - `S05` (`X`): max shear $357.3\text{ plf}$, max deflection $0.459\text{ in}$, chord $10.82\text{ kip}$, collector $14.94\text{ kip}$, `semi-rigid`.
     - `S06` (`Y`): max shear $729.8\text{ plf}$, max deflection $0.951\text{ in}$, chord $25.59\text{ kip}$, collector $16.02\text{ kip}$, `semi-rigid`.
     - `S07` (`X`): max shear $597.5\text{ plf}$, max deflection $0.739\text{ in}$, chord $18.07\text{ kip}$, collector $28.69\text{ kip}$, `semi-rigid`.
     - `S08` (`Y`): max shear $955.2\text{ plf}$, max deflection $1.213\text{ in}$ ($\le 1.60\text{ in}$), chord $33.02\text{ kip}$ ($\le 38.0\text{ kip}$), collector $21.28\text{ kip}$, `semi-rigid`.
     - `S10` (`X`, $\Omega_0 = 2.0$): max shear $597.5\text{ plf}$, max deflection $0.739\text{ in}$, chord $18.07\text{ kip}$, amplified collector $57.37\text{ kip}$ ($\le 58.0\text{ kip}$), `semi-rigid`.
   - **`BOM`**: `deck area 18 gage` = $28,080\text{ sf}$, `deck area 22 gage` = $14,112\text{ sf}$, `support fasteners` = $18,776\text{ ea}$, `sidelap connectors` = $8,760\text{ ea}$ (total installed cost `$223,616.80` per `CP-RD-2026`).

2. **`roof_deck_plan.dxf`** — Roof framing and deck zoning plan in grid coordinates (feet) with 14 closed `LWPOLYLINE` entities on `S-DECK-ZONE`, interior zone labels on `S-DECK-TEXT`, roof framing on `S-FRAMING`, and framed openings `RO-1`, `RO-2`, and `RO-3` on `S-OPENING`.

3. **`constraint_register.xlsx`** — 119-row register on sheet `Register` citing only governing documents (`OBD-DC2-A`, `T-118`, `SNOW-2026-014`, `UFC 1-200-01`, `UFC 3-301-01`, `29 CFR 1926 Subpart R`, `29 CFR 1910 Subpart D`, `EOR-DC-RD-01` Rev 2, `LAT-2026-003` Rev 1, `NORDECK B-36` 2026 Catalogue, `DC2-A-STR` Rev C, `A-201` Rev C, `M-401` Rev C, `S-101` Rev 3, `S-501` Rev 2, schedules, and `USGS_ASCE7-22_RC-III_SiteClass-D_46.6832_-111.9756.json`).

4. **`design_basis.md`** — Engineering narrative detailing document precedence, resolution of conflicts, snow/wind/seismic load derivations, 2D in-plane finite-element diaphragm methodology and classification, and deck zoning optimization.