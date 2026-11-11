const TOKEN_KEY = 'tradestratix_token';
const USER_KEY = 'tradestratix_user';
const BRANCH_KEY = 'tradestratix_active_branch';

export const storage = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  getUser<T>(): T | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setUser(user: unknown) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  getActiveBranchId(): string | null {
    return localStorage.getItem(BRANCH_KEY);
  },
  setActiveBranchId(id: string | null) {
    if (!id) localStorage.removeItem(BRANCH_KEY);
    else localStorage.setItem(BRANCH_KEY, id);
  },
  clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(BRANCH_KEY);
  }
};
