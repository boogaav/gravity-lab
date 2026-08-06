import { useEffect, useState } from 'react';
import { useStore, actions } from '../state/store';
import { workerClient } from '../state/workerClient';
import { PRESETS } from '../physics/presets';
import { frameLabel, type FrameSel } from '../physics/frames';
import { fmtTime } from '../ui/units';
import { isRecording, shareApp, startRecording, stopRecording, takeScreenshot } from '../ui/capture';
import { currentTrack, setTrack, type TrackId } from '../ui/music';
import AccountMenu from './AccountMenu';
import { ThemeToggle, UniversePicker } from './ThemeControls';
import SpotifyControls from './SpotifyControls';

const TRACK_BUTTONS: Array<{ id: TrackId; label: string; hint: string }> = [
  { id: 'off', label: 'Off', hint: 'No music' },
  { id: 'elegy', label: 'Elegy', hint: 'Slow & minor — mournful piano arpeggios' },
  { id: 'tempest', label: 'Tempest', hint: 'Driving 16th-note storm' },
  { id: 'adrift', label: 'Adrift', hint: 'Sparse, ambient, weightless' },
];

function MusicPicker() {
  const [track, setTrackState] = useState<TrackId>(() => currentTrack());
  return (
    <div className="music-group" data-tip-title="Music" data-tip="Three short piano pieces generated live in your browser. Purely ambience — it is not a sonification of the physics.">
      <span className="music-icon">♪</span>
      {TRACK_BUTTONS.map((t) => (
        <button
          key={t.id}
          className={`btn btn-music ${track === t.id ? 'active' : ''}`}
          data-tip-title={`Music: ${t.label}`} data-tip={t.hint}
          onClick={() => {
            setTrackState(t.id);
            setTrack(t.id);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CaptureButtons() {
  const [recSec, setRecSec] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 2500);
  };
  const recording = recSec !== null;
  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setRecSec((s) => (s === null ? null : s + 1)), 1000);
    return () => window.clearInterval(id);
  }, [recording]);
  return (
    <>
      <button
        className="btn"
        data-tip-title="Screenshot" data-tip="Saves a PNG of the current view to your downloads."
        onClick={async () => flash((await takeScreenshot()) ? 'screenshot saved' : 'screenshot failed')}
      >
        📷 Shot
      </button>
      <button
        className={recording ? 'btn btn-rec' : 'btn'}
        data-tip-title="Record" data-tip={recording ? 'Recording — click again to stop and save the video file.' : 'Records the simulation to a video file. Click once to start, again to stop and save.'}
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
      >
        {recording ? `⏹ ${recSec}s` : '⏺ Rec'}
      </button>
      <button
        className="btn"
        data-tip-title="Share" data-tip="Opens your device share sheet, or copies the link if sharing is unavailable."
        onClick={async () => {
          const r = await shareApp();
          if (r === 'copied') flash('link copied ✓');
          else if (r === 'failed') flash('sharing unavailable');
        }}
      >
        ↗ Share
      </button>
      {toast && <span className="chip chip-var">{toast}</span>}
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
        <button className="btn" onClick={() => (running ? actions.pause() : actions.play())} data-tip-title="Start / Pause" data-tip="Runs or freezes the simulation. Time keeps its exact state when paused — nothing is reset.">
          {running ? '⏸ Pause' : '▶ Start'}
        </button>
        <button
          className="btn"
          onClick={actions.startNewWorld}
          data-tip-title="Start New"
          data-tip="Opens a fresh, empty world in a new browser tab — so whatever you have going here stays exactly as it is, and you can bookmark or keep both."
        >
          ＋ Start New
        </button>
        <button
          className="btn btn-primary"
          onClick={() => actions.setPublishOpen(true)}
          data-tip-title="Publish" data-tip="Gives the arrangement on screen its own permanent link and adds it to the leaderboard. Its physics are measured first so it can be ranked."
        >
          🌍 Publish
        </button>
        <button
          className="btn"
          onClick={() => actions.navigate({ kind: 'leaderboard' })}
          data-tip-title="Worlds" data-tip="Browse every published world, sortable by likes, size, chaos or how much carnage they produce."
        >
          ☰ Worlds
        </button>
        <CaptureButtons />
        <MusicPicker />
        <SpotifyControls />
        <UniversePicker />
        <ThemeToggle />
        <AccountMenu />
      </div>
      <label className="ctl ctl-inline">
        <span>speed</span>
        <input
          type="range" min={3} max={7} step={0.05}
          value={Math.log10(config.timeScale)}
          onChange={(e) => actions.setConfig({ timeScale: Math.pow(10, Number(e.target.value)) })}
        />
      </label>
      <div className="clock">
        {liveSpecs.length} bodies · t = {f ? fmtTime(f.time) : '—'}
        {f && Math.abs(f.diag.energyDrift) > 1e-4 && (
          <span className="chip chip-warn">⚠ numerical drift</span>
        )}
      </div>
      <button className="btn btn-lab" onClick={() => actions.setMode('lab')} data-tip-title="Full lab" data-tip="Opens the scientific interface: live energy and momentum measurements, charts, reference frames, editable bodies and the physics validation suite. Same running simulation.">
        🔬 Open full lab
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

  if (mode === 'sandbox') return <SandboxBar />;

  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-name">GRAVITY LAB</span>
        <span className="brand-sub">Newtonian N-body · Yoshida-4 symplectic · double precision</span>
      </div>
      <button className="btn" onClick={() => actions.setMode('sandbox')} data-tip-title="Sandbox" data-tip="Minimal mode: just space and your hands. Press and hold to grow a body, drag to aim, release to launch.">
        💧 Sandbox
      </button>
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
        <button className="btn" onClick={() => (running ? actions.pause() : actions.play())} data-tip-title="Start / Pause" data-tip="Runs or freezes the simulation. Time keeps its exact state when paused — nothing is reset.">
          {running ? '⏸ Pause' : '▶ Start'}
        </button>
        <button className="btn" onClick={actions.singleStep} data-tip-title="Step" data-tip="Advances exactly one adaptive physics substep, so you can inspect an encounter frame by frame.">⏭ Step</button>
        <button className="btn" onClick={actions.reset} data-tip-title="Reset" data-tip="Restores the scenario's exact initial conditions and clears recorded history.">↺ Reset</button>
        <button className="btn btn-primary" onClick={() => actions.setPublishOpen(true)} data-tip-title="Publish" data-tip="Gives this world its own permanent link and adds it to the leaderboard.">
          🌍 Publish
        </button>
        <button className="btn" onClick={() => actions.navigate({ kind: 'leaderboard' })} data-tip-title="Worlds" data-tip="Browse every published world on the leaderboard.">
          ☰ Worlds
        </button>
        <MusicPicker />
        <SpotifyControls />
        <UniversePicker />
        <ThemeToggle />
        <AccountMenu />
        {preset?.variation && (
          <button
            className="btn btn-var"
            onClick={actions.applyVariation}
            data-tip-title="Vary"
            data-tip={`Re-runs this scenario with one variable changed: ${preset.variation.label}. The best way to see how sensitive an encounter is.`}
          >
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
        data-tip-title="Reference frame" data-tip="Changes who you are watching from — the Sun, a planet, the centre of mass. This only changes the presentation; the underlying physics is identical."
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
