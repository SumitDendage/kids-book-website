'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { CART, DETAIL, LICENCES, SHEETS, classById, isFree, money, subjectById } from '@/lib/content';
import { springs } from '@/lib/motion';
import { licence } from '@/lib/libraryStore';
import { pagesFor } from '@/lib/pages';
import { useStore } from '@/lib/store';
import { Reveal, SplitWords, Magnetic } from '@/components/ui/Motion';
import { Sheet } from '@/components/library/Library';
import { SheetCard } from './Sheets';

/* One sheet: what's inside, three preview pages, licence and Pay now.
   Free sheets open straight into the Library; paid ones can be paid for
   here (one-click checkout) or added to the bag. */
export default function SheetDetail({ sheet }) {
  const { owned, claimFree, addToCart, checkout } = useStore();
  const router = useRouter();
  const [lic, setLic] = useState(LICENCES[0].id);
  const [busy, setBusy] = useState(false);
  const free = isFree(sheet), mine = owned.has(sheet.id);
  const subject = subjectById(sheet.subject), cls = classById(sheet.cls);
  const pages = pagesFor(sheet);
  const price = sheet.price * licence(lic).factor;
  const related = SHEETS.filter(s => s.cls === sheet.cls && s.id !== sheet.id).slice(0, 3);

  async function payNow() {
    setBusy(true);
    try {
      if (mine) { router.push('/library'); return; }
      const ok = free ? await claimFree(sheet.id) : await checkout([{ productId: sheet.id, licence: lic, qty: 1 }]);
      if (ok) router.push('/library');
    } finally { setBusy(false); }
  }

  return (
    <main className="detail container" style={{ '--hue': subject.hue }}>
      <Reveal y={10}><Link href="/#sheets" className="back">← {DETAIL.back}</Link></Reveal>
      <div className="detail-grid">
        <div>
          <motion.div className="cover" initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={springs.ui}>
            {sheet.glyph}
            {free && <b className="free-tag">{DETAIL.free}</b>}
          </motion.div>
          <Reveal delay={0.15}>
            <p className="eyebrow" style={{ marginTop: 28 }}>{DETAIL.preview}</p>
            <div className="preview-row">{pages.slice(0, 3).map(p => <Sheet key={p.n} sheet={sheet} page={p} total={pages.length} mark="Preview" />)}</div>
          </Reveal>
        </div>
        <div>
          <Reveal>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}><span className="tag">{cls.label}</span><span className="tag subject" style={{ '--hue': subject.hue }}>{subject.label}</span><span className="tag">{sheet.pages} pages</span></div>
          </Reveal>
          <SplitWords as="h1" className="h2" text={sheet.title} delay={150} />
          <Reveal delay={0.1}><p className="lede">{sheet.blurb}</p></Reveal>
          <Reveal className="panel buy" delay={0.2}>
            <p className="eyebrow">{DETAIL.what}</p>
            <div className="skills">{sheet.skills.map(s => <span className="tag" key={s}>{s}</span>)}</div>
            <p className="eyebrow" style={{ marginTop: 22 }}>{DETAIL.licence}</p>
            {!free && (
              <select value={lic} onChange={e => setLic(e.target.value)} aria-label={DETAIL.licence}>
                {LICENCES.map(l => <option key={l.id} value={l.id}>{l.label} · {DETAIL.copies(l.copies)} · {money(sheet.price * l.factor)}</option>)}
              </select>
            )}
            <div className="meta" style={{ margin: '12px 0 16px' }}>
              <span className={'price' + (free ? ' free' : '')}>{free ? DETAIL.free : money(price)}{sheet.was && !free ? <small>{money(sheet.was)}</small> : null}</span>
              {free && <span>{DETAIL.copies(1)}</span>}
            </div>
            <div className="btn-row">
              <Magnetic><motion.button type="button" className="btn btn-primary" onClick={payNow} disabled={busy} whileTap={{ scale: 0.96 }}>{mine ? DETAIL.inLibrary : free ? DETAIL.openFree : DETAIL.payNow}</motion.button></Magnetic>
              {!free && !mine && <button type="button" className="btn btn-ghost" onClick={() => addToCart(sheet.id, lic)}>{CART.add}</button>}
            </div>
            <p className="note">{DETAIL.note}</p>
          </Reveal>
        </div>
      </div>
      {related.length > 0 && (
        <div style={{ marginTop: 'var(--s8)' }}>
          <Reveal><p className="eyebrow">{DETAIL.related}</p></Reveal>
          <div className="grid">{related.map((s, i) => <SheetCard key={s.id} sheet={s} index={i} />)}</div>
        </div>
      )}
    </main>
  );
}
