import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __onPwaOfflineReady?: () => void;
  }
}

registerSW({
  immediate: true,
  onOfflineReady() {
    window.__onPwaOfflineReady?.();
  },
});

createRoot(document.getElementById('root')!).render(<App />);
