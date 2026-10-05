import { useEffect, useRef, useState } from 'react';

/* a new little question every few seconds — the kind children ask */
export default function WhyLine({ whys }) {
  const [i, setI] = useState(0);
  const [swap, setSwap] = useState(false);
  const list = useRef(whys);
  list.current = whys;
  useEffect(() => {
    let t2 = 0;
    const t = setInterval(() => { setSwap(true); t2 = setTimeout(() => { setI(n => (n + 1) % list.current.length); setSwap(false); }, 500); }, 4200);
    return () => { clearInterval(t); clearTimeout(t2); };
  }, []);
  return <em id="whyLine" className={swap ? 'swap' : undefined}>{whys[i % whys.length]}</em>;
}
