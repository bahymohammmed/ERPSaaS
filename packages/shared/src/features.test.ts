import { describe, expect, it } from 'vitest';
import { dependentsOf, featureForApiPath, featureForReport, featureForScreen, withDependencies, withoutFeature } from './features';

describe('plan modules', () => {
  it('adds core modules and required modules', () => {
    expect(withDependencies(['sales'])).toEqual(['gl', 'banking', 'sales']);
    expect(withDependencies(['nope', 'fixed_assets'])).toEqual(['gl', 'fixed_assets']);
  });

  it('removes dependents together with a module, never the core', () => {
    expect(withoutFeature(['gl', 'banking', 'sales', 'purchases', 'tax'], 'banking')).toEqual(['gl', 'tax']);
    expect(withoutFeature(['gl', 'tax'], 'gl')).toEqual(['gl', 'tax']);
    expect(dependentsOf('banking')).toEqual(['sales', 'purchases']);
  });

  it('maps API routes, screens and reports to modules', () => {
    expect(featureForApiPath('/api/sl/AR/documents')).toBe('sales');
    expect(featureForApiPath('/api/sl/ap/parties')).toBe('purchases');
    expect(featureForApiPath('/api/gl/reports/budget-vs-actual?x=1')).toBe('budgets');
    expect(featureForApiPath('/api/gl/reports/statement')).toBe('statements');
    expect(featureForApiPath('/api/gl/reports/trial-balance')).toBeNull();
    expect(featureForApiPath('/api/gl/statements-other')).toBeNull();
    expect(featureForScreen('/ar/invoices/new')).toBe('sales');
    expect(featureForScreen('/admin/users')).toBeNull();
    expect(featureForScreen('/gl/journals')).toBe('gl');
    expect(featureForReport('fa-forecast')).toBe('fixed_assets');
  });
});
