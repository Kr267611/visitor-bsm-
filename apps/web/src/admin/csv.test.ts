import { describe, expect, it } from 'vitest';
import { parseCsv, rowsFromCsv, TEMPLATE_CSV } from './csv';

describe('parseCsv', () => {
  it('handles quotes, commas inside quotes, CRLF, BOM and blank trailing lines', () => {
    const text = '﻿Name,Note\r\n"Sah, Abhishek","He said ""hi"""\r\nAmit,\r\n,\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Name', 'Note'],
      ['Sah, Abhishek', 'He said "hi"'],
      ['Amit', ''],
    ]);
  });
});

describe('rowsFromCsv', () => {
  it('maps headings in any capitals and alternative names', () => {
    const text = 'Full Name,Phone No,BRANCH,Designation,Department,Password,Extra\nAmit,9811100001,Head Office,Executive,MIS,amit26,x\n';
    expect(rowsFromCsv(text)).toEqual({
      rows: [
        { name: 'Amit', mobile: '9811100001', premises: 'Head Office', designation: 'Executive', department: 'MIS', password: 'amit26' },
      ],
      unknownColumns: ['Extra'],
      missing: [],
    });
  });

  it('reports required columns that are missing', () => {
    expect(rowsFromCsv('Name,Email\nAmit,a@b.in').missing).toEqual(['Mobile', 'Password']);
  });

  it('the template itself is valid', () => {
    const { rows, missing, unknownColumns } = rowsFromCsv(TEMPLATE_CSV);
    expect(missing).toEqual([]);
    expect(unknownColumns).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Abhishek Vijay Sah', role: 'Employee', department: 'MIS', host: 'Yes' });
  });
});
