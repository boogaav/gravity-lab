import { useEffect, useRef, useState } from 'react';
import {
  connectSpotify,
  disconnectSpotify,
  playback,
  playContext,
  spotifyConfigured,
  useSpotify,
} from '../ui/spotify';
import { setTrack } from '../ui/music';

/**
 * Spotify soundtrack control. Renders nothing unless this deployment has a
 * Spotify client id, so the generated tracks remain the whole story otherwise.
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
    ? s.nowPlaying.title.length > 18
      ? `${s.nowPlaying.title.slice(0, 17)}…`
      : s.nowPlaying.title
    : s.connected
      ? s.displayName || 'Spotify'
      : 'Spotify';

  const start = async (uri: string | null) => {
    setTrack('off'); // the generated piano and Spotify never play together
    await playContext(uri);
  };

  return (
    <div className="spotify-wrap" ref={wrap}>
      <button
        className={`btn ${s.connected ? 'btn-spotify' : ''}`}
        onClick={() => setOpen((v) => !v)}
        data-tip-title="Spotify"
        data-tip="Play your own Spotify playlists instead of the built-in piano tracks. Requires a Spotify Premium account — Spotify does not allow in-browser playback on free accounts."
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
                Spotify requires a <b>Premium</b> account for in-browser playback. Free accounts can connect,
                but the built-in tracks will keep playing instead.
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
