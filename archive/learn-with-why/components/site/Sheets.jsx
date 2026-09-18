'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { CLASSES, SHEETS, SHEETS_COPY, SUBJECTS, classById, isFree, money, subjectById } from '@/lib/content';
import { springs } from '@/lib/motion';
import { useStore } from '@/lib/store';
import { Reveal, SplitWords, Tilt } from '@/components/ui/Motion';
import RingGallery from './RingGallery';

function LockIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

/* One sheet on the shelf. Free sheets open straight into the Library; paid
   ones show the price with a lock and unlock through the bag or Pay now. */
export function SheetCard({ sheet, index = 0 }) {
  const { owned, claimFree, addToCart } = useStore();
  const router = useRouter();
  const free = isFree(sheet);
  const mine = owned.has(sheet.id);
  const subject = subjectById(sheet.subject);
  const cls = classById(sheet.cls);
  const go = () => router.push('/sheets/' + sheet.id);
  const primary = async e => {
    e.preventDefault(); e.stopPropagation();
    if (mine) { router.push('/library'); return; }
    if (free) { if (await claimFree(sheet.id)) router.push('/library'); return; }
    addToCart(sheet.id);
  };
  return (
    <Tilt as="article" className="card" style={{ '--hue': subject.hue }} onClick={go} role="link" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') go(); }}
      initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -10% 0px' }} transition={{ ...springs.ui, delay: (index % 6) * 0.06 }}>
      <div className="thumb" aria-hidden="true">
        <small>{cls.label}</small>
        {sheet.glyph}
        <span className="shine" />
        {free ? <b className="free-tag">{SHEETS_COPY.free}</b> : !mine && <span className="lock"><LockIcon /></span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}><span className="tag subject" style={{ '--hue': subject.hue }}>{subject.label}</span><span className="tag">{SHEETS_COPY.pages(sheet.pages)}</span></div>
      <h3>{sheet.title}</h3>
      <p>{sheet.blurb}</p>
      <div className="meta">
        <span className={'price' + (free ? ' free' : '')}>{free ? SHEETS_COPY.free : money(sheet.price)}{sheet.was ? <small>{money(sheet.was)}</small> : null}</span>
      </div>
      <div className="card-actions">
        <motion.button type="button" className="btn btn-primary" onClick={primary} whileTap={{ scale: 0.95 }}>
          {mine ? SHEETS_COPY.inLibrary : free ? SHEETS_COPY.open : SHEETS_COPY.locked}
        </motion.button>
        <Link className="btn btn-ghost" href={'/sheets/' + sheet.id} onClick={e => e.stopPropagation()}>{SHEETS_COPY.details}</Link>
      </div>
    </Tilt>
  );
}

export default function Sheets() {
  const [cls, setCls] = useState(CLASSES[0].id);
  const [subject, setSubject] = useState('all');
  const subjectsHere = useMemo(() => SUBJECTS.filter(s => SHEETS.some(x => x.cls === cls && x.subject === s.id)), [cls]);
  const list = useMemo(() => SHEETS.filter(s => s.cls === cls && (subject === 'all' || s.subject === subject)), [cls, subject]);
  const featured = useMemo(() => SHEETS.filter((_, i) => i % 2 === 0).slice(0, 11), []);
  const pickClass = id => { setCls(id); setSubject('all'); };

  return (
    <div className="sheets" id="sheets">
      <div className="container">
        <Reveal><p className="eyebrow">{SHEETS_COPY.eyebrow}</p></Reveal>
        <SplitWords as="h2" className="h2" text={SHEETS_COPY.title} />
        <Reveal><p className="lede">{SHEETS_COPY.lede}</p></Reveal>

        <Reveal y={30}><RingGallery sheets={featured} /></Reveal>

        <div className="filters">
          <Reveal className="chips" aria-label="Class">
            {CLASSES.map(c => (
              <button key={c.id} type="button" className={'chip' + (cls === c.id ? ' on' : '')} onClick={() => pickClass(c.id)}>
                {cls === c.id && <motion.span className="chip-bg" layoutId="class-chip" transition={springs.ui} />}
                {c.label}<small>{c.ages}</small>
              </button>
            ))}
          </Reveal>
          <Reveal className="chips" aria-label="Subject" delay={0.05}>
            <button type="button" className={'chip subject' + (subject === 'all' ? ' on' : '')} style={{ '--hue': 36 }} onClick={() => setSubject('all')}>
              {subject === 'all' && <motion.span className="chip-bg" layoutId="subject-chip" transition={springs.ui} />}{SHEETS_COPY.all}
            </button>
            {subjectsHere.map(s => (
              <button key={s.id} type="button" className={'chip subject' + (subject === s.id ? ' on' : '')} style={{ '--hue': s.hue }} onClick={() => setSubject(s.id)}>
                {subject === s.id && <motion.span className="chip-bg" layoutId="subject-chip" transition={springs.ui} />}{s.label}
              </button>
            ))}
          </Reveal>
        </div>

        <motion.div className="grid" layout>
          <AnimatePresence mode="popLayout">
            {list.map((s, i) => (
              <motion.div key={s.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={springs.ui}>
                <SheetCard sheet={s} index={i} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
        {!list.length && <p className="cart-empty">{SHEETS_COPY.empty}</p>}
      </div>
    </div>
  );
}
