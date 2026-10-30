import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles/index.css';

// Tailwind CSS is now integrated; responsive.css is no longer needed.

createRoot(document.getElementById('root')!).render(<App />);
