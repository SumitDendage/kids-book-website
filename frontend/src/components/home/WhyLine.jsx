import { useEffect, useMemo, useState } from 'react';

const TYPE_MS = 55, ERASE_MS = 24, HOLD_MS = 2600, START_MS = 450, STILL_MS = 4200;

/* a new little question every few seconds — the kind children ask — typed out letter
   by letter with a blinking cursor, then rubbed out for the next one. With reduced
   motion the questions simply change. Screen readers hear each question once. */
export default function WhyLine({ whys }) {
  const still = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const [step, setStep] = useState({ i: 0, n: 0, erasing: false });
  const text = whys.length ? whys[step.i % whys.length] : '';

  useEffect(() => {
    let delay, next;
    if (still) { delay = STILL_MS; next = { i: step.i + 1, n: 0, erasing: false }; }
    else if (!step.erasing && step.n < text.length) { delay = step.n ? TYPE_MS : START_MS; next = { ...step, n: step.n + 1 }; }
    else if (!step.erasing) { delay = HOLD_MS; next = { ...step, erasing: true }; }
    else if (step.n > 0) { delay = ERASE_MS; next = { ...step, n: Math.min(step.n, text.length) - 1 }; }
    else { delay = 0; next = { i: step.i + 1, n: 0, erasing: false }; }
    const t = setTimeout(() => setStep(next), delay);
    return () => clearTimeout(t);
  }, [step, text, still]);

  return (
    <>
      <span className="sr-only">{text}</span>
      {/* the hidden full line keeps the space steady while the letters come and go */}
      <em id="whyLine" aria-hidden="true">
        <span className="why-ghost">{text}</span>
        <span className="why-typed">{still ? text : text.slice(0, step.n)}<i className="why-caret" /></span>
      </em>
    </>
  );
}
