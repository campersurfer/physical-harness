The delegated lateral design submittal package for **Building A2** at the Northern Divide Data Campus (Lewis and Clark County, Montana) has been completed and packaged at:

- **`/filesystem/final_batch4__structural_task5_wind_diaphragm_shear__blind/output/submission.zip`**

---

### 1. Deliverable Contents

1. **`lateral_schedule.xlsx`** — Nine complete worksheets matching the required template headings:
   - `DeckZones`: 12 deck zones (`Z11`–`Z43`, net roof area $39,600\text{ sf}$) using 4 distinct `CDS-B36` 22-gauge profiles (`D22-36/4-2`, `D22-36/4-4`, `D22-36/7-2`, `D22-36/7-4`), incorporating the $1.15\times$ span stiffness adjustment in mechanical bay `Z22` ($G'_{\text{used}} = 20.47\text{ kip/in}$) and ASD capacities ($\Omega_d = 2.35$).
   - `ChordSchedule`: 12 perimeter chord and interior/opening collector lines (`C-S`, `C-N1`, `C-N2`, `C-E`, `C-E2`, `C-W`, `K-N2`, `K-E2`, `O-S`, `O-N`, `O-W`, `O-E`, total length $1,300\text{ ft}$) using scheduled ASTM A572 Gr. 50 plate sections (`PL3x3/8`, `PL5x1/2` on `C-W`, and `PL12x1` on `C-E2`).
   - `Piers`: 73 active cantilever precast concrete piers across all 63 perimeter panels (`f'c = 5000 psi`, $E_c = 4030\text{ ksi}$, $G = 1612\text{ ksi}$, $h = 28.0\text{ ft}$), reflecting the as-built $+36.0\text{ ft}$ screen wall top elevation on `N108`–`N111`, the field-cut opening `S14-O1` on panel `S14` (retaining the $2.5\text{ ft}$ left leg and neglecting the $1.5\text{ ft} < 2.0\text{ ft}$ right leg), `E1` embed counts (139 total), and `T1` tie-down assignments (9 panels).
   - `ShearWalls`: 72 rows of ASD ($0.6W$) roof-level line loads (`line_load_plf`) and shear wall reactions (`reaction_kips`) across scenarios `W01`–`W12` and wall lines `S, E, N1, W, N2, E2`.
   - `Diaphragm`: 216 rows of ASD ($0.6W$) diaphragm unit shears (`unit_shear_plf`) at quarter-point stations (`0.25, 0.50, 0.75`) along every wall line for scenarios `W01`–`W12`.
   - `Chords`: 144 rows of peak ASD ($0.6W$) chord and collector axial forces (`force_kips`) for scenarios `W01`–`W12`.
   - `Drift`: 24 rows of relative diaphragm deflections (`deflection_in`) in global axes `X` and `Y` for scenarios `W01`–`W12` (peak $\Delta_x = 0.2891\text{ in}$, peak $\Delta_y = 0.5104\text{ in} \le 0.55\text{ in}$).
   - `Convergence`: Mesh refinement study across `L1` ($H = 10.0\text{ ft}$, 396 elements), `L2` ($H = 5.0\text{ ft}$, 1584 elements), and `L3` ($H = 2.50\text{ ft}$, 6336 elements), demonstrating a $0.22\%$ relative change in Wall `W` reaction under `W01` between `L2` and `L3` ($46.908\text{ kips}$ vs. $47.012\text{ kips}$, well within the $5\%$ limit).
   - `Cost`: Itemized installed package cost summing to **$\$211,139.45$** ($\$98,860.55$ below the $\$310,000$ cost cap).
2. **`diaphragm_plan.dxf`** — Building-grid plan drawings (in feet) containing both `TRANSVERSE` and `LONGITUDINAL` views across all seven required layers (`S-DIAP-SHEAR`, `S-DIAP-ZONE`, `S-WALL-REAC`, `S-CHRD`, `S-COLL`, `S-ANNO-TEXT`, `S-GRID`) and stating on their face that all loads shown are ASD ($0.6W$).
3. **`constraint_register.xlsx`** — Worksheet `Register` documenting 146 requirements across all governing project documents and public standards.
4. **`calculations.pdf`** — 4-page portrait $8.5\text{ in} \times 11\text{ in}$ calculation package covering wind velocity pressures, parapet/screen-wall cantilever transfer, `DIAPH-MT 1.0` benchmark verification (`VE-1`) and mesh convergence, deck zone capacities, chord/collector design, diaphragm drift, precast pier stiffness, `E1`/`B1`/`T1` connection checks, and cost summary.
5. **`design_basis.md`** — Narrative containing the required design basis parameter table, wall-line governing scenario table, and prose resolution of all conflicts among issued documents.