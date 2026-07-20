import { useMemo, useRef } from 'react';
import { useStore, actions } from '../state/store';
import { workerClient } from '../state/workerClient';
import { pairOrbit, analyticDeflection, angleBetween, hillSphere, sphereOfInfluence } from '../physics/orbital';
import { explain, speedInFrame } from '../ui/explain';
import { fmtAngle, fmtDistance, fmtEnergy, fmtPct, fmtSpeed, fmtTime } from '../ui/units';
import type { FramePayload } from '../worker/protocol';
import type { Vec3 } from '../physics/types';

function Row({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="kv" title={title}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function DiagnosticsSection({ f }: { f: FramePayload }) {
  const d = f.diag;
  return (
    <section>
      <h3>System measurements <em>(SI, computed every frame)</em></h3>
      <Row k="kinetic energy ΣK" v={fmtEnergy(d.kinetic)} />
      <Row k="potential energy ΣU" v={fmtEnergy(d.potential)} />
      <Row k="total mechanical E" v={fmtEnergy(d.total)} />
      <Row k="energy drift" v={fmtPct(d.energyDrift)} title="(E - E₀)/|E₀| since initial conditions — numerical error indicator" />
      <Row k="ang. momentum |L|" v={`${Math.hypot(...d.angularMomentum).toExponential(3)} kg·m²/s`} />
      <Row k="ang. mom. drift" v={fmtPct(d.angMomDrift)} />
      <Row k="momentum |P|" v={`${Math.hypot(...d.momentum).toExponential(3)} kg·m/s`} />
      <Row k="COM position" v={fmtDistance(Math.hypot(...d.comPosition))} />
      <Row k="COM velocity" v={fmtSpeed(Math.hypot(...d.comVelocity))} />
    </section>
  );
}

function PairSection({ f }: { f: FramePayload }) {
  const pairSel = useStore((s) => s.pairSel);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const encounterRef = useStore((s) => s.encounterRef);
  const encounterLive = useStore((s) => s.encounterLive);

  const ia = f.ids.indexOf(pairSel[0]);
  const ib = f.ids.indexOf(pairSel[1]);
  const name = (id: string) => liveSpecs.find((b) => b.id === id)?.name ?? id;

  const orb = useMemo(() => {
    if (ia < 0 || ib < 0) return null;
    const P = (k: number): Vec3 => [f.pos[3 * k], f.pos[3 * k + 1], f.pos[3 * k + 2]];
    const V = (k: number): Vec3 => [f.vel[3 * k], f.vel[3 * k + 1], f.vel[3 * k + 2]];
    return pairOrbit(f.masses[ia], P(ia), V(ia), f.masses[ib], P(ib), V(ib));
  }, [f, ia, ib]);

  if (!orb || ia < 0 || ib < 0) return null;

  // measured deflection so far: angle between initial and current relative velocity
  const measuredDefl = encounterRef ? angleBetween(encounterRef.vRel0, orb.relVelocity) : null;
  const analytic = encounterRef && encounterRef.vInfinity > 0
    ? analyticDeflection(encounterRef.mu, encounterRef.impactParameter, encounterRef.vInfinity)
    : null;

  const heavyIdx = f.masses[ia] >= f.masses[ib] ? ia : ib;
  const lightIdx = heavyIdx === ia ? ib : ia;

  return (
    <section>
      <h3>Pair analysis — {name(pairSel[0])} ↔ {name(pairSel[1])}</h3>
      <div className="pair-pickers">
        {[0, 1].map((k) => (
          <select key={k} value={pairSel[k]} onChange={(e) => {
            const p: [string, string] = [...pairSel] as [string, string];
            p[k] = e.target.value;
            actions.setPair(p);
          }}>
            {liveSpecs.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ))}
      </div>
      <Row k="separation" v={fmtDistance(orb.r)} />
      <Row k="relative speed" v={fmtSpeed(orb.vRel)} />
      <Row k="escape velocity here" v={fmtSpeed(orb.escapeVelocityHere)} title="√(2μ/r) — the relative speed needed to escape from the current separation" />
      <Row k="orbit class" v={`${orb.classification} (e = ${orb.eccentricity.toFixed(4)})`} />
      <Row k="specific energy ε" v={`${orb.specificEnergy.toExponential(3)} J/kg`} />
      <Row k="specific ang. mom. h" v={`${orb.specificAngMom.toExponential(3)} m²/s`} />
      {isFinite(orb.semiMajorAxis) && <Row k="semi-major axis a" v={fmtDistance(orb.semiMajorAxis)} />}
      <Row k="periapsis" v={fmtDistance(orb.periapsis)} />
      {isFinite(orb.apoapsis) && <Row k="apoapsis" v={fmtDistance(orb.apoapsis)} />}
      {orb.vInfinity > 0 && <Row k="v∞ (hyperbolic excess)" v={fmtSpeed(orb.vInfinity)} />}
      {orb.vInfinity > 0 && <Row k="impact parameter b" v={fmtDistance(orb.impactParameter)} />}
      {encounterLive && (
        <Row k="closest approach so far" v={`${fmtDistance(encounterLive.minSep)} at t = ${fmtTime(encounterLive.timeAtMin)}`} />
      )}
      {f.masses[heavyIdx] > 100 * f.masses[lightIdx] && isFinite(orb.semiMajorAxis) && orb.semiMajorAxis > 0 && (
        <>
          <Row k="Hill sphere (approx.)" v={fmtDistance(hillSphere(orb.semiMajorAxis, f.masses[lightIdx], f.masses[heavyIdx]))}
            title="Analytical approximation: region where the smaller body's gravity dominates tidally" />
          <Row k="SOI (approx.)" v={fmtDistance(sphereOfInfluence(orb.semiMajorAxis, f.masses[lightIdx], f.masses[heavyIdx]))}
            title="Laplace sphere of influence — analytical patched-conic approximation" />
        </>
      )}
      {analytic !== null && measuredDefl !== null && (
        <div className="deflect-box">
          <h4>Deflection: simulation vs analytical</h4>
          <Row k="δ analytical = 2·atan(μ/(b·v∞²))" v={fmtAngle(analytic)} title="From the initial conditions' b and v∞" />
          <Row k="δ simulated (so far)" v={fmtAngle(measuredDefl)} title="Angle between the initial and current relative velocity — approaches the analytical value after the encounter completes" />
          <Row k="difference" v={analytic > 0 ? `${(Math.abs(measuredDefl - analytic) / analytic * 100).toFixed(2)}%` : '—'} />
        </div>
      )}
    </section>
  );
}

/** Before/after comparison against a user-set mark (gravity-assist bookkeeping). */
function MarkSection({ f }: { f: FramePayload }) {
  const markEntry = useStore((s) => s.markEntry);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const frame = useStore((s) => s.frame);
  return (
    <section>
      <h3>Before / after comparison</h3>
      <div className="btn-row">
        <button className="btn btn-sm" onClick={actions.mark}>📍 mark “before” state</button>
        {markEntry && <button className="btn btn-sm" onClick={actions.clearMark}>clear</button>}
      </div>
      {markEntry ? (
        <table className="cmp-table">
          <thead>
            <tr><th>body</th><th>|v| @ mark (t={fmtTime(markEntry.time)})</th><th>|v| now</th><th>Δ inertial KE/m</th></tr>
          </thead>
          <tbody>
            {liveSpecs.map((b) => {
              const before = markEntry.specs.find((x) => x.id === b.id);
              const i = f.ids.indexOf(b.id);
              if (!before || i < 0) return null;
              const vNow = Math.hypot(f.vel[3 * i], f.vel[3 * i + 1], f.vel[3 * i + 2]);
              const vBefore = Math.hypot(...before.velocity);
              const dSpec = 0.5 * (vNow * vNow - vBefore * vBefore);
              return (
                <tr key={b.id}>
                  <td><span className="dot" style={{ background: b.color }} />{b.name}</td>
                  <td>{fmtSpeed(vBefore)}</td>
                  <td>{fmtSpeed(vNow)}</td>
                  <td className={dSpec > 0 ? 'gain' : dSpec < 0 ? 'loss' : ''}>{dSpec.toExponential(2)} J/kg</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="hint">Mark a state before an encounter, then compare each body's speed and specific kinetic energy afterwards. Energy gained by one body is taken from the others — check the system total above.</p>
      )}
      {frame.kind === 'body' && (
        <p className="hint">
          Current frame: {liveSpecs.find((b) => b.id === (frame as any).id)?.name}-centered. Speeds in this frame:{' '}
          {liveSpecs.filter((b) => b.id !== (frame as any).id).map((b) => {
            const v = speedInFrame(f, b.id, frame);
            return v !== null ? `${b.name} ${fmtSpeed(v)}` : '';
          }).filter(Boolean).join(' · ')}
        </p>
      )}
    </section>
  );
}

function ExplanationSection({ f }: { f: FramePayload }) {
  const liveSpecs = useStore((s) => s.liveSpecs);
  const selectedId = useStore((s) => s.selectedId);
  const pairSel = useStore((s) => s.pairSel);
  const frame = useStore((s) => s.frame);
  const prevRef = useRef<FramePayload | null>(null);
  const sentences = useMemo(() => {
    const out = explain(f, prevRef.current, liveSpecs, selectedId, pairSel, frame);
    if (!prevRef.current || f.time - prevRef.current.time > 0 || f.time < prevRef.current.time) {
      prevRef.current = f;
    }
    return out;
  }, [f, liveSpecs, selectedId, pairSel, frame]);
  return (
    <section>
      <h3>What is happening <em>(generated from measured state)</em></h3>
      {sentences.map((s, i) => <p key={i} className="explain">{s}</p>)}
    </section>
  );
}

function ValidationSection() {
  const validation = useStore((s) => s.validation);
  const validationRunning = useStore((s) => s.validationRunning);
  return (
    <section>
      <h3>Physics validation</h3>
      <button className="btn" disabled={validationRunning} onClick={actions.runValidation}>
        {validationRunning ? 'running…' : '▶ run automated accuracy tests'}
      </button>
      {validation && (
        <div className="validation-list">
          {validation.map((r) => (
            <div key={r.name} className={`val-item ${r.pass ? 'pass' : 'fail'}`}>
              <div className="val-head">{r.pass ? '✓' : '✗'} {r.name}</div>
              <div className="val-measured">{r.measured}</div>
              <div className="val-tol">tolerance: {r.tolerance}</div>
            </div>
          ))}
        </div>
      )}
      <p className="hint">The same suite runs headless via <code>npm test</code> (Vitest). Results shown are measured on this machine, now — not asserted claims.</p>
    </section>
  );
}

export default function RightPanel() {
  const liveTick = useStore((s) => s.liveTick);
  void liveTick;
  const f = workerClient.latest;
  if (!f) return <div className="panel right-panel"><p className="hint">initializing…</p></div>;
  return (
    <div className="panel right-panel">
      <DiagnosticsSection f={f} />
      <PairSection f={f} />
      <MarkSection f={f} />
      <ExplanationSection f={f} />
      <ValidationSection />
    </div>
  );
}
