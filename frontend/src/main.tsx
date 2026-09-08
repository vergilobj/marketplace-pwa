import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './context/AppContext';
import { Toaster } from 'react-hot-toast';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
    <Toaster
      position="top-center"
      gutter={8}
      toastOptions={{
        duration: 2500,
        style: {
          background: '#111d18',
          color: '#ffffff',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: '14px',
          padding: '12px 16px',
          fontSize: '14px',
          fontWeight: '500',
          maxWidth: '90vw',
          boxShadow: '0 8px 24px -8px rgba(0,0,0,0.5)',
        },
        success: {
          iconTheme: { primary: '#22c55e', secondary: '#0b0e0d' },
        },
        error: {
          iconTheme: { primary: '#ef4444', secondary: '#0b0e0d' },
          style: {
            border: '1px solid rgba(239,68,68,0.35)',
          },
        },
      }}
    />
  </AppProvider>
);