# Pteronautics Works

**Pteronautics Works** is the professional, vehicle-centred design program of the Pteronautics family. You design a whole vehicle, and Works couples the analyses for you: edit the wing and the aerodynamics, mass and balance, stability, performance and requirements all update, with a graph that shows what is current, what is stale and what it took to compute.

It runs on the same validated solver core as **Pteronautics Atlas**, the free educational aerospace tool. The two are separate programs: Works carries a recorded snapshot of the Atlas solvers in `core/`, and Atlas has no knowledge of Works.

## What works today

- **Hangar**: vehicles of six classes (fixed-wing, rotorcraft & eVTOL, high-speed, launch vehicle, spacecraft, sailplane) and a matrix of which core solvers drive each class. Import a vehicle from `.json`, or start a new fixed-wing vehicle from Kestrel.
- **Kestrel**, an electric survey UAS (3.2 m span, NACA 4415, about 22.4 kg), opens in a live **aircraft workspace**:
  - systems tree and editors for every part, plus the flight condition (cruise speed, ISA altitude and deviation);
  - a to-scale top view with the span load (against elliptic), MAC, CG and neutral point, and lens panels for the stability roots, the power curve and the wing section;
  - a **3D view**: a hidden-line wireframe lofted from the real geometry (NACA sections, taper, sweep, twist, dihedral, body, tails, propeller), wing lines coloured by local lift, with the span load standing over the wing and the CG and neutral point. Drag to orbit, shift-drag to pan, scroll to zoom; Iso, Front, Side and Top presets (the level views are orthographic, with a scale bar);
  - the **airfoil lab** (Section level): the core's mfoil viscous panel method run in a Web Worker at any wing station's chord, Reynolds number and local cℓ at cruise trim (or your own α / cℓ, Re, Ncrit, airfoil). It shows −Cp on both surfaces against the inviscid solution, the section with its pressure arrows, displacement thickness, transition and separation, polars swept progressively in the background (lift curve, drag polar, transition against α), and a button to put a tried airfoil on the wing's root or tip;
  - the **Boundary layer** level: the lab's boundary layer drawn on the section (laminar, turbulent, separated) and Hk, cf, δ*/θ and edge velocity along both surfaces;
  - a breadcrumb that zooms Mission › Vehicle › Wing › Section › Boundary layer;
  - the coupling graph (atmosphere, geometry → sections, mass & balance → aero → stability, performance → requirements) with each node's state and run time, an aero fidelity selector (lifting line, vortex lattice, vortex lattice + nonlinear stall strips) and a sections selector: thin airfoil (handbook cℓ,max, fully turbulent wing skin friction) or viscous (an mfoil polar per airfoil at the mean chord's Reynolds number, run in a worker, feeding cℓ,max and the wing's profile drag into aero, and so the stall speed, L/D, endurance and requirements);
  - stat cards and a live requirements list (target, value, margin, status; targets are editable).
- **Mission planner** (`#/v/<id>/mission`, the **Mission** button in the workspace, or **Missions** in the hangar sidebar; fixed-wing): the flight as a list of segments — climb (full power at the best-climb speed, by altitude steps), cruise (a distance at an airspeed, with a headwind or tailwind), loiter (a time at an airspeed), descent (a glide at best L/D, motor off) and reserve (held at landing, sized at the best-endurance speed). Mission settings: the field elevation (heights are above the field; the air is ISA at field + height) and the hotel load (avionics and payload, drawn all flight). The battery's nominal voltage and internal resistance give its I²R losses (the current solves V₀·I − I²R = P, and past V₀²/4R the pack cannot deliver). It shows height and battery energy through the flight, each segment's time, distance, power and energy, the energy split by segment, and what is left after the reserve. A segment that cannot be flown (below 1.1 × stall, beyond the motor, above the ceiling) is flagged. The **Mission** node joins the coupling graph, so an airframe edit in the workspace reaches the mission, and Kestrel's R-11 requires 5% of usable energy left after the reserve.
- **Linked sizing**: the battery's mass follows its energy at its specific energy (Wh/kg) and the motor's mass follows its power (W/kg). Set **Mass with energy / power** to *fixed* to hold the mass instead. Setting the mass of a linked part changes its rating; setting its specific energy or power changes its mass (linked) or its rating (fixed). Edits, trade studies and missions all apply the same rule.
- **Trade studies** (`#/v/<id>/trade`, the **Trade study** button in the workspace, or **Trade studies** in the hangar sidebar), each sample a full coupled run of the same graph:
  - **Sweep**: one design value over a range. One chart per metric, with each requirement's target and failing side, the worst requirement margin along the sweep, and the part of the range where every requirement holds (and which requirements end it);
  - **Map**: two design values over a grid. One metric as colour, hatching where a requirement fails, each requirement's boundary drawn as a contour, and the best point that meets every requirement;
  - **Sensitivity**: each chosen value moved ±10% (angles ±1°, positions ±2% of the fuselage) on its own, ranked as a tornado chart of one metric;
  - click a sample to compare it with the design, and **Apply** it to the vehicle. The settings are remembered per vehicle in this browser.
- **Tern**, an 18 m class sailplane, opens in the same workspace with a sailplane graph: the airframe nodes (geometry, sections, aero, mass, stability) without a motor or battery, and a **Glide** node in place of Performance and Mission. It gives the glide polar, best glide ratio, minimum sink, stall speed and wing loading, and MacCready's speed to fly and cross-country speed for the average thermal climb (set in the flight condition), with a MacCready table in the **Cross-country** view. Trade studies, requirements and reports work on it too. `src/analyses/classes.js` maps each class to its graph.
- **Requirements** (`#/v/<id>/requirements`, or **Requirements** in the hangar sidebar): every requirement with its live value, margin and status, editable in place (title, group, metric, at least / at most, target), new ones on any analysis output (including the mission and the glide), filters by status and group, and a **history** of which edit made a requirement pass or fail. Edits in the workspace, the mission planner, trade studies and this page are all recorded; the history is kept per vehicle in this browser.
- **Design report** (`#/v/<id>/report`, the **Report** button in the workspace, or **Reports** in the hangar sidebar): the current design as a document on a light paper page, to print or save as PDF (A4). Summary with the top view, requirements and recent changes, configuration and mass, aerodynamics, stability and handling with MIL-F-8785C levels, performance or glide, the mission, and how each analysis was computed.
- The vehicle is kept in `localStorage` as you edit, and can be saved and loaded as a `.json` file.

Segment values (`mission.segments.<id>.<key>`) and the mission settings are trade-study variables, so a survey time or a leg can be swept.

**Stubbed or illustrative in this slice:** trade studies move one parameter at a time, with the battery and motor resized by linked sizing but nothing else (a heavier aircraft keeps its wing); the battery model is a constant open-circuit voltage and resistance (no discharge curve or temperature); the sailplane's drag is the fully turbulent handbook build-up, the pessimistic bound for a laminar sailplane, and its glide has no flaps or water ballast; the rotorcraft, high-speed, launch vehicle and spacecraft vehicles are concept documents (no analyses yet); the Vireo-2 launcher workspace is a layout preview with illustrative numbers; viscous sections use free transition on a clean surface (Ncrit 9), so they are the optimistic bound and fully turbulent Raymer the conservative one; the Libraries sidebar entries are marked "soon".

## Run it

Plain ES modules, no build step, no dependencies. Browsers need a local server for modules:

```bash
python3 serve.py
```

It opens http://localhost:8790 (the tests are at `/tests/`) (Atlas uses 8765, so both can run side by side). `python3 serve.py 9000 --no-browser` picks another port and skips opening the browser.

## The website

The repository is served as it is by GitHub Pages from `main` (Settings → Pages → Deploy from a branch: `main`, root); `.nojekyll` makes Pages serve the files without processing them.

- https://blazingdrako.github.io/pteronautics-works/ opens Works itself (`index.html`), and `/tests/` the test page. `/app/`, where Works lived for a while, redirects to the root and keeps the `#/v/<id>` route.
- The family's home page, which covers both Atlas and Works, is a separate site: https://blazingdrako.github.io/pteronautics/ (repository `pteronautics`). It loads some Works modules live to draw its figures (Kestrel in 3D, the coupling demo, an airfoil solution), so if you move or rename one of the files its README lists, update that site too.

## Tests

Open http://localhost:8790/tests/ with the server running. The page runs:

- **Works tests** (`tests/works/`): the vehicle model (schema, validation, paths, JSON round trip, storage), the coupling engine (ordering, staleness, failures, fidelity, async runs that restart on an edit, asynchronous nodes), the fixed-wing graph end to end on Kestrel (values against independent estimates, couplings and trends), the viscous sections and 3D mesh (NACA 0012 polar against XFOIL and handbook values, the viscous coupling into aero and performance, mesh extent and dihedral), linked sizing and older documents upgraded to it, the mission profile (cruise power against the Performance node, climb time against the core's time to climb, glide distance against best L/D, the reserve at best-endurance power, unflyable segments, the pack's I²R losses, the hotel load, field elevation, segment sweeps), requirements (new ids, evaluation, the history and its causes), sailplanes (the glide polar and MacCready speed to fly against closed forms, Tern end to end), and trade studies (samples against fresh runs, linked edits, the vehicle left untouched, sensitivities, feasible ranges, contours, cancelling).
- **Core tests** (`tests/core/`): the Atlas solver tests that need nothing outside the solvers, copied with the core.

`?only=works` or `?only=core` runs one half. Results are also left in `window.__results`.

## Layout

```
index.html, css/works.css      app page and styles (design tokens shared with Atlas)
app/index.html                 redirect from the old /app/ address
src/app.js                     routing: #/ hangar, #/v/<id> workspace, and /mission, /trade, /requirements, /report under it
src/model/                     vehicle document (vehicle.js, with linked sizing and upgrades), mission segments (segments.js), requirement history (history.js), seeds, storage and .json files
src/engine/graph.js            the coupling engine
src/adapters/aircraft.js       wrappers around the core solvers (wing, stability, performance, atmosphere)
src/adapters/airfoil.js        mfoil operating points and polar sweeps (pure; used by the worker and the tests)
src/workers/                   the airfoil Web Worker and its client (cancellable requests, polar cache)
src/analyses/                  the fixed-wing and sailplane graphs (fixedWing.js, sailplane.js, chosen by class in classes.js), the mission profile (mission.js), requirement evaluation and the trade-study runner (trade.js)
src/ui/                        hangar, workspace, mission planner, trade studies, requirements, report, launcher preview, planform, 3D view, airfoil lab, charts, coupling graph
core/                          solver snapshot from Atlas (do not edit; see below)
tests/                         test page, Works tests, copied core tests
scripts/sync-core.sh           re-copies the core from an Atlas checkout
```

### The vehicle document

One JSON document per vehicle, whatever its class: `{ schema, version, id, name, class, mission, components: [{ id, type, ... }], requirements: [...] }`. Component types (wing, fuselage, rotor, stage, rocket engine, bus, …) and the types each class may hold are listed in `src/model/vehicle.js`. A fixed-wing `mission` also holds `segments`, the mission profile (`src/model/segments.js`). Documents saved before linked sizing and missions are upgraded when they load: the new parameters come from their own numbers, so their results do not change. Fixed-wing vehicles and sailplanes have analysis graphs in this build; a sailplane's `mission` holds the trim speed, altitude and average thermal climb (`climbRate`).

### The coupling engine

Each analysis node declares the document paths it reads (`wing.*`, `*.mass`, `mission.cruiseSpeed`) and the nodes it needs. A node may return a promise (the viscous sections node does); `run()` awaits it and drops the result if an edit made the node stale meanwhile. Editing a path marks its readers and everything downstream stale; the engine reruns only those, in dependency order, and starts over if another edit arrives mid-run. A node that throws is marked failed with its message, and so are the nodes that depend on it.

## The solver core and syncing it from Atlas

`core/solvers/` (and the few helpers in `core/lib/` they import) is a copy of Atlas's `js/solvers/`. `core/SOURCE.md` records the Atlas commit it came from and which tests were copied. Works never edits these files; when it needs a different interface it wraps the solver in `src/adapters/`.

To update the core from a local Atlas checkout:

```bash
scripts/sync-core.sh ../Pteronautics
```

This replaces `core/solvers/`, `core/lib/` and `tests/core/`, rewrites the copied tests' import paths, and updates `core/SOURCE.md`. Then run the test page and commit. A shared package can replace this snapshot later.

## License

Copyright (C) 2026 Andrew Aguiar. Pteronautics Works is free software under the **GNU General Public License v3.0** (see `LICENSE` and `COPYRIGHT`), the same license as the Atlas code it reuses. The mfoil port in `core/solvers/mfoil/` is MIT-licensed (see `LICENSE-mfoil.txt`); the bundled fonts are under the SIL Open Font License (see `assets/fonts/`).
