import { Suspense, lazy } from 'react';
import { authConfigured } from '../state/session';

/**
 * Gate for the account UI. The Privy SDK is heavy (wallet connectors), so it
 * lives behind a dynamic import and is only fetched when this deployment has
 * an app id configured. With accounts off, this renders nothing and the app
 * behaves exactly as it did before — secret keys still own worlds.
 */
const PrivyAccount = lazy(() => import('./PrivyAccount'));

export default function AccountMenu() {
  if (!authConfigured()) return null;
  return (
    <Suspense fallback={<span className="chip">…</span>}>
      <PrivyAccount />
    </Suspense>
  );
}
