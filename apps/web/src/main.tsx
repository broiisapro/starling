import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// React Flow ships its own base CSS (edges, handles, panes). Without it the DAG has invisible
// edges — the shell owns the import because the feature lane has no entry point of its own.
import '@xyflow/react/dist/style.css';
import { AppShell } from './app/index';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
