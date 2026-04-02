import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth/AuthProvider.js';
import { AppRouter } from './app/Router.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <React.StrictMode>
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  </React.StrictMode>,
);
