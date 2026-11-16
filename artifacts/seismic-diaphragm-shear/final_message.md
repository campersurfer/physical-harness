The delegated lateral design and seismic analysis package for **Building B** at the Continental Divide Data Center has been completed and packaged in `/filesystem/final_batch4__structural_task6_seismic_diaphragm_shear__blind/output/submission.zip` (containing `design_record.json`, `diaphragm_plan.dxf`, `seismic_calculations.xlsx`, `constraint_register.xlsx`, and `design_basis.md`).

### 1. Deliverables Produced

* `/filesystem/final_batch4__structural_task6_seismic_diaphragm_shear__blind/output/submission.zip`: Archive containing the five deliverable files at the root level:
  * `design_record.json`: Machine-readable design selections, resolved document conflicts, as-built pier schedules, seismic basis parameters, and reported envelope forces, shears, anchor demands, and installed cost.
  * `diaphragm_plan.dxf`: Two roof diaphragm plan views (E-W loading and N-S loading, in feet) on layers `DIAPHRAGM_SHEAR`, `WALL_FORCE`, `CHORD`, `COLLECTOR`, `DECK_ZONE`, `GRID`, and `TITLE`, showing distributed diaphragm loads $w_{px}$, zoned attachment patterns and unit shears, applied shear wall loads $F_x$, chord/collector/drag strut runs with axial demands, and the LRFD title/revision block.
  * `seismic_calculations.xlsx`: Calculation workbook with sheets `WEIGHTS`, `BASE_SHEAR`, `DIAPHRAGM_FORCES`, `WALL_FORCES`, `PARAPET_ANCHORAGE`, and `CHORD_FORCES`.
  * `constraint_register.xlsx`: Register of 62 governing requirements with document numbers, clauses/tables/sections, values, bound items, and hard/soft classifications (excluding superseded/archive documents).
  * `design_basis.md`: Narrative documenting the seismic basis, SFRS selection, as-built conflict resolutions, `DAP-2` two-stage analysis verification, diaphragm and wall demands, parapet cantilever anchorage, governing checks per wall line, installed cost breakdown, and rejected alternatives.

---

### 2. Governing Documents & Conflict Resolutions

* **Risk Category & Importance Factor (`OBD-CDDC-B` Section 1.4, `SDC-02` Rev 2 Section 2):** Risk Category **III** ($I_e = 1.25$, `ASCE/SEI 7-22` Table 1.5-2) governs due to the county 911 emergency communications tenant, superseding the schematic Risk Category II block on `A-101` and `USGS_ASCE7-22_RiskCatII_SiteClassD_46.6832_-111.9756.json`.
* **Site Class & Ground Motion (`GEO-2026-071` Section 4, `SDC-02` Section 3, `USGS_ASCE7-22_RiskCatIII_SiteClassD_46.6832_-111.9756.json`):** Site Class **D** ($V_{s,100} = 905\text{ ft/s}$), $S_{DS} = 0.44\text{ g}$, $S_{D1} = 0.24\text{ g}$, and **SDC D** (`ASCE/SEI 7-22` Section 11.6) govern for Building B, superseding the 2019 Parcel 4B report `GEO-2019-118` and Building A summary `SM-2019-04`.
* **As-Built Erected Geometry (`RFI-041`, `ERL-2026-08`, `CDDC-SV-2026-041`, `PCS-014` Rev B, `ScanB_2026-08-07_interior.ply`):**
  * **South Wall (`S`):** Dock door `D-3` was erected at $15.5\text{ ft}$ wide ($X = 78.0..93.5\text{ ft}$) and `D-4` at $X = 109.5..123.5\text{ ft}$ ($14.0\text{ ft}$), closing Pier `S5` between `D-4` and `D-5` to **$14.5\text{ ft}$** ($X = 123.5..138.0\text{ ft}$). As-built pier lengths: $18.0, 16.0, 16.0, 16.0, 14.5, 44.0, 40.0\text{ ft}$.
  * **North Wall (`N`):** Panel `N-12` was recast to shop ticket Rev B with louver `L-2` widened to **$16.0\text{ ft} \times 10.0\text{ ft}$** at $X = 154.0..170.0\text{ ft}$ ($Z = 14..24\text{ ft}$). As-built segments: `N1` ($24.0\text{ ft}$ pier), `N2` ($32.0\text{ ft}$ pier), `N3` ($12.0\text{ ft}$ spandrel at `L-1`), `N4` ($82.0\text{ ft}$ pier), `N5` ($16.0\text{ ft}$ spandrel at `L-2`), and `N6` ($70.0\text{ ft}$ pier).
  * **West Wall (`W`):** Opening `EY-1` was widened on site (FC-018) from $40.0\text{ ft}$ to **$44.0\text{ ft}$** ($Y = 66.0..110.0\text{ ft}$), reducing north pier `W3` from $74.0\text{ ft}$ to **$70.0\text{ ft}$** (with `W1` = $12.0\text{ ft}$ and `W2` = $50.0\text{ ft}$).
  * **East Wall (`E`):** As detailed (`E1` = $72.0\text{ ft}$ pier, `E2` = $22.0\text{ ft}$ pier, `E3` = $12.0\text{ ft}$ spandrel at `L-3`, `E4` = $30.0\text{ ft}$ pier, `E5` = $26.0\text{ ft}$ pier).

---

### 3. Key Engineering & Cost Results (LRFD)

* **SFRS Selection:** **Intermediate precast concrete shear walls** (`intermediate_precast`, Bearing Wall System, `ASCE/SEI 7-22` Table 12.2-1 / `UFC 3-301-01` Table 3-1 Line A.6: $R = 4.0$, $\Omega_0 = 2.5$ reduced by $0.5$ to $\Omega_{0,\text{collector}} = 2.0$ per Footnote b, $C_d = 4.0$), permitted in SDC D up to $h_n \le 40\text{ ft}$ (Building B $h_n = 28.0\text{ ft}$).
* **Seismic Weight, Base Shear & Diaphragm Loads:**
  * Tributary wall height including $3.0\text{ ft}$ parapet cantilever lever action (`FEMA P-2192-V1` Section 7.6.1 Step 1): $h_{\text{trib}} = 31.0^2 / (2 \times 28.0) = 17.1607\text{ ft}$ ($w_{\text{wall,trib}} = 1,716.07\text{ plf}$, of which **$316.07\text{ plf}$** is delivered by the parapet above the deck).
  * Fundamental period $T_a = 0.020 (28.0)^{0.75} = 0.2434\text{ s}$; seismic response coefficient $C_s = 0.44 / (4.0 / 1.25) = 0.1375$.
  * Phase 1 effective seismic weight $W = 2,270.50\text{ kips}$ ($V = 312.19\text{ kips}$); Phase 2 future weight $W_{\text{future}} = 2,286.50\text{ kips}$ ($V_{\text{future}} = 314.39\text{ kips}$).
  * Diaphragm design forces (`ASCE/SEI 7-22` Section 12.10.1.1, $F_{px}/w_{px} = 0.1375$):
    * **E-W (`X`, base):** $w_{px,X} = 1,446.79\text{ kips}$, $F_{px,X} = 198.93\text{ kips}$, **$w_{px,X} = 1,105.18\text{ plf}$** over the $180\text{ ft}$ N-S span.
    * **N-S (`Y`, base):** $w_{px,Y} = 1,652.71\text{ kips}$, $F_{px,Y} = 227.25\text{ kips}$, **$w_{px,Y} = 946.87\text{ plf}$** over the $240\text{ ft}$ E-W span.
* **Deck Attachment, Chords/Collectors, Connections & Anchorage:**
  * **Deck Zones (`BDS-2026` Table 4, $\phi = 0.60$):** `P5` ($\phi S_n = 1,101\text{ plf}$, $G' = 61.0\text{ kip/in}$) in `Z1, Z5, Z9`; `P4` ($\phi S_n = 852\text{ plf}$, $G' = 49.0\text{ kip/in}$) in `Z2, Z4, Z8, Z10, Z12`; `P3` ($\phi S_n = 663\text{ plf}$, $G' = 38.0\text{ kip/in}$) in `Z3, Z6, Z7, Z11`. Max zone shear is $982.0\text{ plf} \le 1,101.0\text{ plf}$ (`Z1`), and max amplified semi-rigid deflection is $C_d \delta / I_e = 3.45\text{ in} \le 4.00\text{ in}$ (`S12`).
  * **Chords, Collectors & Drag Struts:** Continuous `C1` (`L4x4x3/8`, $\phi P_n = 92.66\text{ kips}$) on all 20 scheduled lines (`CH-*`, `DR-*`, `OP-*`); max chord demand $= 56.75\text{ kips}$, max amplified collector demand ($\Omega_0 = 2.0$) $= 48.70\text{ kips}$.
  * **Wall Panel Connections & Anchorage (`RPC-CAT-2026`):** `JC1` (`RPC-24`, $\phi V_n = 18.0\text{ kips}$, $k = 210\text{ kip/in}$) at $1\text{ connector/joint}$; `BA2` (`4-#8 dowel + grouted sleeve`, $\phi T_n = 66.0\text{ kips}$) at $1\text{ per panel}$; out-of-plane wall anchors `WA1` ($\phi T_n = 7.05\text{ kips}$) at $6.0\text{ ft}$ o.c. ($k_a = 2.0$, $F_p = 858.04\text{ plf}$, demand $= 5.15\text{ kips/anchor}$) with $60\text{ ft} \times 30\text{ ft}$ subdiaphragms ($2.0:1 \le 2.5:1$).
  * **Installed Cost (`PROC-114` Rev 2):** **$\$353,628.00\text{ USD}$** ($\$41,372.00$ below the $\$395,000.00$ capital cap).