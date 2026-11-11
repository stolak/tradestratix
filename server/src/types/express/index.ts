export type AuthUser = {
  id: string;
  businessId: string;
  username: string;
  fullName: string;
  role: string;
  email?: string | null;
  department?: string | null;
  defaultBranchId?: string | null;
  activeBranchId?: string | null;
  branchIds?: string[];
  permissions?: string[];
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
