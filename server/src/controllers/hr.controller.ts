import type { Request, Response, NextFunction } from 'express';
import * as hrService from '../services/hr.service.js';

function branchListOpts(req: Request) {
  return {
    branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
    allowConsolidated: req.query.consolidated === '1' || req.query.consolidated === 'true'
  };
}

export async function listEmployees(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await hrService.listEmployees(req.user!, status, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

export async function createEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await hrService.createEmployee(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateEmployee(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await hrService.updateEmployee(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listDepartments(req: Request, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    return res.json(await hrService.listDepartments(req.user!, activeOnly));
  } catch (err) {
    return next(err);
  }
}

export async function createDepartment(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await hrService.createDepartment(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateDepartment(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await hrService.updateDepartment(req.user!, req.params.id, req.body || {})
    );
  } catch (err) {
    return next(err);
  }
}

export async function resendEmployeeInvite(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await hrService.resendEmployeePasswordInvite(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(
      await hrService.listAttendance(req.user!, {
        employee_id:
          typeof req.query.employee_id === 'string' ? req.query.employee_id : undefined,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        ...branchListOpts(req)
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function upsertAttendance(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await hrService.upsertAttendance(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    return res.json(await hrService.listLeave(req.user!, status, branchListOpts(req)));
  } catch (err) {
    return next(err);
  }
}

export async function createLeave(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await hrService.createLeave(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function approveLeave(req: Request, res: Response, next: NextFunction) {
  try {
    const body = { ...(req.body || {}) };
    if (body.status == null && body.approve != null) {
      body.status = body.approve === false || body.reject === true ? 'rejected' : 'approved';
    }
    return res.json(await hrService.approveLeave(req.user!, req.params.id, body));
  } catch (err) {
    return next(err);
  }
}
