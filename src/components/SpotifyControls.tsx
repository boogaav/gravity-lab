import { useEffect, useRef, useState } from 'react';
import {
  connectSpotify,
  disconnectSpotify,
  playback,
  playContext,
  spotifyConfigured,
  useSpotify,
} from '../ui/spotify';

/**
 * Music control. Spotify is the only soundtrack source; the menu renders
 * nothing unless this deployment has a Spotify client id configured.
 */
export default function SpotifyControls() {
  if (!spotifyConfigured()) return null;
  return <SpotifyMenu />;
}

function SpotifyMenu() {
  const s = useSpotify();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const label = s.nowPlaying
    ? s.nowPlaying.title.length > 16
      ? `${s.nowPlaying.title.slice(0, 15)}…`
      : s.nowPlaying.title
    : 'Music';

  const start = async (uri: string | null) => {
    await playContext(uri);
  };

  return (
    <div className="spotify-wrap" ref={wrap}>
      <button
        className={`btn ${s.connected ? 'btn-spotify' : ''}`}
        onClick={() => setOpen((v) => !v)}
        data-tip-title="Spotify"
        data-tip="Score your worlds with your own Spotify playlists. Requires a Spotify Premium account — Spotify does not permit in-browser playback on free accounts."
      >
        ♫ {label}
      </button>
      {open && (
        <div className="spotify-pop">
          {!s.connected ? (
            <>
              <p className="hint">
                Connect Spotify to score your worlds with your own music. Playback happens in this tab as a
                Spotify Connect device.
              </p>
              <p className="hint spotify-note">
                Spotify only permits in-browser playback for <b>Premium</b> accounts. Free accounts can connect
                and browse, but playback will not start.
              </p>
              <button className="btn btn-primary" disabled={s.connecting} onClick={connectSpotify}>
                {s.connecting ? 'connecting…' : '♫ Connect Spotify'}
              </button>
            </>
          ) : (
            <>
              <div className="spotify-head">
                <b>{s.displayName}</b>
                <span className="hint">{s.premium ? (s.ready ? 'player ready' : 'starting…') : 'free account'}</span>
              </div>

              {s.nowPlaying && (
                <div className="spotify-now">
                  {s.nowPlaying.art && <img src={s.nowPlaying.art} alt="" />}
                  <div className="spotify-now-text">
                    <b>{s.nowPlaying.title}</b>
                    <em>{s.nowPlaying.artist}</em>
                  </div>
                </div>
              )}

              {s.premium && (
                <div className="spotify-transport">
                  <button className="btn btn-sm" onClick={playback.previous} data-tip-title="Previous" data-tip="Previous track.">⏮</button>
                  <button className="btn btn-sm" onClick={playback.toggle} data-tip-title="Play / pause" data-tip="Play or pause the Spotify track.">
                    {s.nowPlaying?.paused === false ? '⏸' : '▶'}
                  </button>
                  <button className="btn btn-sm" onClick={playback.next} data-tip-title="Next" data-tip="Skip to the next track.">⏭</button>
                  <input
                    type="range" min={0} max={1} step={0.02} defaultValue={0.5}
                    onChange={(e) => playback.setVolume(Number(e.target.value))}
                    aria-label="Spotify volume"
                  />
                </div>
              )}

              <div className="spotify-lists">
                <button className="spotify-item" onClick={() => start(null)}>
                  <span className="spotify-thumb spotify-liked">♥</span>
                  <span className="spotify-item-text"><b>Liked Songs</b><em>your saved tracks</em></span>
                </button>
                {s.playlists.map((p) => (
                  <button key={p.id} className="spotify-item" onClick={() => start(p.uri)}>
                    {p.image ? (
                      <img className="spotify-thumb" src={p.image} alt="" loading="lazy" />
                    ) : (
                      <span className="spotify-thumb" />
                    )}
                    <span className="spotify-item-text"><b>{p.name}</b><em>{p.tracks} tracks</em></span>
                  </button>
                ))}
                {s.playlists.length === 0 && <p className="hint">No playlists found on this account.</p>}
              </div>

              <button
                className="btn btn-sm"
                onClick={async () => {
                  await playback.stop();
                  disconnectSpotify();
                  setOpen(false);
                }}
              >
                disconnect
              </button>
            </>
          )}
          {s.error && <p className="warn-text">{s.error}</p>}
        </div>
      )}
    </div>
  );
}
