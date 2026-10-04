import { useEffect, useRef } from 'react';
import { useSite } from '../../context/SiteContext.jsx';
import { sheetOf, ABOUT } from '../../data/catalogue.js';
import { classById, planOf } from '../../data/content.js';

/* Not signed in? Every worksheet first shows what a free account includes. */
function AccountPopup({ id }) {
  const { closeModal, requireSignIn, openSheet, openShop } = useSite();
  const it = sheetOf(id);
  const go = view => requireSignIn(() => { if (id) openSheet(id); else openShop('all'); }, view === 'signup' ? 'Create your free account — then sign in and your sheet will be waiting for you.' : 'Sign in — your sheet will be waiting for you.', view);
  return (
    <>
      <button type="button" className="icon-btn close-x" aria-label="Close" onClick={closeModal}>✕</button>
      <h3 id="modalTitle">Free Account Includes:</h3>
      <ul className="perks">
        <li><i aria-hidden="true">✓</i><span>Free access sheets in every class — open them in the full-screen viewer</span></li>
        <li><i aria-hidden="true">✓</i><span>Suggest a Resource! You want it? We&apos;ll make it</span></li>
        <li><i aria-hidden="true">✓</i><span>Customer support (with real people!)</span></li>
      </ul>
      <div className="sheet-actions"><button type="button" className="btn btn-primary" onClick={() => go('signup')}>Create my free account →</button><button type="button" className="btn btn-ghost" onClick={() => go('signin')}>I already have an account</button></div>
      {it && <p className="fine">Then <b>{it.title}</b> is one tap away.</p>}
    </>
  );
}

/* any sheet, free or paid: a look at the page, what is inside, and the open / buy action */
function SheetDetail({ id }) {
  const { access, closeModal, openViewer, buy } = useSite();
  const it = sheetOf(id); if (!it) return null;
  const session = access.session;
  const free = it.price === 0, mine = access.canOpen(it), cls = classById(it.cls), sub = mine && !free ? access.activeSub(it.cls) : null;
  const about = it.about || ABOUT[it.id] || it.bullets || [];
  const pic = it.img ? <img src={it.img} alt={it.title + ' — the printed page'} />
    : (
      <div className="sheet-mock" aria-hidden="true"><div className="brand"><b>Learn With Why</b><span>{it.subject}</span></div>
        <div className="boxes"><div><span className="glyph">{it.glyph}</span>{it.skills ? it.skills[0] : it.subject}</div><div><span className="pic">{it.pages ? it.pages : '✎'}</span>{it.pages ? 'A4 pages' : 'Activity'}</div></div>
        <div className="lines"><i /><i /><i /><i /><i /></div><small>{it.title} · {it.subject}</small></div>
    );
  const accessLine = free ? (session ? 'Free access · signed in' : 'Free access · sign in to open') : mine ? (sub ? 'In your ' + cls.label + ' plan · yours to keep' : 'Bought · yours to keep') : 'Yours to keep once bought';
  /* one Open button for every sheet: it opens the protected full-screen viewer in a new tab */
  const actions = mine
    ? <><button type="button" className="btn btn-primary" onClick={() => openViewer(it.id)}>Open PDF · full screen ↗</button><span className="note">Opens in a new tab in the protected viewer, watermarked with your name. Close it to come back here.</span></>
    : !session
      ? <><button type="button" className="btn btn-primary" onClick={() => openViewer(it.id)}>Sign in to open</button><span className="note">{free ? 'Free access sheet — sign in and it opens straight away.' : 'Sign in, then buy this PDF — it stays on your account for good.'}</span></>
      : free
        ? <><button type="button" className="btn btn-primary" onClick={() => openViewer(it.id)}>Open it free ↗</button><span className="note">Free access sheet — no payment, open it as often as you like.</span></>
        : <><button type="button" className="btn btn-primary" onClick={() => buy(it.id)}>Buy this PDF</button><span className="note">The price is shown at checkout. Pay by card, QR code or UPI — the sheet opens right after payment and stays on your account.</span></>;
  return (
    <>
      <div className="sheet-view">{pic}</div>
      <div className="sheet-info">
        <div className="modal-head"><div><p className="eyebrow">{cls.label} · {it.subject}</p><h3 id="modalTitle">{it.title}</h3></div><button type="button" className="icon-btn" aria-label="Close" onClick={closeModal}>✕</button></div>
        <p className="lead">{it.blurb}</p>
        <ul className="about">{about.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="rows"><div><span>Pages</span><b>{it.pages || 1} · A4 · PDF</b></div><div><span>Access</span><b>{accessLine}</b></div></div>
        <div className="sheet-actions">{actions}</div>
      </div>
    </>
  );
}

/* shown right after a successful purchase — access never expires */
function PurchasePopup({ p }) {
  const { closeModal, openViewer, openMyWorksheets } = useSite();
  const cls = classById(p.cls), item = p.worksheet ? sheetOf(p.worksheet) : null;
  return (
    <>
      <div className="purchase-icon" aria-hidden="true">✓</div>
      <p className="eyebrow">Purchase complete · {p.order}</p>
      <h3 id="modalTitle">Your purchase has been completed successfully.</h3>
      <p className="lead">You can now access your PDF.</p>
      <p>{item ? <><b>{item.title}</b> has</> : <>Every sheet in <b>{cls && cls.label}</b> has</>} been added to your account.</p>
      <div className="expiry"><small>{item ? 'This PDF is' : 'These PDFs are'} yours to keep</small><b>No expiry</b><small>Open {item ? 'it' : 'them'} as often as you like, on any device you sign in to.</small></div>
      <p>You can open {item ? 'it' : 'them'} any time from:<br /><b>My Account → My Worksheets</b></p>
      <div className="rows"><div><span>{item ? 'Sheet' : 'Class'}</span><b>{item ? item.title : (cls && cls.label) + ' · every sheet'}</b></div><div><span>Paid</span><b>{p.total} via {p.method}</b></div><div><span>{item ? 'Access' : 'Plan'}</span><b>{item ? 'Does not expire' : planOf(p.plan).label}</b></div></div>
      <div className="sheet-actions">
        {item && <button type="button" className="btn btn-primary" onClick={() => openViewer(item.id)}>Open the PDF now ↗</button>}
        <button type="button" className={'btn ' + (item ? 'btn-ghost' : 'btn-primary')} onClick={openMyWorksheets}>Open My Worksheets</button>
        <button type="button" className="btn btn-ghost" onClick={closeModal}>Close</button>
      </div>
    </>
  );
}

/* the paper-card modal: account prompt, sheet detail, or purchase receipt.
   The last content stays while it fades out. */
export default function SheetModal() {
  const { modal, closeModal } = useSite();
  const box = useRef(null);
  useEffect(() => { if (modal.open && box.current) box.current.focus({ preventScroll: true }); }, [modal.open, modal.kind, modal.id]);
  const cls = modal.kind === 'account' ? 'modal account' : modal.kind === 'purchase' ? 'modal purchase' : 'modal sheet';
  return (
    <div className={'modal-scrim' + (modal.open ? ' open' : '')} id="modalScrim" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
      <div className={cls} id="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabIndex={-1} ref={box} style={{ outline: 'none' }} aria-hidden={modal.open ? undefined : 'true'}>
        {modal.kind === 'account' && <AccountPopup id={modal.id} />}
        {modal.kind === 'sheet' && <SheetDetail id={modal.id} />}
        {modal.kind === 'purchase' && <PurchasePopup p={modal.purchase} />}
      </div>
    </div>
  );
}
