import { useEffect } from 'react';
import Scene from './components/Scene';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import BottomBar from './components/BottomBar';
import { useStore, actions } from './state/store';

export default function App() {
  const presetId = useStore((s) => s.presetId);
  const mode = useStore((s) => s.mode);
  useEffect(() => {
    if (!presetId) {
      actions.loadPreset('sandbox');
      // sandbox visual defaults (display only — physics untouched)
      actions.setConfig({ radiusScale: 10, showLabels: false, showVelocity: false, showCom: false, trailLength: 800 });
      actions.select(null);
      actions.play();
    }
  }, []);
  const sandbox = mode === 'sandbox';
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        {!sandbox && <LeftPanel />}
        <div className="viewport">
          <Scene />
          {sandbox && (
            <div className="sandbox-hint">
              <b>hold</b> to grow a body &nbsp;·&nbsp; <b>drag</b> to aim &nbsp;·&nbsp; <b>release</b> to launch
              &nbsp;·&nbsp; longer hold = more mass (asteroid → planet → gas giant → star)
            </div>
          )}
        </div>
        {!sandbox && <RightPanel />}
      </div>
      {!sandbox && <BottomBar />}
    </div>
  );
}
