import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { api } from '../utils/api';
import { storage } from '../utils/storage';

export type AuthUser = {
  id: string;
  business_id?: string;
  username: string;
  full_name: string;
  role: string;
  email?: string;
  permissions?: string[];
  business?: any;
};

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  permissions: string[];
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  setUser: (user: AuthUser) => void;
  can: (...codes: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<AuthUser | null>(() => storage.getUser<AuthUser>());
  const [token, setToken] = useState<string | null>(() => storage.getToken());
  const [permissions, setPermissions] = useState<string[]>(
    () => storage.getUser<AuthUser>()?.permissions || []
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const boot = async () => {
      const savedToken = storage.getToken();
      if (!savedToken) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.auth.me();
        setUserState(me);
        setPermissions(me.permissions || []);
        storage.setUser(me);
        setToken(savedToken);
      } catch {
        storage.clearAuth();
        setUserState(null);
        setToken(null);
        setPermissions([]);
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.auth.login(username, password);
    const nextUser = { ...result.user, permissions: result.permissions, business: result.business };
    storage.setToken(result.token);
    storage.setUser(nextUser);
    setToken(result.token);
    setUserState(nextUser);
    setPermissions(result.permissions || []);
    return nextUser;
  }, []);

  const logout = useCallback(() => {
    storage.clearAuth();
    setToken(null);
    setUserState(null);
    setPermissions([]);
  }, []);

  const setUser = useCallback((next: AuthUser) => {
    setUserState(next);
    storage.setUser(next);
  }, []);

  const can = useCallback(
    (...codes: string[]) => {
      if (!codes.length) return true;
      if (user?.role === 'business_owner') return true;
      return codes.some((c) => permissions.includes(c));
    },
    [permissions, user?.role]
  );

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      isAuthenticated: Boolean(user && token),
      permissions,
      login,
      logout,
      setUser,
      can
    }),
    [user, token, loading, permissions, login, logout, setUser, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}
