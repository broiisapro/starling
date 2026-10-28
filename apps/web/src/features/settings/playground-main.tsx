import '../../index.css';
import { createRoot } from 'react-dom/client';
import Playground from './Playground';

const container = document.getElementById('root');
if (container) createRoot(container).render(<Playground />);
