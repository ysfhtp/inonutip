import { useEffect } from 'react';
import { initInonuApp } from './legacyApp.ts';

export default function App() {
  useEffect(() => {
    initInonuApp();
  }, []);

  return null;
}
