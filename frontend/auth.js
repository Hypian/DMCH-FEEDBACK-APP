const CHANNEL_NAME = 'dmc_auth_session_channel';
const STORAGE_EVENT_KEY = 'dmc_session_channel_msg';
const STORAGE_LAST_ACTIVE_KEY = 'dmc_session_last_active';
const STORAGE_HAS_SESSION_KEY = 'dmc_has_active_session';
const INACTIVITY_TIMEOUT_MS = 3600 * 1000;

const tabId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : 'tab_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();

let channel = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
}

const seenMessageIds = new Set();
function markSeen(msgId) {
  if (!msgId) return false;
  if (seenMessageIds.has(msgId)) return true;
  seenMessageIds.add(msgId);
  if (seenMessageIds.size > 200) {
    const first = seenMessageIds.values().next().value;
    seenMessageIds.delete(first);
  }
  return false;
}

let localLastActiveTime = Date.now();
let lastBroadcastTime = 0;
let lastBackendPingTime = 0;

export function broadcastSessionEvent(type, payload = {}) {
  const msgId = `${tabId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  markSeen(msgId);
  const data = { msgId, tabId, type, payload, timestamp: Date.now() };

  if (channel) {
    try {
      channel.postMessage(data);
    } catch {
      // ignore
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
  }
}

async function pingBackendActivity() {
  try {
    const apiOrigin = String(window.DMC_API_ORIGIN || '').replace(/\/+$/, '');
    const response = await fetch(`${apiOrigin}/api/session/activity`, {
      method: 'POST',
      credentials: 'include'
    });
    if (response.status === 401) {
      const data = await response.json().catch(() => null);
      if (data?.error === 'session_expired_inactivity') {
        handleSessionExpiration();
      }
    }
  } catch {
    // network issue, backend will re-validate on next authenticated request
  }
}

function handleSessionExpiration() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_HAS_SESSION_KEY);
  }
  broadcastSessionEvent('SESSION_EXPIRED', { reason: 'inactivity' });
  emitAuthState('SIGNED_OUT');
  if (typeof window !== 'undefined') {
    if (window.location.hash === '#admin') {
      window.location.assign(`login.html?reason=inactivity&next=${encodeURIComponent('index.html#admin')}`);
    } else if (document.body?.dataset?.authPage === 'login') {
      const url = new URL(window.location.href);
      if (url.searchParams.get('reason') !== 'inactivity') {
        url.searchParams.set('reason', 'inactivity');
        window.location.replace(url.toString());
      }
    }
  }
}

export function recordUserActivity() {
  const now = Date.now();
  localLastActiveTime = now;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_LAST_ACTIVE_KEY, String(now));
    } catch {
      // ignore
    }
  }

  // Throttle broadcasting activity across tabs (at most once every 10s)
  if (now - lastBroadcastTime >= 10000) {
    lastBroadcastTime = now;
    broadcastSessionEvent('USER_ACTIVITY', { timestamp: now });
  }

  // If in admin mode or has active session, ping backend to maintain authoritative session
  const isAdmin = typeof window !== 'undefined' && (
    window.location.hash === '#admin' ||
    (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_HAS_SESSION_KEY) === '1')
  );

  if (isAdmin && now - lastBackendPingTime >= 45000) {
    lastBackendPingTime = now;
    pingBackendActivity();
  }
}

function handleIncomingSessionEvent(data) {
  if (!data || typeof data !== 'object') return;
  if (data.tabId === tabId) return;
  if (markSeen(data.msgId)) return;

  switch (data.type) {
    case 'USER_ACTIVITY': {
      const remoteTime = Number(data.payload?.timestamp || data.timestamp || Date.now());
      if (remoteTime > localLastActiveTime) {
        localLastActiveTime = remoteTime;
      }
      break;
    }
    case 'SESSION_LOGIN': {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_HAS_SESSION_KEY, '1');
        localStorage.setItem(STORAGE_LAST_ACTIVE_KEY, String(Date.now()));
      }
      localLastActiveTime = Date.now();
      if (typeof window !== 'undefined' && document.body?.dataset?.authPage === 'login') {
        window.location.assign('index.html#admin');
      }
      break;
    }
    case 'SESSION_LOGOUT': {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_HAS_SESSION_KEY);
      }
      emitAuthState('SIGNED_OUT');
      if (typeof window !== 'undefined' && window.location.hash === '#admin') {
        window.location.assign('login.html');
      }
      break;
    }
    case 'SESSION_EXPIRED': {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_HAS_SESSION_KEY);
      }
      emitAuthState('SIGNED_OUT');
      if (typeof window !== 'undefined' && window.location.hash === '#admin') {
        window.location.assign(`login.html?reason=inactivity&next=${encodeURIComponent('index.html#admin')}`);
      }
      break;
    }
  }
}

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
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_HAS_SESSION_KEY, '1');
    localStorage.setItem(STORAGE_LAST_ACTIVE_KEY, String(Date.now()));
  }
  localLastActiveTime = Date.now();
  emitAuthState('SIGNED_IN', current.data.session);
  broadcastSessionEvent('SESSION_LOGIN', { userId: current.data.session?.user?.id });
  return { data, error: null };
}

export async function signOut() {
  const data = await request('sign-out', {});
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_HAS_SESSION_KEY);
  }
  emitAuthState('SIGNED_OUT');
  broadcastSessionEvent('SESSION_LOGOUT');
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

  window.DMC_SESSION_SYNC = {
    broadcast: broadcastSessionEvent,
    recordActivity: recordUserActivity,
    getTabId: () => tabId
  };

  let activeUserId = null;
  const refreshAuthState = async (initial = false) => {
    try {
      const { data } = await getSession();
      const userId = data.session?.user?.id || null;
      if (userId) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STORAGE_HAS_SESSION_KEY, '1');
        }
      } else {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(STORAGE_HAS_SESSION_KEY);
        }
      }
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

  // Track user activity across all tabs when in admin or authenticated
  const activityEvents = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'scroll'];
  const onActivity = () => {
    const isAdmin = window.location.hash === '#admin' ||
      (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_HAS_SESSION_KEY) === '1');
    if (isAdmin) {
      recordUserActivity();
    }
  };

  activityEvents.forEach((evt) => {
    window.addEventListener(evt, onActivity, { passive: true });
  });

  if (channel) {
    channel.onmessage = (event) => handleIncomingSessionEvent(event.data);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_EVENT_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        handleIncomingSessionEvent(parsed);
      } catch {
        // ignore
      }
    }
  });

  // Check 1 hour of total inactivity across all tabs every 15s
  setInterval(() => {
    if (typeof localStorage === 'undefined') return;
    const hasSession = localStorage.getItem(STORAGE_HAS_SESSION_KEY) === '1';
    if (!hasSession) return;

    const storageTime = parseInt(localStorage.getItem(STORAGE_LAST_ACTIVE_KEY) || '0', 10);
    const mostRecent = Math.max(localLastActiveTime, storageTime);

    if (mostRecent > 0 && Date.now() - mostRecent >= INACTIVITY_TIMEOUT_MS) {
      handleSessionExpiration();
    }
  }, 15000);
}
