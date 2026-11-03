import { lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import SiteLayout from './layouts/SiteLayout.jsx';

/* the staff pages are only downloaded when someone opens them */
const Portal = lazy(() => import('./pages/Portal/Portal.jsx'));
/* what a customer sees when the server says the account is suspended or paid sheets are paused */
const AccountBlocked = lazy(() => import('./pages/AccountBlocked/AccountBlocked.jsx'));

/* /viewer keeps working, but the viewer is its own page (viewer.html) so old #t= links stay valid */
function ViewerRedirect() {
  const { hash } = useLocation();
  window.location.replace('/viewer.html' + hash);
  return null;
}

/* staff and account pages stay out of search results (React puts the tag in <head>) */
const NoIndex = () => <meta name="robots" content="noindex, nofollow" />;

export default function App() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={null} />
        <Route path="admin" element={<><NoIndex /><Portal kind="admin" /></>} />
        <Route path="developer" element={<><NoIndex /><Portal kind="developer" /></>} />
        <Route path="account-blocked" element={<><NoIndex /><AccountBlocked /></>} />
      </Route>
      <Route path="viewer" element={<ViewerRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
