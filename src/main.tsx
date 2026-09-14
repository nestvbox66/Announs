import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import "./lib/i18n";
import { ToastProvider } from './components/Toast';
import { APP_VERSION, BUILD_TIME, GIT_COMMIT } from './version';

// Trazabilidad del binario: versión + commit deben coincidir con el log del
// backend ("[Announs] Backend  v..."). Si difieren, hay que recompilar.
console.log(
  `[Announs] Frontend v${APP_VERSION} (commit ${GIT_COMMIT}, build ${BUILD_TIME})`
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
