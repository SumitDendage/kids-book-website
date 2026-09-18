'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { ABOUT, BRAND, CONTACT, FOOTER, NAV, TESTIMONIALS } from '@/lib/content';
import { springs } from '@/lib/motion';
import { isEmail } from '@/lib/authStore';
import { Mark } from '@/components/ui/Logo';
import { CountUp, Reveal, SplitWords, Tilt } from '@/components/ui/Motion';

/* ---------- About ---------- */
export function About() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [-40, 40]);   /* the picture drifts slower than the page */
  return (
    <section className="section about" id="about" ref={ref}>
      <div className="container about-grid">
        <div>
          <Reveal><p className="eyebrow">{ABOUT.eyebrow}</p></Reveal>
          <SplitWords as="h2" className="h2" text={ABOUT.title} />
          <Reveal><p className="lede">{ABOUT.lede}</p></Reveal>
          <div className="grid-2">
            <Reveal className="panel"><h3>{ABOUT.why.title}</h3><p>{ABOUT.why.text}</p></Reveal>
            <Reveal className="panel" delay={0.08}><h3>{ABOUT.how.title}</h3><p>{ABOUT.how.text}</p></Reveal>
          </div>
          <Reveal><ul className="ticks">{ABOUT.ticks.map(t => <li key={t}>{t}</li>)}</ul></Reveal>
        </div>
        <div>
          <Reveal className="about-art" y={40}>
            <motion.img src="/frames/frame_050.jpg" alt="A fox and a rabbit in graduation caps reading a glowing book on a tree stump" style={{ y }} />
            <div className="glass-quote">“Guess first. Look it up after.” — Fox’s only rule</div>
          </Reveal>
          <Reveal className="stats" style={{ marginTop: 16 }} delay={0.1}>
            {ABOUT.stats.map(s => <div className="stat" key={s.label}><b><CountUp value={s.value} /></b><span>{s.label}</span></div>)}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- Testimonials: one quote centred, neighbours peeking ---------- */
const AUTO_MS = 5200;
export function Testimonials() {
  const quotes = TESTIMONIALS.quotes;
  const n = quotes.length, half = Math.floor(n / 2);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const go = d => setIndex(i => (i + d + n) % n);
  useEffect(() => {
    if (reduce || paused) return undefined;
    const t = setInterval(() => go(1), AUTO_MS);
    return () => clearInterval(t);
  }, [reduce, paused]);
  const dragEnd = (_, info) => { const s = info.offset.x + info.velocity.x * 0.2; if (s < -60) go(1); else if (s > 60) go(-1); };
  return (
    <section className="section" id="testimonials">
      <div className="container">
        <Reveal><p className="eyebrow">{TESTIMONIALS.eyebrow}</p></Reveal>
        <SplitWords as="h2" className="h2" text={TESTIMONIALS.title} />
        <Reveal><p className="lede">{TESTIMONIALS.lede}</p></Reveal>
        <Reveal onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
          <div className="carousel-track">
            {quotes.map((q, i) => {
              const offset = ((i - index + n + half) % n) - half;
              const on = offset === 0;
              return (
                <motion.div key={q.name} animate={{ x: offset * 104 + '%', scale: on ? 1 : 0.9, opacity: on ? 1 : 0.35 }} transition={springs.ui} drag={on ? 'x' : false} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.25} onDragEnd={dragEnd} style={{ pointerEvents: on ? 'auto' : 'none', zIndex: on ? 2 : 1 }} aria-hidden={!on}>
                  <Tilt as="article" className="panel quote" max={4}>
                    <div className="stars" aria-label="5 out of 5">★★★★★</div>
                    <blockquote>“{q.text}”</blockquote>
                    <div className="who"><span className="avatar" aria-hidden="true">{q.initials}</span><div><h4>{q.name}</h4><span>{q.meta}</span></div></div>
                  </Tilt>
                </motion.div>
              );
            })}
          </div>
          <div className="carousel-nav">
            <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Previous review">←</button>
            <div className="carousel-dots">{quotes.map((q, i) => <button key={q.name} type="button" className={'carousel-dot' + (i === index ? ' on' : '')} onClick={() => setIndex(i)} aria-label={'Review ' + (i + 1)} />)}</div>
            <button type="button" className="icon-btn" onClick={() => go(1)} aria-label="Next review">→</button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Contact ---------- */
export function Contact() {
  const [form, setForm] = useState({ name: '', email: '', msg: '' });
  const [errors, setErrors] = useState({});
  const [ok, setOk] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  function submit(e) {
    e.preventDefault();
    const next = {};
    if (!form.name.trim()) next.name = CONTACT.errors.name;
    if (!isEmail(form.email)) next.email = CONTACT.errors.email;
    if (form.msg.trim().length < 10) next.msg = CONTACT.errors.message;
    setErrors(next);
    if (Object.keys(next).length) return;
    setForm({ name: '', email: '', msg: '' });
    setOk(true);
  }
  return (
    <section className="section" id="contact">
      <div className="container">
        <Reveal><p className="eyebrow">{CONTACT.eyebrow}</p></Reveal>
        <SplitWords as="h2" className="h2" text={CONTACT.title} />
        <Reveal><p className="lede">{CONTACT.lede}</p></Reveal>
        <div className="grid-2">
          <Reveal as="form" className="panel" onSubmit={submit} noValidate>
            {ok && <motion.div className="alert ok" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>{CONTACT.success}</motion.div>}
            <div className="row-2">
              <div className={'field' + (errors.name ? ' bad' : '')}><label htmlFor="ctName">Name</label><input id="ctName" type="text" placeholder={CONTACT.name} value={form.name} onChange={set('name')} /><div className="err">{errors.name || ''}</div></div>
              <div className={'field' + (errors.email ? ' bad' : '')}><label htmlFor="ctEmail">Email</label><input id="ctEmail" type="email" placeholder={CONTACT.email} value={form.email} onChange={set('email')} /><div className="err">{errors.email || ''}</div></div>
            </div>
            <div className={'field' + (errors.msg ? ' bad' : '')}><label htmlFor="ctMsg">Message</label><textarea id="ctMsg" placeholder={CONTACT.message} value={form.msg} onChange={set('msg')} /><div className="err">{errors.msg || ''}</div></div>
            <motion.button type="submit" className="btn btn-primary btn-block" whileTap={{ scale: 0.97 }}>{CONTACT.submit}</motion.button>
          </Reveal>
          <Reveal className="panel" delay={0.08}>
            {CONTACT.lines.map(l => (
              <div className="contact-line" key={l.label}><div><h4>{l.label}</h4>{l.href ? <a href={l.href}>{l.text}</a> : <p>{l.text}</p>}</div></div>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
export function Footer() {
  return (
    <footer className="footer">
      <Reveal className="container footer-grid" y={16}>
        <Link href="/" className="nav-brand"><Mark color="var(--fg)" /><span>{BRAND.name.split(' ')[0]}<small>{BRAND.name.split(' ').slice(1).join(' ')}</small></span></Link>
        <nav aria-label="Footer">{NAV.map(n => <a key={n.id} href={'/#' + n.id}>{n.label}</a>)}<Link href="/library">My Library</Link></nav>
        <div className="fine"><span>{FOOTER.tagline}</span><span>© {new Date().getFullYear()} {BRAND.name} · <a href={'mailto:' + BRAND.email}>{BRAND.email}</a></span></div>
      </Reveal>
    </footer>
  );
}
