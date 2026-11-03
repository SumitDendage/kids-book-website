import { useMemo } from 'react';
import { plural } from '../Portal/dashboard.js';
import { groupsOfClass, OTHER } from './place.js';

/* Section and Sub-section, two drop lists like the website's menu: Kindergarten › Alphabet ›
   A-Z Letter Tracing. The sub-sections follow the section picked; "+ New section…" and
   "+ New sub-section…" type a new name, made when the sheet is saved (place.js, ensurePlace).
   value = { group, newGroup, sub, newSub }: group is a section's id ('' = none, '+new' = typed),
   sub a sub-section's id ('+new' = typed). A new class has no sections yet. */
export const NO_PLACE = { group: '', newGroup: '', sub: '', newSub: '' };

/* where a sheet starts: its own sub-section, or the one a new sheet was started from */
export function placeOf(sections, id) {
  const x = id && (sections || []).find(s => s.id === id);
  return x ? { ...NO_PLACE, group: x.group || OTHER, sub: x.id } : NO_PLACE;
}

/* what is missing before the sheet can be saved, as { group } or { sub } */
export function placeProblem(v) {
  if (v.group === '+new' && !v.newGroup.trim()) return { group: 'Type the name of the new section, e.g. Story time.' };
  if (v.group && v.group !== '+new' && !v.sub) return { sub: 'Pick a sub-section, or "+ New sub-section" to add one.' };
  if ((v.group === '+new' || v.sub === '+new') && !v.newSub.trim()) return { sub: 'Type the name of the new sub-section, e.g. Animal stories.' };
  return null;
}

export default function SectionPicker({ id, sections, cls, newClass, value, onChange, errs = {} }) {
  const groups = useMemo(() => (newClass ? [] : groupsOfClass(sections, cls)), [sections, cls, newClass]);
  const { group, newGroup, sub, newSub } = value;
  const g = groups.find(x => x.id === group);
  const subs = g ? g.subs : [];
  const typing = group === '+new' || sub === '+new';
  const set = patch => onChange({ ...value, ...patch });
  const groupName = group === '+new' ? newGroup.trim() : g ? g.label : '';
  const picked = subs.find(x => x.id === sub);

  const groupNote = group === '+new' ? (newGroup.trim() ? 'New section "' + newGroup.trim() + '" is made when you save.' : 'Type its name.')
    : g ? plural(subs.length, 'sub-section') + ' in ' + g.label + '.'
    : 'Pick a section, or "+ New section" to add one. None: the class shelf only.';
  const subNote = !group ? 'Pick a section first.'
    : typing ? (newSub.trim() ? 'New sub-section "' + newSub.trim() + '" is made in ' + (groupName || 'the new section') + ' when you save.' : 'Type its name.')
    : picked ? 'Goes into ' + g.label + ' › ' + picked.label + '.'
    : 'Pick one, or "+ New sub-section" to add one.';
  const bad = k => (errs[k] ? <small className="bad">{errs[k]}</small> : null);

  return (
    <>
      <div className="field"><label htmlFor={id + 'Grp'}>Section</label>
        <select id={id + 'Grp'} value={group} aria-invalid={!!errs.group}
          onChange={e => { const v = e.target.value; onChange({ group: v, newGroup: '', sub: v === '+new' ? '+new' : '', newSub: '' }); }}>
          <option value="">None</option>
          {groups.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          <option value="+new">+ New section…</option>
        </select>
        {group === '+new' ? <input aria-label="New section name" value={newGroup} onChange={e => set({ newGroup: e.target.value })} placeholder="e.g. Story time" maxLength={60} autoComplete="off" autoFocus /> : null}
        {bad('group') || <small>{groupNote}</small>}</div>
      <div className="field"><label htmlFor={id + 'Sub'}>Sub-section</label>
        {group === '+new' ? null : <select id={id + 'Sub'} value={sub} disabled={!group} aria-invalid={!!errs.sub} onChange={e => set({ sub: e.target.value, newSub: '' })}>
          <option value="">{group ? 'Choose a sub-section…' : '—'}</option>
          {subs.map(x => <option key={x.id} value={x.id}>{x.label}{x.visible === false ? ' (hidden)' : ''}</option>)}
          {group ? <option value="+new">+ New sub-section…</option> : null}
        </select>}
        {typing ? <input id={group === '+new' ? id + 'Sub' : undefined} aria-label="New sub-section name" value={newSub} onChange={e => set({ newSub: e.target.value })} placeholder="e.g. Animal stories" maxLength={60} autoComplete="off" autoFocus={sub === '+new' && group !== '+new'} /> : null}
        {bad('sub') || <small>{subNote}</small>}</div>
    </>
  );
}

/* "Kindergarten › Alphabet › A-Z Letter Tracing": where the sheet shows, in one line */
export function placePath(className, sections, cls, value) {
  const g = groupsOfClass(sections, cls).find(x => x.id === value.group);
  const sec = value.group === '+new' ? value.newGroup.trim() : g ? g.label : '';
  const sub = value.group === '+new' || value.sub === '+new' ? value.newSub.trim() : g ? ((g.subs.find(x => x.id === value.sub) || {}).label || '') : '';
  return [className, sec, sub].filter(Boolean).join(' › ');
}
