/**
 * Unit: próg minimalnego zamówienia.
 */
import { evaluateMinOrder, minOrderAlertCopy } from '@/lib/supplierMinOrder';

describe('supplierMinOrder', () => {
  it('passes when min is 0', () => {
    expect(evaluateMinOrder(2, 0).ok).toBe(true);
  });

  it('fails below threshold and reports gap', () => {
    const c = evaluateMinOrder(2, 100, 'Warzywa');
    expect(c.ok).toBe(false);
    expect(c.gap).toBe(98);
    const copy = minOrderAlertCopy(c);
    expect(copy.title).toBe('Minimalne zamówienie');
    expect(copy.message).toContain('98');
    expect(copy.message).toContain('100');
  });

  it('passes at exact minimum', () => {
    expect(evaluateMinOrder(100, 100).ok).toBe(true);
  });
});
