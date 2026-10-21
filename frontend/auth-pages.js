import {
  getSession,
  redirectIfLoggedIn,
  resetPassword,
  signIn,
  signUp,
  updatePassword
} from './auth.js';

const form = document.querySelector('[data-auth-form]');
const message = document.querySelector('[data-auth-message]');
const submitButton = form?.querySelector('button[type="submit"]');
const page = document.body.dataset.authPage;

function showMessage(text, type = 'error') {
  if (!message) return;
  message.textContent = text;
  message.dataset.type = type;
  message.hidden = !text;
}

function authErrorMessage(error, action) {
  const code = error?.code || '';
  const text = String(error?.message || '').toLowerCase();
  if (code === 'invalid_credentials' || code === 'INVALID_EMAIL_OR_PASSWORD' || text.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }
  if (code === 'email_exists' || code === 'USER_ALREADY_EXISTS' || text.includes('already registered') || text.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (code === 'weak_password' || code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG' || text.includes('password should be')) {
    return 'Password is too weak. Use at least 8 characters and follow the password requirements.';
  }
  if (code === 'email_not_confirmed' || code === 'EMAIL_NOT_VERIFIED' || text.includes('email not verified') || text.includes('email not confirmed')) {
    return 'Please confirm your email using the link we sent before signing in.';
  }
  if (code === 'otp_expired' || code === 'INVALID_TOKEN' || text.includes('expired') || text.includes('invalid token')) {
    return 'This link is invalid or expired. Request a new password reset email.';
  }
  if (text.includes('fetch') || text.includes('network')) {
    return 'Could not reach the authentication service. Check your connection and try again.';
  }
  if (action === 'reset') {
    return 'Could not send the reset email. Check the SMTP email settings and try again.';
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
  try {
    await request();
  } catch (error) {
    showMessage(authErrorMessage(error, action));
  } finally {
    setLoading(false);
  }
}

function nextPage() {
  const requested = new URLSearchParams(window.location.search).get('next');
  if (requested === 'index.html#admin') return requested;
  return 'index.html';
}

async function initialize() {
  if (!form) return;

  if (page === 'login' || page === 'signup' || page === 'forgot-password') {
    try {
      if (await redirectIfLoggedIn('index.html')) return;
    } catch (error) {
      showMessage(authErrorMessage(error, 'session'));
      return;
    }
  }

  if (page === 'reset-password') {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      showMessage('Open the password reset link from your email, or request a new one.', 'info');
      submitButton.disabled = true;
    }
  }

  if (submitButton) submitButton.dataset.label = submitButton.textContent;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const email = String(values.get('email') || '').trim();
    if (['login', 'signup', 'forgot-password'].includes(page)
      && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return showMessage('Enter a valid email address.');
    }

    if (page === 'signup') {
      const fullName = String(values.get('full_name') || '').trim();
      const phone = String(values.get('phone') || '').trim();
      const password = String(values.get('password') || '');
      const confirmPassword = String(values.get('confirm_password') || '');
      const phoneDigits = phone.replace(/\D/g, '');
      if (fullName.length < 2) return showMessage('Enter your full name.');
      if (!/^\+?[0-9\s().-]{7,20}$/.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) {
        return showMessage('Enter a valid phone number, including country code if needed.');
      }
      if (password.length < 8) return showMessage('Password must be at least 8 characters.');
      if (password !== confirmPassword) return showMessage('Passwords do not match.');
      return runRequest('Creating account…', 'signup', async () => {
        const { data, error } = await signUp(email, password, { fullName, phone });
        if (error) throw error;
        if (data.session) {
          window.location.replace('index.html');
          return;
        }
        showMessage('Account created. Check your email to confirm your address before signing in.', 'success');
      });
    }

    if (page === 'login') {
      if (!String(values.get('password') || '')) return showMessage('Enter your password.');
      return runRequest('Signing in…', 'login', async () => {
        const { error } = await signIn(
          email,
          String(values.get('password'))
        );
        if (error) throw error;
        window.location.replace(nextPage());
      });
    }

    if (page === 'forgot-password') {
      return runRequest('Sending email…', 'reset', async () => {
        const redirectTo = new URL('reset-password.html', window.location.href).href;
        const { error } = await resetPassword(email, redirectTo);
        if (error) throw error;
        showMessage('If an account exists for that email, a password reset link has been sent.', 'success');
      });
    }

    if (page === 'reset-password') {
      const token = new URLSearchParams(window.location.search).get('token');
      if (!token) return showMessage('This password reset link is invalid. Request a new one.');
      const password = String(values.get('password') || '');
      const confirmPassword = String(values.get('confirm_password') || '');
      if (password.length < 8) return showMessage('Password must be at least 8 characters.');
      if (password !== confirmPassword) return showMessage('Passwords do not match.');
      return runRequest('Saving password…', 'update', async () => {
        const { error } = await updatePassword(password, token);
        if (error) throw error;
        showMessage('Your password has been updated. You can now sign in.', 'success');
        form.reset();
        submitButton.disabled = true;
      });
    }
  });
}

initialize().catch((error) => {
  showMessage(authErrorMessage(error, 'session'));
});
