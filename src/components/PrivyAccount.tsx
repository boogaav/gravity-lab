import { useEffect, useState } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { PRIVY_APP_ID, session, setTokenProvider, useSession } from '../state/session';
import { actions } from '../state/store';

/**
 * Everything that depends on the Privy SDK, in one lazily-loaded chunk.
 *
 * The provider wraps only the account control — not the whole app — so the
 * simulation never remounts when auth state changes, and the (large) wallet
 * SDK is never downloaded unless an app id is configured.
 */

function SessionBridge() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setTokenProvider(null);
      session.clear();
      return;
    }
    setTokenProvider(getAccessToken);
    // Seed the handle from whatever identity they signed in with.
    const suggested =
      user?.twitter?.username ??
      user?.farcaster?.username ??
      user?.github?.username ??
      user?.discord?.username?.split('#')[0] ??
      user?.email?.address?.split('@')[0] ??
      (user?.wallet?.address ? `pilot-${user.wallet.address.slice(2, 8).toLowerCase()}` : undefined);
    void session.sync(suggested ?? undefined);
  }, [ready, authenticated, user, getAccessToken]);

  return null;
}

function AccountControl() {
  const { ready, authenticated, login, logout } = usePrivy();
  const account = useSession((s) => s.account);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [saveErr, setSaveErr] = useState('');

  if (!ready) return <span className="chip">…</span>;

  if (!authenticated) {
    return (
      <button
        className="btn"
        onClick={login}
        data-tip-title="Sign in"
        data-tip="Create an account with email, Google, X or a wallet. Worlds you publish while signed in are collected on your creator profile and stay editable from any device."
      >
        ⏻ Sign in
      </button>
    );
  }

  const label = account ? `@${account.handle}` : busy ? 'linking…' : 'account';

  return (
    <div className="account-wrap">
      <button
        className="btn btn-account"
        onClick={() => setOpen((v) => !v)}
        data-tip-title="Your account"
        data-tip="Your creator profile, published worlds and sign-out. Worlds published while signed in are automatically attached to this account."
      >
        ◉ {label}
      </button>
      {open && (
        <div className="account-pop">
          {error && <p className="warn-text">{error}</p>}
          {account && (
            <>
              <div className="account-head">
                <b>@{account.handle}</b>
                <span className="hint">signed in</span>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => {
                  setOpen(false);
                  actions.navigate({ kind: 'creator', handle: account.handle });
                }}
                data-tip-title="My worlds"
                data-tip="Your creator profile: every world attached to this account."
              >
                ☰ My worlds
              </button>
              <div className="account-rename">
                <input
                  type="text"
                  value={handle}
                  placeholder="change handle"
                  maxLength={24}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    setSaveErr('');
                  }}
                />
                <button
                  className="btn btn-sm"
                  disabled={!handle.trim()}
                  onClick={async () => {
                    try {
                      await session.rename({ handle: handle.trim() });
                      setHandle('');
                      setSaveErr('');
                    } catch (err) {
                      setSaveErr(err instanceof Error ? err.message : String(err));
                    }
                  }}
                >
                  save
                </button>
              </div>
              {saveErr && <p className="warn-text">{saveErr}</p>}
            </>
          )}
          <button
            className="btn btn-sm"
            onClick={async () => {
              setOpen(false);
              await logout();
              session.clear();
            }}
          >
            sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function PrivyAccount() {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: 'dark', accentColor: '#63d0ff', showWalletLoginFirst: false },
        loginMethods: ['email', 'google', 'twitter', 'wallet'],
        // No wallets are created for people who sign in with email or social.
        embeddedWallets: { ethereum: { createOnLogin: 'off' } },
      }}
    >
      <SessionBridge />
      <AccountControl />
    </PrivyProvider>
  );
}
