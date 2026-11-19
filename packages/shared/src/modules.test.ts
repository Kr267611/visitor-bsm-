import { effectiveModules, MODULES, ROLE_MODULES } from './modules';

describe('effectiveModules', () => {
  it('no ticks saved means everything the role allows', () => {
    expect(effectiveModules('admin', [])).toEqual([...MODULES]);
    expect(effectiveModules('guard', null)).toEqual(['desk']);
    expect(effectiveModules('employee', undefined)).toEqual(['visitors']);
  });

  it('ticks narrow the role, and can never go beyond it', () => {
    expect(effectiveModules('admin', ['users'])).toEqual(['users']);
    expect(effectiveModules('security', ['desk', 'devices'])).toEqual(['desk', 'devices']);
    expect(effectiveModules('guard', ['desk', 'users', 'premises'])).toEqual(['desk']);
    expect(effectiveModules('employee', ['users'])).toEqual([]);
  });

  it('a super admin has no business modules', () => {
    expect(ROLE_MODULES.super_admin).toEqual([]);
    expect(effectiveModules('super_admin', [])).toEqual([]);
  });
});
