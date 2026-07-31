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
  const unlocked = useStore((s) => s.worldUnlocked);
  const [toast, setToast] = useState('');
  const [askKey, setAskKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  const [checking, setChecking] = useState(false);

  const tryUnlock = async () => {
    setChecking(true);
    setKeyError('');
    try {
      await actions.unlockWorld(keyInput.trim());
      setAskKey(false);
      setKeyInput('');
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

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
          {rec.ownerHandle ? (
            <>
              {' · by '}
              <span
                className="creator-link"
                data-tip-title={`@${rec.ownerHandle}`}
                data-tip="See every world published by this creator."
                onClick={() => actions.navigate({ kind: 'creator', handle: rec.ownerHandle! })}
              >
                @{rec.ownerHandle}
              </span>
            </>
          ) : (
            rec.author && <> · by {rec.author}</>
          )}
        </span>
      </div>
      <div className="world-bar-stats">
        <span className="wchip">{rec.bodies} bodies</span>
        <span className="wchip">{fate}</span>
        {chaos && <span className="wchip">{chaos}</span>}
        <span className="wchip">{rec.views} views</span>
      </div>
      <div className="world-bar-actions">
        <button className={`btn btn-sm ${liked ? 'btn-liked' : ''}`} onClick={actions.toggleLike} data-tip-title="Like" data-tip="Give this world a like. Likes drive the Top ranking on the leaderboard.">
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
          data-tip-title="Share"
          data-tip="Share this exact world. The link previews with its own thumbnail and measured stats."
        >
          ↗ Share
        </button>
        {rec.editable && unlocked && (
          <button
            className="btn btn-sm btn-primary"
            onClick={() => actions.setPublishOpen(true, 'update')}
            data-tip-title="Update" data-tip="Save what is on screen now over this published world. Its link, likes and views stay the same."
          >
            ✎ Update
          </button>
        )}
        {rec.editable && !unlocked && (
          <button className="btn btn-sm" onClick={() => setAskKey(true)} data-tip-title="Claim this world" data-tip="Enter the secret key you saved when publishing to unlock editing from this device.">
            🔑 I own this
          </button>
        )}
        <button className="btn btn-sm" onClick={actions.remixWorld} data-tip-title="Remix" data-tip="Take this world into your own sandbox and keep changing it. The original stays exactly as its author published it.">
          ⑂ Remix
        </button>
        <button
          className="btn btn-sm"
          onClick={() => actions.navigate({ kind: 'leaderboard' })}
          data-tip-title="All worlds"
          data-tip="Browse every published world on the leaderboard."
        >
          ☰ All worlds
        </button>
        {toast && <span className="chip chip-var">{toast}</span>}
      </div>
      {askKey && (
        <div className="key-prompt">
          <input
            autoFocus
            type="text"
            spellCheck={false}
            value={keyInput}
            placeholder="secret key for this world"
            onChange={(e) => {
              setKeyInput(e.target.value);
              setKeyError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void tryUnlock();
              if (e.key === 'Escape') setAskKey(false);
            }}
          />
          <button className="btn btn-sm btn-primary" disabled={checking || !keyInput.trim()} onClick={tryUnlock}>
            {checking ? 'checking…' : 'Unlock'}
          </button>
          <button className="btn btn-sm" onClick={() => setAskKey(false)}>Cancel</button>
          {keyError && <span className="warn-text">{keyError}</span>}
        </div>
      )}
    </div>
  );
}
