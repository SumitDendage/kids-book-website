import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffResponse } from '../src/services/staffResponse.js';

test('incomplete analytics and health reports fail before rendering nested values', () => {
  for (const path of ['/api/admin/analytics?days=30', '/api/admin/developer/health']) {
    assert.throws(() => validateStaffResponse(path, {}), { status: 502, code: 'invalid_response' });
  }
});
test('valid empty reports remain valid instead of being confused with failures', () => {
  const empty = { range: { from: 0, to: 1000 }, totals: {}, conversion: {}, byDay: [] };
  assert.equal(validateStaffResponse('/api/admin/analytics', empty), empty);
  const health = { db: {}, payments: {}, outbox: {} };
  assert.equal(validateStaffResponse('/api/admin/developer/health', health), health);
});
test('staff identity must include a role and a list of explicit permissions', () => {
  assert.throws(() => validateStaffResponse('/api/admin/me', { user: { id: 'test' }, staff: {} }));
  const me = { user: { id: 'test' }, staff: { role: 'support', permissions: ['orders.read'] } };
  assert.equal(validateStaffResponse('/api/admin/me', me), me);
});
