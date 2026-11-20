# Solver core source

`core/` is a recorded snapshot of the solvers from **Pteronautics Atlas** (GPL-3.0, copyright Andrew Aguiar).
Do not edit these files in place: re-sync with `scripts/sync-core.sh`, and wrap any interface Works needs in `src/adapters/`.

- Atlas commit: `cf353731ecc16bec64e8dbc80ea3aa79c9e0805b`
- Commit subject: Point site URLs at the renamed pteronautics-atlas repository
- Commit date: 2026-11-19
- Synced: 2026-11-20T04:27:00Z

## Copied

- `js/solvers/` → `core/solvers/` (44 files, including `mfoil/`, MIT, see `LICENSE-mfoil.txt`)
- `js/lib/` → `core/lib/`: eigen.js expr.js linalg.js spline.js 
- Tests → `tests/core/` (import paths rewritten): aero335.tests.js augment.tests.js autopilot.tests.js collab.tests.js control.tests.js flow.tests.js frame3d.tests.js gasdyn.tests.js ins.tests.js navigation.tests.js orbits.tests.js performance.tests.js propulsion.tests.js rocket.tests.js stability.tests.js structures.tests.js theory.tests.js vibration.tests.js wings.tests.js

## Not copied

Tests that import Atlas UI modules (`js/modules/`), so they cannot run without the Atlas app: cfd.tests.js fem2d.tests.js flight.tests.js formulas.tests.js supersonic.tests.js vehicles.tests.js.
The mfoil checks inside Atlas's `tests/tests.js` runner are also not copied, since that runner imports those tests.
