'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Command, Eye, EyeOff } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import TrackerApp, { type Account, type Role } from './tracker-app';

export default function AuthShell() {
  const [ready, setReady] = useState(false);
  const live = Boolean(getSupabase());
  const [account, setAccount] = useState<Account | null>(null);
  const [mode, setMode] = useState<'in' | 'up' | 'forgot' | 'reset'>('in');
  const [emailInput, setEmailInput] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const submitting = useRef(false);
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const cooldownKey =
    'robohaven:recovery:' + process.env.NEXT_PUBLIC_SUPABASE_URL;

  useEffect(() => {
    if (mode !== 'forgot') return;
    let until = retryAt;
    try {
      until = Math.max(until, Number(sessionStorage.getItem(cooldownKey)) || 0);
    } catch {
      /* Storage may be disabled. */
    }
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    update();
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      update();
      if (until <= Date.now()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode, retryAt, cooldownKey]);

  function pauseRecovery() {
    const until = Date.now() + 60000;
    setRetryAt(until);
    setRemaining(60);
    try {
      sessionStorage.setItem(cooldownKey, String(until));
    } catch {
      /* In-memory cooldown is sufficient here. */
    }
  }

  useEffect(() => {
    const db = getSupabase();

    if (!db) {
      const frame = requestAnimationFrame(() => setReady(true));
      return () => cancelAnimationFrame(frame);
    }
    let generation = 0;
    const query = new URLSearchParams(location.search);
    if (query.has('auth'))
      queueMicrotask(() =>
        setError('This email link has expired. Request another link.'),
      );

    const { data } = db.auth.onAuthStateChange((event, session) => {
      const version = ++generation;
      if (event === 'PASSWORD_RECOVERY' || (session && query.has('reset'))) {
        setMode('reset');
        query.delete('reset');
      }
      if (!session && query.has('reset')) {
        query.delete('reset');
        setMode('forgot');
        setError('This reset session has expired. Request a fresh email link.');
      }
      if (!session) {
        setAccount(null);
        setReady(true);
        return;
      }
      setTimeout(async () => {
        if (version !== generation) return;
        try {
          const { data: profile, error } = await db
            .from('workspace_members')
            .select('id,name,role')
            .eq('id', session.user.id)
            .maybeSingle();
          if (version !== generation) return;
          if (error) throw error;
          if (!profile) {
            const { data: access } = await db.rpc('account_access_status');
            throw new Error(
              access?.reason ||
                'Your club membership is unavailable. Contact a club administrator.',
            );
          }
          setAccount({
            id: profile.id,
            name: profile.name,
            role: profile.role as Role,
            email: session.user.email || '',
          });
        } catch (error) {
          if (version === generation) {
            setAccount(null);
            setError(
              error instanceof Error
                ? error.message
                : 'Could not load your membership.',
            );
          }
        } finally {
          if (version === generation) setReady(true);
        }
      }, 0);
    });
    return () => {
      generation++;
      data.subscription.unsubscribe();
    };
  }, []);

  const accountId = account?.id;
  useEffect(() => {
    const db = getSupabase();
    if (!db || !accountId) return;
    let active = true;
    let version = 0;
    async function refreshRole() {
      const current = ++version;
      const { data, error } = await db!
        .from('workspace_members')
        .select('role')
        .eq('id', accountId)
        .maybeSingle();
      if (!active || current !== version || error) return;
      setAccount((previous) =>
        !previous || previous.id !== accountId
          ? previous
          : !data
            ? null
            : previous.role === data.role
              ? previous
              : { ...previous, role: data.role as Role },
      );
    }
    const channel = db
      .channel('my-role-' + accountId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'role_updates',
          filter: 'id=eq.' + accountId,
        },
        () => void refreshRole(),
      )
      .on('system', {}, (event) => {
        if (event.status === 'ok' && event.extension === 'postgres_changes')
          void refreshRole();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refreshRole();
      });
    window.addEventListener('focus', refreshRole);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshRole);
      void db.removeChannel(channel);
    };
  }, [accountId]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const db = getSupabase();
    if (
      !db ||
      busy ||
      submitting.current ||
      (mode === 'forgot' && remaining > 0)
    )
      return;
    submitting.current = true;
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') || '')
      .trim()
      .toLowerCase();
    const password = String(form.get('password') || '');
    const redirect = location.origin + '/auth/confirm';
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'forgot') {
        const { error } = await db.auth.resetPasswordForEmail(email, {
          redirectTo: redirect,
        });
        if (
          error?.status === 429 ||
          error?.code === 'over_email_send_rate_limit'
        ) {
          pauseRecovery();
          throw new Error(
            'Supabase has paused recovery emails. This request did not send a link. If you already received one, use the latest email. If the limit persists, contact your club administrator.',
          );
        }
        if (error) throw error;
        pauseRecovery();
        setInfo(
          'If this address has an account, check its inbox for a reset link. Open the latest link in the browser where you requested it.',
        );
      } else if (mode === 'reset') {
        const { error } = await db.auth.updateUser({ password });
        if (error) throw error;
        history.replaceState(null, '', '/');
        setMode('in');
        setInfo('Password updated.');
      } else if (mode === 'up') {
        const name = String(form.get('name') || '').trim();
        if (name.length < 2) throw new Error('Enter your full name.');
        const { data, error } = await db.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirect, data: { full_name: name } },
        });
        if (error) throw error;
        if (!data.session)
          setInfo('Check your inbox to verify your email address.');
      } else {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error?.code === 'invalid_credentials')
          throw new Error(
            'The email and password do not match. Check the email address or use Forgot password to choose a new password.',
          );
        if (error) throw error;
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Account request failed. Try again.',
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    setMode('in');
    const { error } = await getSupabase()!.auth.signOut({ scope: 'local' });
    if (error) {
      setError(error.message);
      return;
    }
    setAccount(null);
    setError('');
    setInfo('');
  }

  if (!ready)
    return (
      <div
        className="auth-loading auth-skeleton-screen"
        role="status"
        aria-label="Loading your account"
        aria-busy="true"
      >
        <div className="auth-skeleton-panel">
          <div className="skeleton skeleton-heading" />
          <div className="skeleton skeleton-subheading" />
          <div className="skeleton skeleton-card" />
        </div>
      </div>
    );
  if (account && mode !== 'reset')
    return (
      <TrackerApp
        key={account.id + account.role}
        account={account}
        onLogout={logout}
      />
    );

  return (
    <main className="auth-page auth-redesign">
      <section className="auth-side" aria-label="Robotics club introduction">
        <header className="auth-identity">
          <div className="auth-brand-logo">
            <Command size={24} strokeWidth={2.2} />
          </div>
          <div className="auth-identity-text">
            <strong>
              RoboHaven<span className="auth-brand-dot">.</span>
            </strong>
            <small>ROBOTICS CLUB</small>
          </div>
        </header>
        <div className="auth-intro-content">
          <div className="auth-eyebrow">
            <span className="auth-live-light" /> DESIGNED FOR MAKERS
          </div>
          <h1>
            Build the{' '}
            <span>
              future<span className="auth-orange-dot">.</span>
            </span>
          </h1>
          <p>Your equipment. Your team. One workspace.</p>
        </div>
        <div className="auth-machine" aria-hidden="true">
          <div className="auth-machine-glow" />
          <div className="auth-machine-ring auth-ring-one" />
          <div className="auth-machine-ring auth-ring-two" />
          <svg
            viewBox="0 0 660 450"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="presentation"
          >
            <defs>
              <linearGradient
                id="metal"
                x1="100"
                y1="0"
                x2="550"
                y2="400"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#dae9ed" />
                <stop offset=".45" stopColor="#657b89" />
                <stop offset="1" stopColor="#1c3444" />
              </linearGradient>
              <linearGradient
                id="metal-dark"
                x1="200"
                y1="0"
                x2="490"
                y2="440"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#485d6c" />
                <stop offset="1" stopColor="#0c1924" />
              </linearGradient>
              <filter id="arm-glow">
                <feGaussianBlur stdDeviation="9" />
              </filter>
            </defs>
            <g className="auth-arm-assembly">
              <ellipse
                cx="326"
                cy="412"
                rx="181"
                ry="21"
                stroke="#638497"
                strokeOpacity=".34"
                strokeDasharray="5 9"
              />
              <path
                d="M195 390H457L482 418H171L195 390Z"
                fill="#152a38"
                stroke="#6c8191"
                strokeWidth="2"
              />
              <path
                d="M231 347H421V395H231V347Z"
                fill="url(#metal-dark)"
                stroke="#9cb3bf"
                strokeWidth="2"
              />
              <path d="M257 340H394V351H257V340Z" fill="#ff612d" />
              <path
                d="M269 325H382L394 343H257L269 325Z"
                fill="#344d60"
                stroke="#b3c8d0"
                strokeWidth="2"
              />
              <path
                d="M285 326L234 218L264 188L326 300Z"
                fill="url(#metal)"
                stroke="#bed0d7"
                strokeWidth="4"
              />
              <path
                d="M310 324L269 204L299 186L353 317Z"
                fill="#182e3d"
                stroke="#6e8796"
                strokeWidth="2"
              />
              <circle
                cx="281"
                cy="203"
                r="36"
                fill="#172e3e"
                stroke="#a7bdc8"
                strokeWidth="5"
              />
              <circle cx="281" cy="203" r="24" fill="#ff612d" />
              <circle
                cx="281"
                cy="203"
                r="13"
                fill="#152a39"
                stroke="#ffb090"
                strokeWidth="3"
              />
              <path
                d="M290 177L408 89L435 123L317 220Z"
                fill="url(#metal)"
                stroke="#c7d6de"
                strokeWidth="4"
              />
              <path
                d="M307 185L420 98L427 112L312 203Z"
                fill="#182e3d"
                opacity=".65"
              />
              <circle
                cx="423"
                cy="108"
                r="32"
                fill="#142a39"
                stroke="#a8bec9"
                strokeWidth="5"
              />
              <circle cx="423" cy="108" r="19" fill="#ff612d" />
              <circle cx="423" cy="108" r="9" fill="#142a39" />
              <path
                d="M444 95L497 139L488 155L419 136Z"
                fill="url(#metal)"
                stroke="#c1d1d9"
                strokeWidth="3"
              />
              <path
                d="M492 147L520 156L535 191L515 196L506 171L488 166Z"
                fill="#213b4b"
                stroke="#bacbd3"
                strokeWidth="3"
              />
              <path
                d="M516 192L499 220L510 245L526 236L517 219L535 207L543 238L558 235L550 192Z"
                fill="#b9cbd4"
                stroke="#dde7ea"
                strokeWidth="2"
              />
              <path
                d="M290 172C337 130 358 113 402 105"
                stroke="#ff723c"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="4 8"
                opacity=".85"
              />
              <circle cx="326" cy="360" r="9" fill="#ff612d" />
              <circle cx="361" cy="360" r="4" fill="#84e3cf" />
              <path
                d="M180 402H480"
                stroke="#ff612d"
                strokeWidth="2"
                strokeDasharray="10 12"
              />
            </g>
            <g fill="#ff784a">
              <circle cx="126" cy="121" r="3" />
              <circle cx="555" cy="78" r="3" />
              <circle cx="599" cy="299" r="3" />
            </g>
            <g stroke="#648293" strokeOpacity=".55">
              <path d="M80 108H168M124 64V151M509 54H611M560 14V95M560 297H635M599 258V337" />
            </g>
            <g
              fontSize="10"
              fontFamily="monospace"
              fill="#85a0af"
              letterSpacing="2"
            >
              <text x="71" y="168">
                JOINT / A01
              </text>
              <text x="507" y="111">
                SERVO / 02
              </text>
              <text x="470" y="375">
                ACTIVE SYSTEM
              </text>
            </g>
          </svg>
        </div>
      </section>
      <section className="auth-access" aria-label="Account access">
        <div className="auth-access-top">
          <span>
            <span className="auth-live-light" /> CLUB PORTAL
          </span>
          <span>
            SECURE ACCESS <span className="auth-access-cross">✳</span>
          </span>
        </div>
        <div className="auth-card">
          <div className="auth-card-symbol">
            <Command size={27} />
          </div>
          <div className="auth-card-kicker">MEMBER ACCESS</div>
          <h2>
            {mode === 'forgot' || mode === 'reset' ? (
              'Reset password'
            ) : mode === 'in' ? (
              <>
                Welcome <span>back.</span>
              </>
            ) : (
              <>
                Join the <span>crew.</span>
              </>
            )}
          </h2>
          <p className="auth-sub">
            {mode === 'in'
              ? 'Sign in to your robotics workspace.'
              : mode === 'up'
                ? 'Create your robotics club account.'
                : mode === 'forgot'
                  ? 'Enter your club email address.'
                  : 'Choose a new password.'}
          </p>
          <div className="auth-tabs" role="tablist" aria-label="Account mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'in'}
              className={mode === 'in' ? 'on' : ''}
              onClick={() => {
                setMode('in');
                setError('');
                setInfo('');
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'up'}
              className={mode === 'up' ? 'on' : ''}
              onClick={() => {
                setMode('up');
                setError('');
                setInfo('');
              }}
            >
              Create account
            </button>
          </div>
          <form onSubmit={submit} key={mode}>
            {mode === 'up' && (
              <label>
                Full name
                <input
                  name="name"
                  required
                  autoComplete="name"
                  placeholder="Your full name"
                />
              </label>
            )}
            {mode !== 'reset' && (
              <label>
                Email address
                <input
                  name="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@university.edu"
                />
              </label>
            )}
            {mode !== 'forgot' && (
              <label>
                Password
                <span className="pw-wrap">
                  <input
                    name="password"
                    type={show ? 'text' : 'password'}
                    required
                    minLength={mode === 'in' ? undefined : 8}
                    autoComplete={
                      mode === 'in' ? 'current-password' : 'new-password'
                    }
                    placeholder={
                      mode === 'in' ? 'Your password' : 'Minimum 8 characters'
                    }
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
            )}
            {mode === 'up' && (
              <p className="auth-note">New club accounts start as Members.</p>
            )}
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            {info && (
              <p className="auth-info" role="status">
                {info}
              </p>
            )}
            {!live && (
              <p id="auth-unavailable" className="auth-note" role="status">
                Sign-in and registration are unavailable until the club’s
                Supabase connection is configured.
              </p>
            )}
            <button
              className="auth-submit"
              type="submit"
              disabled={busy || !live || (mode === 'forgot' && remaining > 0)}
              aria-busy={busy}
              aria-describedby={!live ? 'auth-unavailable' : undefined}
            >
              <span>
                {busy
                  ? 'Authenticating…'
                  : mode === 'in'
                    ? 'Enter workspace'
                    : mode === 'up'
                      ? 'Create account'
                      : mode === 'reset'
                        ? 'Save password'
                        : remaining > 0
                          ? 'Request again in ' + remaining + 's'
                          : 'Email reset link'}
              </span>
              <span className="auth-submit-icon">
                {busy ? (
                  <span className="auth-button-spinner" />
                ) : (
                  <ArrowUpRight size={20} />
                )}
              </span>
            </button>
          </form>
          {mode === 'in' && (
            <button
              className="text-link auth-forgot-link"
              type="button"
              onClick={() => {
                setMode('forgot');
                setError('');
                setInfo('');
              }}
            >
              Forgot password?
            </button>
          )}
          <div className="auth-card-bottom">
            <span className="auth-verified">✳ &nbsp; SECURE WORKSPACE</span>
            <span>v 2.0</span>
          </div>
        </div>
        <div className="auth-access-bottom">
          <span>ROBOTICS CLUB</span>
          <span>© 2026 ROBOHAVEN</span>
        </div>
      </section>
    </main>
  );
}
