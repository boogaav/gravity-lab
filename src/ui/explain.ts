import type { FramePayload } from '../worker/protocol';
import type { BodySpec } from '../physics/types';
import type { FrameSel } from '../physics/frames';
import { frameLabel, computeFrameTransform, toFrameVel } from '../physics/frames';
import { pairOrbit } from '../physics/orbital';
import { fmtAngle, fmtDistance, fmtSpeed, fmtTime } from './units';

/**
 * Plain-language narration GENERATED FROM THE MEASURED STATE — no scripted
 * story. Each sentence is derived from live quantities in the frame payload.
 */
export function explain(
  frame: FramePayload,
  prev: FramePayload | null,
  specs: BodySpec[],
  selectedId: string | null,
  pair: [string, string],
  frameSel: FrameSel,
): string[] {
  const out: string[] = [];
  const idx = (id: string) => frame.ids.indexOf(id);
  const name = (id: string) => specs.find((b) => b.id === id)?.name ?? id;

  // Selected-body energetics: is PE converting to KE right now?
  if (selectedId) {
    const i = idx(selectedId);
    if (i >= 0) {
      const v = Math.hypot(frame.vel[3 * i], frame.vel[3 * i + 1], frame.vel[3 * i + 2]);
      const a = Math.hypot(frame.acc[3 * i], frame.acc[3 * i + 1], frame.acc[3 * i + 2]);
      // power = m a·v tells the direction of the K⇄U exchange
      const p =
        frame.masses[i] *
        (frame.acc[3 * i] * frame.vel[3 * i] +
          frame.acc[3 * i + 1] * frame.vel[3 * i + 1] +
          frame.acc[3 * i + 2] * frame.vel[3 * i + 2]);
      const trend =
        p > 1e-12 * frame.masses[i] * a * v
          ? 'speeding up: gravitational potential energy is converting into kinetic energy as it falls inward'
          : p < -1e-12 * frame.masses[i] * a * v
            ? 'slowing down: kinetic energy is converting back into gravitational potential energy as it climbs outward'
            : 'moving at a momentarily steady speed (its velocity is perpendicular to the net gravitational pull)';
      out.push(
        `${name(selectedId)} is ${trend}. Speed ${fmtSpeed(v)}, net gravitational acceleration ${a.toExponential(3)} m/s².`,
      );
    }
  }

  // Featured-pair orbit classification
  const ia = idx(pair[0]);
  const ib = idx(pair[1]);
  if (ia >= 0 && ib >= 0) {
    const P = (k: number) => [frame.pos[3 * k], frame.pos[3 * k + 1], frame.pos[3 * k + 2]] as [number, number, number];
    const V = (k: number) => [frame.vel[3 * k], frame.vel[3 * k + 1], frame.vel[3 * k + 2]] as [number, number, number];
    const orb = pairOrbit(frame.masses[ia], P(ia), V(ia), frame.masses[ib], P(ib), V(ib));
    if (orb.classification === 'bound') {
      out.push(
        `${name(pair[0])} and ${name(pair[1])} are gravitationally bound (e = ${orb.eccentricity.toFixed(3)}): their relative speed ${fmtSpeed(orb.vRel)} is below the local escape velocity ${fmtSpeed(orb.escapeVelocityHere)}.`,
      );
    } else {
      out.push(
        `${name(pair[0])} and ${name(pair[1])} are on an unbound ${orb.classification} encounter (e = ${orb.eccentricity.toFixed(3)}): relative speed ${fmtSpeed(orb.vRel)} exceeds the local escape velocity ${fmtSpeed(orb.escapeVelocityHere)}. The encounter will bend both paths by ${fmtAngle(orb.deflectionAngle)} in total, then they separate forever.`,
      );
    }
    // Gravity-assist framing when viewing a planet-centered frame
    if (frameSel.kind === 'body') {
      const craftId = pair[0] === frameSel.id ? pair[1] : pair[1] === frameSel.id ? pair[0] : null;
      if (craftId && orb.classification === 'hyperbolic') {
        out.push(
          `In the ${frameLabel(frameSel, specs)}, ${name(craftId)}'s incoming and outgoing speeds far away are both ≈ ${fmtSpeed(orb.vInfinity)} — gravity only turns the direction here. Because ${name(frameSel.id)} itself moves, that turn changes ${name(craftId)}'s velocity — and therefore its energy — in the inertial frame. The exchanged momentum is carried by ${name(frameSel.id)}: its recoil is equal and opposite, just spread over a mass ${(frame.masses[idx(frameSel.id)] / frame.masses[idx(craftId)]).toExponential(1)}× larger.`,
        );
      }
    }
  }

  // System-level conservation statement from measured drift
  out.push(
    `Total system energy is conserved to ${(Math.abs(frame.diag.energyDrift) * 100).toExponential(1)}% and angular momentum to ${(Math.abs(frame.diag.angMomDrift) * 100).toExponential(1)}% since t = 0 (numerical error, not physics). Simulated time: ${fmtTime(frame.time)}; current adaptive substep ${fmtTime(frame.lastSubstep)}.`,
  );

  // Center of mass
  const comSpeed = Math.hypot(...frame.diag.comVelocity);
  out.push(
    comSpeed < 1e-6
      ? `The center of mass sits still at the origin (total momentum ≈ 0): every body orbits it, not any single "anchor" body.`
      : `The center of mass drifts at a constant ${fmtSpeed(comSpeed)} — internal gravitational forces cancel pairwise and cannot accelerate the system as a whole.`,
  );

  if (prev && frame.time > prev.time) {
    const dK = frame.diag.kinetic - prev.diag.kinetic;
    const dU = frame.diag.potential - prev.diag.potential;
    if (Math.abs(dK) > 1e-9 * Math.abs(frame.diag.kinetic)) {
      out.push(
        `Over the last ${fmtTime(frame.time - prev.time)}: kinetic energy ${dK > 0 ? 'rose' : 'fell'} by ${Math.abs(dK).toExponential(2)} J while potential energy ${dU > 0 ? 'rose' : 'fell'} by ${Math.abs(dU).toExponential(2)} J — the two trade places; their sum stays fixed.`,
      );
    }
  }
  return out;
}

/** Speed of one body in an arbitrary display frame — used by the assist comparison table. */
export function speedInFrame(
  frame: FramePayload,
  bodyId: string,
  frameSel: FrameSel,
): number | null {
  const i = frame.ids.indexOf(bodyId);
  if (i < 0) return null;
  const t = computeFrameTransform(
    frameSel, frame.ids, frame.pos, frame.vel,
    new Float64Array(frame.masses), frame.diag.comPosition, frame.diag.comVelocity,
  );
  const v = toFrameVel(
    [frame.pos[3 * i], frame.pos[3 * i + 1], frame.pos[3 * i + 2]],
    [frame.vel[3 * i], frame.vel[3 * i + 1], frame.vel[3 * i + 2]],
    t,
  );
  return Math.hypot(...v);
}
