import { nextStatus, VisitAction, VisitStatus } from './status';

describe('nextStatus', () => {
  const allowed: [VisitStatus, VisitAction, VisitStatus][] = [
    ['INVITED', 'REGISTER', 'APPROVED'],
    ['INVITED', 'CANCEL', 'CANCELLED'],
    ['INVITED', 'EXPIRE', 'EXPIRED'],
    ['PENDING_APPROVAL', 'APPROVE', 'APPROVED'],
    ['PENDING_APPROVAL', 'REJECT', 'REJECTED'],
    ['PENDING_APPROVAL', 'CANCEL', 'CANCELLED'],
    ['PENDING_APPROVAL', 'EXPIRE', 'EXPIRED'],
    ['APPROVED', 'CHECK_IN', 'CHECKED_IN'],
    ['APPROVED', 'CANCEL', 'CANCELLED'],
    ['APPROVED', 'EXPIRE', 'EXPIRED'],
    ['CHECKED_IN', 'CHECK_OUT', 'CHECKED_OUT'],
  ];

  it.each(allowed)('%s + %s = %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  const blocked: [VisitStatus, VisitAction][] = [
    ['REJECTED', 'CHECK_IN'],
    ['CHECKED_OUT', 'CHECK_IN'],
    ['CHECKED_IN', 'EXPIRE'],
    ['CHECKED_IN', 'CANCEL'],
    ['INVITED', 'CHECK_IN'],
  ];

  it.each(blocked)('%s + %s blocked', (from, action) => {
    expect(nextStatus(from, action)).toBeNull();
  });
});
