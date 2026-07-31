# Gravity Lab

**Live: https://gravity-lab.fly.dev**

An interactive, scientifically honest 3D gravitational N-body simulator for exploring
close encounters: flybys, gravity assists, binary disruption, chaotic three-body motion,
collisions, and escape thresholds.

**Nothing is scripted.** Every trajectory emerges from Newtonian gravitation acting on
each body's mass, position, velocity, and radius. There are no decorative orbits, no
easing curves, no fixed "anchor" bodies, and no predetermined outcomes.

```
npm install
npm run dev     # http://localhost:5198 (frontend only)
npm test        # headless physics validation suite (Vitest)

# full stack (API + published worlds), from the repo root:
npx vite build --base=/ && (cd server && npm install) && node server/index.mjs
```

## Published worlds

Press-and-hold in the sandbox to grow bodies, then **Publish** to give a world its own
address at `/@your-world-name`. Anyone opening that link gets the exact initial
conditions, replayed by the same integrator. `/worlds` lists every published world.

The leaderboard's ranking columns are **measured, not declared**. At publish time the
world is integrated forward for 200 characteristic orbital periods alongside a twin
displaced by one part in 10⁹, yielding:

- `chaos` — a finite-time Lyapunov exponent per orbit (~0 regular, >0.3 chaotic)
- `firstCollision` / `survivors` — when (and whether) bodies actually merge
- `escapees` — bodies on unbound outbound trajectories at the end

See `src/physics/analyze.ts`. Worlds that merge before a full dynamical time report no
chaos value rather than a meaningless one.

Sharing is also possible with no server at all: a world encodes into a `#w=…` URL
fragment (deflate-compressed, ~350 characters for a five-body system).

---

## Physics model

Newtonian N-body gravitation, computed pairwise for every body `i`:

```
a_i = G · Σ_{j≠i}  m_j (r_j − r_i) / |r_j − r_i|³
```

- `G = 6.6743×10⁻¹¹ m³ kg⁻¹ s⁻²` (CODATA 2018)
- All internal state is SI (meters, kilograms, seconds, joules) in **double precision**
  (`Float64Array` throughout). The UI converts to km, AU, days, years, km/s for display only.
- Every body both exerts and feels force — Newton's third law is exact by construction
  (each pair is accumulated symmetrically), and the validation suite measures
  `|ΣF|/Σ|F| ≈ 10⁻¹⁷` (machine precision).
- **No gravitational softening by default.** Close approaches are resolved by adaptive
  substepping down to physical contact at the bodies' real radii. An optional Plummer
  softening ε is available for abstract point-particle experiments and is labeled as an
  approximation in the UI.

### Energies

- Per body: `K_i = ½ m_i |v_i|²`
- Per unique pair: `U_ij = −G m_i m_j / |r_i − r_j|`
- Total mechanical energy `E = ΣK + ΣU` is tracked continuously, along with linear
  momentum, angular momentum, and the center of mass.

The UI distinguishes three different "energies" that are often conflated:

1. **Total energy of the isolated system** — conserved to numerical tolerance (displayed
   as a live drift percentage).
2. **One body's energy in a chosen reference frame** — may rise or fall (this is what a
   gravity assist changes).
3. **Energy exchanged between bodies** — during an assist the spacecraft's gain is taken
   from the assisting planet's orbital energy. The planet's recoil momentum is equal and
   opposite to the craft's (total momentum is conserved to ~10⁻¹³ relative); for an
   825 kg craft the implied change in Jupiter's *velocity* (~10⁻²³ m/s) is real in the
   force equations but far below what double precision can resolve against a 13 km/s
   orbital speed — the UI says exactly that instead of pretending to display it.

## Integrator

**4th-order Yoshida symplectic composition** (Yoshida 1990) — three nested leapfrog
(drift-kick) stages with coefficients

```
w1 = 1/(2 − 2^(1/3))      w0 = −2^(1/3)/(2 − 2^(1/3))
c = [w1/2, (w0+w1)/2, (w0+w1)/2, w1/2]      d = [w1, w0, w1]
```

Symplectic integrators preserve the Hamiltonian phase-space structure, so energy error
stays *bounded and oscillatory* (you can watch it spike at periapsis and recover in the
drift chart) instead of accumulating secularly — the right choice for long-term orbits.

### Adaptive timestep

Each render tick's simulated interval is split into substeps

```
h = η · min over pairs of ( √(r³/G(m_i+m_j)),  r/|v_rel| )
```

- the free-fall/orbital timescale term resolves orbital curvature;
- the crossing-time term is applied only to pairs whose linearly-extrapolated closest
  approach comes within 5× their combined radii, so near-collisions are resolved without
  distant irrelevant pairs strangling the step;
- η (default 0.03) is user-adjustable; the current substep is displayed live.

Strictly speaking, varying the step size costs a symplectic integrator some of its exact
phase-space preservation; measured drift over repeated deep three-body encounters stays
below ~10⁻⁷ at η = 0.008 and ~10⁻⁶ at the interactive default (see Limitations).

Physics runs in a **Web Worker**, fully separated from rendering. The main thread only
receives immutable state copies; camera moves, frame switches, and UI reads can never
perturb the integration (verified bitwise by an automated test).

### Error monitoring

Kinetic/potential/total energy, momentum, angular momentum, COM position/velocity, and
percentage drift of E and |L| since t=0 are computed every frame and charted. If energy
drift exceeds 0.01% a warning chip appears suggesting a smaller η. After an inelastic
merge the drift baselines are rebased, because the merge *physically* dissipates kinetic
energy (reported per event) — the drift meters exist to measure numerical error, not to
hide physical dissipation.

## Reference frames

Inertial (simulation coordinates; presets are initialized barycentric with zero total
momentum), instantaneous center-of-mass, any body-centered frame, and a rotating
two-body frame. Frame changes transform *presentation only* — positions, velocities and
trails are re-derived from the same physical state, with each trail point transformed
using the frame evaluated at that point's own recorded time.

## Collisions

Detected against **real physical radii** (never the visual exaggeration). Modes:

- **stop** — halt at contact;
- **merge** — perfectly inelastic: total mass and momentum conserved exactly (validated),
  merged radius from equal-density volume addition, dissipated COM-frame kinetic energy
  reported in the event log;
- **elastic** — restitution-1 impulse along the line of centers (abstract experiments);
- **none** — pass-through for point-particle mode.

No fragmentation is offered because no defensible fragmentation model is implemented.

Merges display a brief flash/ring/spark burst at the computed contact point. This is
**illustrative rendering only** — it runs on the render thread in wall-clock time and
feeds nothing back into physics; the scientifically calculated impact state (relative
speed, dissipated COM-frame kinetic energy, momentum bookkeeping) is in the event log.

## Prediction, playback, editing

- **Ghost trajectories** integrate a *clone* of the current state in the worker — never a
  fitted curve, never fed back into the live run.
- **Scrubbing** restores exact recorded snapshots (no interpolation, no fake reverse
  physics). Editing any initial condition honestly re-initializes the run.
- Bodies are fully editable (mass, radius, position, velocity, name, type, color, trail &
  vector visibility) numerically, or by dragging the body / its velocity-arrow tip in the
  viewport while at t=0. Scenarios import/export as JSON and save to localStorage.
- Two-body pair analysis: osculating elements (ε, h, e, a, periapsis/apoapsis), bound /
  parabolic / hyperbolic classification, v∞, impact parameter, local escape velocity,
  Hill sphere and Laplace SOI (labeled as analytical approximations), closest approach,
  and a live **simulated vs analytical deflection** comparison using
  `δ = 2·atan(μ/(b·v∞²))` with the percentage difference shown.

## Validation

`npm test` runs the same suite exposed in-app ("run automated accuracy tests"), which
displays measured numbers, not assertions. Results on this machine:

| Test | Measured |
|---|---|
| Newton's third law | \|ΣF\|/Σ\|F\| = 6.6×10⁻¹⁷ |
| Circular orbit, 10 periods | max radius deviation 4.4×10⁻⁸, energy drift ~10⁻¹⁴ |
| Chaotic 3-body, 9.5 yr (η=0.008) | ΔE/E = −6×10⁻⁸, ΔL/L = 9×10⁻¹³ |
| Barycenter linear motion | relative error 3.8×10⁻¹⁶ |
| Hyperbolic flyby vs 2·asin(1/e) | 120.698° vs 120.698° (<0.001%) |
| Convergence order | halving h shrinks error 16.0× (4th order) |
| Display metadata independence | bitwise identical trajectories |
| Frame/camera reads | bitwise identical trajectories |
| Gravity assist | craft 14 940→19 190 m/s heliocentric; system ΔE/E ≈ 5×10⁻¹⁵, Δ\|P\| ≈ 0 |
| Inelastic merge | Δmass = 0, relative Δ\|P\| = 0 |

The interactive Jupiter-assist scenario reproduces the analytical deflection to ~1%; the
residual is physical (the Sun perturbs the encounter), not numerical.

## Assumptions & limitations

- **Point-mass Newtonian gravity**: no relativity, tides, oblateness, radiation pressure,
  or drag. Fine for the regimes shown; Mercury-perihelion-class precision is out of scope.
- **Osculating elements** shown for a pair are exact only for an isolated pair; third
  bodies make them drift (which is visible and instructive).
- **Merged bodies cannot spin**: a merge converts the pair's orbital angular momentum
  about their COM into spin, which a point-mass model cannot carry; the event log states
  this and the L-drift baseline is rebased.
- **Adaptive stepping** trades a little of the symplectic error bound for encounter
  resolution (measured above). Elastic-bounce overlap correction slightly displaces
  bodies to the contact surface.
- **Visual scales**: body sizes may be exaggerated for visibility (labeled with the
  factor); physics and collision detection always use the real radius (validated).
- Prediction ghosts integrate at a slightly relaxed η for responsiveness and ignore
  collisions.

## Architecture

```
src/physics/    constants, forces, integrator (Yoshida-4), engine (adaptive stepping,
                collisions), diagnostics, orbital elements, reference frames, presets,
                analyze (measured world statistics for the leaderboard)
src/worker/     physics worker + typed message protocol (integration off the UI thread)
src/state/      worker client (60 fps mutable frame slot), zustand store + router,
                world codec (compact URL-safe serialization), registry API client
src/components/ R3F scene (bodies, trails, vectors, markers, asymptotes, drag handles,
                sandbox spawner, impact FX), top bar, editor/measurement panels,
                charts/scrubber, publish dialog, leaderboard, world bar
src/validation/ shared accuracy suite (in-app panel + Vitest)
server/         Fastify + SQLite registry; serves the SPA and injects per-world
                OpenGraph tags on /@slug so shared links preview correctly
tests/          Vitest entries (physics validation + codec/analyzer)
```

Deployment: a single Fly.io app (`fly.toml`, `Dockerfile`) serving both the static build
and the API, with SQLite on a mounted volume at `/data`.

Stack: TypeScript, React 18, Three.js via React-Three-Fiber, zustand, Vite, Vitest.
Charts are hand-rolled SVG. No physics library is used; the integrator is ~40 lines and
validated against analytical results above.
