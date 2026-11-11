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
  branches?: any[];
  active_branch_id?: string | null;
  is_sales_rep?: boolean;
  sales_rep?: { id: string; code?: string | null; status?: string; commission_percent?: number } | null;
};

export type BranchOption = {
  id: string;
  name: string;
  code: string;
  is_active?: boolean;
};

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  loadingBranch: boolean;
  isAuthenticated: boolean;
  permissions: string[];
  branches: BranchOption[];
  activeBranchId: string | null;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  setUser: (user: AuthUser) => void;
  switchBranch: (branchId: string) => Promise<void>;
  can: (...codes: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function normalizeBranches(raw: any): BranchOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    is_active: b.is_active !== false
  }));
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<AuthUser | null>(() => storage.getUser<AuthUser>());
  const [token, setToken] = useState<string | null>(() => storage.getToken());
  const [permissions, setPermissions] = useState<string[]>(
    () => storage.getUser<AuthUser>()?.permissions || []
  );
  const [branches, setBranches] = useState<BranchOption[]>(() =>
    normalizeBranches(storage.getUser<AuthUser>()?.branches)
  );
  const [activeBranchId, setActiveBranchId] = useState<string | null>(
    () => storage.getActiveBranchId() || storage.getUser<AuthUser>()?.active_branch_id || null
  );
  const [loading, setLoading] = useState(true);
  const [loadingBranch, setLoadingBranch] = useState(false);
  const [branchEpoch, setBranchEpoch] = useState(0);

  const applySession = useCallback(
    (next: {
      user: AuthUser;
      token?: string;
      permissions?: string[];
      branches?: any[];
      active_branch_id?: string | null;
      is_sales_rep?: boolean;
      sales_rep?: AuthUser['sales_rep'];
    }) => {
      const branchList = normalizeBranches(next.branches ?? next.user.branches);
      const active =
        next.active_branch_id ||
        next.user.active_branch_id ||
        branchList[0]?.id ||
        null;
      const merged = {
        ...next.user,
        permissions: next.permissions || next.user.permissions || [],
        branches: branchList,
        active_branch_id: active,
        is_sales_rep: Boolean(
          next.is_sales_rep ?? next.user.is_sales_rep ?? next.sales_rep?.id ?? next.user.sales_rep?.id
        ),
        sales_rep: next.sales_rep ?? next.user.sales_rep ?? null
      };
      storage.setUser(merged);
      if (next.token) {
        storage.setToken(next.token);
        setToken(next.token);
      }
      storage.setActiveBranchId(active);
      setUserState(merged);
      setPermissions(merged.permissions || []);
      setBranches(branchList);
      setActiveBranchId(active);
      return merged;
    },
    []
  );

  useEffect(() => {
    const boot = async () => {
      const savedToken = storage.getToken();
      if (!savedToken) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.auth.me();
        applySession({
          user: me,
          permissions: me.permissions,
          branches: me.branches,
          active_branch_id: me.active_branch_id || storage.getActiveBranchId(),
          is_sales_rep: me.is_sales_rep,
          sales_rep: me.sales_rep
        });
      } catch {
        storage.clearAuth();
        setUserState(null);
        setToken(null);
        setPermissions([]);
        setBranches([]);
        setActiveBranchId(null);
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, [applySession]);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await api.auth.login(username, password);
      return applySession({
        user: { ...result.user, business: result.business },
        token: result.token,
        permissions: result.permissions,
        branches: result.branches,
        active_branch_id: result.active_branch_id,
        is_sales_rep: result.is_sales_rep,
        sales_rep: result.sales_rep
      });
    },
    [applySession]
  );

  const logout = useCallback(() => {
    storage.clearAuth();
    setToken(null);
    setUserState(null);
    setPermissions([]);
    setBranches([]);
    setActiveBranchId(null);
  }, []);

  const setUser = useCallback((next: AuthUser) => {
    setUserState(next);
    storage.setUser(next);
  }, []);

  const switchBranch = useCallback(
    async (branchId: string) => {
      if (!branchId || branchId === activeBranchId) return;
      setLoadingBranch(true);
      try {
        const result = await api.auth.switchBranch(branchId);
        storage.setToken(result.token);
        storage.setActiveBranchId(result.active_branch_id);
        setToken(result.token);
        setActiveBranchId(result.active_branch_id);
        setBranches(normalizeBranches(result.branches));
        setUserState((prev) => {
          const merged = {
            ...(prev || ({} as AuthUser)),
            active_branch_id: result.active_branch_id,
            branches: normalizeBranches(result.branches)
          };
          storage.setUser(merged);
          return merged;
        });
        setBranchEpoch((n) => n + 1);
        // Force remount of branch-scoped views via hash bump
        const hash = window.location.hash || '#/dashboard';
        window.location.hash = hash.includes('?')
          ? `${hash.split('?')[0]}?b=${Date.now()}`
          : `${hash}?b=${Date.now()}`;
      } finally {
        setLoadingBranch(false);
      }
    },
    [activeBranchId]
  );

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
      loadingBranch,
      isAuthenticated: Boolean(user && token),
      permissions,
      branches,
      activeBranchId,
      login,
      logout,
      setUser,
      switchBranch,
      can,
      // expose epoch indirectly via activeBranchId changes for consumers
      ...(branchEpoch >= 0 ? {} : {})
    }),
    [
      user,
      token,
      loading,
      loadingBranch,
      permissions,
      branches,
      activeBranchId,
      login,
      logout,
      setUser,
      switchBranch,
      can,
      branchEpoch
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}
