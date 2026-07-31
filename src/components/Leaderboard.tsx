import { useEffect, useState } from 'react';
import { actions } from '../state/store';
import { api, SORTS, type SortKey, type WorldCard } from '../state/api';
import { useSession } from '../state/session';
import WorldGrid from './WorldGrid';

export default function Leaderboard() {
  const [sort, setSort] = useState<SortKey>('new');
  const [worlds, setWorlds] = useState<WorldCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const account = useSession((s) => s.account);

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
          {account && (
            <button
              className="btn"
              onClick={() => actions.navigate({ kind: 'creator', handle: account.handle })}
              data-tip-title="My worlds"
              data-tip="Your creator profile: every world you have published while signed in, all editable from any device."
            >
              ◉ My worlds
            </button>
          )}
          <button
            className="btn"
            onClick={() => actions.navigate({ kind: 'home' })}
            data-tip-title="Sandbox"
            data-tip="Go back to building: press and hold in empty space to grow a body, drag to aim, release to launch."
          >
            ← Back to sandbox
          </button>
        </div>
      </div>

      <div className="lb-sorts">
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`btn btn-music ${sort === s.key ? 'active' : ''}`}
            data-tip-title={s.label}
            data-tip={s.tip}
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
      {worlds && worlds.length > 0 && <WorldGrid worlds={worlds} />}
    </div>
  );
}
