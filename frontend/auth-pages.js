import {
  getSession,
  getAccountStatus,
  redirectIfLoggedIn,
  signIn,
  signOut,
  signUp
} from './auth.js';

const form = document.querySelector('[data-auth-form]');
const message = document.querySelector('[data-auth-message]');
const submitButton = form?.querySelector('button[type="submit"]');
const page = document.body.dataset.authPage;
let authPageReady = false;

function showMessage(text, type = 'error') {
  if (!message) return;
  message.textContent = text;
  message.dataset.type = type;
  message.hidden = !text;
}

function showApprovalDialog(status = 'pending', registration = false) {
  const dialog = document.querySelector('[data-account-dialog]');
  if (!dialog) {
    showMessage(registration
      ? 'Account created. Please wait for admin approval.'
      : status === 'rejected'
        ? 'This account request was declined. Contact the hospital administrator.'
        : status === 'deactivated'
          ? 'This account has been deactivated. Contact the hospital administrator.'
          : 'Account created. Please wait for admin approval.', 'success');
    return;
  }
  const title = dialog.querySelector('[data-dialog-title]');
  const body = dialog.querySelector('[data-dialog-body]');
  if (status === 'rejected') {
    title.textContent = 'Account request declined';
    body.textContent = 'This account request was declined. Please contact the hospital administrator if you think this is a mistake.';
  } else if (status === 'deactivated') {
    title.textContent = 'Account deactivated';
    body.textContent = 'This account has been deactivated. Please contact the hospital administrator if you require access.';
  } else {
    title.textContent = registration ? 'Account created' : 'Approval pending';
    body.textContent = registration
      ? 'Your account has been created. Please wait for an administrator to approve it before signing in.'
      : 'An administrator must approve your account before you can use it.';
  }
  if (registration) {
    dialog.addEventListener('close', () => {
      window.location.replace('login.html?approval=pending');
    }, { once: true });
  }
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else showMessage(body.textContent, 'success');
}

function authErrorMessage(error, action) {
  const code = error?.code || '';
  const text = String(error?.message || '').toLowerCase();
  if (code === 'INVALID_USERNAME_OR_PASSWORD' || code === 'invalid_credentials' || text.includes('invalid login credentials')) {
    return 'Username or password is incorrect.';
  }
  if (code === 'USERNAME_IS_ALREADY_TAKEN' || text.includes('username is already taken')) {
    return 'That username is already taken. Choose another username.';
  }
  if (code === 'weak_password' || code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG' || text.includes('password should be')) {
    return 'Password is too weak. Use at least 8 characters and follow the password requirements.';
  }
  if (code === 'USERNAME_TOO_SHORT' || code === 'USERNAME_TOO_LONG' || code === 'INVALID_USERNAME') {
    return 'Use a username with 3–30 letters, numbers, periods, or underscores.';
  }
  if (text.includes('fetch') || text.includes('network')) {
    return 'Could not reach the authentication service. Check your connection and try again.';
  }
  if (action === 'signup') {
    return 'Could not create the account. Check the details and try again.';
  }
  if (action === 'session' && error?.status >= 500) {
    return 'The authentication service is unavailable. Check server setup and try again.';
  }
  return 'Could not complete that request. Please try again.';
}

function setLoading(isLoading, label) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? label : submitButton.dataset.label;
}

async function runRequest(label, action, request) {
  showMessage('');
  setLoading(true, label);
  let shouldResetLoading = true;
  try {
    const outcome = await request();
    if (outcome && outcome.redirecting) {
      shouldResetLoading = false;
    }
  } catch (error) {
    showMessage(authErrorMessage(error, action));
  } finally {
    if (shouldResetLoading) {
      setLoading(false);
    }
  }
}

function nextPage() {
  const requested = new URLSearchParams(window.location.search).get('next');
  if (requested === 'index.html#admin') return requested;
  return 'index.html#admin';
}

if (submitButton) submitButton.dataset.label = submitButton.textContent;
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!authPageReady) {
    showMessage('Please wait for account security checks to finish, then try again.');
    return;
  }
  const values = new FormData(form);
  const username = String(values.get('username') || '').trim();

  if (page === 'signup') {
    const fullName = String(values.get('full_name') || '').trim();
    const password = String(values.get('password') || '');
    const confirmPassword = String(values.get('confirm_password') || '');
    if (fullName.length < 2) return showMessage('Enter your full name.');
    if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
      return showMessage('Use a username with 3–30 letters, numbers, periods, or underscores.');
    }
    if (password.length < 8) return showMessage('Password must be at least 8 characters.');
    if (password !== confirmPassword) return showMessage('Passwords do not match.');
    return runRequest('Creating account…', 'signup', async () => {
      const { error } = await signUp(username, password, { fullName });
      if (error) throw error;
      showApprovalDialog('pending', true);
    });
  }

  if (page === 'login') {
    if (!username) return showMessage('Enter your username.');
    if (!String(values.get('password') || '')) return showMessage('Enter your password.');
    return runRequest('Signing in…', 'login', async () => {
      const { error } = await signIn(
        username,
        String(values.get('password'))
      );
      if (error) throw error;
      const account = await getAccountStatus();
      if (account.status !== 'approved') {
        await signOut();
        showApprovalDialog(account.status);
        return;
      }
      setLoading(true, 'Signing in…');
      window.location.replace(nextPage());
      return { redirecting: true };
    });
  }
});

async function initialize() {
  if (!form) return;

  if (page === 'login' || page === 'signup') {
    try {
      const redirectTo = page === 'login' ? 'index.html#admin' : 'index.html';
      if (await redirectIfLoggedIn(redirectTo)) return;
      if (window.DMC_ACCOUNT_APPROVAL_STATUS) {
        showApprovalDialog(window.DMC_ACCOUNT_APPROVAL_STATUS);
        delete window.DMC_ACCOUNT_APPROVAL_STATUS;
      } else if (page === 'login' && new URLSearchParams(window.location.search).get('approval') === 'pending') {
        showApprovalDialog('pending');
      } else if (page === 'login' && new URLSearchParams(window.location.search).get('reason') === 'inactivity') {
        showMessage('Your session expired after 1 hour of inactivity. Please sign in again.', 'info');
      }
    } catch (error) {
      showMessage(authErrorMessage(error, 'session'));
      return;
    }
  }

  authPageReady = true;
}

initialize().catch((error) => {
  showMessage(authErrorMessage(error, 'session'));
});
