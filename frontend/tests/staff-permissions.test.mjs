import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the production permission rules without invoking React hooks or API calls.
const source = (await readFile(new URL('../src/pages/Portal/dashboard.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '');
const { ADMIN_SECTIONS, DEV_SECTIONS, SECTION_PERMS, canWith, panelAllowed, sectionAllowed } =
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('every sidebar section has an explicit permission requirement', () => {
  for (const [kind, sections] of [['admin', ADMIN_SECTIONS], ['developer', DEV_SECTIONS]]) {
    for (const [id] of sections) assert.ok(SECTION_PERMS[kind][id]?.length, kind + '/' + id);
  }
});
test('customers and editable metadata never grant either staff panel', () => {
  for (const me of [null, { user: { user_metadata: { role: 'owner', permissions: ['developer.read'] } } }]) {
    const can = canWith(me);
    assert.equal(panelAllowed('admin', can), false);
    assert.equal(panelAllowed('developer', can), false);
  }
});
test('order readers cannot enter the Developer panel or change staff roles', () => {
  const can = canWith({ staff: { role: 'support', permissions: ['orders.read'] } });
  assert.equal(sectionAllowed('admin', 'orders', can), true);
  assert.equal(sectionAllowed('admin', 'roles', can), false);
  assert.equal(panelAllowed('developer', can), false);
});
test('developer access does not imply customer, order or settings privileges', () => {
  const can = canWith({ staff: { role: 'developer', permissions: ['developer.read'] } });
  assert.equal(panelAllowed('developer', can), true);
  assert.equal(sectionAllowed('developer', 'health', can), true);
  assert.equal(sectionAllowed('developer', 'payments', can), false);
  assert.equal(sectionAllowed('admin', 'customers', can), false);
  assert.equal(sectionAllowed('admin', 'settings', can), false);
});
