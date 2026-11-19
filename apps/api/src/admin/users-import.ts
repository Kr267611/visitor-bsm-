import { normalizeIndianPhone, PASSWORD_MAX, PASSWORD_MIN, type Role } from '@visitor/shared';
import { z } from 'zod';

/** Most rows one upload may carry. */
export const IMPORT_MAX_ROWS = 1000;

/** One spreadsheet row as the web app sends it: every cell is text; blank cells may be left out. */
export const importRow = z.object({
  name: z.string().optional(),
  mobile: z.string().optional(),
  email: z.string().optional(),
  role: z.string().optional(),
  department: z.string().optional(),
  designation: z.string().optional(),
  password: z.string().optional(),
  premises: z.string().optional(),
  host: z.string().optional(),
});
export type ImportRow = z.infer<typeof importRow>;

export const importBody = z.object({ rows: z.array(importRow).min(1).max(IMPORT_MAX_ROWS) });

const ROLE_WORDS: Record<string, Exclude<Role, 'super_admin'>> = {
  admin: 'admin',
  reception: 'reception',
  receptionist: 'reception',
  security: 'security',
  guard: 'guard',
  employee: 'employee',
  member: 'employee',
  host: 'employee',
  doer: 'employee',
};

const YES = new Set(['', 'yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);
const EMAIL = z.string().email();

export interface CleanRow {
  line: number;
  name: string;
  phone: string;
  email: string | null;
  role: Exclude<Role, 'super_admin'>;
  department: string | null;
  designation: string | null;
  password: string;
  premises: string | null;
  isHost: boolean;
}

export interface RowError {
  /** Spreadsheet line: 1 is the header, so the first person is line 2. */
  line: number;
  errors: string[];
}

const text = (value: string | undefined) => (value ?? '').trim();

/** Checks every row on its own (no database). Lines are numbered as in the sheet. */
export function cleanRows(rows: ImportRow[]): { clean: CleanRow[]; problems: RowError[] } {
  const clean: CleanRow[] = [];
  const problems: RowError[] = [];
  const seenPhones = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 2;
    const errors: string[] = [];
    const name = text(row.name);
    if (!name) errors.push('Name is missing.');
    else if (name.length > 100) errors.push('Name is longer than 100 characters.');

    const phone = normalizeIndianPhone(text(row.mobile));
    if (!phone) errors.push('Mobile must be a valid 10-digit number.');
    else if (seenPhones.has(phone)) errors.push(`Mobile is repeated (also on line ${seenPhones.get(phone)}).`);
    else seenPhones.set(phone, line);

    const emailText = text(row.email).toLowerCase();
    if (emailText && !EMAIL.safeParse(emailText).success) errors.push('Email is not valid.');
    else if (emailText && seenEmails.has(emailText)) errors.push(`Email is repeated (also on line ${seenEmails.get(emailText)}).`);
    else if (emailText) seenEmails.set(emailText, line);

    const roleText = text(row.role).toLowerCase();
    const role = roleText ? ROLE_WORDS[roleText] : 'employee';
    if (!role) errors.push('Role must be one of: Employee, Guard, Reception, Security, Admin.');

    const password = text(row.password);
    if (password.length < PASSWORD_MIN) errors.push(`Password must be at least ${PASSWORD_MIN} characters.`);
    else if (password.length > PASSWORD_MAX) errors.push(`Password is longer than ${PASSWORD_MAX} characters.`);

    const department = text(row.department) || null;
    const designation = text(row.designation) || null;
    if (designation && !department) errors.push('A designation needs a department.');
    if ((department?.length ?? 0) > 100 || (designation?.length ?? 0) > 100) {
      errors.push('Department and designation must be 100 characters or less.');
    }

    const hostText = text(row.host).toLowerCase();
    if (!YES.has(hostText) && !NO.has(hostText)) errors.push('Host must be Yes or No.');

    if (errors.length) {
      problems.push({ line, errors });
      return;
    }
    clean.push({
      line,
      name,
      phone: phone!,
      email: emailText || null,
      role: role!,
      department,
      designation,
      password,
      premises: text(row.premises) || null,
      isHost: !NO.has(hostText),
    });
  });
  return { clean, problems };
}
