import { useEffect, useMemo, useRef, useState } from 'react';
import { actions, useStore } from '../state/store';
import { slugify, isValidSlug } from '../state/worldCodec';
import { api, SITE_ORIGIN } from '../state/api';
import { analyzeWorld, describeStats, type WorldStats } from '../physics/analyze';
import type { World } from '../state/worldCodec';
import { captureThumbnail } from '../ui/capture';
import { fmtTime } from '../ui/units';

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

export default function PublishDialog() {
  const open = useStore((s) => s.publishOpen);
  const publishing = useStore((s) => s.publishing);
  const liveSpecs = useStore((s) => s.liveSpecs);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem('gravity-lab-author') ?? '');
  const [avail, setAvail] = useState<Availability>('idle');
  const [error, setError] = useState('');
  const [stats, setStats] = useState<WorldStats | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<World | null>(null);
  const slug = useMemo(() => slugify(title), [title]);
  const checkSeq = useRef(0);

  // Freeze the world the moment the dialog opens: the simulation keeps running
  // behind the modal, so the thumbnail, the measured stats and what actually
  // gets published must all describe the SAME snapshot.
  useEffect(() => {
    if (!open) {
      setFrozen(null);
      setStats(null);
      return;
    }
    setError('');
    setThumb(captureThumbnail(640));
    const snapshot = actions.currentWorld();
    setFrozen(snapshot);
    const id = window.setTimeout(() => {
      try {
        setStats(analyzeWorld(snapshot.bodies));
      } catch {
        setStats(null);
      }
    }, 30);
    return () => window.clearTimeout(id);
  }, [open]);

  // Debounced name availability check.
  useEffect(() => {
    if (!open) return;
    if (!slug) {
      setAvail('idle');
      return;
    }
    if (!isValidSlug(slug)) {
      setAvail('invalid');
      return;
    }
    setAvail('checking');
    const seq = ++checkSeq.current;
    const id = window.setTimeout(async () => {
      try {
        const res = await api.available(slug);
        if (seq !== checkSeq.current) return;
        setAvail(res.available ? 'free' : res.reason === 'taken' ? 'taken' : 'invalid');
      } catch {
        if (seq === checkSeq.current) setAvail('idle');
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [slug, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.setPublishOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const canPublish = avail === 'free' && !publishing && !!frozen && !!stats && liveSpecs.length > 0;

  const submit = async () => {
    if (!canPublish) return;
    setError('');
    try {
      localStorage.setItem('gravity-lab-author', author);
      await actions.publishWorld({
        slug,
        title: title.trim(),
        author: author.trim(),
        world: frozen!,
        stats: stats!,
        thumb,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !publishing && actions.setPublishOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Publish this world</h2>
        <p className="hint">
          Your world gets its own address that anyone can open — the exact bodies, masses and velocities
          on screen right now, replayed by the same physics engine.
        </p>

        {thumb && <img className="publish-thumb" src={thumb} alt="Preview of the world being published" />}

        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            type="text"
            value={title}
            maxLength={60}
            placeholder="Twin suns and a doomed moon"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <div className="url-preview">
          {slug ? (
            <>
              <span className="url-dim">{SITE_ORIGIN.replace(/^https?:\/\//, '')}/</span>
              <span className="url-slug">@{slug}</span>
              {avail === 'checking' && <span className="chip">checking…</span>}
              {avail === 'free' && <span className="chip chip-var">available ✓</span>}
              {avail === 'taken' && <span className="chip chip-warn">already taken</span>}
              {avail === 'invalid' && <span className="chip chip-warn">needs 2+ letters or numbers</span>}
            </>
          ) : (
            <span className="url-dim">pick a name to get your link</span>
          )}
        </div>

        <label className="field">
          <span>Your name <em>(optional)</em></span>
          <input
            type="text"
            value={author}
            maxLength={40}
            placeholder="anonymous"
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>

        <div className="publish-stats">
          <div className="chart-title">Measured dynamics</div>
          {stats ? (
            <>
              <div className="stat-line">{describeStats(stats)}</div>
              <div className="stat-grid">
                <span>orbital timescale</span><b>{fmtTime(stats.dynamicalTime)}</b>
                <span>simulated forward</span><b>{fmtTime(stats.horizon)}</b>
                <span>survivors</span><b>{stats.survivors} of {stats.bodies}</b>
                <span>chaos (Lyapunov)</span>
                <b>{stats.chaosWindow > 0 ? `${stats.chaos.toFixed(2)} per orbit` : 'not measurable'}</b>
              </div>
              <p className="hint">
                These come from integrating your world forward{stats.truncated ? ' (compute-capped)' : ''} and
                comparing it against a twin displaced by one part in a billion. They rank the leaderboard.
              </p>
            </>
          ) : (
            <div className="stat-line">measuring…</div>
          )}
        </div>

        {error && <p className="warn-text">{error}</p>}

        <div className="modal-actions">
          <button className="btn" disabled={publishing} onClick={() => actions.setPublishOpen(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canPublish} onClick={submit}>
            {publishing ? 'Publishing…' : '🌍 Publish world'}
          </button>
        </div>
      </div>
    </div>
  );
}
