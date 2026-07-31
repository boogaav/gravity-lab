import { useEffect } from 'react';
import Scene from './components/Scene';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import BottomBar from './components/BottomBar';
import Leaderboard from './components/Leaderboard';
import PublishDialog from './components/PublishDialog';
import WorldBar from './components/WorldBar';
import { useStore, actions } from './state/store';

export default function App() {
  const presetId = useStore((s) => s.presetId);
  const mode = useStore((s) => s.mode);
  const route = useStore((s) => s.route);

  useEffect(() => {
    if (presetId) return;
    (async () => {
      actions.loadPreset('sandbox');
      // sandbox visual defaults (display only — physics untouched)
      actions.setConfig({ radiusScale: 10, showLabels: false, showVelocity: false, showCom: false, trailLength: 800 });
      actions.select(null);
      // A URL may carry a world: /@slug from the registry, or #w=… encoded inline.
      const handled = await actions.bootRouting();
      if (!handled && useStore.getState().route.kind !== 'world') actions.play();
    })();
  }, []);

  if (route.kind === 'leaderboard') {
    return (
      <div className="app">
        <Leaderboard />
      </div>
    );
  }

  const sandbox = mode === 'sandbox';
  const viewingWorld = route.kind === 'world';
  return (
    <div className="app">
      <TopBar />
      {viewingWorld && <WorldBar />}
      <div className="main">
        {!sandbox && <LeftPanel />}
        <div className="viewport">
          <Scene />
          <a
            className="contact-btn"
            href="https://x.com/boogaav"
            target="_blank"
            rel="noopener noreferrer"
            title="Contact / connect on X"
          >
            ✉ Contact
          </a>
          {sandbox && !viewingWorld && (
            <div className="sandbox-hint">
              <b>hold</b> to grow a body &nbsp;·&nbsp; <b>drag</b> to aim &nbsp;·&nbsp; <b>release</b> to launch
              &nbsp;·&nbsp; longer hold = more mass (asteroid → planet → gas giant → star)
            </div>
          )}
        </div>
        {!sandbox && <RightPanel />}
      </div>
      {!sandbox && <BottomBar />}
      <PublishDialog />
    </div>
  );
}
