'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const authPagesPath = path.join(__dirname, '..', 'frontend', 'auth-pages.js');
const authPagesSource = fs.readFileSync(authPagesPath, 'utf8')
  .replace(/^import \{[\s\S]*?\} from '\.\/auth\.js';\r?\n/, '')
  .replace(
    /initialize\(\)\.catch\(\(error\) => \{\s*showMessage\(authErrorMessage\(error, 'session'\)\);\s*\}\);\s*$/,
    'globalThis.authInitialize = initialize;'
  );

function createAuthPage(page, authMocks = {}, search = '') {
  const submitButton = {
    dataset: {},
    disabled: false,
    textContent: page === 'signup' ? 'Create account' : 'Sign in'
  };
  const form = {
    values: {},
    listener: null,
    querySelector: () => submitButton,
    addEventListener(type, listener) {
      if (type === 'submit') this.listener = listener;
    }
  };
  const message = { dataset: {}, hidden: true, textContent: '' };
  const dialogTitle = { textContent: '' };
  const dialogBody = { textContent: '' };
  const dialog = {
    open: false,
    listeners: new Map(),
    querySelector(selector) {
      return selector === '[data-dialog-title]' ? dialogTitle : dialogBody;
    },
    addEventListener(type, listener, options) {
      this.listeners.set(type, { listener, once: options?.once });
    },
    showModal() { this.open = true; },
    close() {
      this.open = false;
      const registration = this.listeners.get('close');
      registration?.listener();
      if (registration?.once) this.listeners.delete('close');
    }
  };
  const redirects = [];
  const window = {
    location: {
      search,
      replace(path) { redirects.push(path); }
    }
  };
  class TestFormData {
    constructor() { return new Map(Object.entries(form.values)); }
  }
  const context = vm.createContext({
    ...authMocks,
    document: {
      body: { dataset: { authPage: page } },
      querySelector(selector) {
        if (selector === '[data-auth-form]') return form;
        if (selector === '[data-auth-message]') return message;
        if (selector === '[data-account-dialog]') return dialog;
        return null;
      }
    },
    window,
    URLSearchParams,
    FormData: TestFormData
  });
  vm.runInContext(authPagesSource, context, { filename: authPagesPath });
  return { context, form, message, dialog, dialogTitle, dialogBody, submitButton, redirects };
}

function submit(form) {
  let prevented = false;
  const result = form.listener({ preventDefault() { prevented = true; } });
  return { prevented, result };
}

test('signup blocks submission during session checks, validates input, and opens the approval dialog', async () => {
  let finishSessionCheck;
  let finishSignup;
  let signUpCalls = 0;
  const page = createAuthPage('signup', {
    redirectIfLoggedIn: () => new Promise((resolve) => { finishSessionCheck = resolve; }),
    signUp: () => {
      signUpCalls += 1;
      return new Promise((resolve) => { finishSignup = resolve; });
    }
  });

  const initialization = page.context.authInitialize();
  page.form.values = {
    full_name: 'Test Patient',
    username: 'test_patient',
    password: 'Strong-pass-123',
    confirm_password: 'Strong-pass-123'
  };
  const early = submit(page.form);
  assert.equal(early.prevented, true);
  assert.match(page.message.textContent, /security checks to finish/);
  assert.equal(signUpCalls, 0);

  finishSessionCheck(false);
  await initialization;

  page.form.values.confirm_password = 'Not-the-same';
  await submit(page.form).result;
  assert.equal(page.message.textContent, 'Passwords do not match.');
  assert.equal(signUpCalls, 0);

  page.form.values.confirm_password = 'Strong-pass-123';
  const request = submit(page.form).result;
  assert.equal(page.submitButton.disabled, true);
  assert.equal(page.submitButton.textContent, 'Creating account…');
  finishSignup({ error: null });
  await request;

  assert.equal(page.dialog.open, true);
  assert.equal(page.dialogTitle.textContent, 'Account created');
  assert.match(page.dialogBody.textContent, /wait for an administrator to approve/);
  assert.equal(page.submitButton.disabled, false);
  page.dialog.close();
  assert.equal(page.dialog.open, false);
  assert.deepEqual(page.redirects, ['login.html?approval=pending']);
});

test('login displays pending and rejected dialogs and signs out before denying access', async () => {
  for (const status of ['pending', 'rejected']) {
    let signOutCalls = 0;
    const page = createAuthPage('login', {
      redirectIfLoggedIn: async () => false,
      signIn: async () => ({ error: null }),
      getAccountStatus: async () => ({ status }),
      signOut: async () => { signOutCalls += 1; return { error: null }; }
    });
    await page.context.authInitialize();
    page.form.values = { username: 'test_patient', password: 'Strong-pass-123' };

    await submit(page.form).result;

    assert.equal(page.dialog.open, true);
    assert.equal(signOutCalls, 1);
    assert.deepEqual(page.redirects, []);
    if (status === 'pending') {
      assert.equal(page.dialogTitle.textContent, 'Approval pending');
      assert.match(page.dialogBody.textContent, /must approve your account/);
    } else {
      assert.equal(page.dialogTitle.textContent, 'Account request declined');
      assert.match(page.dialogBody.textContent, /request was declined/);
    }
    page.dialog.close();
    assert.equal(page.dialog.open, false);
  }
});

test('approved login redirects to the admin dashboard', async () => {
  const page = createAuthPage('login', {
    redirectIfLoggedIn: async () => false,
    signIn: async () => ({ error: null }),
    getAccountStatus: async () => ({ status: 'approved' })
  });
  await page.context.authInitialize();
  page.form.values = { username: 'approved_admin', password: 'Strong-pass-123' };

  await submit(page.form).result;

  assert.deepEqual(page.redirects, ['index.html#admin']);
  assert.equal(page.dialog.open, false);
});

test('login displays a pending approval notice after redirecting from signup', async () => {
  const page = createAuthPage('login', {
    redirectIfLoggedIn: async () => false
  }, '?approval=pending');

  await page.context.authInitialize();

  assert.equal(page.dialog.open, true);
  assert.equal(page.dialogTitle.textContent, 'Approval pending');
  assert.match(page.dialogBody.textContent, /must approve your account/);
});

test('login and signup approval dialogs have a native close action', () => {
  for (const pageName of ['login.html', 'signup.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', pageName), 'utf8');
    assert.match(html, /<dialog class="account-approval-dialog" data-account-dialog/);
    assert.match(html, /<form method="dialog"><button class="btn" type="submit">Understood<\/button><\/form>/);
  }
  const signup = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'signup.html'), 'utf8');
  assert.doesNotMatch(signup, /<script src="script\.js"><\/script>/);
});
