import { useMemo } from 'react';

export function useAuth() {
  const token = localStorage.getItem('accessToken');

  const user = useMemo(() => {
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        // Token expired — clean up
        localStorage.removeItem('accessToken');
        return null;
      }
      return {
        id: payload.sub,
        role: payload.role,
      };
    } catch {
      localStorage.removeItem('accessToken');
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
