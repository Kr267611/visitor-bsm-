import type { UserImportRow } from '@visitor/shared';

/** Splits CSV text into rows of cells. Handles quotes, commas and line breaks inside quotes, CRLF and a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Excel often leaves fully empty lines at the end.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Column headings we understand, in any capitals; several names for the same column. */
const HEADINGS: Record<string, keyof UserImportRow> = {
  name: 'name',
  'full name': 'name',
  mobile: 'mobile',
  'mobile no': 'mobile',
  phone: 'mobile',
  'phone no': 'mobile',
  email: 'email',
  role: 'role',
  department: 'department',
  designation: 'designation',
  password: 'password',
  premises: 'premises',
  branch: 'premises',
  host: 'host',
};

export const TEMPLATE_COLUMNS = ['Name', 'Mobile', 'Email', 'Role', 'Department', 'Designation', 'Password', 'Premises', 'Host'];

export const TEMPLATE_CSV = [
  TEMPLATE_COLUMNS.join(','),
  'Abhishek Vijay Sah,6352872742,,Employee,MIS,Executive,abhi26,,Yes',
  'Alka Vinod Mishra,9198164246,alka@example.com,Guard,QC,Inspector,alka26,,No',
].join('\r\n');

/** Turns the sheet into upload rows. The first row must be the headings. */
export function rowsFromCsv(text: string): { rows: UserImportRow[]; unknownColumns: string[]; missing: string[] } {
  const [head, ...body] = parseCsv(text);
  if (!head) return { rows: [], unknownColumns: [], missing: ['Name', 'Mobile', 'Password'] };
  const keys = head.map((h) => HEADINGS[h.trim().toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ')]);
  const unknownColumns = head.filter((h, i) => h.trim() && !keys[i]).map((h) => h.trim());
  const missing = (['name', 'mobile', 'password'] as const)
    .filter((k) => !keys.includes(k))
    .map((k) => k[0].toUpperCase() + k.slice(1));
  const rows = body.map((cells) => {
    const row: UserImportRow = {};
    keys.forEach((key, i) => {
      const value = (cells[i] ?? '').trim();
      if (key && value) row[key] = value;
    });
    return row;
  });
  return { rows, unknownColumns, missing };
}
