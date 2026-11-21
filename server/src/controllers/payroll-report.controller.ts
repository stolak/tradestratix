import type { Request, Response, NextFunction } from 'express';
import * as report from '../services/payroll-report.service.js';

export async function payslip(req: Request, res: Response, next: NextFunction) {
  try {
    const payrollItemId =
      typeof req.query.payroll_item_id === 'string'
        ? req.query.payroll_item_id
        : typeof req.params.itemId === 'string'
          ? req.params.itemId
          : undefined;
    const runId = typeof req.query.run_id === 'string' ? req.query.run_id : undefined;
    const employeeId =
      typeof req.query.employee_id === 'string' ? req.query.employee_id : undefined;
    return res.json(
      await report.getPayslip(req.user!, { payrollItemId, runId, employeeId })
    );
  } catch (err) {
    return next(err);
  }
}

export async function runPayslips(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await report.listRunPayslips(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function periodReport(req: Request, res: Response, next: NextFunction) {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    return res.json(
      await report.getPeriodReport(req.user!, {
        year,
        month,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        branchId: typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined,
        allowConsolidated:
          req.query.consolidated === '1' || req.query.consolidated === 'true'
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function employeeYtd(req: Request, res: Response, next: NextFunction) {
  try {
    const year = Number(req.query.year || new Date().getFullYear());
    return res.json(
      await report.getEmployeeYtd(req.user!, req.params.employeeId, year)
    );
  } catch (err) {
    return next(err);
  }
}
