import { readData } from './data-store.js';
import { createSupabaseAuthClient } from './supabase-auth.js';

const BASE_EMPLOYEES = [
  {
    id: 'HRADMIN',
    name: 'Pramod',
    mobile: '9716209931',
    email: 'pramod@wiom.in',
    doj: '2023-01-01',
    designation: 'HR Admin',
    dept: 'HR',
    loc: 'Gurugram',
    mgr: '',
    payroll: 'Wiom',
    role: 'hr'
  },
  {
    id: 'ORA0023',
    name: 'Udit Kumar',
    mobile: '9716209931',
    email: '',
    doj: '2025-07-24',
    designation: 'Associate',
    dept: 'Supply',
    loc: 'New Delhi',
    mgr: 'Pramod',
    payroll: 'Betterplace'
  },
  {
    id: 'RYANADMIN',
    name: 'Ryan Wilson',
    mobile: '',
    email: 'ryan.wilson@wiom.in',
    doj: '2026-07-03',
    designation: 'DigiDesk Admin',
    dept: 'Admin',
    loc: '',
    mgr: '',
    payroll: 'Wiom',
    status: 'Active',
    role: 'hr'
  }
];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emailLocalPart(email) {
  return normalizeEmail(email).split('@')[0] || '';
}

function parseStoredJson(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value) || typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hasGoogleProvider(user) {
  const providers = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : [];
  return user?.app_metadata?.provider === 'google' || providers.includes('google');
}

function buildEmployees(data) {
  const employees = BASE_EMPLOYEES.map(employee => ({ ...employee }));
  const customEmployees = parseStoredJson(data.wiom_custom_emps, []);

  customEmployees.forEach(employee => {
    if (!employee?.id) return;
    const next = { ...employee, id: String(employee.id).trim().toUpperCase() };
    const index = employees.findIndex(existing => existing.id === next.id);
    if (index >= 0) employees[index] = next;
    else employees.push(next);
  });

  return employees;
}

function isActiveEmployee(employee) {
  return String(employee?.status || 'Active').toLowerCase() === 'active';
}

function findEmployeeByEmail(employees, authEmail) {
  const normalizedAuthEmail = normalizeEmail(authEmail);
  if (!normalizedAuthEmail) return null;

  const exactMatch = employees.find(employee => (
    isActiveEmployee(employee) &&
    normalizeEmail(employee.email) === normalizedAuthEmail
  ));

  if (exactMatch) return exactMatch;

  const localPart = emailLocalPart(normalizedAuthEmail);
  if (!localPart) return null;

  return employees.find(employee => (
    isActiveEmployee(employee) &&
    normalizeEmail(employee.email) &&
    emailLocalPart(employee.email) === localPart
  )) || null;
}

export function appUserFromEmployee(employee, authUser) {
  const role = employee.role || 'employee';
  const user = { emp: employee, role, authEmail: normalizeEmail(authUser.email) };

  if (role === 'hr' || role === 'manager') {
    user.mgrName = employee.name;
  }

  return user;
}

export async function getAuthorizedDigideskUser(authUser) {
  if (!authUser) {
    return { error: 'Please sign in with Google.', status: 401 };
  }

  if (!hasGoogleProvider(authUser)) {
    return { error: 'Please sign in with Google.', status: 403 };
  }

  if (!authUser.email) {
    return { error: 'Your Google account did not share an email address.', status: 403 };
  }

  const data = await readData();
  const employee = findEmployeeByEmail(buildEmployees(data), authUser.email);

  if (!employee) {
    return {
      error: 'No active DigiDesk employee record matches this Google email.',
      status: 403
    };
  }

  return {
    authUser,
    employee,
    appUser: appUserFromEmployee(employee, authUser)
  };
}

export async function getDigideskAuthContext() {
  const supabase = await createSupabaseAuthClient();

  if (!supabase) {
    return { error: 'Supabase Auth is not configured.', status: 500 };
  }

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: 'Please sign in with Google.', status: 401 };
  }

  return getAuthorizedDigideskUser(user);
}

export async function requireDigideskUser() {
  const context = await getDigideskAuthContext();

  if (context.error) {
    return {
      response: Response.json(
        { ok: false, error: context.error },
        { status: context.status || 401 }
      )
    };
  }

  return { context };
}

export async function requireDigideskHr() {
  const auth = await requireDigideskUser();
  if (auth.response) return auth;

  if (auth.context.appUser.role !== 'hr') {
    return {
      response: Response.json(
        { ok: false, error: 'HR access is required.' },
        { status: 403 }
      )
    };
  }

  return auth;
}

export function safeInternalPath(value, fallback = '/') {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  return value;
}
