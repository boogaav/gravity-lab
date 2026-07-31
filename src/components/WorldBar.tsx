import { useState } from 'react';
import { actions, useStore } from '../state/store';
import { worldUrl } from '../state/api';
import { shareApp } from '../ui/capture';
import { YEAR } from '../physics/constants';

/** Info strip shown when viewing a published world at /@slug. */
export default function WorldBar() {
  const rec = useStore((s) => s.worldRecord);
  const liked = useStore((s) => s.worldLiked);
  const loading = useStore((s) => s.worldLoading);
  const error = useStore((s) => s.worldError);
  const [toast, setToast] = useState('');

  if (loading) return <div className="world-bar"><span className="hint">loading world…</span></div>;

  if (error) {
    return (
      <div className="world-bar">
        <span className="warn-text">{error}</span>
        <button className="btn btn-sm" onClick={() => actions.navigate({ kind: 'leaderboard' })}>Browse worlds</button>
        <button className="btn btn-sm" onClick={() => actions.navigate({ kind: 'home' })}>Sandbox</button>
      </div>
    );
  }
  if (!rec) return null;

  const fate =
    rec.firstCollision != null
      ? `first impact at ${(rec.firstCollision / YEAR).toPrecision(3)} yr`
      : rec.escapees > 0
        ? `${rec.escapees} ejected`
        : 'intact';
  const chaos =
    rec.chaosWindow > 0
      ? rec.chaos > 0.3
        ? `chaotic (λ ${rec.chaos.toFixed(2)})`
        : rec.chaos > 0.1
          ? `unsettled (λ ${rec.chaos.toFixed(2)})`
          : `regular (λ ${rec.chaos.toFixed(2)})`
      : null;

  return (
    <div className="world-bar">
      <div className="world-bar-id">
        <b>{rec.title}</b>
        <span className="hint">
          @{rec.slug}
          {rec.author && <> · by {rec.author}</>}
        </span>
      </div>
      <div className="world-bar-stats">
        <span className="wchip">{rec.bodies} bodies</span>
        <span className="wchip">{fate}</span>
        {chaos && <span className="wchip">{chaos}</span>}
        <span className="wchip">{rec.views} views</span>
      </div>
      <div className="world-bar-actions">
        <button className={`btn btn-sm ${liked ? 'btn-liked' : ''}`} onClick={actions.toggleLike}>
          {liked ? '♥' : '♡'} {rec.likes}
        </button>
        <button
          className="btn btn-sm"
          onClick={async () => {
            const r = await shareApp({
              url: worldUrl(rec.slug),
              title: `${rec.title} — Gravity Lab`,
              text: `${rec.title}: ${rec.bodies} bodies, ${fate}. A real N-body world.`,
            });
            if (r === 'copied') setToast('link copied ✓');
            else if (r === 'failed') setToast('sharing unavailable');
            if (r !== 'shared') window.setTimeout(() => setToast(''), 2200);
          }}
        >
          ↗ Share
        </button>
        <button className="btn btn-sm" onClick={actions.remixWorld} title="Fork this world and keep playing">
          ⑂ Remix
        </button>
        <button className="btn btn-sm" onClick={() => actions.navigate({ kind: 'leaderboard' })}>
          ☰ All worlds
        </button>
        {toast && <span className="chip chip-var">{toast}</span>}
      </div>
    </div>
  );
}
