import type { Request, Response, NextFunction } from 'express';
import * as cfg from '../services/payroll-config.service.js';

export async function ensureDefaults(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.ensurePayrollDefaults(req.user!));
  } catch (err) {
    return next(err);
  }
}

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.getPayrollConfigSummary(req.user!));
  } catch (err) {
    return next(err);
  }
}

export async function listComponents(req: Request, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    return res.json(await cfg.listComponents(req.user!, activeOnly));
  } catch (err) {
    return next(err);
  }
}

export async function createComponent(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await cfg.createComponent(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateComponent(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.updateComponent(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listGrades(req: Request, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.query.active === '1' || req.query.active === 'true';
    return res.json(await cfg.listPayGrades(req.user!, activeOnly));
  } catch (err) {
    return next(err);
  }
}

export async function createGrade(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await cfg.createPayGrade(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateGrade(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.updatePayGrade(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listChart(req: Request, res: Response, next: NextFunction) {
  try {
    const stepRaw = typeof req.query.step === 'string' ? Number(req.query.step) : undefined;
    return res.json(
      await cfg.listChartEntries(req.user!, {
        payGradeId: typeof req.query.pay_grade_id === 'string' ? req.query.pay_grade_id : undefined,
        employmentType:
          typeof req.query.employment_type === 'string' ? req.query.employment_type : undefined,
        step: stepRaw != null && Number.isFinite(stepRaw) ? stepRaw : undefined
      })
    );
  } catch (err) {
    return next(err);
  }
}

export async function upsertChart(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.upsertChartEntry(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function deleteChart(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.deleteChartEntry(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}

export async function listStatutory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.listStatutoryRules(req.user!));
  } catch (err) {
    return next(err);
  }
}

export async function upsertStatutory(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.upsertStatutoryRule(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function getPeriod(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.getActivePeriod(req.user!));
  } catch (err) {
    return next(err);
  }
}

export async function setPeriod(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.setActivePeriod(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listPackage(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.listEmployeePackage(req.user!, req.params.employeeId));
  } catch (err) {
    return next(err);
  }
}

export async function upsertPackage(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.upsertEmployeePackageLine(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function listOverrides(req: Request, res: Response, next: NextFunction) {
  try {
    const employeeId =
      typeof req.query.employee_id === 'string' ? req.query.employee_id : undefined;
    return res.json(await cfg.listEmployeeOverrides(req.user!, employeeId));
  } catch (err) {
    return next(err);
  }
}

export async function createOverride(req: Request, res: Response, next: NextFunction) {
  try {
    return res.status(201).json(await cfg.createEmployeeOverride(req.user!, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function updateOverride(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.updateEmployeeOverride(req.user!, req.params.id, req.body || {}));
  } catch (err) {
    return next(err);
  }
}

export async function deleteOverride(req: Request, res: Response, next: NextFunction) {
  try {
    return res.json(await cfg.deleteEmployeeOverride(req.user!, req.params.id));
  } catch (err) {
    return next(err);
  }
}
