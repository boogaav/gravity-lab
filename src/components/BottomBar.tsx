import { useMemo } from 'react';
import { useStore, actions } from '../state/store';
import { fmtTime } from '../ui/units';

function LineChart({
  series, title, unit,
}: {
  series: { label: string; color: string; values: number[] }[];
  title: string;
  unit: string;
}) {
  const W = 320, H = 110, PAD = 6;
  const paths = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v) => isFinite(v));
    if (!all.length) return [];
    let min = Math.min(...all), max = Math.max(...all);
    if (max === min) { max += 1; min -= 1; }
    const span = max - min;
    return series.map((s) => {
      const n = s.values.length;
      if (n < 2) return { ...s, d: '' };
      const pts = s.values.map((v, i) => {
        const x = PAD + (i / (n - 1)) * (W - 2 * PAD);
        const y = H - PAD - ((v - min) / span) * (H - 2 * PAD);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return { ...s, d: `M${pts.join('L')}` };
    });
  }, [series]);
  return (
    <div className="chart">
      <div className="chart-title" data-tip-title={title} data-tip={title === 'Energy' ? 'Kinetic and potential energy trading back and forth while their sum stays flat — that flat green line is energy conservation.' : 'How far total energy and angular momentum have drifted from their starting values. This is numerical error, not physics.'}>{title} <em>{unit}</em></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none">
        <rect x={0} y={0} width={W} height={H} fill="#070b14" rx={4} />
        {paths.map((p) => p.d && <path key={p.label} d={p.d} fill="none" stroke={p.color} strokeWidth={1.4} />)}
      </svg>
      <div className="legend">
        {series.map((s) => (
          <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
    </div>
  );
}

export default function BottomBar() {
  const seriesData = useStore((s) => s.series);
  const history = useStore((s) => s.history);
  const collisions = useStore((s) => s.collisions);

  const energySeries = [
    { label: 'kinetic ΣK', color: '#63d0ff', values: seriesData.map((p) => p.K) },
    { label: 'potential ΣU', color: '#ff9d63', values: seriesData.map((p) => p.U) },
    { label: 'total E', color: '#9dffb0', values: seriesData.map((p) => p.E) },
  ];
  const driftSeries = [
    { label: 'ΔE/E₀', color: '#ff6d9a', values: seriesData.map((p) => p.driftE) },
    { label: 'Δ|L|/|L₀|', color: '#c9a2ff', values: seriesData.map((p) => p.driftL) },
  ];

  return (
    <div className="bottombar">
      <div className="scrub-wrap">
        <div className="scrub-label" data-tip-title="Replay scrubber" data-tip="Drag to jump back through recorded snapshots. It restores exact saved states — it never interpolates or fakes reversed physics.">
          recorded states: {history.length}
          {history.length > 1 && <> · scrub to replay (restores exact recorded snapshots — no interpolation)</>}
        </div>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={Math.max(history.length - 1, 0)}
          value={history.length - 1}
          onChange={(e) => actions.scrubTo(Number(e.target.value))}
          disabled={history.length < 2}
        />
      </div>
      <LineChart series={energySeries} title="Energy" unit="J vs time" />
      <LineChart series={driftSeries} title="Conservation drift" unit="fraction vs time" />
      <div className="collision-log">
        <div className="chart-title" data-tip-title="Events" data-tip="Every contact between bodies, with the impact speed and the kinetic energy dissipated in the collision.">Events</div>
        {collisions.length === 0 && <p className="hint">no contacts</p>}
        {collisions.slice(-6).map((c, i) => (
          <div key={i} className="collision-item">
            t={fmtTime(c.time)}: <b>{c.aName}</b> + <b>{c.bName}</b> — {c.mode}, impact {(c.relSpeed / 1000).toFixed(2)} km/s,
            {' '}COM-frame KE {c.impactEnergy.toExponential(2)} J
            {c.mode === 'merge' && ' (dissipated as heat/deformation; pair orbital ang. momentum → spin, untracked by point masses. Drift baselines rebased.)'}
          </div>
        ))}
      </div>
    </div>
  );
}
