import { useDash } from '../Portal/DashContext.js';
import { save, log } from '../Portal/dashboard.js';
import { HERO, WHYS } from '../../data/content.js';

/* the words on the first screen of the site; saved here, shown there straight away */
export default function Content() {
  const { site, toast } = useDash();
  const c = site.content;
  const submit = e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next = { badge: String(f.get('badge')).trim(), heroTitle: String(f.get('heroTitle')).trim(), heroLede: String(f.get('heroLede')).trim(), whys: String(f.get('whys')).split('\n').map(x => x.trim()).filter(Boolean) };
    save('lww_content', next); site.setContent(next); log('content saved', 'home page'); toast('Content saved');
  };
  const reset = () => { localStorage.removeItem('lww_content'); log('content reset', 'home page'); toast('Reset — reloading'); setTimeout(() => location.reload(), 500); };
  return (
    <section className="panel"><p className="eyebrow">Home page</p><p className="auth-sub">These lines are shown on the first screen of the site.</p>
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="ctBadge">Eyebrow line</label><input id="ctBadge" name="badge" defaultValue={c.badge || HERO.badge} /></div>
        <div className="field"><label htmlFor="ctTitle">Headline</label><input id="ctTitle" name="heroTitle" defaultValue={c.heroTitle || HERO.titleHtml} /><small>HTML allowed, e.g. &lt;em&gt;why&lt;/em&gt;</small></div>
        <div className="field"><label htmlFor="ctLede">Intro paragraph</label><textarea id="ctLede" name="heroLede" defaultValue={c.heroLede || HERO.lede} /></div>
        <div className="field"><label htmlFor="ctWhys">&quot;Today&apos;s why&quot; questions</label><textarea id="ctWhys" name="whys" style={{ minHeight: '140px' }} defaultValue={(c.whys || WHYS).join('\n')} /><small>One per line</small></div>
        <div className="btn-row"><button type="submit" className="btn btn-primary">Save content</button><button type="button" className="btn btn-ghost" onClick={reset}>Reset to defaults</button></div>
      </form>
    </section>
  );
}
