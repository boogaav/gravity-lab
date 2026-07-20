import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore, actions } from '../state/store';
import { workerClient } from '../state/workerClient';
import { computeFrameTransform, toFramePos, type FrameTransform } from '../physics/frames';
import { pairForce } from '../physics/forces';
import { pairOrbit } from '../physics/orbital';
import { fmtSpeed } from '../ui/units';
import type { Vec3 } from '../physics/types';

/** Physics XY plane is drawn horizontal: (x,y,z)_phys → (x, z, -y)_three. */
const physToScene = (p: Vec3, s: number): [number, number, number] => [p[0] / s, p[2] / s, -p[1] / s];
const sceneToPhys = (v: THREE.Vector3, s: number): Vec3 => [v.x * s, -v.z * s, v.y * s];

function currentTransform(): { t: FrameTransform | null } {
  const f = workerClient.latest;
  const { frame } = useStore.getState();
  if (!f) return { t: null };
  return {
    t: computeFrameTransform(
      frame, f.ids, f.pos, f.vel,
      new Float64Array(f.masses), f.diag.comPosition, f.diag.comVelocity,
    ),
  };
}

/** Arrow with log-compressed display length; the true magnitude is shown in panels/labels. */
function makeArrow(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), mat);
  shaft.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 8), mat);
  head.position.y = 1.05;
  g.add(shaft, head);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
function orientArrow(g: THREE.Group, origin: THREE.Vector3, dir: THREE.Vector3, len: number) {
  g.position.copy(origin);
  g.visible = len > 1e-4 && dir.lengthSq() > 0;
  if (!g.visible) return;
  g.scale.set(1, len, 1);
  g.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
}

/** log-compressed arrow length in scene units */
const arrowLen = (mag: number, ref: number) => (mag <= 0 ? 0 : 0.9 * Math.log10(1 + (4 * mag) / ref));

// ---------------------------------------------------------------- bodies + vectors

function BodiesLayer() {
  const liveSpecs = useStore((s) => s.liveSpecs);
  const sceneScale = useStore((s) => s.sceneScale);
  const velScale = useStore((s) => s.velScale);
  const config = useStore((s) => s.config);
  const selectedId = useStore((s) => s.selectedId);
  const started = useStore((s) => s.started);
  const groupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const arrowsRef = useRef<Map<string, { vel: THREE.Group; acc: THREE.Group; force: THREE.Group[] }>>(new Map());
  const rootRef = useRef<THREE.Group>(null);
  const [labelData, setLabelData] = useState<Map<string, string>>(new Map());
  const labelTimer = useRef(0);
  const dragState = useRef<{ id: string; kind: 'pos' | 'vel' } | null>(null);
  const { camera, gl } = useThree();

  // accRef: typical acceleration scale for arrow normalization (from live frame)
  useFrame((_, dt) => {
    const f = workerClient.latest;
    if (!f) return;
    const { t } = currentTransform();
    if (!t) return;
    let refAcc = 0;
    for (let i = 0; i < f.n; i++) refAcc = Math.max(refAcc, Math.hypot(f.acc[3 * i], f.acc[3 * i + 1], f.acc[3 * i + 2]));
    const labels = new Map<string, string>();
    for (let i = 0; i < f.n; i++) {
      const id = f.ids[i];
      const g = groupRefs.current.get(id);
      if (!g) continue;
      const pw: Vec3 = [f.pos[3 * i], f.pos[3 * i + 1], f.pos[3 * i + 2]];
      const vw: Vec3 = [f.vel[3 * i], f.vel[3 * i + 1], f.vel[3 * i + 2]];
      const fp = toFramePos(pw, t);
      const [x, y, z] = physToScene(fp, sceneScale);
      g.position.set(x, y, z);
      const spec = liveSpecs.find((b) => b.id === id);
      const arrows = arrowsRef.current.get(id);
      if (arrows && spec) {
        const show = spec.showVectors;
        const vRel = [vw[0] - t.originVel[0], vw[1] - t.originVel[1], vw[2] - t.originVel[2]] as Vec3;
        const vMag = Math.hypot(...vRel);
        const vDir = new THREE.Vector3(...physToScene(vRel, Math.max(vMag, 1e-30) /* unit */));
        orientArrow(arrows.vel, g.position, vDir, show && config.showVelocity ? arrowLen(vMag, velScale) : 0);
        const aM: Vec3 = [f.acc[3 * i], f.acc[3 * i + 1], f.acc[3 * i + 2]];
        const aMag = Math.hypot(...aM);
        const aDir = new THREE.Vector3(...physToScene(aM, Math.max(aMag, 1e-30)));
        orientArrow(arrows.acc, g.position, aDir, show && config.showAcceleration ? arrowLen(aMag, Math.max(refAcc, 1e-30)) : 0);
        // per-pair forces on the SELECTED body only
        arrows.force.forEach((fa) => (fa.visible = false));
        if (config.showForces && id === selectedId) {
          let k = 0;
          for (let j = 0; j < f.n && k < arrows.force.length; j++) {
            if (j === i) continue;
            const F = pairForce(f.pos, new Float64Array(f.masses), i, j, 0);
            const Fmag = Math.hypot(...F);
            const Fdir = new THREE.Vector3(...physToScene(F as Vec3, Math.max(Fmag, 1e-30)));
            const refF = f.masses[i] * Math.max(refAcc, 1e-30);
            orientArrow(arrows.force[k], g.position, Fdir, arrowLen(Fmag, refF));
            k++;
          }
        }
      }
      if (config.showLabels && spec) {
        labels.set(id, `${spec.name}  ·  ${fmtSpeed(Math.hypot(...vw))}`);
      }
    }
    labelTimer.current += dt;
    if (labelTimer.current > 0.25) {
      labelTimer.current = 0;
      setLabelData(labels);
    }
  });

  // pointer-drag editing of initial conditions (paused, t = 0 only)
  const dragPlane = useMemo(() => new THREE.Plane(), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const beginDrag = (id: string, kind: 'pos' | 'vel', e: ThreeEvent<PointerEvent>) => {
    if (started) return;
    e.stopPropagation();
    dragState.current = { id, kind };
    const spec = useStore.getState().specs.find((b) => b.id === id)!;
    // drag in the horizontal plane through the body (physics XY plane)
    dragPlane.set(new THREE.Vector3(0, 1, 0), -spec.position[2] / sceneScale);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    gl.domElement.style.cursor = 'grabbing';
  };
  useEffect(() => {
    const el = gl.domElement;
    const move = (ev: PointerEvent) => {
      const d = dragState.current;
      if (!d) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, hit)) return;
      const phys = sceneToPhys(hit, sceneScale);
      const st = useStore.getState();
      const spec = st.specs.find((b) => b.id === d.id);
      if (!spec) return;
      if (d.kind === 'pos') {
        actions.updateSpec(d.id, { position: [phys[0], phys[1], spec.position[2]] });
      } else {
        const vs = st.velScale;
        const dv: Vec3 = [
          (phys[0] - spec.position[0]) / st.sceneScale * vs,
          (phys[1] - spec.position[1]) / st.sceneScale * vs,
          spec.velocity[2],
        ];
        actions.updateSpec(d.id, { velocity: [dv[0], dv[1], spec.velocity[2]] });
      }
    };
    const up = () => {
      dragState.current = null;
      el.style.cursor = 'default';
    };
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [camera, gl, sceneScale, raycaster, dragPlane]);

  return (
    <group ref={rootRef}>
      {liveSpecs.map((b) => {
        const visR = Math.max((b.radius * config.radiusScale) / sceneScale, 0.09);
        return (
          <group key={b.id}>
            <group
              ref={(g) => {
                if (g) groupRefs.current.set(b.id, g);
                else groupRefs.current.delete(b.id);
              }}
            >
              <mesh
                onClick={(e) => {
                  e.stopPropagation();
                  actions.select(b.id);
                }}
                onPointerDown={(e) => beginDrag(b.id, 'pos', e)}
              >
                <sphereGeometry args={[visR, 24, 24]} />
                <meshStandardMaterial
                  color={b.color}
                  emissive={b.type === 'star' ? b.color : '#000000'}
                  emissiveIntensity={b.type === 'star' ? 1.2 : 0}
                  roughness={0.6}
                />
              </mesh>
              {selectedId === b.id && (
                <mesh>
                  <ringGeometry args={[visR * 1.6, visR * 1.75, 48]} />
                  <meshBasicMaterial color="#ffffff" transparent opacity={0.7} side={THREE.DoubleSide} />
                </mesh>
              )}
              {config.showLabels && labelData.has(b.id) && (
                <Html distanceFactor={26} position={[0, visR + 0.25, 0]} style={{ pointerEvents: 'none' }}>
                  <div className="body-label">{labelData.get(b.id)}</div>
                </Html>
              )}
              {/* velocity IC handle: draggable arrow tip when editing */}
              {!started && selectedId === b.id && <VelocityHandle spec={b} beginDrag={beginDrag} />}
            </group>
            <VectorGroup
              id={b.id}
              color={b.color}
              register={(entry) => {
                if (entry) arrowsRef.current.set(b.id, entry);
                else arrowsRef.current.delete(b.id);
              }}
            />
          </group>
        );
      })}
    </group>
  );
}

function VelocityHandle({
  spec,
  beginDrag,
}: {
  spec: { id: string; velocity: Vec3; color: string };
  beginDrag: (id: string, kind: 'pos' | 'vel', e: ThreeEvent<PointerEvent>) => void;
}) {
  const velScale = useStore((s) => s.velScale);
  const v = spec.velocity;
  const tip = physToScene([v[0] / velScale, v[1] / velScale, v[2] / velScale], 1);
  return (
    <group>
      <Line points={[[0, 0, 0], tip]} color="#ffffff" lineWidth={1.5} dashed dashSize={0.12} gapSize={0.08} />
      <mesh position={tip} onPointerDown={(e) => beginDrag(spec.id, 'vel', e)}>
        <sphereGeometry args={[0.14, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <Html position={tip} distanceFactor={26} style={{ pointerEvents: 'none' }}>
        <div className="body-label">v = {fmtSpeed(Math.hypot(...v))} (drag tip to aim)</div>
      </Html>
    </group>
  );
}

function VectorGroup({
  id,
  color,
  register,
}: {
  id: string;
  color: string;
  register: (e: { vel: THREE.Group; acc: THREE.Group; force: THREE.Group[] } | null) => void;
}) {
  const { scene } = useThree();
  useEffect(() => {
    const vel = makeArrow('#63d0ff');
    const acc = makeArrow('#ffb763');
    const force: THREE.Group[] = Array.from({ length: 9 }, () => makeArrow('#ff6d9a'));
    const all = [vel, acc, ...force];
    all.forEach((a) => {
      a.visible = false;
      scene.add(a);
    });
    register({ vel, acc, force });
    return () => {
      all.forEach((a) => scene.remove(a));
      register(null);
    };
  }, [scene, id, color]);
  return null;
}

// ---------------------------------------------------------------- trails

function Trails() {
  const history = useStore((s) => s.history);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const frame = useStore((s) => s.frame);
  const sceneScale = useStore((s) => s.sceneScale);
  const trailLength = useStore((s) => s.config.trailLength);

  const trails = useMemo(() => {
    const out: { id: string; color: string; points: [number, number, number][] }[] = [];
    const entries = history.slice(-trailLength);
    if (entries.length < 2) return out;
    for (const spec of liveSpecs) {
      if (!spec.showTrail) continue;
      const pts: [number, number, number][] = [];
      for (const e of entries) {
        const b = e.specs.find((x) => x.id === spec.id);
        if (!b) continue;
        // each trail point transformed with the frame evaluated AT ITS OWN TIME
        const n = e.specs.length;
        const pos = new Float64Array(3 * n);
        const vel = new Float64Array(3 * n);
        const mass = new Float64Array(n);
        e.specs.forEach((s2, i) => {
          mass[i] = s2.mass;
          for (let q = 0; q < 3; q++) {
            pos[3 * i + q] = s2.position[q];
            vel[3 * i + q] = s2.velocity[q];
          }
        });
        let M = 0;
        const cp: Vec3 = [0, 0, 0];
        const cv: Vec3 = [0, 0, 0];
        e.specs.forEach((s2) => {
          M += s2.mass;
          for (let q = 0; q < 3; q++) {
            cp[q] += s2.mass * s2.position[q];
            cv[q] += s2.mass * s2.velocity[q];
          }
        });
        if (M > 0) for (let q = 0; q < 3; q++) { cp[q] /= M; cv[q] /= M; }
        const t = computeFrameTransform(frame, e.specs.map((x) => x.id), pos, vel, mass, cp, cv);
        pts.push(physToScene(toFramePos(b.position, t), sceneScale));
      }
      if (pts.length >= 2) out.push({ id: spec.id, color: spec.color, points: pts });
    }
    return out;
  }, [history, liveSpecs, frame, sceneScale, trailLength]);

  return (
    <>
      {trails.map((t) => (
        <Line key={t.id} points={t.points} color={t.color} lineWidth={1.2} transparent opacity={0.55} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- overlays

function ComMarker() {
  const show = useStore((s) => s.config.showCom);
  const sceneScale = useStore((s) => s.sceneScale);
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const f = workerClient.latest;
    if (!f || !ref.current) return;
    const { t } = currentTransform();
    if (!t) return;
    const p = toFramePos(f.diag.comPosition, t);
    ref.current.position.set(...physToScene(p, sceneScale));
  });
  if (!show) return null;
  return (
    <group ref={ref}>
      <mesh>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <Html distanceFactor={26} position={[0, 0.2, 0]} style={{ pointerEvents: 'none' }}>
        <div className="body-label com-label">⊕ center of mass</div>
      </Html>
    </group>
  );
}

function ClosestApproachMarker() {
  const enc = useStore((s) => s.encounterLive);
  const frame = useStore((s) => s.frame);
  const sceneScale = useStore((s) => s.sceneScale);
  const liveTick = useStore((s) => s.liveTick);
  void liveTick;
  if (!enc || !isFinite(enc.minSep)) return null;
  const { t } = currentTransform();
  if (!t) return null;
  void frame;
  const a = physToScene(toFramePos(enc.posA, t), sceneScale);
  const b = physToScene(toFramePos(enc.posB, t), sceneScale);
  return (
    <group>
      <Line points={[a, b]} color="#ffe066" lineWidth={1} dashed dashSize={0.1} gapSize={0.08} />
      <mesh position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]}>
        <octahedronGeometry args={[0.09]} />
        <meshBasicMaterial color="#ffe066" />
      </mesh>
    </group>
  );
}

/** Incoming/outgoing asymptotes of the featured pair's osculating hyperbola, drawn about the pair COM. */
function Asymptotes() {
  const pair = useStore((s) => s.pairSel);
  const liveTick = useStore((s) => s.liveTick);
  const sceneScale = useStore((s) => s.sceneScale);
  void liveTick;
  const f = workerClient.latest;
  if (!f) return null;
  const ia = f.ids.indexOf(pair[0]);
  const ib = f.ids.indexOf(pair[1]);
  if (ia < 0 || ib < 0) return null;
  const P = (k: number): Vec3 => [f.pos[3 * k], f.pos[3 * k + 1], f.pos[3 * k + 2]];
  const V = (k: number): Vec3 => [f.vel[3 * k], f.vel[3 * k + 1], f.vel[3 * k + 2]];
  const orb = pairOrbit(f.masses[ia], P(ia), V(ia), f.masses[ib], P(ib), V(ib));
  if (orb.classification !== 'hyperbolic') return null;
  // eccentricity vector: e = (v × h)/mu − r̂
  const [rx, ry, rz] = orb.relPosition;
  const [vx, vy, vz] = orb.relVelocity;
  const h: Vec3 = [ry * vz - rz * vy, rz * vx - rx * vz, rx * vy - ry * vx];
  const vxh: Vec3 = [vy * h[2] - vz * h[1], vz * h[0] - vx * h[2], vx * h[1] - vy * h[0]];
  const eVec: Vec3 = [vxh[0] / orb.mu - rx / orb.r, vxh[1] / orb.mu - ry / orb.r, vxh[2] / orb.mu - rz / orb.r];
  const eMag = Math.hypot(...eVec);
  if (eMag <= 1) return null;
  const ePer = eVec.map((q) => q / eMag) as Vec3; // toward periapsis
  const hn = orb.orbitNormal;
  const perp: Vec3 = [
    hn[1] * ePer[2] - hn[2] * ePer[1],
    hn[2] * ePer[0] - hn[0] * ePer[2],
    hn[0] * ePer[1] - hn[1] * ePer[0],
  ];
  const thetaInf = Math.acos(-1 / eMag);
  const { t } = currentTransform();
  if (!t) return null;
  const mA = f.masses[ia], mB = f.masses[ib], M = mA + mB;
  const com: Vec3 = [
    (mA * f.pos[3 * ia] + mB * f.pos[3 * ib]) / M,
    (mA * f.pos[3 * ia + 1] + mB * f.pos[3 * ib + 1]) / M,
    (mA * f.pos[3 * ia + 2] + mB * f.pos[3 * ib + 2]) / M,
  ];
  const c = physToScene(toFramePos(com, t), sceneScale);
  const L = 14;
  const mkDir = (sign: 1 | -1): [number, number, number] => {
    const d: Vec3 = [
      Math.cos(sign * thetaInf) * ePer[0] + Math.sin(sign * thetaInf) * perp[0],
      Math.cos(sign * thetaInf) * ePer[1] + Math.sin(sign * thetaInf) * perp[1],
      Math.cos(sign * thetaInf) * ePer[2] + Math.sin(sign * thetaInf) * perp[2],
    ];
    const sd = physToScene(d, 1);
    return [sd[0] * L, sd[1] * L, sd[2] * L];
  };
  const d1 = mkDir(1);
  const d2 = mkDir(-1);
  return (
    <group position={c}>
      <Line points={[[0, 0, 0], d1]} color="#8899bb" lineWidth={0.8} dashed dashSize={0.25} gapSize={0.2} />
      <Line points={[[0, 0, 0], d2]} color="#8899bb" lineWidth={0.8} dashed dashSize={0.25} gapSize={0.2} />
    </group>
  );
}

function PredictionGhosts() {
  const prediction = useStore((s) => s.prediction);
  const show = useStore((s) => s.config.showPrediction);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const frame = useStore((s) => s.frame);
  const sceneScale = useStore((s) => s.sceneScale);
  const lines = useMemo(() => {
    if (!prediction || !show) return [];
    const n = prediction.ids.length;
    const S = prediction.times.length;
    // Ghosts are drawn in the INERTIAL frame only (frame transforms need full
    // state at each predicted time; body-centered ghost view uses relative calc).
    return prediction.ids.map((id, i) => {
      const color = liveSpecs.find((b) => b.id === id)?.color ?? '#888';
      const pts: [number, number, number][] = [];
      let anchorIdx = -1;
      if (frame.kind === 'body') anchorIdx = prediction.ids.indexOf(frame.id);
      for (let s = 0; s < S; s++) {
        const base = (s * n + i) * 3;
        let p: Vec3 = [prediction.tracks[base], prediction.tracks[base + 1], prediction.tracks[base + 2]];
        if (anchorIdx >= 0) {
          const ab = (s * n + anchorIdx) * 3;
          p = [p[0] - prediction.tracks[ab], p[1] - prediction.tracks[ab + 1], p[2] - prediction.tracks[ab + 2]];
        }
        pts.push(physToScene(p, sceneScale));
      }
      return { id, color, pts };
    });
  }, [prediction, show, liveSpecs, frame, sceneScale]);
  return (
    <>
      {lines.map((l) => (
        <Line key={`ghost-${l.id}`} points={l.pts} color={l.color} lineWidth={1} transparent opacity={0.28} dashed dashSize={0.15} gapSize={0.12} />
      ))}
    </>
  );
}

function CameraRig() {
  const sceneEpoch = useStore((s) => s.sceneEpoch);
  const { camera } = useThree();
  const controls = useRef<any>(null);
  useEffect(() => {
    camera.position.set(0, 26, 30);
    camera.lookAt(0, 0, 0);
    controls.current?.target?.set(0, 0, 0);
    controls.current?.update?.();
  }, [sceneEpoch, camera]);
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} />;
}

export default function Scene() {
  const showGrid = useStore((s) => s.config.showGrid);
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, logarithmicDepthBuffer: true }}
      camera={{ fov: 45, near: 0.01, far: 5000 }}
      style={{ background: '#04060c' }}
      onPointerMissed={() => actions.select(null)}
    >
      <color attach="background" args={['#04060c']} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 40, 0]} intensity={1.2} decay={0} />
      <Stars />
      {showGrid && (
        <gridHelper args={[80, 40, '#1b2740', '#0e1524']} position={[0, -0.001, 0]} />
      )}
      <BodiesLayer />
      <Trails />
      <ComMarker />
      <ClosestApproachMarker />
      <Asymptotes />
      <PredictionGhosts />
      <CameraRig />
    </Canvas>
  );
}

/** Static, subtle starfield (decorative only — infinitely far, no physics). */
function Stars() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const N = 1200;
    const arr = new Float32Array(N * 3);
    let seed = 42;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < N; i++) {
      const r = 900;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      arr[3 * i] = r * Math.sin(ph) * Math.cos(th);
      arr[3 * i + 1] = r * Math.cos(ph);
      arr[3 * i + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial size={1.4} sizeAttenuation={false} color="#3a4763" />
    </points>
  );
}
