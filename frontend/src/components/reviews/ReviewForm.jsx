import { useState } from 'react';
import { meApi } from '../../services/api.js';
import { useSite } from '../../context/SiteContext.jsx';
import { StarPicker } from './Stars.jsx';
import { rememberMyReview } from './myReviews.js';

/* Rate a sheet: tap the stars, add a few words if you like, post. Every review waits for a quick
   check in Admin → Homepage → Reviews before it shows on the website. */
export default function ReviewForm({ it, mine, onSaved, autoStars = 0, compact = false }) {
  const { session, requireSignIn } = useSite();
  const [rating, setRating] = useState(autoStars || (mine && mine.rating) || 0);
  const [text, setText] = useState((mine && mine.body) || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const pick = n => {
    if (!session) { requireSignIn({ do: 'sheet', id: it.id }, 'Sign in to rate ' + it.title + '.', 'signin'); return; }
    setRating(n); setMsg(null);
  };
  async function post(e) {
    e.preventDefault();
    if (!rating) { setMsg({ type: 'err', body: 'Tap the stars to give 1 to 5 stars.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await meApi.review({ worksheet: it.id, rating, body: text.trim() || null });
      rememberMyReview(session && session.id, { ...r.review, worksheet: it.id });
      setMsg({ type: 'ok', body: 'Thank you! Your review shows on the website after a quick check.' });
      if (onSaved) onSaved(r.review);
    } catch (err) {
      if (err.status === 401) { requireSignIn({ do: 'sheet', id: it.id }, 'Your sign-in has ended. Sign in again to rate ' + it.title + '.', 'signin'); return; }
      setMsg({ type: 'err', body: err.status === 429 ? 'You have posted a few reviews already. Please try again in a little while.' : err.code === 'not_eligible' ? 'You can rate a sheet after you have bought or opened it.' : err.message || 'That did not work. Please try again.' });
    } finally { setBusy(false); }
  }
  return (
    <form className={'review-form' + (compact ? ' compact' : '')} onSubmit={post} noValidate>
      <StarPicker value={rating} onChange={pick} disabled={busy} label={'Rate ' + it.title} />
      {rating ? <>
        <label className="sr-only" htmlFor={'rv-' + it.id}>Your review (optional)</label>
        <textarea id={'rv-' + it.id} maxLength={2000} rows={3} placeholder="Tell other parents and teachers what you liked (optional)" value={text} onChange={e => setText(e.target.value)} disabled={busy} />
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : mine ? 'Update my review' : 'Post my review'}</button>
      </> : null}
      {msg ? <div className={'alert ' + msg.type} role={msg.type === 'err' ? 'alert' : 'status'}>{msg.body}</div> : null}
    </form>
  );
}
