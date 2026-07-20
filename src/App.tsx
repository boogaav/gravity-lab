import { useEffect } from 'react';
import Scene from './components/Scene';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';
import BottomBar from './components/BottomBar';
import { useStore, actions } from './state/store';

export default function App() {
  const presetId = useStore((s) => s.presetId);
  useEffect(() => {
    if (!presetId) actions.loadPreset('jupiter-assist');
  }, []);
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <LeftPanel />
        <div className="viewport">
          <Scene />
        </div>
        <RightPanel />
      </div>
      <BottomBar />
    </div>
  );
}
