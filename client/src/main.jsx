import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import './styles.css';
import { AuthProvider, ProductProvider, useAuth } from './lib/context.jsx';
import { ToastProvider, Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Login, ForgotPassword, ResetPassword, ChangePassword } from './pages/Auth.jsx';
import Overview from './pages/Overview.jsx';
import Operation from './pages/Operation.jsx';
import { Products, ProductDetail } from './pages/Products.jsx';
import Campaigns from './pages/Campaigns.jsx';
import CampaignForm from './pages/CampaignForm.jsx';
import CampaignDetail from './pages/CampaignDetail.jsx';
import { Contacts, ContactDetail } from './pages/Contacts.jsx';
import Followups from './pages/Followups.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Reports from './pages/Reports.jsx';
import { Imports, ImportWizard } from './pages/Imports.jsx';
import SettingsPage from './pages/Settings.jsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, staleTime: 15000, retry: (n, e) => n < 1 && ![401, 403, 404].includes(e?.status) },
  },
});

function AppRoutes() {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <Routes>
        <Route path="/esqueci-senha" element={<ForgotPassword />} />
        <Route path="/redefinir-senha" element={<ResetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  if (user.mustChangePassword) return <ChangePassword forced />;
  return (
    <ProductProvider>
      <Routes>
        <Route path="/redefinir-senha" element={<ResetPassword />} />
        <Route element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="operacao" element={<Operation />} />
          <Route path="produtos" element={<Products />} />
          <Route path="produtos/:id" element={<ProductDetail />} />
          <Route path="campanhas" element={<Campaigns />} />
          {isAdmin && <Route path="campanhas/nova" element={<CampaignForm />} />}
          {isAdmin && <Route path="campanhas/:id/editar" element={<CampaignForm />} />}
          <Route path="campanhas/:id" element={<CampaignDetail />} />
          <Route path="contatos" element={<Contacts />} />
          <Route path="contatos/:id" element={<ContactDetail />} />
          <Route path="followups" element={<Followups />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="relatorios" element={<Reports />} />
          {isAdmin && <Route path="importacoes" element={<Imports />} />}
          {isAdmin && <Route path="importacoes/:id" element={<ImportWizard />} />}
          <Route path="configuracoes" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ProductProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
