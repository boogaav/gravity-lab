import { useEffect, useState } from 'react';
import { actions, useStore } from '../state/store';
import { API_BASE, type WorldCard } from '../state/api';
import { useSession } from '../state/session';
import WorldGrid from './WorldGrid';

interface CreatorData {
  user: { handle: string; displayName: string; createdAt: number };
  totals: { likes: number; views: number };
  worlds: WorldCard[];
}

/** Public profile: one creator's whole collection of worlds. */
export default function CreatorPage({ handle }: { handle: string }) {
  const [data, setData] = useState<CreatorData | null>(null);
  const [error, setError] = useState('');
  const me = useSession((s) => s.account);
  const liveTick = useStore((s) => s.liveTick);
  void liveTick;

  useEffect(() => {
    let alive = true;
    setData(null);
    setError('');
    fetch(`${API_BASE}/api/creators/${encodeURIComponent(handle)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error || `Request failed (${r.status})`);
        return body as CreatorData;
      })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [handle]);

  const isMe = me?.handle === handle;

  return (
    <div className="leaderboard">
      <div className="lb-head creator-head">
        <div className="creator-id">
          <h1>@{handle}</h1>
          {data?.user.displayName && <p className="hint">{data.user.displayName}</p>}
          <p className="hint">
            {isMe ? 'Your collection — every world you have published.' : 'Worlds published by this creator.'}
          </p>
          {data && (
            <div className="creator-totals">
              <span className="wchip">{data.worlds.length} world{data.worlds.length === 1 ? '' : 's'}</span>
              <span className="wchip">♥ {data.totals.likes}</span>
              <span className="wchip">{data.totals.views} views</span>
            </div>
          )}
        </div>
        <div className="lb-actions">
          <button
            className="btn"
            onClick={() => actions.navigate({ kind: 'leaderboard' })}
            data-tip-title="All worlds"
            data-tip="Browse every published world, ranked by measured physics."
          >
            ☰ All worlds
          </button>
          <button
            className="btn"
            onClick={() => actions.navigate({ kind: 'home' })}
            data-tip-title="Sandbox"
            data-tip="Go back to building: press and hold in space to create bodies."
          >
            ← Sandbox
          </button>
        </div>
      </div>

      {error && (
        <div className="lb-empty">
          <p className="warn-text">{error}</p>
          <button className="btn" onClick={() => actions.navigate({ kind: 'leaderboard' })}>Browse all worlds</button>
        </div>
      )}
      {!error && !data && <div className="lb-empty"><p className="hint">loading…</p></div>}
      {data && data.worlds.length === 0 && (
        <div className="lb-empty">
          <p>No worlds published yet.</p>
          {isMe && <p className="hint">Build something in the sandbox and hit Publish — it will land here.</p>}
          <button className="btn btn-primary" onClick={() => actions.navigate({ kind: 'home' })}>
            Build a world
          </button>
        </div>
      )}
      {data && data.worlds.length > 0 && <WorldGrid worlds={data.worlds} />}
    </div>
  );
}
