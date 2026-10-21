async function request(path, body) {
  const apiOrigin = String(window.DMC_API_ORIGIN || '').replace(/\/+$/, '');
  const response = await fetch(`${apiOrigin}/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || 'Authentication request failed.');
    error.code = data?.code || '';
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function getAccountStatus() {
  const apiOrigin = String(window.DMC_API_ORIGIN || '').replace(/\/+$/, '');
  const response = await fetch(`${apiOrigin}/api/account/status`, {
    credentials: 'include'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || 'Could not check account approval status.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function emitAuthState(event, session = null) {
  window.dispatchEvent(new CustomEvent('dmc-auth-state-change', {
    detail: { event, session }
  }));
}

export async function signUp(username, password, { fullName } = {}) {
  const normalizedUsername = username.trim().toLowerCase();
  const data = await request('sign-up/email', {
    name: fullName.trim(),
    email: `${normalizedUsername}@accounts.dmc.invalid`,
    username: normalizedUsername,
    password,
  });
  emitAuthState('SIGNED_UP', data);
  return { data, error: null };
}

export async function signIn(username, password) {
  const data = await request('sign-in/username', {
    username: username.trim(),
    password,
    rememberMe: true
  });
  const current = await getSession();
  emitAuthState('SIGNED_IN', current.data.session);
  return { data, error: null };
}

export async function signOut() {
  const data = await request('sign-out', {});
  emitAuthState('SIGNED_OUT');
  return { data, error: null };
}

export async function getSession() {
  const data = await request('get-session');
  return {
    data: { session: data?.session ? data : null },
    error: null
  };
}

export async function requireAuth(redirectTo = 'login.html') {
  const { data, error } = await getSession();
  if (error) throw error;
  if (!data.session) {
    window.location.replace(redirectTo);
    return null;
  }
  return data.session;
}

export async function redirectIfLoggedIn(redirectTo = 'index.html') {
  const { data, error } = await getSession();
  if (error) throw error;
  if (data.session) {
    const account = await getAccountStatus();
    if (account.status === 'approved') {
      window.location.replace(redirectTo);
      return true;
    }
    await signOut();
    window.DMC_ACCOUNT_APPROVAL_STATUS = account.status;
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.DMC_AUTH = {
    signUp,
    signIn,
    signOut,
    getSession,
    getAccountStatus,
    requireAuth,
    redirectIfLoggedIn
  };
  let activeUserId = null;
  const refreshAuthState = async (initial = false) => {
    try {
      const { data } = await getSession();
      const userId = data.session?.user?.id || null;
      if (initial || userId !== activeUserId) {
        activeUserId = userId;
        emitAuthState(initial ? 'INITIAL_SESSION' : userId ? 'SIGNED_IN' : 'SIGNED_OUT', data.session);
      }
    } catch {
      emitAuthState('SESSION_ERROR');
    }
  };
  refreshAuthState(true);
  window.addEventListener('focus', () => refreshAuthState());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshAuthState();
  });
}
