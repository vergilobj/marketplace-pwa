import { useMemo } from 'react';

export function useAuth() {
  const token = localStorage.getItem('accessToken');

  const user = useMemo(() => {
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return {
        id: payload.sub,
        role: payload.role,
      };
    } catch {
      return null;
    }
  }, [token]);

  return {
    user,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'ADMIN',
    isSeller: user?.role === 'SELLER',
    isBuyer: user?.role === 'BUYER',
  };
}