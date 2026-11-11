import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/auth/me'), staleTime: 60000 });
  useEffect(() => {
    const expired = () => { qc.clear(); refetch(); };
    const must = () => refetch();
    window.addEventListener('auth:expired', expired);
    window.addEventListener('auth:must-change', must);
    return () => { window.removeEventListener('auth:expired', expired); window.removeEventListener('auth:must-change', must); };
  }, [qc, refetch]);
  const value = useMemo(() => ({
    user: data?.user || null,
    loading: isLoading,
    isAdmin: data?.user?.role === 'admin',
    refresh: refetch,
    logout: async () => { await api.post('/auth/logout'); qc.clear(); await refetch(); },
  }), [data, isLoading, refetch, qc]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);

// Produto selecionado globalmente (preferência de navegação, guardada só neste navegador)
const ProductCtx = createContext(null);
const KEY = 'aldeia-reativa:produto';
export function ProductProvider({ children }) {
  const [productId, setProductIdState] = useState(() => {
    try { return Number(localStorage.getItem(KEY)) || null; } catch { return null; }
  });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: () => api.get('/products'), staleTime: 300000 });
  const setProductId = (id) => {
    setProductIdState(id || null);
    try { if (id) localStorage.setItem(KEY, String(id)); else localStorage.removeItem(KEY); } catch { /* sem armazenamento */ }
  };
  const valid = productId && products.some((p) => p.id === productId) ? productId : null;
  const product = products.find((p) => p.id === valid) || null;
  return <ProductCtx.Provider value={{ productId: valid, product, products, setProductId }}>{children}</ProductCtx.Provider>;
}
export const useProduct = () => useContext(ProductCtx);
