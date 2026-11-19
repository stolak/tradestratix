import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { alertError, alertSuccess } from '../utils/alerts';

type Tab =
  | 'dashboard'
  | 'register'
  | 'categories'
  | 'locations'
  | 'depreciate'
  | 'operations'
  | 'accounting'
  | 'verify'
  | 'budgets';
type DashSub = 'overview' | 'register' | 'reconcile' | 'depreciation';
type OpsSub = 'transfers' | 'maintenance' | 'cover';
type AcctSub = 'cip' | 'impairment' | 'revaluation' | 'disposal' | 'components';

export const AssetsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashSub, setDashSub] = useState<DashSub>('overview');
  const [dashboard, setDashboard] = useState<any | null>(null);
  const [registerReport, setRegisterReport] = useState<any | null>(null);
  const [glRecon, setGlRecon] = useState<any | null>(null);
  const [depSummary, setDepSummary] = useState<any | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [acquisitions, setAcquisitions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [deps, setDeps] = useState<any[]>([]);
  const [depRuns, setDepRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [depPeriod, setDepPeriod] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  );
  const [budgets, setBudgets] = useState<any[]>([]);
  const [glAccounts, setGlAccounts] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [vsActual, setVsActual] = useState<any | null>(null);
  const [opsSub, setOpsSub] = useState<OpsSub>('transfers');
  const [transfers, setTransfers] = useState<any[]>([]);
  const [maintRequests, setMaintRequests] = useState<any[]>([]);
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [insurances, setInsurances] = useState<any[]>([]);
  const [warranties, setWarranties] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [transferForm, setTransferForm] = useState({
    asset_id: '',
    to_branch_id: '',
    to_location_id: '',
    reason: ''
  });
  const [maintForm, setMaintForm] = useState({
    asset_id: '',
    title: '',
    priority: 'medium',
    description: ''
  });
  const [coverForm, setCoverForm] = useState({
    kind: 'insurance' as 'insurance' | 'warranty',
    asset_id: '',
    name: '',
    number: '',
    start_date: '',
    end_date: ''
  });
  const [acctSub, setAcctSub] = useState<AcctSub>('cip');
  const [capitalProjects, setCapitalProjects] = useState<any[]>([]);
  const [impairments, setImpairments] = useState<any[]>([]);
  const [revaluations, setRevaluations] = useState<any[]>([]);
  const [disposals, setDisposals] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [cipForm, setCipForm] = useState({ name: '', cost_amount: '', funding_method: 'equity' });
  const [impForm, setImpForm] = useState({ asset_id: '', amount: '', reason: '' });
  const [revalForm, setRevalForm] = useState({ asset_id: '', new_carrying_amount: '', reason: '' });
  const [dispForm, setDispForm] = useState({
    asset_id: '',
    disposal_type: 'scrap',
    proceeds: '0',
    bank_account_id: '',
    reason: ''
  });
  const [compForm, setCompForm] = useState({ parent_asset_id: '', name: '', cost_amount: '' });
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<any | null>(null);
  const [verifyForm, setVerifyForm] = useState({ name: '', location_id: '', branch_id: '' });
  const [scanForm, setScanForm] = useState({ scanned_code: '', found_location_id: '' });

  const FUNDING_BY_SOURCE: Record<string, { value: string; label: string }[]> = {
    direct: [
      { value: 'bank', label: 'Bank' },
      { value: 'cash', label: 'Cash' },
      { value: 'credit', label: 'Credit / payable' }
    ],
    opening_balance: [{ value: 'opening', label: 'Opening equity' }],
    donation: [
      { value: 'donation', label: 'Donation / capital contribution' },
      { value: 'equity', label: 'Equity' }
    ],
    other: [
      { value: 'bank', label: 'Bank' },
      { value: 'cash', label: 'Cash' },
      { value: 'credit', label: 'Credit / payable' },
      { value: 'equity', label: 'Equity' }
    ]
  };
  const [nameFilter, setNameFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editForm, setEditForm] = useState({
    department: '',
    condition: 'good',
    location_id: '',
    notes: ''
  });
  const [acqForm, setAcqForm] = useState({
    asset_name: '',
    manufacturer: '',
    model: '',
    category_id: '',
    location_id: '',
    acquisition_date: new Date().toISOString().slice(0, 10),
    quantity: '1',
    unit_cost: '',
    salvage_value: '0',
    useful_life_months: '36',
    source: 'direct',
    funding_method: 'bank',
    bank_account_id: '',
    supplier_id: '',
    serial_numbers_text: '',
    notes: ''
  });
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const emptyCategoryForm = {
    code: '',
    name: '',
    default_useful_life_months: '36',
    default_depreciation_method: 'straight_line',
    capitalisation_threshold: '0',
    cost_account_id: '',
    accum_dep_account_id: '',
    dep_expense_account_id: '',
    is_active: true
  };
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [locationForm, setLocationForm] = useState({ code: '', name: '', description: '' });
  const [budgetForm, setBudgetForm] = useState({
    name: '',
    fiscal_year: String(new Date().getFullYear()),
    asset_category_id: '',
    amount: ''
  });

  const load = async () => {
    try {
      const [
        a,
        acqs,
        cats,
        locs,
        d,
        runs,
        b,
        gl,
        banks,
        sups,
        xfers,
        mreqs,
        wos,
        ins,
        wars,
        br,
        cips,
        imps,
        revs,
        disps,
        comps,
        camps,
        dash,
        regRpt,
        recon,
        depSum
      ] = await Promise.all([
          api.assets.list({
            q: nameFilter || undefined,
            category_id: categoryFilter || undefined
          }),
          api.assets.acquisitions().catch(() => []),
          api.assets.categories().catch(() => []),
          api.assets.locations().catch(() => []),
          api.assets.depreciationEntries().catch(() => []),
          api.assets.depreciationRuns().catch(() => []),
          api.budgets.list(),
          api.accounting.accounts(),
          api.banking.accounts().catch(() => []),
          api.suppliers.list().catch(() => []),
          api.assets.transfers().catch(() => []),
          api.assets.maintenanceRequests().catch(() => []),
          api.assets.workOrders().catch(() => []),
          api.assets.insurances().catch(() => []),
          api.assets.warranties().catch(() => []),
          api.branches.list().catch(() => []),
          api.assets.capitalProjects().catch(() => []),
          api.assets.impairments().catch(() => []),
          api.assets.revaluations().catch(() => []),
          api.assets.disposals().catch(() => []),
          api.assets.components().catch(() => []),
          api.assets.verificationCampaigns().catch(() => []),
          api.assets.dashboard().catch(() => null),
          api.assets.registerReport().catch(() => null),
          api.assets.glReconciliation().catch(() => null),
          api.assets.depreciationSummary().catch(() => null)
        ]);
      setAssets(a);
      setAcquisitions(acqs);
      setCategories(cats);
      setDepRuns(Array.isArray(runs) ? runs : []);
      setLocations(locs);
      setDeps(d);
      setBudgets(b);
      setTransfers(Array.isArray(xfers) ? xfers : []);
      setMaintRequests(Array.isArray(mreqs) ? mreqs : []);
      setWorkOrders(Array.isArray(wos) ? wos : []);
      setInsurances(Array.isArray(ins) ? ins : []);
      setWarranties(Array.isArray(wars) ? wars : []);
      setBranches(Array.isArray(br) ? br : []);
      setCapitalProjects(Array.isArray(cips) ? cips : []);
      setImpairments(Array.isArray(imps) ? imps : []);
      setRevaluations(Array.isArray(revs) ? revs : []);
      setDisposals(Array.isArray(disps) ? disps : []);
      setComponents(Array.isArray(comps) ? comps : []);
      setCampaigns(Array.isArray(camps) ? camps : []);
      setDashboard(dash || null);
      setRegisterReport(regRpt || null);
      setGlRecon(recon || null);
      setDepSummary(depSum || null);
      const activeBanks = (banks || []).filter((x: any) => x.is_active !== false);
      setBankAccounts(activeBanks);
      setSuppliers(sups || []);
      const activeGl = gl.filter((x: any) => x.is_active !== false);
      setGlAccounts(activeGl);
      const expense =
        activeGl.find((x: any) => x.code === '6400') ||
        activeGl.find((x: any) => x.account_type === 'expense');
      const fa =
        activeGl.find((x: any) => x.code === '1200') ||
        activeGl.find((x: any) => x.account_type === 'asset');
      const accum =
        activeGl.find((x: any) => /accum/i.test(x.name) && x.account_type === 'asset') || fa;
      setCategoryForm((f) => ({
        ...f,
        cost_account_id: f.cost_account_id || fa?.id || '',
        accum_dep_account_id: f.accum_dep_account_id || accum?.id || '',
        dep_expense_account_id: f.dep_expense_account_id || expense?.id || ''
      }));
      setAcqForm((f) => ({
        ...f,
        category_id: f.category_id || cats[0]?.id || '',
        bank_account_id: f.bank_account_id || activeBanks[0]?.id || '',
        supplier_id: f.supplier_id || (sups || [])[0]?.id || ''
      }));
    } catch (e: any) {
      await alertError('Assets', e.message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createAcquisition = async (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = Math.max(1, Math.floor(Number(acqForm.quantity) || 1));
    try {
      await api.assets.createAcquisition({
        asset_name: acqForm.asset_name,
        manufacturer: acqForm.manufacturer || undefined,
        model: acqForm.model || acqForm.asset_name,
        category_id: acqForm.category_id || undefined,
        location_id: acqForm.location_id || undefined,
        acquisition_date: acqForm.acquisition_date,
        quantity,
        unit_cost: Number(acqForm.unit_cost),
        salvage_value: Number(acqForm.salvage_value),
        useful_life_months: Number(acqForm.useful_life_months),
        source: acqForm.source,
        funding_method: acqForm.funding_method,
        bank_account_id:
          acqForm.funding_method === 'bank' || acqForm.funding_method === 'cash'
            ? acqForm.bank_account_id || undefined
            : undefined,
        supplier_id:
          acqForm.funding_method === 'credit' ? acqForm.supplier_id || undefined : undefined,
        serial_numbers_text: acqForm.serial_numbers_text || undefined,
        notes: acqForm.notes || undefined
      });
      await alertSuccess(
        quantity > 1 ? `Draft created for ${quantity} units` : 'Acquisition draft created'
      );
      setAcqForm((f) => ({
        ...f,
        asset_name: '',
        manufacturer: '',
        model: '',
        unit_cost: '',
        serial_numbers_text: '',
        notes: '',
        quantity: '1'
      }));
      await load();
    } catch (err: any) {
      await alertError('Acquisition failed', err.message);
    }
  };

  const acqQty = Math.max(1, Math.floor(Number(acqForm.quantity) || 1));
  const acqUnit = Number(acqForm.unit_cost) || 0;
  const acqLotTotal = acqUnit * acqQty;
  const serialLineCount = acqForm.serial_numbers_text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
  const fundingOptions = FUNDING_BY_SOURCE[acqForm.source] || FUNDING_BY_SOURCE.direct;

  const onAcqSourceChange = (source: string) => {
    const options = FUNDING_BY_SOURCE[source] || FUNDING_BY_SOURCE.direct;
    const fundingStillValid = options.some((o) => o.value === acqForm.funding_method);
    setAcqForm({
      ...acqForm,
      source,
      funding_method: fundingStillValid ? acqForm.funding_method : options[0].value
    });
  };

  const runAcqAction = async (
    id: string,
    action: 'submit' | 'approve' | 'capitalise' | 'cancel'
  ) => {
    try {
      if (action === 'submit') await api.assets.submitAcquisition(id);
      else if (action === 'approve') await api.assets.approveAcquisition(id);
      else if (action === 'capitalise') await api.assets.capitaliseAcquisition(id);
      else await api.assets.cancelAcquisition(id);
      const done =
        action === 'submit'
          ? 'submitted'
          : action === 'approve'
            ? 'approved'
            : action === 'capitalise'
              ? 'capitalised'
              : 'cancelled';
      await alertSuccess(`Acquisition ${done}`);
      await load();
    } catch (err: any) {
      await alertError(`Acquisition ${action} failed`, err.message);
    }
  };

  const resetCategoryForm = (defaults?: Partial<typeof emptyCategoryForm>) => {
    setSelectedCategoryId('');
    setCategoryForm({
      ...emptyCategoryForm,
      cost_account_id: defaults?.cost_account_id || categoryForm.cost_account_id || '',
      accum_dep_account_id: defaults?.accum_dep_account_id || categoryForm.accum_dep_account_id || '',
      dep_expense_account_id:
        defaults?.dep_expense_account_id || categoryForm.dep_expense_account_id || ''
    });
  };

  const selectCategory = (c: any) => {
    setSelectedCategoryId(c.id);
    setCategoryForm({
      code: c.code || '',
      name: c.name || '',
      default_useful_life_months: String(c.default_useful_life_months ?? 36),
      default_depreciation_method: c.default_depreciation_method || 'straight_line',
      capitalisation_threshold: String(c.capitalisation_threshold ?? 0),
      cost_account_id: c.cost_account_id || c.cost_account?.id || categoryForm.cost_account_id || '',
      accum_dep_account_id:
        c.accum_dep_account_id || c.accum_dep_account?.id || categoryForm.accum_dep_account_id || '',
      dep_expense_account_id:
        c.dep_expense_account_id ||
        c.dep_expense_account?.id ||
        categoryForm.dep_expense_account_id ||
        '',
      is_active: c.is_active !== false
    });
  };

  const saveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      code: categoryForm.code,
      name: categoryForm.name,
      default_useful_life_months: Number(categoryForm.default_useful_life_months),
      default_depreciation_method: categoryForm.default_depreciation_method,
      capitalisation_threshold: Number(categoryForm.capitalisation_threshold),
      cost_account_id: categoryForm.cost_account_id || undefined,
      accum_dep_account_id: categoryForm.accum_dep_account_id || undefined,
      dep_expense_account_id: categoryForm.dep_expense_account_id || undefined,
      is_active: categoryForm.is_active
    };
    try {
      if (selectedCategoryId) {
        await api.assets.updateCategory(selectedCategoryId, body);
        await alertSuccess('Category updated');
      } else {
        await api.assets.createCategory(body);
        await alertSuccess('Category created');
      }
      resetCategoryForm();
      await load();
    } catch (err: any) {
      await alertError('Category failed', err.message);
    }
  };

  const toggleCategoryActive = async (c: any) => {
    try {
      await api.assets.updateCategory(c.id, { is_active: c.is_active === false });
      await alertSuccess(c.is_active === false ? 'Category enabled' : 'Category disabled');
      if (selectedCategoryId === c.id) {
        setCategoryForm((f) => ({ ...f, is_active: c.is_active === false }));
      }
      await load();
    } catch (err: any) {
      await alertError('Update failed', err.message);
    }
  };

  const createLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.assets.createLocation(locationForm);
      await alertSuccess('Location created');
      setLocationForm({ code: '', name: '', description: '' });
      await load();
    } catch (err: any) {
      await alertError('Location failed', err.message);
    }
  };

  const selectAsset = (a: any) => {
    setSelectedId(a.id);
    setEditForm({
      department: a.department || '',
      condition: a.condition || 'good',
      location_id: a.location_id || a.location?.id || '',
      notes: a.notes || ''
    });
  };

  const saveAssetEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await api.assets.update(selectedId, {
        department: editForm.department || null,
        condition: editForm.condition,
        location_id: editForm.location_id || null,
        notes: editForm.notes || null
      });
      await alertSuccess('Asset updated');
      await load();
    } catch (err: any) {
      await alertError('Update failed', err.message);
    }
  };

  const previewDep = async () => {
    try {
      const run = await api.assets.previewDepreciation({ period_label: depPeriod });
      setSelectedRun(run);
      await alertSuccess(
        `Preview ${run.run_number}`,
        `${run.included_count || 0} included · ${Number(run.total_amount || 0).toLocaleString()}`
      );
      await load();
      setTab('depreciate');
    } catch (err: any) {
      await alertError('Preview failed', err.message);
    }
  };

  const openRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.getDepreciationRun(id));
    } catch (err: any) {
      await alertError('Load run failed', err.message);
    }
  };

  const approveDepRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.approveDepreciationRun(id));
      await alertSuccess('Run approved');
      await load();
    } catch (err: any) {
      await alertError('Approve failed', err.message);
    }
  };

  const postDepRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.postDepreciationRun(id));
      await alertSuccess('Depreciation posted');
      await load();
    } catch (err: any) {
      await alertError('Post failed', err.message);
    }
  };

  const reverseDepRun = async (id: string) => {
    try {
      setSelectedRun(await api.assets.reverseDepreciationRun(id));
      await alertSuccess('Run reversed');
      await load();
    } catch (err: any) {
      await alertError('Reverse failed', err.message);
    }
  };

  const createBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.budgets.create({
        name: budgetForm.name,
        fiscal_year: Number(budgetForm.fiscal_year),
        lines: [
          {
            asset_category_id: budgetForm.asset_category_id,
            period_no: 0,
            amount: Number(budgetForm.amount)
          }
        ]
      });
      await alertSuccess('Budget created');
      setBudgetForm((f) => ({ ...f, name: '', amount: '', asset_category_id: '' }));
      await load();
    } catch (err: any) {
      await alertError('Budget failed', err.message);
    }
  };

  const activate = async (id: string) => {
    try {
      await api.budgets.activate(id);
      await alertSuccess('Budget activated');
      await load();
    } catch (err: any) {
      await alertError('Activate failed', err.message);
    }
  };

  const showVs = async (id: string) => {
    try {
      setVsActual(await api.budgets.vsActual(id));
    } catch (err: any) {
      await alertError('Vs actual failed', err.message);
    }
  };

  const createTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.assets.createTransfer({
        to_branch_id: transferForm.to_branch_id || undefined,
        reason: transferForm.reason || undefined,
        lines: [
          {
            asset_id: transferForm.asset_id,
            to_location_id: transferForm.to_location_id || undefined
          }
        ]
      });
      await alertSuccess('Transfer draft created');
      setTransferForm({ asset_id: '', to_branch_id: '', to_location_id: '', reason: '' });
      await load();
    } catch (err: any) {
      await alertError('Transfer failed', err.message);
    }
  };

  const runTransferAction = async (
    id: string,
    action: 'submit' | 'approve' | 'dispatch' | 'receive' | 'cancel'
  ) => {
    try {
      if (action === 'submit') await api.assets.submitTransfer(id);
      else if (action === 'approve') await api.assets.approveTransfer(id);
      else if (action === 'dispatch') await api.assets.dispatchTransfer(id);
      else if (action === 'receive') await api.assets.receiveTransfer(id);
      else await api.assets.cancelTransfer(id);
      await alertSuccess(`Transfer ${action}`);
      await load();
    } catch (err: any) {
      await alertError('Transfer action failed', err.message);
    }
  };

  const createMaintRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const req = await api.assets.createMaintenanceRequest({
        asset_id: maintForm.asset_id,
        title: maintForm.title,
        priority: maintForm.priority,
        description: maintForm.description || undefined
      });
      await alertSuccess('Maintenance request created');
      setMaintForm({ asset_id: '', title: '', priority: 'medium', description: '' });
      await load();
      if (req?.id) {
        // keep listed
      }
    } catch (err: any) {
      await alertError('Request failed', err.message);
    }
  };

  const convertToWorkOrder = async (requestId: string) => {
    try {
      await api.assets.createWorkOrder({ request_id: requestId });
      await alertSuccess('Work order created');
      await load();
    } catch (err: any) {
      await alertError('Work order failed', err.message);
    }
  };

  const createCover = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (coverForm.kind === 'insurance') {
        await api.assets.createInsurance({
          asset_id: coverForm.asset_id,
          insurer_name: coverForm.name,
          policy_number: coverForm.number,
          start_date: coverForm.start_date,
          end_date: coverForm.end_date
        });
      } else {
        await api.assets.createWarranty({
          asset_id: coverForm.asset_id,
          provider_name: coverForm.name,
          warranty_number: coverForm.number || undefined,
          start_date: coverForm.start_date,
          end_date: coverForm.end_date
        });
      }
      await alertSuccess(coverForm.kind === 'insurance' ? 'Insurance added' : 'Warranty added');
      setCoverForm({
        kind: coverForm.kind,
        asset_id: '',
        name: '',
        number: '',
        start_date: '',
        end_date: ''
      });
      await load();
    } catch (err: any) {
      await alertError('Cover failed', err.message);
    }
  };

  const createCip = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const project = await api.assets.createCapitalProject({ name: cipForm.name });
      if (Number(cipForm.cost_amount) > 0) {
        await api.assets.addCapitalProjectCost(project.id, {
          amount: Number(cipForm.cost_amount),
          funding_method: cipForm.funding_method
        });
      }
      await alertSuccess('CIP project created');
      setCipForm({ name: '', cost_amount: '', funding_method: 'equity' });
      await load();
    } catch (err: any) {
      await alertError('CIP failed', err.message);
    }
  };

  const createImpairment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const row = await api.assets.createImpairment({
        asset_id: impForm.asset_id,
        amount: Number(impForm.amount),
        reason: impForm.reason || undefined
      });
      await api.assets.postImpairment(row.id);
      await alertSuccess('Impairment posted');
      setImpForm({ asset_id: '', amount: '', reason: '' });
      await load();
    } catch (err: any) {
      await alertError('Impairment failed', err.message);
    }
  };

  const createRevaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const row = await api.assets.createRevaluation({
        asset_id: revalForm.asset_id,
        new_carrying_amount: Number(revalForm.new_carrying_amount),
        reason: revalForm.reason || undefined
      });
      await api.assets.postRevaluation(row.id);
      await alertSuccess('Revaluation posted');
      setRevalForm({ asset_id: '', new_carrying_amount: '', reason: '' });
      await load();
    } catch (err: any) {
      await alertError('Revaluation failed', err.message);
    }
  };

  const createDisposal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const proceeds = Number(dispForm.proceeds || 0);
      if (proceeds > 0 && !dispForm.bank_account_id) {
        await alertError('Disposal', 'Select a bank/cash account when proceeds are greater than zero');
        return;
      }
      const row = await api.assets.createDisposal({
        asset_id: dispForm.asset_id,
        disposal_type: dispForm.disposal_type,
        proceeds,
        proceeds_method: proceeds > 0 ? 'bank' : 'none',
        bank_account_id: proceeds > 0 ? dispForm.bank_account_id : undefined,
        reason: dispForm.reason || undefined
      });
      await api.assets.submitDisposal(row.id);
      await api.assets.approveDisposal(row.id);
      await api.assets.postDisposal(row.id);
      await alertSuccess('Disposal posted');
      setDispForm({
        asset_id: '',
        disposal_type: 'scrap',
        proceeds: '0',
        bank_account_id: '',
        reason: ''
      });
      await load();
    } catch (err: any) {
      await alertError('Disposal failed', err.message);
    }
  };

  const createComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.assets.createComponent({
        parent_asset_id: compForm.parent_asset_id,
        name: compForm.name,
        cost_amount: Number(compForm.cost_amount || 0)
      });
      await alertSuccess('Component added');
      setCompForm({ parent_asset_id: '', name: '', cost_amount: '' });
      await load();
    } catch (err: any) {
      await alertError('Component failed', err.message);
    }
  };

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const row = await api.assets.createVerificationCampaign({
        name: verifyForm.name,
        location_id: verifyForm.location_id || undefined,
        branch_id: verifyForm.branch_id || undefined
      });
      await alertSuccess('Campaign created');
      setVerifyForm({ name: '', location_id: '', branch_id: '' });
      await load();
      const full = await api.assets.getVerificationCampaign(row.id);
      setSelectedCampaign(full);
    } catch (err: any) {
      await alertError('Campaign failed', err.message);
    }
  };

  const refreshCampaign = async (id: string) => {
    const full = await api.assets.getVerificationCampaign(id);
    setSelectedCampaign(full);
    await load();
  };

  const scanAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampaign?.id) return;
    try {
      const result = await api.assets.scanVerificationCampaign(selectedCampaign.id, {
        scanned_code: scanForm.scanned_code,
        found_location_id: scanForm.found_location_id || undefined
      });
      await alertSuccess(`Scan: ${result.status}`);
      setScanForm({ scanned_code: '', found_location_id: '' });
      await refreshCampaign(selectedCampaign.id);
    } catch (err: any) {
      await alertError('Scan failed', err.message);
    }
  };

  return (
    <div className="page-stack">
      <header>
        <h1 className="display" style={{ margin: 0, fontSize: '2.2rem' }}>
          Asset Management
        </h1>
        <p style={{ color: 'var(--ink-muted)', margin: '0.35rem 0 0' }}>
          Acquire → capitalise → depreciate; operations; CIP, impairment, revaluation and disposal.
        </p>
      </header>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(
          [
            ['dashboard', 'Dashboard'],
            ['register', 'Register'],
            ['categories', 'Categories'],
            ['locations', 'Locations'],
            ['depreciate', 'Depreciate'],
            ['operations', 'Operations'],
            ['accounting', 'Accounting'],
            ['verify', 'Verify'],
            ['budgets', 'Budgets']
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {tab === 'dashboard' ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['overview', 'Overview'],
                ['register', 'Register report'],
                ['reconcile', 'GL reconciliation'],
                ['depreciation', 'Depreciation summary']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={dashSub === key ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setDashSub(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {dashSub === 'overview' ? (
            <>
              <div
                className="card-surface"
                style={{
                  padding: '1.25rem',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 12
                }}
              >
                {[
                  ['Active assets', dashboard?.summary?.active_count],
                  ['Disposed', dashboard?.summary?.disposed_count],
                  ['Total cost', Number(dashboard?.summary?.total_cost || 0).toLocaleString()],
                  [
                    'Accum. dep.',
                    Number(dashboard?.summary?.accumulated_depreciation || 0).toLocaleString()
                  ],
                  [
                    'Accum. impairment',
                    Number(dashboard?.summary?.accumulated_impairment || 0).toLocaleString()
                  ],
                  ['NBV', Number(dashboard?.summary?.net_book_value || 0).toLocaleString()]
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>{label}</div>
                    <div style={{ fontWeight: 700, fontSize: '1.25rem' }}>{value ?? '—'}</div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  gap: 12
                }}
              >
                <div className="card-surface" style={{ padding: '1rem' }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Open workflows</div>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--ink-muted)' }}>
                    <li>Depreciation runs: {dashboard?.workflow?.open_depreciation_runs ?? 0}</li>
                    <li>CIP projects: {dashboard?.workflow?.open_cip_projects ?? 0}</li>
                    <li>Disposals: {dashboard?.workflow?.open_disposals ?? 0}</li>
                    <li>
                      Verification campaigns: {dashboard?.workflow?.open_verification_campaigns ?? 0}
                    </li>
                  </ul>
                </div>
                <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                  <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>By category</div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Count</th>
                          <th>Cost</th>
                          <th>NBV</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dashboard?.by_category || []).length ? (
                          (dashboard?.by_category || []).map((c: any) => (
                            <tr key={c.category_id || c.code}>
                              <td>
                                {c.code} — {c.name}
                              </td>
                              <td>{c.count}</td>
                              <td>{Number(c.cost).toLocaleString()}</td>
                              <td>{Number(c.nbv).toLocaleString()}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} style={{ color: 'var(--ink-muted)' }}>
                              No active assets yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {dashSub === 'register' ? (
            <div className="card-surface" style={{ padding: '0.5rem 0' }}>
              <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>
                Register report — total NBV{' '}
                {Number(registerReport?.totals?.net_book_value || 0).toLocaleString()}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Cost</th>
                      <th>Accum. dep.</th>
                      <th>NBV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(registerReport?.lines || []).length ? (
                      (registerReport?.lines || []).map((l: any) => (
                        <tr key={l.id}>
                          <td>{l.code || '—'}</td>
                          <td>{l.name}</td>
                          <td>{l.category?.name || '—'}</td>
                          <td>{l.financial_status}</td>
                          <td>{Number(l.cost).toLocaleString()}</td>
                          <td>{Number(l.accumulated_depreciation).toLocaleString()}</td>
                          <td>{Number(l.net_book_value).toLocaleString()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                          No register lines.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {dashSub === 'reconcile' ? (
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                GL reconciliation{' '}
                {glRecon?.balanced ? (
                  <span style={{ color: 'var(--success, #1a7f37)' }}>— balanced</span>
                ) : (
                  <span style={{ color: 'var(--danger, #b42318)' }}>
                    — max diff {Number(glRecon?.max_abs_difference || 0).toLocaleString()}
                  </span>
                )}
              </div>
              <p style={{ margin: '0 0 12px', color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                {glRecon?.note ||
                  'Register totals vs default asset account balances on the trial balance.'}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Account</th>
                      <th>Register</th>
                      <th>GL</th>
                      <th>Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(glRecon?.lines || []).map((l: any) => (
                      <tr key={l.key}>
                        <td>{l.label}</td>
                        <td>{l.account_code || '—'}</td>
                        <td>{Number(l.register_amount).toLocaleString()}</td>
                        <td>{Number(l.gl_amount).toLocaleString()}</td>
                        <td>{Number(l.difference).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {dashSub === 'depreciation' ? (
            <div className="card-surface" style={{ padding: '0.5rem 0' }}>
              <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>
                Depreciation — {depSummary?.period_label || '—'} · posted{' '}
                {Number(depSummary?.posted_total || 0).toLocaleString()}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Book</th>
                      <th>Status</th>
                      <th>Lines</th>
                      <th>Included</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(depSummary?.runs || []).length ? (
                      (depSummary?.runs || []).map((r: any) => (
                        <tr key={r.id}>
                          <td>{r.run_number || r.id?.slice(0, 8)}</td>
                          <td>{r.book?.name || r.book?.code || '—'}</td>
                          <td>{r.status}</td>
                          <td>{r.line_count}</td>
                          <td>{r.included_count}</td>
                          <td>{Number(r.total_amount).toLocaleString()}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                          No depreciation runs for this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'register' ? (
        <>
          <form
            onSubmit={createAcquisition}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>Add asset(s)</div>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
              Same model can be bought in bulk. Each unit becomes its own register line with a unique
              serial and auto tag (e.g. COMPUTER-2026-0001). Draft → submit → approve → capitalise;
              GL posts once for the lot on capitalise.
            </p>
            <div className="form-grid">
              <div className="field">
                <label>Asset name</label>
                <input
                  value={acqForm.asset_name}
                  onChange={(e) => setAcqForm({ ...acqForm, asset_name: e.target.value })}
                  placeholder="HP computer ProBook iCore 8 16G"
                  required
                />
              </div>
              <div className="field">
                <label>Manufacturer</label>
                <input
                  value={acqForm.manufacturer}
                  onChange={(e) => setAcqForm({ ...acqForm, manufacturer: e.target.value })}
                  placeholder="HP"
                />
              </div>
              <div className="field">
                <label>Model</label>
                <input
                  value={acqForm.model}
                  onChange={(e) => setAcqForm({ ...acqForm, model: e.target.value })}
                  placeholder="ProBook iCore 8 16G"
                />
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  value={acqForm.category_id}
                  onChange={(e) => setAcqForm({ ...acqForm, category_id: e.target.value })}
                >
                  <option value="">— None —</option>
                  {categories
                    .filter((c) => c.is_active !== false)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Location</label>
                <select
                  value={acqForm.location_id}
                  onChange={(e) => setAcqForm({ ...acqForm, location_id: e.target.value })}
                >
                  <option value="">— None —</option>
                  {locations
                    .filter((l) => l.is_active !== false)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Acquisition date</label>
                <input
                  type="date"
                  value={acqForm.acquisition_date}
                  onChange={(e) => setAcqForm({ ...acqForm, acquisition_date: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Quantity</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={acqForm.quantity}
                  onChange={(e) => setAcqForm({ ...acqForm, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Unit cost</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={acqForm.unit_cost}
                  onChange={(e) => setAcqForm({ ...acqForm, unit_cost: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Lot total</label>
                <input value={acqLotTotal ? acqLotTotal.toLocaleString() : '—'} readOnly />
              </div>
              <div className="field">
                <label>Salvage (per unit)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={acqForm.salvage_value}
                  onChange={(e) => setAcqForm({ ...acqForm, salvage_value: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Life (months)</label>
                <input
                  type="number"
                  min="1"
                  value={acqForm.useful_life_months}
                  onChange={(e) => setAcqForm({ ...acqForm, useful_life_months: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Source</label>
                <select value={acqForm.source} onChange={(e) => onAcqSourceChange(e.target.value)}>
                  <option value="direct">Direct</option>
                  <option value="opening_balance">Opening balance</option>
                  <option value="donation">Donation</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label>Funding</label>
                <select
                  value={acqForm.funding_method}
                  onChange={(e) => setAcqForm({ ...acqForm, funding_method: e.target.value })}
                >
                  {fundingOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {acqForm.funding_method === 'bank' || acqForm.funding_method === 'cash' ? (
                <div className="field">
                  <label>
                    {acqForm.funding_method === 'bank' ? 'Bank account' : 'Cash / till account'}
                    {acqForm.funding_method === 'cash' ? ' (optional)' : ''}
                  </label>
                  <select
                    value={acqForm.bank_account_id}
                    onChange={(e) => setAcqForm({ ...acqForm, bank_account_id: e.target.value })}
                    required={acqForm.funding_method === 'bank'}
                  >
                    {acqForm.funding_method === 'cash' ? (
                      <option value="">Default cash GL</option>
                    ) : (
                      <option value="">— Select bank —</option>
                    )}
                    {bankAccounts.map((ba) => (
                      <option key={ba.id} value={ba.id}>
                        {ba.name}
                        {ba.bank_name ? ` (${ba.bank_name})` : ''}
                        {ba.account_number ? ` · ${ba.account_number}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {acqForm.funding_method === 'credit' ? (
                <div className="field">
                  <label>Supplier</label>
                  <select
                    value={acqForm.supplier_id}
                    onChange={(e) => setAcqForm({ ...acqForm, supplier_id: e.target.value })}
                    required
                  >
                    <option value="">— Select supplier —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code ? `${s.code} — ` : ''}
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>
                  Serial numbers {acqQty > 1 ? `(required: ${acqQty} unique)` : '(optional)'}
                  {acqQty > 1 ? (
                    <span style={{ color: 'var(--ink-muted)', fontWeight: 400 }}>
                      {' '}
                      — {serialLineCount}/{acqQty} entered
                    </span>
                  ) : null}
                </label>
                <textarea
                  rows={Math.min(8, Math.max(3, acqQty))}
                  value={acqForm.serial_numbers_text}
                  onChange={(e) => setAcqForm({ ...acqForm, serial_numbers_text: e.target.value })}
                  placeholder={
                    acqQty > 1
                      ? 'Paste one serial per line\nSN001\nSN002\n…'
                      : 'Optional serial for this unit'
                  }
                  required={acqQty > 1}
                />
              </div>
              <div className="field">
                <label>Notes</label>
                <input
                  value={acqForm.notes}
                  onChange={(e) => setAcqForm({ ...acqForm, notes: e.target.value })}
                />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create draft{acqQty > 1 ? ` (${acqQty} units)` : ''}
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '1.25rem' }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Acquisition pipeline</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Asset</th>
                    <th className="num">Qty</th>
                    <th>Source</th>
                    <th className="num">Lot cost</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisitions.filter((r) => r.status !== 'capitalised' && r.status !== 'cancelled')
                    .length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--ink-muted)' }}>
                        No open acquisitions — capitalised assets show in the register below
                      </td>
                    </tr>
                  ) : (
                    acquisitions
                      .filter((r) => r.status !== 'capitalised' && r.status !== 'cancelled')
                      .map((row) => (
                        <tr key={row.id}>
                          <td>{row.acquisition_number}</td>
                          <td>
                            {row.asset_name}
                            {row.model ? (
                              <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
                                {row.manufacturer ? `${row.manufacturer} · ` : ''}
                                {row.model}
                              </div>
                            ) : null}
                          </td>
                          <td className="num">{row.quantity || 1}</td>
                          <td>
                            {row.source} / {row.funding_method}
                          </td>
                          <td className="num">
                            {Number(row.capitalised_cost ?? row.purchase_cost).toLocaleString()}
                          </td>
                          <td>{row.status}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {row.status === 'draft' ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'submit')}
                                  >
                                    Submit
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'cancel')}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : null}
                              {row.status === 'pending_approval' ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'approve')}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => void runAcqAction(row.id, 'cancel')}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : null}
                              {row.status === 'approved' ? (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={() => void runAcqAction(row.id, 'capitalise')}
                                >
                                  Capitalise
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card-surface" style={{ padding: '0.75rem 1rem', display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Asset register</div>
            <div className="form-grid">
              <div className="field" style={{ margin: 0 }}>
                <label>Filter by name / code</label>
                <input
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  onBlur={() => void load()}
                  placeholder="Search…"
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Filter by category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setTimeout(() => void load(), 0);
                  }}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid--actions">
                <button type="button" className="btn btn-ghost" onClick={() => void load()}>
                  Apply filters
                </button>
              </div>
            </div>
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Name</th>
                  <th>Serial</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th className="num">Cost</th>
                  <th className="num">Accum. dep.</th>
                  <th className="num">NBV</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => selectAsset(a)}
                    style={
                      selectedId === a.id
                        ? { background: 'color-mix(in srgb, var(--brand, #0f5c4c) 8%, transparent)', cursor: 'pointer' }
                        : { cursor: 'pointer' }
                    }
                  >
                    <td>{a.code || '—'}</td>
                    <td>
                      {a.name}
                      {a.model ? (
                        <div style={{ color: 'var(--ink-muted)', fontSize: '0.8rem' }}>
                          {[a.manufacturer, a.model].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td>{a.serial_number || '—'}</td>
                    <td>{a.asset_category?.name || a.category}</td>
                    <td>{a.location?.name || '—'}</td>
                    <td className="num">{Number(a.purchase_cost).toLocaleString()}</td>
                    <td className="num">{Number(a.accumulated_depreciation).toLocaleString()}</td>
                    <td className="num">{Number(a.net_book_value ?? 0).toLocaleString()}</td>
                    <td>{a.operational_status || a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {selectedId ? (
            <form onSubmit={saveAssetEdit} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
              <div style={{ fontWeight: 700 }}>
                Edit assignment — {assets.find((a) => a.id === selectedId)?.name}
              </div>
              <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                Financial balances cannot be edited here. Assignment changes are history-tracked.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label>Department</label>
                  <input
                    value={editForm.department}
                    onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Condition</label>
                  <select
                    value={editForm.condition}
                    onChange={(e) => setEditForm({ ...editForm, condition: e.target.value })}
                  >
                    <option value="new">New</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="damaged">Damaged</option>
                  </select>
                </div>
                <div className="field">
                  <label>Location</label>
                  <select
                    value={editForm.location_id}
                    onChange={(e) => setEditForm({ ...editForm, location_id: e.target.value })}
                  >
                    <option value="">— None —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <input
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  />
                </div>
                <div className="form-grid--actions">
                  <button className="btn btn-primary" type="submit">
                    Save changes
                  </button>
                </div>
              </div>
            </form>
          ) : null}
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <form onSubmit={saveCategory} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>
              {selectedCategoryId ? 'Edit asset category' : 'New asset category'}
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Code</label>
                <input value={categoryForm.code} onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })} required />
              </div>
              <div className="field">
                <label>Name</label>
                <input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Default life (months)</label>
                <input type="number" min="0" value={categoryForm.default_useful_life_months} onChange={(e) => setCategoryForm({ ...categoryForm, default_useful_life_months: e.target.value })} />
              </div>
              <div className="field">
                <label>Method</label>
                <select
                  value={categoryForm.default_depreciation_method}
                  onChange={(e) => {
                    const method = e.target.value;
                    setCategoryForm({
                      ...categoryForm,
                      default_depreciation_method: method,
                      default_useful_life_months:
                        method === 'none' ? '0' : categoryForm.default_useful_life_months === '0'
                          ? '36'
                          : categoryForm.default_useful_life_months
                    });
                  }}
                  required
                >
                  <option value="straight_line">Straight line</option>
                  <option value="reducing_balance">Reducing balance</option>
                  <option value="units_of_production">Units of production</option>
                  <option value="none">None (non-depreciable)</option>
                </select>
              </div>
              <div className="field">
                <label>Capitalisation threshold</label>
                <input type="number" min="0" step="0.01" value={categoryForm.capitalisation_threshold} onChange={(e) => setCategoryForm({ ...categoryForm, capitalisation_threshold: e.target.value })} />
              </div>
              <div className="field">
                <label>Cost account</label>
                <select value={categoryForm.cost_account_id} onChange={(e) => setCategoryForm({ ...categoryForm, cost_account_id: e.target.value })}>
                  {glAccounts.filter((a) => a.account_type === 'asset').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Accum. depreciation</label>
                <select value={categoryForm.accum_dep_account_id} onChange={(e) => setCategoryForm({ ...categoryForm, accum_dep_account_id: e.target.value })}>
                  {glAccounts.filter((a) => a.account_type === 'asset').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Depreciation expense</label>
                <select value={categoryForm.dep_expense_account_id} onChange={(e) => setCategoryForm({ ...categoryForm, dep_expense_account_id: e.target.value })}>
                  {glAccounts.filter((a) => a.account_type === 'expense').map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              {selectedCategoryId ? (
                <div className="field">
                  <label>Status</label>
                  <select
                    value={categoryForm.is_active ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, is_active: e.target.value === 'active' })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Disabled</option>
                  </select>
                </div>
              ) : null}
              <div className="form-grid--actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="submit">
                  {selectedCategoryId ? 'Update category' : 'Save category'}
                </button>
                {selectedCategoryId ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => resetCategoryForm()}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </div>
          </form>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Life</th>
                    <th>Method</th>
                    <th>Threshold</th>
                    <th>Active</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => selectCategory(c)}
                      style={
                        selectedCategoryId === c.id
                          ? {
                              background:
                                'color-mix(in srgb, var(--brand, #0f5c4c) 8%, transparent)',
                              cursor: 'pointer',
                              opacity: c.is_active === false ? 0.7 : 1
                            }
                          : { cursor: 'pointer', opacity: c.is_active === false ? 0.7 : 1 }
                      }
                    >
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{c.default_useful_life_months}</td>
                      <td>{c.default_depreciation_method}</td>
                      <td>{Number(c.capitalisation_threshold).toLocaleString()}</td>
                      <td>{c.is_active === false ? 'No' : 'Yes'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectCategory(c);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleCategoryActive(c);
                            }}
                          >
                            {c.is_active === false ? 'Enable' : 'Disable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'locations' ? (
        <>
          <form onSubmit={createLocation} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>New asset location</div>
            <div className="form-grid">
              <div className="field">
                <label>Code</label>
                <input value={locationForm.code} onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })} required />
              </div>
              <div className="field">
                <label>Name</label>
                <input value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Description</label>
                <input value={locationForm.description} onChange={(e) => setLocationForm({ ...locationForm, description: e.target.value })} />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">Save location</button>
              </div>
            </div>
          </form>
          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Branch</th>
                    <th>Active</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.id}>
                      <td>{l.code}</td>
                      <td>{l.name}</td>
                      <td>{l.branch?.code || '—'}</td>
                      <td>{l.is_active === false ? 'No' : 'Yes'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'depreciate' ? (
        <>
          <div
            className="card-surface"
            style={{ padding: '1.25rem', display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}
          >
            <div className="field">
              <label>Period (YYYY-MM)</label>
              <input value={depPeriod} onChange={(e) => setDepPeriod(e.target.value)} required />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void previewDep()}>
              Preview run
            </button>
            <span style={{ color: 'var(--ink-muted)', fontSize: 14 }}>
              Preview → approve → post. Methods: straight-line, reducing balance, units of production, none
              (land). Posted runs can be reversed.
            </span>
          </div>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Runs</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Included</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {depRuns.map((r) => (
                    <tr key={r.id}>
                      <td>{r.run_number}</td>
                      <td>{r.period_label}</td>
                      <td>{r.status}</td>
                      <td>{r.included_count}</td>
                      <td>{Number(r.total_amount).toLocaleString()}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-ghost" onClick={() => void openRun(r.id)}>
                          Open
                        </button>
                        {r.status === 'previewed' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void approveDepRun(r.id)}
                          >
                            Approve
                          </button>
                        ) : null}
                        {r.status === 'approved' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void postDepRun(r.id)}
                          >
                            Post
                          </button>
                        ) : null}
                        {r.status === 'posted' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => void reverseDepRun(r.id)}
                          >
                            Reverse
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!depRuns.length ? (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--ink-muted)' }}>
                        No depreciation runs yet
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {selectedRun ? (
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {selectedRun.run_number} — {selectedRun.period_label} ({selectedRun.status})
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedRun.lines || []).map((l: any) => (
                      <tr key={l.id}>
                        <td>
                          {l.asset?.code ? `${l.asset.code} — ` : ''}
                          {l.asset?.name || l.asset_id}
                        </td>
                        <td>{l.method}</td>
                        <td>{Number(l.amount).toLocaleString()}</td>
                        <td>{l.line_status}</td>
                        <td style={{ color: 'var(--ink-muted)', fontSize: 13 }}>
                          {l.exception_reason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Posted entries</div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Asset</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {deps.map((d) => (
                    <tr key={d.id}>
                      <td>{d.period_label}</td>
                      <td>{d.asset?.name}</td>
                      <td>{Number(d.amount).toLocaleString()}</td>
                      <td>{d.status || 'posted'}</td>
                      <td>{d.run_date?.slice?.(0, 10) || d.created_at?.slice?.(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {tab === 'operations' ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['transfers', 'Transfers'],
                ['maintenance', 'Maintenance'],
                ['cover', 'Insurance / warranty']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={opsSub === key ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setOpsSub(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {opsSub === 'transfers' ? (
            <>
              <form
                onSubmit={createTransfer}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>New transfer</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Asset</label>
                    <select
                      value={transferForm.asset_id}
                      onChange={(e) => setTransferForm({ ...transferForm, asset_id: e.target.value })}
                      required
                    >
                      <option value="">Select…</option>
                      {assets
                        .filter((a) => a.financial_status !== 'disposed')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} — ` : ''}
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>To branch</label>
                    <select
                      value={transferForm.to_branch_id}
                      onChange={(e) =>
                        setTransferForm({ ...transferForm, to_branch_id: e.target.value })
                      }
                    >
                      <option value="">Same / unchanged</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>To location</label>
                    <select
                      value={transferForm.to_location_id}
                      onChange={(e) =>
                        setTransferForm({ ...transferForm, to_location_id: e.target.value })
                      }
                    >
                      <option value="">Unchanged</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code} — {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Reason</label>
                    <input
                      value={transferForm.reason}
                      onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
                    />
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Create draft
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Transfer</th>
                        <th>Status</th>
                        <th>From → To</th>
                        <th>Assets</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.map((t) => (
                        <tr key={t.id}>
                          <td>{t.transfer_number}</td>
                          <td>{t.status}</td>
                          <td>
                            {t.from_branch?.code || '—'} → {t.to_branch?.code || '—'}
                          </td>
                          <td>{t.lines?.length ?? 0}</td>
                          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {t.status === 'draft' ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void runTransferAction(t.id, 'submit')}
                              >
                                Submit
                              </button>
                            ) : null}
                            {t.status === 'pending_approval' ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void runTransferAction(t.id, 'approve')}
                              >
                                Approve
                              </button>
                            ) : null}
                            {t.status === 'approved' ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void runTransferAction(t.id, 'dispatch')}
                              >
                                Dispatch
                              </button>
                            ) : null}
                            {t.status === 'in_transit' ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void runTransferAction(t.id, 'receive')}
                              >
                                Receive
                              </button>
                            ) : null}
                            {!['received', 'cancelled'].includes(t.status) ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void runTransferAction(t.id, 'cancel')}
                              >
                                Cancel
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!transfers.length ? (
                        <tr>
                          <td colSpan={5} style={{ color: 'var(--ink-muted)' }}>
                            No transfers yet
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {opsSub === 'maintenance' ? (
            <>
              <form
                onSubmit={createMaintRequest}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>New maintenance request</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Asset</label>
                    <select
                      value={maintForm.asset_id}
                      onChange={(e) => setMaintForm({ ...maintForm, asset_id: e.target.value })}
                      required
                    >
                      <option value="">Select…</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code ? `${a.code} — ` : ''}
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Title</label>
                    <input
                      value={maintForm.title}
                      onChange={(e) => setMaintForm({ ...maintForm, title: e.target.value })}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Priority</label>
                    <select
                      value={maintForm.priority}
                      onChange={(e) => setMaintForm({ ...maintForm, priority: e.target.value })}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Description</label>
                    <input
                      value={maintForm.description}
                      onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })}
                    />
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Create request
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Requests</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Request</th>
                        <th>Asset</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {maintRequests.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.request_number} — {r.title}
                          </td>
                          <td>{r.asset?.name}</td>
                          <td>{r.status}</td>
                          <td>{r.priority}</td>
                          <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {r.status === 'draft' ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() =>
                                  void api.assets
                                    .submitMaintenanceRequest(r.id)
                                    .then(() => load())
                                    .catch((err: any) => alertError('Submit failed', err.message))
                                }
                              >
                                Submit
                              </button>
                            ) : null}
                            {['draft', 'submitted'].includes(r.status) ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() =>
                                  void api.assets
                                    .approveMaintenanceRequest(r.id)
                                    .then(() => load())
                                    .catch((err: any) => alertError('Approve failed', err.message))
                                }
                              >
                                Approve
                              </button>
                            ) : null}
                            {r.status === 'approved' ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => void convertToWorkOrder(r.id)}
                              >
                                Create WO
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Work orders</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>WO</th>
                        <th>Asset</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {workOrders.map((w) => (
                        <tr key={w.id}>
                          <td>
                            {w.work_order_number} — {w.title}
                          </td>
                          <td>{w.asset?.name}</td>
                          <td>{w.status}</td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            {w.status === 'open' ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() =>
                                  void api.assets
                                    .startWorkOrder(w.id)
                                    .then(() => load())
                                    .catch((err: any) => alertError('Start failed', err.message))
                                }
                              >
                                Start
                              </button>
                            ) : null}
                            {['open', 'in_progress'].includes(w.status) ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() =>
                                  void api.assets
                                    .completeWorkOrder(w.id)
                                    .then(() => load())
                                    .catch((err: any) => alertError('Complete failed', err.message))
                                }
                              >
                                Complete
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {opsSub === 'cover' ? (
            <>
              <form
                onSubmit={createCover}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>Add cover</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Type</label>
                    <select
                      value={coverForm.kind}
                      onChange={(e) =>
                        setCoverForm({
                          ...coverForm,
                          kind: e.target.value as 'insurance' | 'warranty'
                        })
                      }
                    >
                      <option value="insurance">Insurance</option>
                      <option value="warranty">Warranty</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Asset</label>
                    <select
                      value={coverForm.asset_id}
                      onChange={(e) => setCoverForm({ ...coverForm, asset_id: e.target.value })}
                      required
                    >
                      <option value="">Select…</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code ? `${a.code} — ` : ''}
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>{coverForm.kind === 'insurance' ? 'Insurer' : 'Provider'}</label>
                    <input
                      value={coverForm.name}
                      onChange={(e) => setCoverForm({ ...coverForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>{coverForm.kind === 'insurance' ? 'Policy #' : 'Warranty #'}</label>
                    <input
                      value={coverForm.number}
                      onChange={(e) => setCoverForm({ ...coverForm, number: e.target.value })}
                      required={coverForm.kind === 'insurance'}
                    />
                  </div>
                  <div className="field">
                    <label>Start</label>
                    <input
                      type="date"
                      value={coverForm.start_date}
                      onChange={(e) => setCoverForm({ ...coverForm, start_date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>End</label>
                    <input
                      type="date"
                      value={coverForm.end_date}
                      onChange={(e) => setCoverForm({ ...coverForm, end_date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Save
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Insurance</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Insurer</th>
                        <th>Policy</th>
                        <th>Ends</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insurances.map((i) => (
                        <tr key={i.id}>
                          <td>{i.asset?.name}</td>
                          <td>{i.insurer_name}</td>
                          <td>{i.policy_number}</td>
                          <td>{String(i.end_date).slice(0, 10)}</td>
                          <td>{i.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div style={{ fontWeight: 700, padding: '0.5rem 1rem' }}>Warranties</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Provider</th>
                        <th>Ends</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warranties.map((w) => (
                        <tr key={w.id}>
                          <td>{w.asset?.name}</td>
                          <td>{w.provider_name}</td>
                          <td>{String(w.end_date).slice(0, 10)}</td>
                          <td>{w.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'accounting' ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                ['cip', 'CIP'],
                ['impairment', 'Impairment'],
                ['revaluation', 'Revaluation'],
                ['disposal', 'Disposal'],
                ['components', 'Components']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={acctSub === key ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => setAcctSub(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {acctSub === 'cip' ? (
            <>
              <form
                onSubmit={createCip}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>New CIP project</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Name</label>
                    <input
                      value={cipForm.name}
                      onChange={(e) => setCipForm({ ...cipForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>First cost</label>
                    <input
                      type="number"
                      min="0"
                      value={cipForm.cost_amount}
                      onChange={(e) => setCipForm({ ...cipForm, cost_amount: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Funding</label>
                    <select
                      value={cipForm.funding_method}
                      onChange={(e) => setCipForm({ ...cipForm, funding_method: e.target.value })}
                    >
                      <option value="equity">Equity</option>
                      <option value="bank">Bank</option>
                      <option value="cash">Cash</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Create
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Status</th>
                        <th>Total</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {capitalProjects.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {p.project_number} — {p.name}
                          </td>
                          <td>{p.status}</td>
                          <td>{Number(p.total_cost || 0).toLocaleString()}</td>
                          <td style={{ display: 'flex', gap: 6 }}>
                            {['active', 'draft'].includes(p.status) && Number(p.total_cost) > 0 ? (
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={async () => {
                                  try {
                                    await api.assets.completeCapitalProject(p.id);
                                    await load();
                                  } catch (err: any) {
                                    await alertError('Complete failed', err.message);
                                  }
                                }}
                              >
                                Complete
                              </button>
                            ) : null}
                            {['completed', 'active'].includes(p.status) && !p.capitalised_asset_id ? (
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={async () => {
                                  try {
                                    await api.assets.capitaliseCapitalProject(p.id, {
                                      asset_name: p.name
                                    });
                                    await alertSuccess('Capitalised');
                                    await load();
                                  } catch (err: any) {
                                    await alertError('Capitalise failed', err.message);
                                  }
                                }}
                              >
                                Capitalise
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {acctSub === 'impairment' ? (
            <>
              <form
                onSubmit={createImpairment}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>Post impairment</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Asset</label>
                    <select
                      value={impForm.asset_id}
                      onChange={(e) => setImpForm({ ...impForm, asset_id: e.target.value })}
                      required
                    >
                      <option value="">Select…</option>
                      {assets
                        .filter((a) => a.financial_status !== 'disposed')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} — ` : ''}
                            {a.name} (NBV {Number(a.net_book_value ?? 0).toLocaleString()})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Amount</label>
                    <input
                      type="number"
                      min="0"
                      value={impForm.amount}
                      onChange={(e) => setImpForm({ ...impForm, amount: e.target.value })}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Reason</label>
                    <input
                      value={impForm.reason}
                      onChange={(e) => setImpForm({ ...impForm, reason: e.target.value })}
                    />
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Post
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Asset</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impairments.map((r) => (
                        <tr key={r.id}>
                          <td>{r.impairment_number}</td>
                          <td>{r.asset?.name}</td>
                          <td>{Number(r.amount).toLocaleString()}</td>
                          <td>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {acctSub === 'revaluation' ? (
            <>
              <form
                onSubmit={createRevaluation}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>Post revaluation</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Asset</label>
                    <select
                      value={revalForm.asset_id}
                      onChange={(e) => setRevalForm({ ...revalForm, asset_id: e.target.value })}
                      required
                    >
                      <option value="">Select…</option>
                      {assets
                        .filter((a) => a.financial_status !== 'disposed')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} — ` : ''}
                            {a.name} (NBV {Number(a.net_book_value ?? 0).toLocaleString()})
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>New carrying amount</label>
                    <input
                      type="number"
                      min="0"
                      value={revalForm.new_carrying_amount}
                      onChange={(e) =>
                        setRevalForm({ ...revalForm, new_carrying_amount: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Reason</label>
                    <input
                      value={revalForm.reason}
                      onChange={(e) => setRevalForm({ ...revalForm, reason: e.target.value })}
                    />
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Post
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Asset</th>
                        <th>Adjustment</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revaluations.map((r) => (
                        <tr key={r.id}>
                          <td>{r.revaluation_number}</td>
                          <td>{r.asset?.name}</td>
                          <td>{Number(r.adjustment_amount).toLocaleString()}</td>
                          <td>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {acctSub === 'disposal' ? (
            <>
              <form
                onSubmit={createDisposal}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>Dispose asset</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Asset</label>
                    <select
                      value={dispForm.asset_id}
                      onChange={(e) => setDispForm({ ...dispForm, asset_id: e.target.value })}
                      required
                    >
                      <option value="">Select…</option>
                      {assets
                        .filter((a) => a.financial_status !== 'disposed')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} — ` : ''}
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Type</label>
                    <select
                      value={dispForm.disposal_type}
                      onChange={(e) => setDispForm({ ...dispForm, disposal_type: e.target.value })}
                    >
                      <option value="scrap">Scrap</option>
                      <option value="sale">Sale</option>
                      <option value="donation">Donation</option>
                      <option value="write_off">Write-off</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Proceeds</label>
                    <input
                      type="number"
                      min="0"
                      value={dispForm.proceeds}
                      onChange={(e) => setDispForm({ ...dispForm, proceeds: e.target.value })}
                    />
                  </div>
                  {Number(dispForm.proceeds || 0) > 0 ? (
                    <div className="field">
                      <label>Bank / cash account</label>
                      <select
                        value={dispForm.bank_account_id}
                        onChange={(e) =>
                          setDispForm({ ...dispForm, bank_account_id: e.target.value })
                        }
                        required
                      >
                        <option value="">Select…</option>
                        {bankAccounts.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div className="field">
                    <label>Reason</label>
                    <input
                      value={dispForm.reason}
                      onChange={(e) => setDispForm({ ...dispForm, reason: e.target.value })}
                    />
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Approve &amp; post
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Asset</th>
                        <th>NBV</th>
                        <th>Gain/(Loss)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disposals.map((r) => (
                        <tr key={r.id}>
                          <td>{r.disposal_number}</td>
                          <td>{r.asset?.name}</td>
                          <td>{Number(r.nbv_amount).toLocaleString()}</td>
                          <td>{Number(r.gain_loss_amount).toLocaleString()}</td>
                          <td>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          {acctSub === 'components' ? (
            <>
              <form
                onSubmit={createComponent}
                className="card-surface"
                style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
              >
                <div style={{ fontWeight: 700 }}>Add component</div>
                <div className="form-grid">
                  <div className="field">
                    <label>Parent asset</label>
                    <select
                      value={compForm.parent_asset_id}
                      onChange={(e) =>
                        setCompForm({ ...compForm, parent_asset_id: e.target.value })
                      }
                      required
                    >
                      <option value="">Select…</option>
                      {assets
                        .filter((a) => a.financial_status !== 'disposed')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} — ` : ''}
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Name</label>
                    <input
                      value={compForm.name}
                      onChange={(e) => setCompForm({ ...compForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Cost (memo)</label>
                    <input
                      type="number"
                      min="0"
                      value={compForm.cost_amount}
                      onChange={(e) => setCompForm({ ...compForm, cost_amount: e.target.value })}
                    />
                  </div>
                  <div className="form-grid--actions">
                    <button className="btn btn-primary" type="submit">
                      Add
                    </button>
                  </div>
                </div>
              </form>
              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Parent</th>
                        <th>Component</th>
                        <th>Cost</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {components.map((c) => (
                        <tr key={c.id}>
                          <td>{c.parent_asset?.name}</td>
                          <td>{c.name}</td>
                          <td>{Number(c.cost_amount).toLocaleString()}</td>
                          <td>{c.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'verify' ? (
        <>
          <form
            onSubmit={createCampaign}
            className="card-surface"
            style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>New verification campaign</div>
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input
                  value={verifyForm.name}
                  onChange={(e) => setVerifyForm({ ...verifyForm, name: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Branch (optional)</label>
                <select
                  value={verifyForm.branch_id}
                  onChange={(e) => setVerifyForm({ ...verifyForm, branch_id: e.target.value })}
                >
                  <option value="">All</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Location (optional)</label>
                <select
                  value={verifyForm.location_id}
                  onChange={(e) => setVerifyForm({ ...verifyForm, location_id: e.target.value })}
                >
                  <option value="">All</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Expected</th>
                    <th>Matched</th>
                    <th>Mismatch</th>
                    <th>Missing</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.campaign_number} — {c.name}
                      </td>
                      <td>{c.status}</td>
                      <td>{c.expected_count}</td>
                      <td>{c.matched_count}</td>
                      <td>{c.mismatch_count}</td>
                      <td>{c.missing_count}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={async () => {
                            try {
                              await refreshCampaign(c.id);
                            } catch (err: any) {
                              await alertError('Load failed', err.message);
                            }
                          }}
                        >
                          Open
                        </button>
                        {c.status === 'draft' ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={async () => {
                              try {
                                await api.assets.openVerificationCampaign(c.id);
                                await alertSuccess('Campaign opened');
                                await refreshCampaign(c.id);
                              } catch (err: any) {
                                await alertError('Open failed', err.message);
                              }
                            }}
                          >
                            Start
                          </button>
                        ) : null}
                        {c.status === 'open' ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={async () => {
                              try {
                                await api.assets.closeVerificationCampaign(c.id);
                                await alertSuccess('Campaign closed');
                                await refreshCampaign(c.id);
                              } catch (err: any) {
                                await alertError('Close failed', err.message);
                              }
                            }}
                          >
                            Close
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {selectedCampaign ? (
            <>
              <div className="card-surface" style={{ padding: '1rem' }}>
                <div style={{ fontWeight: 700 }}>
                  {selectedCampaign.campaign_number} — {selectedCampaign.name} (
                  {selectedCampaign.status})
                </div>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--ink-muted)', fontSize: '0.85rem' }}>
                  Scans never change the register. Resolve mismatches with “Correct register” to
                  apply found location/branch.
                </p>
              </div>

              {selectedCampaign.status === 'open' ? (
                <form
                  onSubmit={scanAsset}
                  className="card-surface"
                  style={{ padding: '1.25rem', display: 'grid', gap: 12 }}
                >
                  <div style={{ fontWeight: 700 }}>Scan code / barcode / QR</div>
                  <div className="form-grid">
                    <div className="field">
                      <label>Scanned code</label>
                      <input
                        value={scanForm.scanned_code}
                        onChange={(e) =>
                          setScanForm({ ...scanForm, scanned_code: e.target.value })
                        }
                        required
                        placeholder="Asset code, barcode, serial, or QR"
                      />
                    </div>
                    <div className="field">
                      <label>Found location (optional)</label>
                      <select
                        value={scanForm.found_location_id}
                        onChange={(e) =>
                          setScanForm({ ...scanForm, found_location_id: e.target.value })
                        }
                      >
                        <option value="">As registered</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} — {l.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-grid--actions">
                      <button className="btn btn-primary" type="submit">
                        Record scan
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}

              <div className="card-surface" style={{ padding: '0.5rem 0' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Asset</th>
                        <th>Status</th>
                        <th>Scanned</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedCampaign.results || []).map((r: any) => (
                        <tr key={r.id}>
                          <td>
                            {r.asset
                              ? `${r.asset.code ? `${r.asset.code} — ` : ''}${r.asset.name}`
                              : r.scanned_code || '—'}
                          </td>
                          <td>{r.status}</td>
                          <td>{r.scanned_code || '—'}</td>
                          <td>
                            {['mismatch', 'missing', 'unexpected'].includes(r.status) ? (
                              <select
                                defaultValue=""
                                onChange={async (e) => {
                                  const action = e.target.value;
                                  e.target.value = '';
                                  if (!action) return;
                                  try {
                                    await api.assets.resolveVerificationResult(r.id, {
                                      resolution_action: action
                                    });
                                    await alertSuccess(`Resolved (${action})`);
                                    await refreshCampaign(selectedCampaign.id);
                                  } catch (err: any) {
                                    await alertError('Resolve failed', err.message);
                                  }
                                }}
                              >
                                <option value="">Resolve…</option>
                                {r.status === 'mismatch' ? (
                                  <option value="correct_register">Correct register</option>
                                ) : null}
                                <option value="accept_found">Accept found</option>
                                <option value="ignore">Ignore</option>
                                <option value="mark_missing">Mark missing</option>
                              </select>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'budgets' ? (
        <>
          <form onSubmit={createBudget} className="card-surface" style={{ padding: '1.25rem', display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700 }}>New budget (annual line)</div>
            <div className="form-grid">
              <div className="field">
                <label>Name</label>
                <input value={budgetForm.name} onChange={(e) => setBudgetForm({ ...budgetForm, name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Year</label>
                <input value={budgetForm.fiscal_year} onChange={(e) => setBudgetForm({ ...budgetForm, fiscal_year: e.target.value })} required />
              </div>
              <div className="field">
                <label>Category</label>
                <select
                  value={budgetForm.asset_category_id}
                  onChange={(e) => setBudgetForm({ ...budgetForm, asset_category_id: e.target.value })}
                  required
                >
                  <option value="">Select category…</option>
                  {categories
                    .filter((c) => c.is_active !== false)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input type="number" min="0" value={budgetForm.amount} onChange={(e) => setBudgetForm({ ...budgetForm, amount: e.target.value })} required />
              </div>
              <div className="form-grid--actions">
                <button className="btn btn-primary" type="submit">
                  Create budget
                </button>
              </div>
            </div>
          </form>

          <div className="card-surface" style={{ padding: '0.5rem 0' }}>
            <div className="table-wrap">
              <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th>Lines</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.fiscal_year}</td>
                    <td>{b.status}</td>
                    <td>{b._count?.lines ?? b.lines?.length ?? 0}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {b.status === 'draft' ? (
                        <button type="button" className="btn btn-ghost" onClick={() => void activate(b.id)}>
                          Activate
                        </button>
                      ) : null}
                      <button type="button" className="btn btn-ghost" onClick={() => void showVs(b.id)}>
                        Vs actual
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {vsActual ? (
            <div className="card-surface" style={{ padding: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                {vsActual.budget?.name} — budget vs actual
              </div>
              <div className="table-wrap">
                <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Budget</th>
                    <th>Actual (capitalised)</th>
                    <th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {(vsActual.lines || []).map((l: any, i: number) => (
                    <tr key={i}>
                      <td>
                        {l.asset_category
                          ? `${l.asset_category.code} — ${l.asset_category.name}`
                          : `${l.account?.code || ''} ${l.account?.name || ''}`.trim() || '—'}
                      </td>
                      <td>{Number(l.budget).toLocaleString()}</td>
                      <td>{Number(l.actual).toLocaleString()}</td>
                      <td>{Number(l.variance).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
