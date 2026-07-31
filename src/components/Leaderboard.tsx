import { useEffect, useState } from 'react';
import { actions, useStore } from '../state/store';
import { api, SORTS, thumbUrl, type SortKey, type WorldCard } from '../state/api';
import { YEAR } from '../physics/constants';

function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function fate(w: WorldCard): { label: string; cls: string } {
  if (w.firstCollision != null) {
    return { label: `impact at ${(w.firstCollision / YEAR).toPrecision(2)} yr`, cls: 'fate-impact' };
  }
  if (w.escapees > 0) return { label: `${w.escapees} ejected`, cls: 'fate-eject' };
  return { label: 'intact', cls: 'fate-intact' };
}

function chaosLabel(w: WorldCard): { label: string; cls: string } {
  if (w.chaosWindow <= 0) return { label: 'unmeasured', cls: 'chaos-none' };
  if (w.chaos > 0.3) return { label: `chaotic ${w.chaos.toFixed(2)}`, cls: 'chaos-high' };
  if (w.chaos > 0.1) return { label: `unsettled ${w.chaos.toFixed(2)}`, cls: 'chaos-mid' };
  return { label: `regular ${w.chaos.toFixed(2)}`, cls: 'chaos-low' };
}

function Card({ w }: { w: WorldCard }) {
  const f = fate(w);
  const c = chaosLabel(w);
  return (
    <a
      className="world-card"
      href={actions.routePath({ kind: 'world', slug: w.slug })}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        actions.navigate({ kind: 'world', slug: w.slug });
      }}
    >
      <div className="world-thumb">
        {w.hasThumb ? (
          <img src={thumbUrl(w.slug)} alt="" loading="lazy" />
        ) : (
          <div className="world-thumb-empty">no preview</div>
        )}
        <span className="world-bodies">{w.bodies} bodies</span>
      </div>
      <div className="world-card-body">
        <div className="world-title">{w.title}</div>
        <div className="world-meta">
          @{w.slug}
          {w.author && <> · {w.author}</>}
          {' · '}
          {timeAgo(w.createdAt)}
        </div>
        <div className="world-chips">
          <span className={`wchip ${f.cls}`}>{f.label}</span>
          <span className={`wchip ${c.cls}`}>{c.label}</span>
          <span className="wchip">♥ {w.likes}</span>
          <span className="wchip">{w.views} views</span>
        </div>
      </div>
    </a>
  );
}

export default function Leaderboard() {
  const [sort, setSort] = useState<SortKey>('new');
  const [worlds, setWorlds] = useState<WorldCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const mode = useStore((s) => s.mode);
  void mode;

  useEffect(() => {
    let alive = true;
    setWorlds(null);
    setError('');
    api
      .list(sort, 60)
      .then((r) => {
        if (!alive) return;
        setWorlds(r.worlds);
        setTotal(r.total);
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [sort]);

  return (
    <div className="leaderboard">
      <div className="lb-head">
        <div>
          <h1>Published worlds</h1>
          <p className="hint">
            Every world here is a real set of initial conditions. Ranking columns are measured by
            integrating each world forward — not by vote count alone.
          </p>
        </div>
        <div className="lb-actions">
          <button className="btn" onClick={() => actions.navigate({ kind: 'home' })}>← Back to sandbox</button>
        </div>
      </div>

      <div className="lb-sorts">
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`btn btn-music ${sort === s.key ? 'active' : ''}`}
            title={s.hint}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
        {worlds && <span className="hint lb-count">{total} world{total === 1 ? '' : 's'}</span>}
      </div>

      {error && (
        <div className="lb-empty">
          <p className="warn-text">Could not reach the world registry: {error}</p>
          <p className="hint">Your own worlds still work — sandbox and link-sharing need no server.</p>
        </div>
      )}
      {!error && worlds === null && <div className="lb-empty"><p className="hint">loading worlds…</p></div>}
      {!error && worlds?.length === 0 && (
        <div className="lb-empty">
          <p>No worlds published yet.</p>
          <p className="hint">Build something in the sandbox and hit Publish — you'll be first.</p>
          <button className="btn btn-primary" onClick={() => actions.navigate({ kind: 'home' })}>
            Build a world
          </button>
        </div>
      )}
      {worlds && worlds.length > 0 && (
        <div className="world-grid">
          {worlds.map((w) => (
            <Card key={w.slug} w={w} />
          ))}
        </div>
      )}
    </div>
  );
}
