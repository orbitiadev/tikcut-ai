import { useState } from 'react';
import EditorV2 from './components/EditorV2';
import StudioPro from './components/StudioProV3';
import Finalizer from './components/Finalizer';
import Storyverse from './components/Storyverse';
import Guide from './components/Guide';
import './storyverse.css';
import './editor-v2.css';
import './studio-pro.css';
import './timeline-edit.css';
import './finalizer.css';
import './nav-responsive.css';

type Area = 'editor' | 'studio-pro' | 'finalizer' | 'storyverse' | 'guide';

export default function RootApp() {
  const [area, setArea] = useState<Area>('editor');

  return (
    <>
      <div className="app-mode-switch" role="navigation" aria-label="Áreas do TikCut AI">
        <button className={area === 'editor' ? 'active' : ''} onClick={() => setArea('editor')}>Editor</button>
        <button className={area === 'studio-pro' ? 'active' : ''} onClick={() => setArea('studio-pro')}>STUDIO PRO</button>
        <button className={area === 'finalizer' ? 'active' : ''} onClick={() => setArea('finalizer')}>FINALIZADOR</button>
        <button className={area === 'storyverse' ? 'active' : ''} onClick={() => setArea('storyverse')}>STORYVERSE</button>
        <button className={area === 'guide' ? 'active' : ''} onClick={() => setArea('guide')}>Guia de Uso</button>
      </div>
      {area === 'editor' && <EditorV2 />}
      {area === 'studio-pro' && <StudioPro />}
      {area === 'finalizer' && <Finalizer />}
      {area === 'guide' && <Guide />}
      {area === 'storyverse' && (
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
