import { useState } from 'react';
import { ABOUT, CHAPTER, CONTACT, HOME, PRODUCTS, SHEETS, TESTIMONIALS, WHAT_WE_DO, WORKSHEETS } from '../../content';
import { isEmail } from '../../lib/authStore';
import { Alert, Field } from '../auth/FormBits';
import { Magnetic, SplitWords } from '../ui/Motion';
import SiteChapter, { Stats, Ticks } from './SiteChapter';
import { InfoCard, ProductCard } from './Cards';
import TestimonialCarousel from './TestimonialCarousel';
import Footer from './Footer';

/* ---------- 01 Home ---------- */
export function Home({ section, anim, onGo }) {
  return (
    <SiteChapter index={CHAPTER.home} section={section} anim={anim}>
      <div className="rise" style={{ '--i': 0 }}><div className="badge">{HOME.badge}</div></div>
      <SplitWords as="h1" className="display rise" style={{ '--i': 1 }} delay={200} text={HOME.title} />
      <p className="lede rise" style={{ '--i': 2 }}>{HOME.lede}</p>
      <div className="btn-row rise" style={{ '--i': 3 }}>
        <Magnetic><button type="button" className="btn btn-primary" onClick={() => onGo(HOME.primary.go)}>{HOME.primary.label}</button></Magnetic>
        <Magnetic><button type="button" className="btn btn-ghost" onClick={() => onGo(HOME.secondary.go)}>{HOME.secondary.label}</button></Magnetic>
      </div>
      <Stats items={HOME.stats} className="rise" style={{ '--i': 4, marginTop: 36, maxWidth: 620 }} />
    </SiteChapter>
  );
}

/* ---------- 02 What we do ---------- */
export function WhatWeDo({ section, anim }) {
  return (
    <SiteChapter index={CHAPTER.whatWeDo} section={section} anim={anim}>
      <p className="eyebrow rise" style={{ '--i': 0 }}>{WHAT_WE_DO.eyebrow}</p>
      <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={WHAT_WE_DO.title} />
      <p className="lede rise" style={{ '--i': 2 }}>{WHAT_WE_DO.lede}</p>
      <div className="grid-3 rise" style={{ '--i': 3 }}>
        {WHAT_WE_DO.cards.map(c => <InfoCard key={c.title} mark={c.mark} title={c.title} text={c.text} />)}
      </div>
      <div className="rise" style={{ '--i': 4, maxWidth: 620 }}>
        <Ticks items={WHAT_WE_DO.ticks} />
      </div>
    </SiteChapter>
  );
}

/* ---------- 03 Sheets ---------- */
export function Sheets({ section, anim, onAdd, owned, onClaim, onLibrary }) {
  return (
    <SiteChapter index={CHAPTER.sheets} section={section} anim={anim}>
      <p className="eyebrow rise" style={{ '--i': 0 }}>{SHEETS.eyebrow}</p>
      <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={SHEETS.title} />
      <p className="lede rise" style={{ '--i': 2 }}>{SHEETS.lede}</p>
      <div className="grid-3 rise" style={{ '--i': 3 }}>
        {PRODUCTS.filter(p => p.group === 'sheets').map(p => <ProductCard key={p.id} product={p} onAdd={onAdd} owned={owned.has(p.id)} onClaim={onClaim} onLibrary={onLibrary} />)}
      </div>
    </SiteChapter>
  );
}

/* ---------- 04 Worksheets ---------- */
export function Worksheets({ section, anim, onAdd, owned, onClaim, onLibrary }) {
  return (
    <SiteChapter index={CHAPTER.worksheets} section={section} anim={anim}>
      <p className="eyebrow rise" style={{ '--i': 0 }}>{WORKSHEETS.eyebrow}</p>
      <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={WORKSHEETS.title} />
      <p className="lede rise" style={{ '--i': 2 }}>{WORKSHEETS.lede}</p>
      <div className="grid-3 rise" style={{ '--i': 3 }}>
        {PRODUCTS.filter(p => p.group === 'worksheets').map(p => <ProductCard key={p.id} product={p} onAdd={onAdd} owned={owned.has(p.id)} onClaim={onClaim} onLibrary={onLibrary} />)}
      </div>
    </SiteChapter>
  );
}

/* ---------- 05 About us ---------- */
const panelText = { color: 'var(--fg-muted)', fontSize: '0.94rem', lineHeight: 1.6, marginTop: 8 };

export function About({ section, anim }) {
  return (
    <SiteChapter index={CHAPTER.about} section={section} anim={anim}>
      <p className="eyebrow rise" style={{ '--i': 0 }}>{ABOUT.eyebrow}</p>
      <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={ABOUT.title} />
      <div className="grid-2 rise" style={{ '--i': 2 }}>
        <div className="panel">
          <h3>{ABOUT.why.title}</h3>
          <p style={panelText}>{ABOUT.why.text}</p>
          <Ticks items={ABOUT.why.ticks} />
        </div>
        <div className="panel">
          <h3>{ABOUT.how.title}</h3>
          <p style={panelText}>{ABOUT.how.text}</p>
          <Stats items={ABOUT.how.stats} style={{ gridTemplateColumns: '1fr 1fr', marginTop: 16 }} />
        </div>
      </div>
    </SiteChapter>
  );
}

/* ---------- 06 Contact us ---------- */
export function Contact({ section, anim }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState({});
  const [alert, setAlert] = useState(null);

  function submit(e) {
    e.preventDefault();
    setAlert(null);
    const next = {};
    if (!name.trim()) next.name = CONTACT.errors.name;
    if (!isEmail(email)) next.email = CONTACT.errors.email;
    if (msg.trim().length < 10) next.msg = CONTACT.errors.message;
    setErrors(next);
    if (Object.keys(next).length) return;
    setName(''); setEmail(''); setMsg('');
    setAlert({ type: 'ok', msg: CONTACT.success });
  }

  return (
    <SiteChapter index={CHAPTER.contact} section={section} anim={anim}>
      <p className="eyebrow rise" style={{ '--i': 0 }}>{CONTACT.eyebrow}</p>
      <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={CONTACT.title} />
      <div className="grid-2 rise" style={{ '--i': 2 }}>
        <form className="panel" onSubmit={submit} noValidate>
          <Alert alert={alert} />
          <div className="row-2">
            <Field id="ctName" label="Name" error={errors.name}>
              <input id="ctName" type="text" placeholder={CONTACT.namePlaceholder} value={name} onChange={e => setName(e.target.value)} />
            </Field>
            <Field id="ctEmail" label="Email" error={errors.email}>
              <input id="ctEmail" type="email" placeholder={CONTACT.emailPlaceholder} value={email} onChange={e => setEmail(e.target.value)} />
            </Field>
          </div>
          <Field id="ctMsg" label="Message" error={errors.msg}>
            <textarea id="ctMsg" placeholder={CONTACT.messagePlaceholder} value={msg} onChange={e => setMsg(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary btn-block">{CONTACT.submit}</button>
        </form>
        <div className="panel">
          {CONTACT.lines.map(line => (
            <div className="contact-line" key={line.label}>
              <span>{line.icon}</span>
              <div>
                <h4>{line.label}</h4>
                {line.href ? <a href={line.href}>{line.text}</a> : <p>{line.text}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SiteChapter>
  );
}

/* ---------- 07 Testimonials ---------- */
export function Testimonials({ section, anim, onGo }) {
  return (
    <SiteChapter index={CHAPTER.testimonials} section={section} anim={anim}>
      <p className="eyebrow rise" style={{ '--i': 0 }}>{TESTIMONIALS.eyebrow}</p>
      <SplitWords as="h2" className="h2 rise" style={{ '--i': 1 }} delay={200} text={TESTIMONIALS.title} />
      <p className="lede rise" style={{ '--i': 2 }}>{TESTIMONIALS.lede}</p>
      <div className="rise" style={{ '--i': 3 }}>
        <TestimonialCarousel active={section === CHAPTER.testimonials} />
      </div>
      <Stats items={TESTIMONIALS.stats} className="rise" style={{ '--i': 4, marginTop: 18 }} />
      <div className="rise" style={{ '--i': 5 }}><Footer onGo={onGo} /></div>
    </SiteChapter>
  );
}
