/* Where a sheet goes, like the website's menu: a class (Kindergarten, Class 1 …), a section in it
   (Alphabet, Vocabulary …) and a sub-section in that (A-Z Letter Tracing, Colours …), plus its
   subject. Staff pick one that is there or type a new name; what is new is made on the server just
   before the sheet is saved. On the server a sub-section is a row of `sections`, and the section it
   sits in is that row's group (group id and group label). */
import { staffApi } from '../../services/api.js';

const low = s => String(s || '').trim().toLowerCase();
export const sameName = (a, b) => low(a) === low(b);

/* a short id for a new class: "Class 4" → c4, "Nursery" → nursery (12 letters and digits at most) */
export function classIdFor(name, classes) {
  const n = /^\s*(?:class|std|standard|grade)\s*(\d{1,2})\s*$/i.exec(name);
  let id = n ? 'c' + Number(n[1]) : low(name).replace(/[^a-z0-9]/g, '').slice(0, 10) || 'class';
  const taken = new Set((classes || []).map(c => c.id));
  for (let i = 2, base = id.slice(0, 10); taken.has(id); i++) id = base + i;
  return id;
}

/* the sub-sections of one class */
export const sectionsOfClass = (sections, cls) => (sections || []).filter(x => (x.cls || 'kg') === cls);

/* sub-sections that sit in no section (made before sections had sub-sections) are listed as "Other" */
export const OTHER = '~other';
/* the website shows these two first: Kindergarten › Alphabet, Vocabulary */
const FIRST = ['alpha', 'vocab'];
/* the sections of one class, each with its sub-sections: Alphabet and Vocabulary first, then the
   rest in the order staff set (Admin → Categories), then "Other" */
export function groupsOfClass(sections, cls) {
  const m = new Map();
  sectionsOfClass(sections, cls).forEach(x => {
    const id = x.group || OTHER;
    if (!m.has(id)) m.set(id, { id, label: x.group ? x.groupLabel || x.group : 'Other', sort: x.sort || 0, subs: [] });
    const g = m.get(id);
    g.subs.push(x);
    if ((x.sort || 0) < g.sort) g.sort = x.sort || 0;
  });
  const tier = g => (g.id === OTHER ? 2 : FIRST.includes(g.id) ? 0 : 1);
  const list = [...m.values()].sort((a, b) => (tier(a) - tier(b)) || (FIRST.indexOf(a.id) - FIRST.indexOf(b.id)) || (a.sort - b.sort) || a.label.localeCompare(b.label));
  list.forEach(g => g.subs.sort((a, b) => ((a.sort || 0) - (b.sort || 0)) || a.label.localeCompare(b.label)));
  return list;
}

/* a short id for a new section: "Story time" → story-time, one no other section has */
export function groupIdFor(name, sections) {
  const base = low(name).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '') || 'section';
  const taken = new Set((sections || []).map(x => x.group).filter(Boolean));
  let id = base;
  for (let i = 2; taken.has(id); i++) id = base + '-' + i;
  return id;
}
const tidy = s => String(s || '').trim().replace(/\s+/g, ' ');

/* makes what is missing and gives back { cls, subject, section } for the sheet (section is the
   server's sub-section row, or null for the class shelf). group is a section's id (OTHER for none),
   sub a sub-section's id; newClass, newGroup and newSub are typed names. onMade(kind, answer)
   passes each new list back. */
export async function ensurePlace({ classes, subjects, sections, cls, newClass, subject, group, newGroup, sub, newSub }, onMade) {
  let clsId = cls;
  if (newClass && newClass.trim()) {
    const name = tidy(newClass);
    const old = (classes || []).find(c => sameName(c.name, name));
    if (old) clsId = old.id;
    else {
      clsId = classIdFor(name, classes);
      /* a new class starts as "Coming soon" on the website; staff open it once its sheets are ready */
      const r = await staffApi('PUT', '/api/admin/classes', { classes: [{ id: clsId, name, status: 'coming_soon', sort: 100 }] });
      if (onMade) onMade('classes', r);
    }
  }
  let subj = tidy(subject);
  if (subj) {
    const old = (subjects || []).find(x => sameName(x.name, subj));
    if (old) subj = old.name;
    else { const r = await staffApi('POST', '/api/admin/subjects', { name: subj }); subj = r.subject.name; if (onMade) onMade('subjects', r); }
  }
  const picked = sub && (sections || []).find(x => x.id === sub);
  if (picked) return { cls: clsId, subject: subj, section: picked };
  const subName = tidy(newSub);
  if (!subName) return { cls: clsId, subject: subj, section: null };
  /* the section: one of the class's, found by name when typed, or a new one */
  const inClass = sectionsOfClass(sections, clsId);
  const groupName = tidy(newGroup);
  let gid = group && group !== OTHER && group !== '+new' ? group : null, glabel = null;
  if (groupName) {
    const old = inClass.find(x => x.group && sameName(x.groupLabel || x.group, groupName));
    if (old) { gid = old.group; glabel = old.groupLabel || null; } else { gid = groupIdFor(groupName, sections); glabel = groupName; }
  } else if (gid) glabel = (inClass.find(x => x.group === gid) || {}).groupLabel || null;
  /* the sub-section: one already in that section with the same name, or a new one after the others */
  const mates = inClass.filter(x => (x.group || null) === gid);
  const old = mates.find(x => sameName(x.label, subName));
  if (old) return { cls: clsId, subject: subj, section: old };
  const body = { label: subName, cls: clsId, group: gid, groupLabel: glabel };
  if (mates.length) body.sort = Math.max(...mates.map(x => x.sort || 0)) + 10;
  const r = await staffApi('POST', '/api/admin/sections', body);
  if (onMade) onMade('sections', r);
  return { cls: clsId, subject: subj, section: r.section };
}

/* the sheet's fields for its section */
export const sectionFields = sec => (sec ? { group: sec.group || null, section: sec.id, sectionLabel: sec.label } : { group: null, section: null, sectionLabel: null });
