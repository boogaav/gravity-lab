import { useState } from 'react';
import { useStore, actions } from '../state/store';
import type { BodySpec } from '../physics/types';
import { fmtMass } from '../ui/units';

function NumField({
  label, value, onCommit, step,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="text"
        value={text ?? value.toExponential(4)}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const v = Number(text);
            if (isFinite(v)) onCommit(v);
            setText(null);
          }
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function BodyEditor({ spec }: { spec: BodySpec }) {
  const upd = (patch: Partial<BodySpec>) => actions.updateSpec(spec.id, patch);
  const vec = (key: 'position' | 'velocity', axis: number, v: number) => {
    const arr = [...spec[key]] as [number, number, number];
    arr[axis] = v;
    upd({ [key]: arr });
  };
  return (
    <div className="body-editor">
      <div className="body-editor-head">
        <input
          className="name-input"
          value={spec.name}
          onChange={(e) => upd({ name: e.target.value })}
        />
        <select value={spec.type} onChange={(e) => upd({ type: e.target.value as BodySpec['type'] })}>
          {['star', 'planet', 'moon', 'asteroid', 'spacecraft', 'particle'].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input
          type="color" value={spec.color}
          onChange={(e) => upd({ color: e.target.value })}
          title="Display color (no effect on physics)"
        />
        <button className="btn btn-sm btn-danger" onClick={() => actions.removeBody(spec.id)}>✕</button>
      </div>
      <NumField label="mass (kg)" value={spec.mass} onCommit={(v) => upd({ mass: v })} />
      <NumField label="radius (m)" value={spec.radius} onCommit={(v) => upd({ radius: v })} />
      <div className="vec-row">
        {(['x', 'y', 'z'] as const).map((ax, i) => (
          <NumField key={ax} label={`r${ax} (m)`} value={spec.position[i]} onCommit={(v) => vec('position', i, v)} />
        ))}
      </div>
      <div className="vec-row">
        {(['x', 'y', 'z'] as const).map((ax, i) => (
          <NumField key={ax} label={`v${ax} (m/s)`} value={spec.velocity[i]} onCommit={(v) => vec('velocity', i, v)} />
        ))}
      </div>
      <div className="check-row">
        <label><input type="checkbox" checked={spec.showTrail} onChange={(e) => upd({ showTrail: e.target.checked })} /> trail</label>
        <label><input type="checkbox" checked={spec.showVectors} onChange={(e) => upd({ showVectors: e.target.checked })} /> vectors</label>
        <span className="hint">{fmtMass(spec.mass)}</span>
      </div>
    </div>
  );
}

export default function LeftPanel() {
  const specs = useStore((s) => s.specs);
  const selectedId = useStore((s) => s.selectedId);
  const config = useStore((s) => s.config);
  const presetDescription = useStore((s) => s.presetDescription);
  const started = useStore((s) => s.started);
  const [savedList, setSavedList] = useState<string[]>(() => actions.listSaved());
  const [importErr, setImportErr] = useState('');

  return (
    <div className="panel left-panel">
      <p className="preset-desc">{presetDescription}</p>
      {!started && (
        <p className="hint">Editing mode: click a body, drag it to reposition, drag the white arrow tip to aim its velocity — or type exact values below. Any edit re-initializes the run.</p>
      )}

      <section>
        <h3 data-tip-title="Bodies" data-tip="Every gravitating object in the scenario. Click one to edit its mass, radius, position and velocity — the exact numbers the physics engine integrates.">Bodies <button className="btn btn-sm" onClick={actions.addBody} data-tip-title="Add body" data-tip="Adds a new asteroid you can then position and aim. It immediately takes part in the N-body gravity.">+ add</button></h3>
        <div className="body-list">
          {specs.map((b) => (
            <div key={b.id} className={`body-row ${selectedId === b.id ? 'sel' : ''}`}>
              <button className="body-pick" onClick={() => actions.select(selectedId === b.id ? null : b.id)}>
                <span className="dot" style={{ background: b.color }} />
                {b.name}
              </button>
              {selectedId === b.id && <BodyEditor spec={b} />}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 data-tip-title="Integrator" data-tip="Controls how the physics is computed: step accuracy, what happens on contact, and whether close approaches are softened. These change the numerics, not the laws.">Integrator</h3>
        <label className="ctl">
          <span>accuracy η = {config.eta.toFixed(3)} <em>(substep = η × shortest gravitational timescale; smaller = more accurate)</em></span>
          <input type="range" min={-2.4} max={-0.7} step={0.05} value={Math.log10(config.eta)}
            onChange={(e) => actions.setConfig({ eta: Math.pow(10, Number(e.target.value)) })} />
        </label>
        <label className="ctl">
          <span>collisions</span>
          <select value={config.collisionMode} onChange={(e) => actions.setConfig({ collisionMode: e.target.value as any })}>
            <option value="stop">stop on contact</option>
            <option value="merge">inelastic merge (conserves mass & momentum)</option>
            <option value="elastic">elastic bounce (abstract experiment)</option>
            <option value="none">pass through (point-particle mode)</option>
          </select>
        </label>
        <label className="ctl">
          <span>
            softening ε = {config.softening.toExponential(1)} m{' '}
            {config.softening > 0 && <em className="warn-text">⚠ approximation — not physical gravity</em>}
          </span>
          <input type="range" min={0} max={10} step={0.1}
            value={config.softening > 0 ? Math.log10(config.softening) : 0}
            onChange={(e) => {
              const v = Number(e.target.value);
              actions.setConfig({ softening: v <= 0 ? 0 : Math.pow(10, v) });
            }} />
          <em>0 = physically correct celestial mode (default). Nonzero Plummer softening is only for abstract point-particle experiments.</em>
        </label>
        <label className="ctl">
          <span><input type="checkbox" checked={config.autoSlowMo} onChange={(e) => actions.setConfig({ autoSlowMo: e.target.checked })} /> auto slow-motion near closest approach</span>
        </label>
      </section>

      <section>
        <h3 data-tip-title="Display" data-tip="Purely visual settings. Nothing here touches the simulation — enlarging a planet does not change its gravity or its collision size.">Display <em>(never affects physics)</em></h3>
        <label className="ctl">
          <span>visual radius ×{config.radiusScale.toFixed(0)}
            {config.radiusScale > 1 && <em className="warn-text"> — enlarged; physics & collisions use real radius</em>}
          </span>
          <input type="range" min={0} max={3} step={0.1} value={Math.log10(config.radiusScale)}
            onChange={(e) => actions.setConfig({ radiusScale: Math.pow(10, Number(e.target.value)) })} />
        </label>
        <label className="ctl">
          <span>trail length ({config.trailLength} samples)</span>
          <input type="range" min={10} max={3000} step={10} value={config.trailLength}
            onChange={(e) => actions.setConfig({ trailLength: Number(e.target.value) })} />
        </label>
        <div className="check-grid">
          <label><input type="checkbox" checked={config.showVelocity} onChange={(e) => actions.setConfig({ showVelocity: e.target.checked })} /> velocity vectors</label>
          <label><input type="checkbox" checked={config.showAcceleration} onChange={(e) => actions.setConfig({ showAcceleration: e.target.checked })} /> acceleration vectors</label>
          <label><input type="checkbox" checked={config.showForces} onChange={(e) => actions.setConfig({ showForces: e.target.checked })} /> per-body forces (selected)</label>
          <label><input type="checkbox" checked={config.showCom} onChange={(e) => actions.setConfig({ showCom: e.target.checked })} /> center of mass</label>
          <label><input type="checkbox" checked={config.showGrid} onChange={(e) => actions.setConfig({ showGrid: e.target.checked })} /> grid</label>
          <label><input type="checkbox" checked={config.showLabels} onChange={(e) => actions.setConfig({ showLabels: e.target.checked })} /> labels</label>
        </div>
        <p className="hint">Arrow lengths are log-compressed for readability; true magnitudes are shown in labels and panels.</p>
      </section>

      <section>
        <h3 data-tip-title="Prediction" data-tip="Projects where bodies are heading by integrating a copy of the current state forward. The ghost paths are real physics, never a drawn curve, and never feed back into the live run.">Prediction (ghost trajectories)</h3>
        <label className="ctl">
          <span><input type="checkbox" checked={config.showPrediction}
            onChange={(e) => {
              actions.setConfig({ showPrediction: e.target.checked });
              if (e.target.checked) actions.requestPrediction();
            }} /> show predicted paths</span>
        </label>
        <label className="ctl">
          <span>lookahead {(config.predictionDuration / 86400).toFixed(1)} days</span>
          <input type="range" min={3} max={9} step={0.1} value={Math.log10(config.predictionDuration)}
            onChange={(e) => actions.setConfig({ predictionDuration: Math.pow(10, Number(e.target.value)) })} />
        </label>
        <button className="btn" onClick={actions.requestPrediction}>↻ recompute from current state</button>
        <p className="hint">Ghosts are produced by numerically integrating a CLONE of the current state — never a fitted curve, and never fed back into the live simulation.</p>
      </section>

      <section>
        <h3 data-tip-title="Scenario files" data-tip="Export the exact initial conditions as JSON to keep or share, import someone else's, or save a snapshot in this browser.">Scenario I/O</h3>
        <div className="btn-row">
          <button className="btn" onClick={() => {
            const blob = new Blob([actions.exportJSON()], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'gravity-lab-scenario.json';
            a.click();
            URL.revokeObjectURL(a.href);
          }}>⇩ export JSON</button>
          <label className="btn">
            ⇧ import JSON
            <input type="file" accept=".json" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                actions.importJSON(await file.text());
                setImportErr('');
              } catch (err) {
                setImportErr(String(err));
              }
              e.target.value = '';
            }} />
          </label>
          <button className="btn" onClick={() => { actions.saveScenario(); setSavedList(actions.listSaved()); }}>💾 save</button>
        </div>
        {importErr && <p className="warn-text">{importErr}</p>}
        {savedList.length > 0 && (
          <select className="ctl" defaultValue="" onChange={(e) => { if (e.target.value) actions.loadSaved(e.target.value); e.target.value = ''; }}>
            <option value="" disabled>load saved scenario…</option>
            {savedList.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
      </section>
    </div>
  );
}
