/* Where a sheet goes: its class, subject and website section. Staff pick one that is there or type
   a new name; a new class, subject or section is made on the server just before the sheet is saved. */
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

/* the sections of one class, Alphabet and Vocabulary first, then the rest by name */
export const sectionsOfClass = (sections, cls) => (sections || []).filter(x => (x.cls || 'kg') === cls);

/* makes what is missing and gives back { cls, subject, section } for the sheet (section is the
   server's section row, or null for none). onMade(kind, answer) passes each new list back. */
export async function ensurePlace({ classes, subjects, sections, cls, newClass, subject, section }, onMade) {
  let clsId = cls;
  if (newClass && newClass.trim()) {
    const name = newClass.trim().replace(/\s+/g, ' ');
    const old = (classes || []).find(c => sameName(c.name, name));
    if (old) clsId = old.id;
    else {
      clsId = classIdFor(name, classes);
      /* a new class starts as "Coming soon" on the website; staff open it once its sheets are ready */
      const r = await staffApi('PUT', '/api/admin/classes', { classes: [{ id: clsId, name, status: 'coming_soon', sort: 100 }] });
      if (onMade) onMade('classes', r);
    }
  }
  let subj = String(subject || '').trim().replace(/\s+/g, ' ');
  if (subj) {
    const old = (subjects || []).find(x => sameName(x.name, subj));
    if (old) subj = old.name;
    else { const r = await staffApi('POST', '/api/admin/subjects', { name: subj }); subj = r.subject.name; if (onMade) onMade('subjects', r); }
  }
  let sec = null;
  const secName = String(section || '').trim().replace(/\s+/g, ' ');
  if (secName) {
    sec = sectionsOfClass(sections, clsId).find(x => sameName(x.label, secName)) || null;
    if (!sec) { const r = await staffApi('POST', '/api/admin/sections', { label: secName, cls: clsId }); sec = r.section; if (onMade) onMade('sections', r); }
  }
  return { cls: clsId, subject: subj, section: sec };
}

/* the sheet's fields for its section */
export const sectionFields = sec => (sec ? { group: sec.group || null, section: sec.id, sectionLabel: sec.label } : { group: null, section: null, sectionLabel: null });
