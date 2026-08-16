import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './context/AppContext';
import { Toaster } from 'react-hot-toast';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
    <Toaster position="top-center" toastOptions={{ style: { borderRadius: '16px', background: '#333', color: '#fff' } }} />
  </AppProvider>
);