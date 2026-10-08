import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';
import './readability.css';
import './shadcn.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
