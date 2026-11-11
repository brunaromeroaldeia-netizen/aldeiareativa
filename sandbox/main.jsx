import './globals.js';
import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Route } from 'react-router-dom';
import { boot, handle, resetEnvironment, TEST_USERS } from './server.js';
import App from '../client/src/App.jsx';
import TestGuide from './TestGuide.jsx';

// Marca a interface como versão de testes (credenciais na tela de login, guia, reinício do ambiente)
window.__ALDEIA_TESTE__ = {
  users: TEST_USERS,
  reset: async () => { await resetEnvironment(); window.location.reload(); },
};

// Todas as chamadas /api são atendidas pelo "servidor" que roda no próprio navegador
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('/api')) {
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return handle((init.method || 'GET').toUpperCase(), url, headers, init.body);
  }
  return nativeFetch(input, init);
};

// Downloads (relatórios Excel/CSV): usa o recurso de download da página publicada
window.__aldeiaSave = async (blob, filename) => {
  const downloads = window.claude?.use ? await window.claude.use('downloads') : null;
  if (downloads) {
    try { await downloads.save({ filename, data: blob }); } catch (e) {
      if (e?.code === 'declined') return;
      throw new Error(e?.message || 'Não foi possível salvar o arquivo.');
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};

const TestRouter = ({ children }) => <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
const extraRoutes = <Route path="guia-de-testes" element={<TestGuide />} />;

function Boot() {
  const [state, setState] = useState({ phase: 'loading', msg: 'Preparando o ambiente de testes…' });
  useEffect(() => {
    boot((msg) => setState({ phase: 'loading', msg }))
      .then((info) => { window.__ALDEIA_TESTE__.persistent = info.persistent; setState({ phase: 'ready' }); })
      .catch((e) => { console.error(e); setState({ phase: 'error', msg: e?.message || String(e) }); });
  }, []);
  if (state.phase === 'ready') {
    return <App Router={TestRouter} extraRoutes={extraRoutes} />;
  }
  return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', background: '#111111', color: '#FFFFFF', borderLeft: '6px solid #FFC20E' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: '#FFC20E', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 32 32" width="28" height="28"><path d="M7 23 16 8l9 15" stroke="#111111" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="19" r="2" fill="#111111" /></svg>
        </div>
        <p style={{ fontWeight: 800, fontSize: 20, fontFamily: 'Archivo, system-ui, sans-serif' }}>Aldeia Reativa · versão de testes</p>
        {state.phase === 'loading' ? (
          <p style={{ color: '#C8C8C8', marginTop: 8 }}>{state.msg}<br /><small>Na primeira abertura leva alguns segundos.</small></p>
        ) : (
          <div style={{ marginTop: 12, color: '#F2857B', fontSize: 14 }}>
            <p>Não foi possível iniciar o banco de dados de testes neste navegador.</p>
            <p style={{ color: '#C8C8C8', marginTop: 8 }}>{state.msg}</p>
            <p style={{ color: '#C8C8C8', marginTop: 8 }}>Tente recarregar a página ou abrir no Chrome ou Edge atualizados.</p>
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Boot />);
