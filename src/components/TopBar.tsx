import { useStore, actions } from '../state/store';
import { workerClient } from '../state/workerClient';
import { PRESETS } from '../physics/presets';
import { frameLabel, type FrameSel } from '../physics/frames';
import { fmtTime } from '../ui/units';

export default function TopBar() {
  const running = useStore((s) => s.running);
  const presetId = useStore((s) => s.presetId);
  const presetName = useStore((s) => s.presetName);
  const variationLabel = useStore((s) => s.variationLabel);
  const config = useStore((s) => s.config);
  const frame = useStore((s) => s.frame);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const liveTick = useStore((s) => s.liveTick);
  const driftWarning = useStore((s) => s.driftWarning);
  void liveTick;
  const f = workerClient.latest;
  const preset = PRESETS.find((p) => p.id === presetId);

  const frameOptions: { key: string; sel: FrameSel }[] = [
    { key: 'inertial', sel: { kind: 'inertial' } },
    { key: 'com', sel: { kind: 'com' } },
    ...liveSpecs.map((b) => ({ key: `body:${b.id}`, sel: { kind: 'body', id: b.id } as FrameSel })),
  ];
  if (liveSpecs.length >= 2) {
    const [a, b] = useStore.getState().pairSel;
    if (a && b && liveSpecs.some((x) => x.id === a) && liveSpecs.some((x) => x.id === b)) {
      frameOptions.push({ key: `rot:${a}:${b}`, sel: { kind: 'rotating', a, b } });
    }
  }
  const frameKey =
    frame.kind === 'inertial' ? 'inertial'
      : frame.kind === 'com' ? 'com'
        : frame.kind === 'body' ? `body:${frame.id}`
          : `rot:${frame.a}:${frame.b}`;

  const slowedDown = f && running && f.effTimeScale < config.timeScale * 0.9;

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-name">GRAVITY LAB</span>
        <span className="brand-sub">Newtonian N-body · Yoshida-4 symplectic · double precision</span>
      </div>
      <select
        className="preset-select"
        value={presetId}
        onChange={(e) => actions.loadPreset(e.target.value)}
      >
        {!PRESETS.some((p) => p.id === presetId) && <option value={presetId}>{presetName}</option>}
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <div className="transport">
        <button className="btn" onClick={() => (running ? actions.pause() : actions.play())}>
          {running ? '⏸ Pause' : '▶ Play'}
        </button>
        <button className="btn" onClick={actions.singleStep} title="Advance exactly one adaptive physics substep">⏭ Step</button>
        <button className="btn" onClick={actions.reset} title="Restore the exact initial conditions">↺ Reset</button>
        {preset?.variation && (
          <button className="btn btn-var" onClick={actions.applyVariation} title={preset.variation.label}>
            ⑂ Vary
          </button>
        )}
      </div>
      <label className="ctl">
        <span>speed ×{config.timeScale.toExponential(1)}</span>
        <input
          type="range" min={0} max={9} step={0.05}
          value={Math.log10(config.timeScale)}
          onChange={(e) => actions.setConfig({ timeScale: Math.pow(10, Number(e.target.value)) })}
        />
      </label>
      <select
        className="frame-select"
        value={frameKey}
        onChange={(e) => {
          const opt = frameOptions.find((o) => o.key === e.target.value);
          if (opt) actions.setFrame(opt.sel);
        }}
        title="Reference frame (presentation only — physics state is untouched)"
      >
        {frameOptions.map((o) => (
          <option key={o.key} value={o.key}>{frameLabel(o.sel, liveSpecs)}</option>
        ))}
      </select>
      <div className="clock">
        t = {f ? fmtTime(f.time) : '—'}
        {variationLabel && <span className="chip chip-var">{variationLabel}</span>}
        {slowedDown && <span className="chip chip-slow">auto slow-mo: close encounter</span>}
        {f?.lagging && <span className="chip chip-warn">integrator saturated — lower speed</span>}
        {f?.stopped && <span className="chip chip-stop">stopped: contact</span>}
        {driftWarning && (
          <span
            className="chip chip-warn"
            title="Energy drift exceeded 0.01%. Reduce the accuracy factor η (left panel) and Reset."
          >
            ⚠ drift &gt; 0.01% — lower η
          </span>
        )}
      </div>
    </div>
  );
}
