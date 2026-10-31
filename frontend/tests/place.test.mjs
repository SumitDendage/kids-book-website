import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/* place.js with the server calls recorded instead of sent */
const calls = [];
globalThis.__staffApi = async (method, path, body) => {
  calls.push({ method, path, body });
  if (path === '/api/admin/sections') return { section: { id: 'new-' + calls.length, label: body.label, group: body.group, groupLabel: body.groupLabel, cls: body.cls }, sections: [] };
  if (path === '/api/admin/subjects') return { subject: { name: body.name }, subjects: [] };
  return { classes: [] };
};
const code = (await readFile(new URL('../src/pages/Admin/place.js', import.meta.url), 'utf8'))
  .replace("import { staffApi } from '../../services/api.js';", 'const staffApi = (...a) => globalThis.__staffApi(...a);');
const place = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const SECTIONS = [
  { id: 'picture-matching', label: 'Picture matching', group: 'pre', groupLabel: 'Pre-reading skills', cls: 'kg', sort: 110 },
  { id: 'letter-recognition', label: 'A-Z Letter Recognition', group: 'alpha', groupLabel: 'Alphabet', cls: 'kg', sort: 220 },
  { id: 'letter-tracing', label: 'A-Z Letter Tracing', group: 'alpha', groupLabel: 'Alphabet', cls: 'kg', sort: 210 },
  { id: 'vocab-colours', label: 'Colours', group: 'vocab', groupLabel: 'Vocabulary', cls: 'kg', sort: 410 },
  { id: 'story-books', label: 'Story books', group: null, groupLabel: null, cls: 'kg', sort: 5000 },
  { id: 'c1-numbers', label: 'Numbers', group: 'maths', groupLabel: 'Maths', cls: 'c1', sort: 5000 },
];
const base = { classes: [{ id: 'kg', name: 'Kindergarten' }], subjects: [{ name: 'English' }], sections: SECTIONS, cls: 'kg', subject: 'English' };

test('a class lists its sections like the website menu: Alphabet, Vocabulary, the rest, then Other', () => {
  const groups = place.groupsOfClass(SECTIONS, 'kg');
  assert.deepEqual(groups.map(g => g.label), ['Alphabet', 'Vocabulary', 'Pre-reading skills', 'Other']);
  assert.deepEqual(groups[0].subs.map(x => x.id), ['letter-tracing', 'letter-recognition']);
  assert.equal(groups[3].id, place.OTHER);
  assert.deepEqual(place.groupsOfClass(SECTIONS, 'c1').map(g => g.label), ['Maths']);
  assert.deepEqual(place.groupsOfClass(SECTIONS, 'c2'), []);
});

test('a new section gets a short id no other section has', () => {
  assert.equal(place.groupIdFor('Story time', SECTIONS), 'story-time');
  assert.equal(place.groupIdFor('Alpha', SECTIONS), 'alpha-2');
  assert.equal(place.groupIdFor('हिंदी', SECTIONS), 'section');
});

test('a picked sub-section is used as it is, with nothing made', async () => {
  calls.length = 0;
  const r = await place.ensurePlace({ ...base, group: 'alpha', sub: 'letter-tracing' });
  assert.equal(r.section.id, 'letter-tracing');
  assert.equal(calls.length, 0);
  assert.deepEqual(place.sectionFields(r.section), { group: 'alpha', section: 'letter-tracing', sectionLabel: 'A-Z Letter Tracing' });
});

test('no section puts the sheet on the class shelf', async () => {
  calls.length = 0;
  const r = await place.ensurePlace({ ...base, group: '', sub: '' });
  assert.equal(r.section, null);
  assert.equal(calls.length, 0);
});

test('a new sub-section is made in the picked section, after its others', async () => {
  calls.length = 0;
  await place.ensurePlace({ ...base, group: 'alpha', sub: '+new', newSub: '  Letter   writing ' });
  assert.deepEqual(calls, [{ method: 'POST', path: '/api/admin/sections', body: { label: 'Letter writing', cls: 'kg', group: 'alpha', groupLabel: 'Alphabet', sort: 230 } }]);
});

test('a typed name already in the section is reused, not made twice', async () => {
  calls.length = 0;
  const r = await place.ensurePlace({ ...base, group: 'alpha', sub: '+new', newSub: 'a-z letter tracing' });
  assert.equal(r.section.id, 'letter-tracing');
  assert.equal(calls.length, 0);
});

test('a new section and its first sub-section are made together', async () => {
  calls.length = 0;
  await place.ensurePlace({ ...base, group: '+new', newGroup: 'Story time', sub: '+new', newSub: 'Animal stories' });
  assert.deepEqual(calls[0].body, { label: 'Animal stories', cls: 'kg', group: 'story-time', groupLabel: 'Story time' });
});

test('a typed section name the class already has goes into that section', async () => {
  calls.length = 0;
  await place.ensurePlace({ ...base, group: '+new', newGroup: 'vocabulary', sub: '+new', newSub: 'Toys' });
  assert.equal(calls[0].body.group, 'vocab');
  assert.equal(calls[0].body.groupLabel, 'Vocabulary');
});

test('a new sub-section under Other is in no section', async () => {
  calls.length = 0;
  await place.ensurePlace({ ...base, group: place.OTHER, sub: '+new', newSub: 'Puzzles' });
  assert.deepEqual(calls[0].body, { label: 'Puzzles', cls: 'kg', group: null, groupLabel: null, sort: 5010 });
});
