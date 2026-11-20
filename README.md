# Pteronautics Works

**Pteronautics Works** is the professional, vehicle-centred design program of the Pteronautics family. You design a whole vehicle, and Works couples the analyses for you: edit the wing and the aerodynamics, mass and balance, stability, performance and requirements all update, with a graph that shows what is current, what is stale and what it took to compute.

It runs on the same validated solver core as **Pteronautics Atlas**, the free educational aerospace tool. The two are separate programs: Works carries a recorded snapshot of the Atlas solvers in `core/`, and Atlas has no knowledge of Works.

## What works today (first slice)

- **Hangar**: vehicles of six classes (fixed-wing, rotorcraft & eVTOL, high-speed, launch vehicle, spacecraft, sailplane) and a matrix of which core solvers drive each class. Import a vehicle from `.json`, or start a new fixed-wing vehicle from Kestrel.
- **Kestrel**, an electric survey UAS (3.2 m span, NACA 4415, about 22.4 kg), opens in a live **aircraft workspace**:
  - systems tree and editors for every part, plus the flight condition (cruise speed, ISA altitude and deviation);
  - a to-scale top view with the span load (against elliptic), MAC, CG and neutral point, and lens panels for the stability roots, the power curve and the wing section;
  - a breadcrumb that zooms Mission › Vehicle › Wing › Section › Boundary layer;
  - the coupling graph (atmosphere, geometry → aero, mass & balance → stability, performance → requirements) with each node's state and run time, and an aero fidelity selector (lifting line, vortex lattice, vortex lattice + nonlinear stall strips);
  - stat cards and a live requirements list (target, value, margin, status; targets are editable).
- The vehicle is kept in `localStorage` as you edit, and can be saved and loaded as a `.json` file.

**Stubbed or illustrative in this slice:** the other five vehicles are concept documents (no analyses yet); the Vireo-2 launcher workspace is a layout preview with illustrative numbers; the Section level shows the NACA geometry and thin-airfoil numbers, and the viscous section lens (mfoil) and the Boundary layer level are placeholders; there is no 3D view yet; the Missions, Requirements, Trade studies, Libraries and Reports sidebar entries are marked "soon".

## Run it

Plain ES modules, no build step, no dependencies. Browsers need a local server for modules:

```bash
python3 serve.py
```

It opens http://localhost:8790 (Atlas uses 8765, so both can run side by side). `python3 serve.py 9000 --no-browser` picks another port and skips opening the browser.

## Tests

Open http://localhost:8790/tests/ with the server running. The page runs:

- **Works tests** (`tests/works/`): the vehicle model (schema, validation, paths, JSON round trip, storage), the coupling engine (ordering, staleness, failures, fidelity, async runs that restart on an edit) and the fixed-wing graph end to end on Kestrel (values against independent estimates, couplings and trends).
- **Core tests** (`tests/core/`): the Atlas solver tests that need nothing outside the solvers, copied with the core.

`?only=works` or `?only=core` runs one half. Results are also left in `window.__results`.

## Layout

```
index.html, css/works.css      app page and styles (design tokens shared with Atlas)
src/app.js                     routing: #/ hangar, #/v/<id> workspace
src/model/                     vehicle document (vehicle.js), seeds, storage and .json files
src/engine/graph.js            the coupling engine
src/adapters/aircraft.js       wrappers around the core solvers (wing, stability, performance, atmosphere)
src/analyses/                  the fixed-wing analysis nodes and requirement evaluation
src/ui/                        hangar, workspace, launcher preview, planform, charts, coupling graph
core/                          solver snapshot from Atlas (do not edit; see below)
tests/                         test page, Works tests, copied core tests
scripts/sync-core.sh           re-copies the core from an Atlas checkout
```

### The vehicle document

One JSON document per vehicle, whatever its class: `{ schema, version, id, name, class, mission, components: [{ id, type, ... }], requirements: [...] }`. Component types (wing, fuselage, rotor, stage, rocket engine, bus, …) and the types each class may hold are listed in `src/model/vehicle.js`. Only fixed-wing has an analysis graph in this build.

### The coupling engine

Each analysis node declares the document paths it reads (`wing.*`, `*.mass`, `mission.cruiseSpeed`) and the nodes it needs. Editing a path marks its readers and everything downstream stale; the engine reruns only those, in dependency order, and starts over if another edit arrives mid-run. A node that throws is marked failed with its message, and so are the nodes that depend on it.

## The solver core and syncing it from Atlas

`core/solvers/` (and the few helpers in `core/lib/` they import) is a copy of Atlas's `js/solvers/`. `core/SOURCE.md` records the Atlas commit it came from and which tests were copied. Works never edits these files; when it needs a different interface it wraps the solver in `src/adapters/`.

To update the core from a local Atlas checkout:

```bash
scripts/sync-core.sh ../Pteronautics
```

This replaces `core/solvers/`, `core/lib/` and `tests/core/`, rewrites the copied tests' import paths, and updates `core/SOURCE.md`. Then run the test page and commit. A shared package can replace this snapshot later.

## License

Copyright (C) 2026 Andrew Aguiar. Pteronautics Works is free software under the **GNU General Public License v3.0** (see `LICENSE` and `COPYRIGHT`), the same license as the Atlas code it reuses. The mfoil port in `core/solvers/mfoil/` is MIT-licensed (see `LICENSE-mfoil.txt`); the bundled fonts are under the SIL Open Font License (see `assets/fonts/`).
