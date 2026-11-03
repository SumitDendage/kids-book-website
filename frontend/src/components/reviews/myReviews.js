import { meApi } from '../../services/api.js';

/* The signed-in customer's own reviews (GET /api/me/reviews), kept for this page so every sheet
   window can say "Your rating" without asking again. A new sign-in starts a new list. */
let cache = { user: null, p: null, list: [] };
export function loadMyReviews(userId) {
  if (!userId) return Promise.resolve([]);
  if (cache.user === userId && cache.p) return cache.p;
  const p = meApi.reviews().then(r => { const list = Array.isArray(r.reviews) ? r.reviews : []; if (cache.p === p) cache.list = list; return list; })
    .catch(() => { if (cache.p === p) cache.p = null; return []; });
  cache = { user: userId, p, list: [] };
  return p;
}
export const myReviewOf = (list, id) => (list || []).find(r => r.worksheet === id) || null;
/* a review just posted replaces the old one in the list */
export function rememberMyReview(userId, review) {
  if (!userId || !review) return;
  const list = (cache.user === userId ? cache.list : []).filter(r => r.worksheet !== review.worksheet).concat(review);
  cache = { user: userId, p: Promise.resolve(list), list };
}
