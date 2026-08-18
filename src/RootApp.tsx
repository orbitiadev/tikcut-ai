import { useState } from 'react';
import App from './App';
import Storyverse from './components/Storyverse';
import './storyverse.css';

type Area = 'editor' | 'storyverse';

export default function RootApp() {
  const [area, setArea] = useState<Area>('editor');

  return (
    <>
      <div className="app-mode-switch" role="navigation" aria-label="Áreas do TikCut AI">
        <button className={area === 'editor' ? 'active' : ''} onClick={() => setArea('editor')}>Editor</button>
        <button className={area === 'storyverse' ? 'active' : ''} onClick={() => setArea('storyverse')}>STORYVERSE</button>
      </div>
      {area === 'editor' ? (
        <App />
      ) : (
        <div className="storyverse-page app-shell">
          <header className="topbar storyverse-topbar">
            <div>
              <div className="eyebrow">PRIVATE TIKTOK STUDIO · SERIAL CONTENT</div>
              <h1>TikCut <span>AI</span> · STORYVERSE</h1>
            </div>
            <span className="pill good">Continuidade local-first</span>
          </header>
          <Storyverse />
          <footer><span>Histórias, personagens e episódios ficam salvos localmente neste navegador.</span><span>STORYVERSE v1</span></footer>
        </div>
      )}
    </>
  );
}
