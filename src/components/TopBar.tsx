import { useEffect, useState } from 'react';
import { useStore, actions } from '../state/store';
import { workerClient } from '../state/workerClient';
import { PRESETS } from '../physics/presets';
import { frameLabel, type FrameSel } from '../physics/frames';
import { fmtTime } from '../ui/units';
import { shareApp, startRecording, stopRecording, takeScreenshot } from '../ui/capture';
import AccountMenu from './AccountMenu';
import SpotifyControls from './SpotifyControls';
import ToolbarMenu, { MenuLabel } from './ToolbarMenu';
import { ThemeToggle, UniverseOptions, UniverseSwatch } from './ThemeControls';

/** Screenshot / record / share, grouped under one Capture button. */
function CaptureMenu() {
  const [recSec, setRecSec] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const recording = recSec !== null;
  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 2500);
  };

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setRecSec((s) => (s === null ? null : s + 1)), 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  return (
    <>
      <ToolbarMenu
        label={recording ? <span className="rec-live">⏺ {recSec}s</span> : '📷 Capture'}
        tipTitle="Capture"
        tip="Save a screenshot, record the simulation to a video, or share a link to what you are looking at."
        width={230}
      >
        <button
          className="menu-item"
          onClick={async () => flash((await takeScreenshot()) ? 'screenshot saved' : 'screenshot failed')}
          data-tip-title="Screenshot"
          data-tip="Saves a PNG of the current view to your downloads."
        >
          📷 <span>Screenshot</span>
        </button>
        <button
          className={`menu-item ${recording ? 'danger' : ''}`}
          onClick={() => {
            if (recording) {
              stopRecording();
              setRecSec(null);
              flash('video saved');
            } else if (startRecording()) {
              setRecSec(0);
            } else {
              flash('recording not supported here');
            }
          }}
          data-tip-title="Record"
          data-tip={recording ? 'Stop recording and save the video file.' : 'Records the simulation to a video file.'}
        >
          {recording ? '⏹' : '⏺'} <span>{recording ? `Stop recording (${recSec}s)` : 'Record video'}</span>
        </button>
        <button
          className="menu-item"
          onClick={async () => {
            const r = await shareApp();
            if (r === 'copied') flash('link copied ✓');
            else if (r === 'failed') flash('sharing unavailable');
          }}
          data-tip-title="Share"
          data-tip="Opens your device share sheet, or copies the link if sharing is unavailable."
        >
          ↗ <span>Share link</span>
        </button>
      </ToolbarMenu>
      {toast && <span className="chip chip-var">{toast}</span>}
    </>
  );
}

/** Universe scheme + light/dark, grouped under one Look button. */
function LookMenu() {
  return (
    <ToolbarMenu
      label={<><UniverseSwatch />Look</>}
      tipTitle="Look"
      tip="How the app and space itself are drawn: pick a universe colour scheme, and switch the interface between dark and light."
      width={330}
    >
      <MenuLabel>Interface</MenuLabel>
      <ThemeToggle />
      <MenuLabel>Universe</MenuLabel>
      <UniverseOptions />
    </ToolbarMenu>
  );
}

function StatusChips() {
  const running = useStore((s) => s.running);
  const config = useStore((s) => s.config);
  const driftWarning = useStore((s) => s.driftWarning);
  const liveTick = useStore((s) => s.liveTick);
  void liveTick;
  const f = workerClient.latest;
  const slowedDown = f && running && f.effTimeScale < config.timeScale * 0.9;
  return (
    <>
      {slowedDown && <span className="chip chip-slow">auto slow-mo</span>}
      {f?.lagging && <span className="chip chip-warn">integrator saturated</span>}
      {f?.stopped && <span className="chip chip-stop">stopped: contact</span>}
      {driftWarning && (
        <span className="chip chip-warn" title="Energy drift above 0.01% — lower η in the lab and reset.">
          ⚠ drift
        </span>
      )}
    </>
  );
}

function SandboxBar() {
  const running = useStore((s) => s.running);
  const config = useStore((s) => s.config);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const liveTick = useStore((s) => s.liveTick);
  void liveTick;
  const f = workerClient.latest;

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-name">GRAVITY LAB</span>
        <span className="brand-sub">real N-body gravity · nothing scripted</span>
      </div>

      <div className="transport">
        <button
          className="btn"
          onClick={() => (running ? actions.pause() : actions.play())}
          data-tip-title="Start / Pause"
          data-tip="Runs or freezes the simulation. Time keeps its exact state when paused — nothing is reset."
        >
          {running ? '⏸ Pause' : '▶ Start'}
        </button>
        <button
          className="btn"
          onClick={actions.startNewWorld}
          data-tip-title="Start New"
          data-tip="Opens a fresh, empty world in a new browser tab — whatever you have going here stays exactly as it is."
        >
          ＋ New
        </button>
        <button
          className="btn btn-primary"
          onClick={() => actions.setPublishOpen(true)}
          data-tip-title="Publish"
          data-tip="Gives the arrangement on screen its own permanent link and adds it to the leaderboard. Its physics are measured first so it can be ranked."
        >
          🌍 Publish
        </button>
        <button
          className="btn"
          onClick={() => actions.navigate({ kind: 'leaderboard' })}
          data-tip-title="Worlds"
          data-tip="Browse every published world, sortable by likes, size, chaos or how much carnage they produce."
        >
          ☰ Worlds
        </button>
      </div>

      <div className="tools">
        <CaptureMenu />
        <SpotifyControls />
        <LookMenu />
        <AccountMenu />
      </div>

      <label className="ctl ctl-inline" data-tip-title="Speed" data-tip="How much simulated time passes per real second. Close encounters automatically slow down so you can see them.">
        <span>speed</span>
        <input
          type="range" min={3} max={7} step={0.05}
          value={Math.log10(config.timeScale)}
          onChange={(e) => actions.setConfig({ timeScale: Math.pow(10, Number(e.target.value)) })}
        />
      </label>

      <div className="clock">
        {liveSpecs.length} bodies · t = {f ? fmtTime(f.time) : '—'}
        <StatusChips />
      </div>

      <button
        className="btn btn-lab"
        onClick={() => actions.setMode('lab')}
        data-tip-title="Full lab"
        data-tip="Opens the scientific interface: live energy and momentum measurements, charts, reference frames, editable bodies and the physics validation suite. Same running simulation."
      >
        🔬 Full lab
      </button>
    </div>
  );
}

export default function TopBar() {
  const mode = useStore((s) => s.mode);
  const running = useStore((s) => s.running);
  const presetId = useStore((s) => s.presetId);
  const presetName = useStore((s) => s.presetName);
  const variationLabel = useStore((s) => s.variationLabel);
  const config = useStore((s) => s.config);
  const frame = useStore((s) => s.frame);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const liveTick = useStore((s) => s.liveTick);
  void liveTick;
  const f = workerClient.latest;
  const preset = PRESETS.find((p) => p.id === presetId);

  if (mode === 'sandbox') return <SandboxBar />;

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

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-name">GRAVITY LAB</span>
        <span className="brand-sub">Newtonian N-body · Yoshida-4 symplectic · double precision</span>
      </div>

      <button
        className="btn"
        onClick={() => actions.setMode('sandbox')}
        data-tip-title="Sandbox"
        data-tip="Minimal mode: just space and your hands. Press and hold to grow a body, drag to aim, release to launch."
      >
        💧 Sandbox
      </button>

      <select
        className="preset-select"
        value={presetId}
        onChange={(e) => actions.loadPreset(e.target.value)}
        data-tip-title="Scenario"
        data-tip="Load one of the built-in experiments — each is a set of real initial conditions demonstrating one effect."
      >
        {!PRESETS.some((p) => p.id === presetId) && <option value={presetId}>{presetName}</option>}
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <div className="transport">
        <button
          className="btn"
          onClick={() => (running ? actions.pause() : actions.play())}
          data-tip-title="Start / Pause"
          data-tip="Runs or freezes the simulation. Time keeps its exact state when paused."
        >
          {running ? '⏸ Pause' : '▶ Start'}
        </button>
        <button
          className="btn"
          onClick={actions.singleStep}
          data-tip-title="Step"
          data-tip="Advances exactly one adaptive physics substep, so you can inspect an encounter frame by frame."
        >
          ⏭ Step
        </button>
        <button
          className="btn"
          onClick={actions.reset}
          data-tip-title="Reset"
          data-tip="Restores the scenario's exact initial conditions and clears recorded history."
        >
          ↺ Reset
        </button>
        <button
          className="btn btn-primary"
          onClick={() => actions.setPublishOpen(true)}
          data-tip-title="Publish"
          data-tip="Gives this world its own permanent link and adds it to the leaderboard."
        >
          🌍 Publish
        </button>
        <button
          className="btn"
          onClick={() => actions.navigate({ kind: 'leaderboard' })}
          data-tip-title="Worlds"
          data-tip="Browse every published world on the leaderboard."
        >
          ☰ Worlds
        </button>
        {preset?.variation && (
          <button
            className="btn btn-var"
            onClick={actions.applyVariation}
            data-tip-title="Vary"
            data-tip={`Re-runs this scenario with one variable changed: ${preset.variation.label}.`}
          >
            ⑂ Vary
          </button>
        )}
      </div>

      <div className="tools">
        <CaptureMenu />
        <SpotifyControls />
        <LookMenu />
        <AccountMenu />
      </div>

      <label className="ctl ctl-inline">
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
        data-tip-title="Reference frame"
        data-tip="Changes who you are watching from — the Sun, a planet, the centre of mass. Presentation only; the underlying physics is identical."
      >
        {frameOptions.map((o) => (
          <option key={o.key} value={o.key}>{frameLabel(o.sel, liveSpecs)}</option>
        ))}
      </select>

      <div className="clock">
        t = {f ? fmtTime(f.time) : '—'}
        {variationLabel && <span className="chip chip-var">{variationLabel}</span>}
        <StatusChips />
      </div>
    </div>
  );
}
