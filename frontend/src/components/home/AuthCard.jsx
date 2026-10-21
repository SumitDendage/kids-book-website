  setErrs(errors);
  if (b) return;

  busyOn(true);
  const r = await authApi.verifyLoginOtp({
    challengeId: loginChallengeId,
    code,
  });

  setLoginChallengeId('');
  write('lww_seen', true);
  const first = String((r.user && r.user.name) || '').trim().split(/\s+/)[0];
  await signedIn(
    r.user,
    first ? 'Welcome back, ' + first + '!' : 'Welcome back!',
    remember,
    r.security || null,
  );
      } else if (view === 'signin') {
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.') | bad('auPass', pass ? '' : 'Enter your password.');
        setErrs(errors); if (b) return;
        busyOn(true);
        await signInWith(email, pass);
      } else if (view === 'agree') {
        if (!pass || !isEmail(email)) { setAuthView('signin', null, { email }); return; }
        const b = bad('auAccept', agreed ? '' : 'Please tick the box to agree. Your account is just for you.');
        setErrs(errors); if (b) return;
        busyOn(true);
        await signInWith(email, pass, { agreement: true });
      } else if (view === 'forgot') {
        const b = bad('auEmail', isEmail(email) ? '' : 'Enter a valid email address.'); setErrs(errors); if (b) return;
        busyOn(true); const r = await authApi.forgotPassword({ email });
        setAuthAlert({ type: 'ok', msg: r.message || 'If that email has an account, a reset link is on its way.' });
      } else if (view === 'reset') {
        if (!auth.token) { setAuthView('forgot'); setTimeout(() => setAuthAlert({ type: 'err', msg: 'Open the reset link from your email, or ask for a new one here.' }), 0); return; }
        const b = bad('auPass', strongPass(pass)) | bad('auConfirm', confirm === pass ? '' : 'Both passwords must match.');
        setErrs(errors); if (b) return;
        busyOn(true);
        let r; try { r = await authApi.resetPassword({ token: auth.token, password: pass }); }
        catch (err) { if (/^token_/.test(err.code || '')) { setAuthView('forgot'); setTimeout(() => setAuthAlert({ type: 'err', msg: err.message }), 0); return; } throw err; }
        setAuthView('signin'); setTimeout(() => setAuthAlert({ type: 'ok', msg: r.message || 'Password updated. Sign in with your new password.' }), 0);
      }
    } catch (err) {
      const fe = err.body && err.body.errors;
      if (fe) setErrs({ auName: fe.name, auEmail: fe.email, auPass: fe.password, auAccept: fe.agreement });
      setAuthAlert({ type: 'err', msg: friendly(err, email) });
    } finally { busyOn(false); }
  }

  /* the account type is asked once in its own popup (AccountTypePopup) and only staff change it later */
  const hasRole = !!accountType;
  const subs = access.subsOf();
  const paused = !!session && session.accessStatus === 'suspended';
  const tz = (session && session.timeZone) || undefined;
  const Link = ({ to, children }) => <button type="button" className="link" onClick={() => setAuthView(to, null, { email: f.email.trim() })}>{children}</button>;
  const switchLine = {
    signup: <>Already have an account? <Link to="signin">Sign in</Link> &nbsp;·&nbsp; <Link to="forgot">Forgot password?</Link></>,
    signin: <>New here? <Link to="signup">Sign up</Link></>,
    loginotp: <button type="button" className="link" onClick={() => { setLoginChallengeId(''); setAuthView('signin', null, { email: f.email.trim() }); }}>Back to sign in</button>,
    forgot: <>Remembered it? <Link to="signin">Sign in</Link></>,
    reset: <Link to="signin">Back to sign in</Link>,
    verify: <>Wrong email? <Link to="signup">Start again</Link> &nbsp;·&nbsp; <button type="button" className="link" onClick={() => resendWelcome(f.email.trim().toLowerCase())}>Send a new code</button></>,
    agree: <Link to="signin">Back to sign in</Link>,
  }[view];

  return (
    <div className={'panel auth-card rise' + (session ? ' is-signed' : '')} id="authCard" style={{ '--i': 2 }}>
      <p className="eyebrow">01 / Your adventure starts here</p>
      <div className="guest">
        <div className="tabs" role="tablist">
          <button type="button" className={'tab' + (TAB_OF[view] === 'signup' ? ' on' : '')} role="tab" aria-selected={TAB_OF[view] === 'signup'} onClick={() => setAuthView('signup')}>Sign up</button>
          <button type="button" className={'tab' + (TAB_OF[view] === 'signin' ? ' on' : '')} role="tab" aria-selected={TAB_OF[view] === 'signin'} onClick={() => setAuthView('signin')}>Sign in</button>
        </div>
        <form id="authForm" noValidate onSubmit={onSubmit} data-view={view}>
          <h2 className="card-title" id="authTitle">{copy.title}</h2>
          <p className="auth-sub" id="authSub">{copy.sub}</p>
          <div id="authAlert" aria-live="polite">{auth.alert && <div className={'alert ' + auth.alert.type}>{auth.alert.msg}{auth.alert.action && <> <button type="button" className="link" onClick={auth.alert.action.run}>{auth.alert.action.label}</button></>}</div>}</div>
          {view === 'agree' ? <p className="auth-note">Signing in as <b>{f.email}</b></p> : null}
          <Field id="auName" label="Your name" show={shows('signup')} error={errs.auName}><input id="auName" type="text" autoComplete="name" placeholder="Your name" maxLength={80} value={f.name} onChange={set('name')} /></Field>
          <Field id="auEmail" label="Email address" show={shows('signup signin forgot verify')} error={errs.auEmail}><input id="auEmail" type="email" autoComplete="email" placeholder="you@example.com" value={f.email} onChange={set('email')} /></Field>
          <Field id="auCode" label="6-digit code" show={shows('verify loginotp')} error={errs.auCode}><input id="auCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" placeholder="123456" maxLength={10} value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.replace(/[^0-9]/g, '') }))} /></Field>
          <Field id="auPass" label={view === 'reset' ? 'New password' : 'Password'} show={shows('signup signin reset')} error={errs.auPass}>
            <div className="pw-wrap"><input id="auPass" type={showPass ? 'text' : 'password'} autoComplete={view === 'signin' ? 'current-password' : 'new-password'} placeholder={view === 'signin' ? 'Your password' : 'At least 8 characters'} maxLength={128} value={f.pass} onChange={set('pass')} /><button type="button" className="pw-toggle" id="pwToggle" aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(v => !v)}>{showPass ? 'HIDE' : 'SHOW'}</button></div>
          </Field>
          <Field id="auConfirm" label="Confirm password" show={shows('signup reset')} error={errs.auConfirm}><input id="auConfirm" type="password" autoComplete="new-password" placeholder="Once more" maxLength={128} value={f.confirm} onChange={set('confirm')} /></Field>
          {shows('signup agree') ? <AcceptRules id="auAccept" text={agreement.text} checked={agreed} onChange={v => { setAgreed(v); if (v) setErrs(x => ({ ...x, auAccept: undefined })); }} error={errs.auAccept} /> : null}
          {view === 'signup' ? <p className="auth-note">Eight characters or more, with a number and a capital letter. Keep it to yourself.</p> : null}
          <div className="between" style={shows('signin agree') ? undefined : { display: 'none' }}><span className="auth-note">You stay signed in until you sign out.</span>{view === 'signin' ? <button type="button" className="link" onClick={() => setAuthView('forgot', null, { email: f.email.trim() })}>Forgot password?</button> : null}</div>
          <button type="submit" className="btn btn-primary btn-block" id="authSubmit" disabled={busy}>{busy ? 'One moment…' : copy.submit}</button>
          <p className="switch" id="authSwitch">{switchLine}</p>
        </form>
      </div>
      <div className="signed">
        <h2 className="card-title">You&apos;re in, <span id="signedName">{session ? session.name : ''}</span>.</h2>
        <p className="auth-sub" id="roleLine" hidden={!hasRole}><b id="signedRole">{hasRole ? accountType.label : ''}</b> account · {hasRole ? printsText(printsPerSheet).toLowerCase() : ''} per sheet. Your plans and sheets are kept with it.</p>
        {paused ? <p className="auth-sub" id="pausedLine">Paid sheets are paused on this account. Free sheets still open. <button type="button" className="link" onClick={() => openAccount('security')}>See why</button></p> : null}
        <p className="auth-sub" id="subLine" hidden={!hasRole}>
          {subs.length
            ? <>{subs.map((x, n) => <span key={x.cls}>{n ? ' ' : ''}Your <b>{(classById(x.cls) || { label: 'class' }).label}</b> plan is open{x.end ? ' until ' + dateTimeTz(x.end, tz) : ''}.</span>)} <button type="button" className="link" onClick={() => openAccount('sheets')}>My Worksheets</button></>
            : <>Your sheets are under <button type="button" className="link" onClick={() => openAccount('sheets')}>My Account → My Worksheets</button>.</>}
        </p>
        <div className="btn-row"><button type="button" className="btn btn-primary" onClick={() => openShop('all')}>Explore the sheets →</button><button type="button" className="btn btn-ghost" id="signOutBtn" onClick={signOut}>Sign out</button></div>
      </div>
    </div>
  );
}
