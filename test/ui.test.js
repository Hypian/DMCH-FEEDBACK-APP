'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

class FakeClassList {
  constructor(classes = []) {
    this.values = new Set(classes);
  }

  add(name) {
    this.values.add(name);
  }

  remove(name) {
    this.values.delete(name);
  }

  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = { ...attributes };
    this.dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[key] = value;
      }
    }
    this.classList = new FakeClassList((attributes.class || '').split(/\s+/).filter(Boolean));
    this.style = {};
    this.disabled = false;
    this.textContent = '';
    this.parentElement = { setAttribute: (name, value) => this.parentAttributes[name] = value };
    this.parentAttributes = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  remove() {
    this.removed = true;
  }
}

function makeContext(fetchImplementation, storage = new Map()) {
  const timers = new Map();
  const options = [];
  const app = {
    renderCount: 0,
    elements: new Map(),
    children: [],
    set innerHTML(value) {
      this.html = value;
      this.renderCount += 1;
      this.elements.clear();
      const tags = value.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi);
      for (const [, source] of tags) {
        const attributes = {};
        for (const [, name, rawValue] of source.matchAll(/([\w-]+)="([^"]*)"/g)) {
          attributes[name] = rawValue;
        }
        const element = new FakeElement(attributes);
        if (attributes.id) this.elements.set(attributes.id, element);
        if (attributes['data-question']) options.push(element);
      }
      const progress = this.elements.get('submit-progress');
      if (progress) progress.parentElement = new FakeElement();
    },
    get innerHTML() {
      return this.html || '';
    },
    querySelector(selector) {
      if (selector === '.btn') {
        const match = this.html && this.html.match(/<button\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>/);
        if (!match) return null;
        const attrs = {};
        for (const [, name, value] of match[0].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[name] = value;
        return new FakeElement(attrs);
      }
      return null;
    },
    append(node) {
      this.children.push(node);
    }
  };
  let nextTimerId = 1;
  const splash = new FakeElement();
  const welcome = new FakeElement();
  const document = {
    getElementById(id) {
      if (id === 'app') return app;
      if (id === 'splash') return splash.removed ? null : splash;
      if (id === 'wl') return welcome;
      return app.elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === '.intro-language') {
        return [...app.elements.values()].filter((element) => element.dataset.language);
      }
      if (selector === '#app .opt.lang') return [];
      const match = selector.match(/^\.opt\[data-question="([^"]+)"\]$/);
      return match ? options.filter((option) => option.dataset.question === match[1]) : [];
    },
    createElement() {
      return new FakeElement();
    }
  };
  const context = vm.createContext({
    document,
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) {
        if (storage.failWritesFor?.has(key)) throw new Error(`Storage write failed for ${key}.`);
        storage.set(key, value);
      },
      removeItem(key) { storage.delete(key); }
    },
    fetch: fetchImplementation || (async () => { throw new Error('Unexpected network request.'); }),
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay, interval: false });
      if (delay >= 850 && delay <= 1000) {
        Promise.resolve().then(() => {
          if (!timers.has(id)) return;
          timers.delete(id);
          callback();
        });
      }
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay, interval: true });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    addEventListener() {},
    scrollTo() {},
    location: { hash: '' },
    console: { error() {}, log() {} },
    alert() {},
    confirm() { return true; },
    URL: { createObjectURL() { return ''; } },
    Blob: class {}
  });
  vm.runInContext(script, context);

  return { app, context, options, storage, timers };
}

test('single-choice selection updates in place and advances only once', () => {
  const { app, context, options, timers } = makeContext();
  vm.runInContext("S={lang:'en',dept:'o0',a:{}}; i=3;", context);
  options.push(...[0, 1, 2, 3].map((option) => {
    const element = new FakeElement({ 'data-question': 'q1', 'data-option': String(option) });
    return element;
  }));

  const rendersBeforeSelection = app.renderCount;
  vm.runInContext("ans('q1',0); ans('q1',1);", context);

  assert.equal(app.renderCount, rendersBeforeSelection);
  assert.equal(vm.runInContext('S.a.q1', context), 0);
  assert.equal(options[0].classList.contains('on'), true);
  assert.equal(options[1].classList.contains('on'), false);
  assert.equal(options[0].attributes['aria-pressed'], 'true');

  const timerId = vm.runInContext('answerTimer', context);
  timers.get(timerId).callback();
  assert.equal(vm.runInContext('i', context), 4);
  assert.equal(app.renderCount, rendersBeforeSelection + 1);
});

test('survey screen entrance animation leaves the top logo outside the animation', () => {
  assert.match(styles, /\.wrap\.screen-enter\{animation:none\}/);
  assert.match(styles, /\.wrap\.screen-enter>:not\(\.top\)\{animation:screen-enter/);
  assert.doesNotMatch(styles, /\.screen-enter\{animation:screen-enter/);
  assert.match(styles, /\.top img\{width:131px;height:38px;flex:none;object-fit:contain\}/);
});

test('welcome splash logo preserves its aspect ratio within the viewport', () => {
  assert.match(styles, /#splash img\{[^}]*width:min\(78vw,380px\);height:auto;aspect-ratio:760\/221;object-fit:contain/);
});

test('survey starts with Visited Services and omits browser-ID privacy disclaimer', () => {
  const { app, context } = makeContext();
  vm.runInContext("S={lang:'en',dept:null,a:{}}; i=0; render(false)", context);

  assert.match(app.innerHTML, /Visited Services/);
  assert.doesNotMatch(app.innerHTML, /Are you an inpatient or outpatient/);
  assert.doesNotMatch(app.innerHTML, /Feedback is confidential|anonymous ID saved in this browser/);
});

test('intro language changes in place and starts without making network requests', () => {
  let fetchCalls = 0;
  const { app, context, storage } = makeContext(async () => {
    fetchCalls += 1;
    throw new Error('The local demo must not make network requests.');
  });
  vm.runInContext('renderIntro(false)', context);
  assert.match(app.innerHTML, /<img class="intro-logo" src="logo-optimized\.jpg" alt="Dream Medical Center Hospital" width="760" height="221" loading="lazy" decoding="async">/);
  assert.doesNotMatch(app.innerHTML, /✦/);
  const rendersBeforeLanguageChange = app.renderCount;

  vm.runInContext("chooseLanguage('fr')", context);
  assert.equal(app.renderCount, rendersBeforeLanguageChange);
  assert.match(vm.runInContext('g(U.introTitle)', context), /QUESTIONNAIRE DE SATISFACTION DU SERVICE DES CONSULTATIONS EXTERNES/);

  vm.runInContext('startSurvey()', context);

  assert.equal(vm.runInContext('i', context), 0);
  assert.equal(storage.has('dmc_storage_check'), false);
  assert.equal(storage.has('dmc_device_id'), false);
  assert.equal(fetchCalls, 0);
  assert.equal(vm.runInContext("'phone' in S", context), false);
  assert.equal(vm.runInContext("flow().includes('phone')", context), false);
  assert.match(app.innerHTML, /Services Visités/i);
});

test('a local submission within 24 hours restores the completion screen without network access', () => {
  const storage = new Map([['dmc_completed', JSON.stringify({ submittedAt: Date.now(), lang: 'fr' })]]);
  let fetchCalls = 0;
  const { app, context } = makeContext(async () => {
    fetchCalls += 1;
    throw new Error('The local demo must not make network requests.');
  }, storage);
  vm.runInContext('renderIntro(false)', context);
  vm.runInContext("chooseLanguage('fr')", context);

  vm.runInContext('startSurvey()', context);

  assert.match(app.innerHTML, /MERCI D(&#39;|')AVOIR CHOISI DREAM MEDICAL CENTER HOSPITAL!/);
  assert.doesNotMatch(app.innerHTML, /Bienvenue à DMC Hospital/);
  assert.match(app.innerHTML, /Envoyé/);
  assert.equal(fetchCalls, 0);
});

test('successful local submission saves the response and restores the completion screen after refresh', async () => {
  let fetchCalls = 0;
  const fetchImplementation = async () => {
    fetchCalls += 1;
    throw new Error('The local demo must not make network requests.');
  };
  const { app, context, storage } = makeContext(fetchImplementation);
  const submission = vm.runInContext(
    "clearTimeout(welcomeTimer); welcomeTimer=null; S={lang:'en',dept:'o0',a:{q1:1}}; submit()",
    context
  );
  await Promise.resolve();
  assert.match(app.innerHTML, /submit-progress/);
  await submission;
  assert.equal(fetchCalls, 0);
  assert.match(app.innerHTML, /THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!/);
  assert.doesNotMatch(app.innerHTML, /Welcome to DMC Hospital/);
  assert.match(app.innerHTML, /Submitted/);
  assert.equal(JSON.parse(storage.get('dmc_r')).length, 1);
  assert.equal(JSON.parse(storage.get('dmc_r'))[0].a.q1, 1);
  assert.equal(JSON.parse(storage.get('dmc_completed')).lang, 'en');

  const refreshed = makeContext(fetchImplementation, storage);
  assert.match(refreshed.app.innerHTML, /THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!/);
  assert.equal(refreshed.timers.size, 0);
});

test('failed local save keeps answers and offers a successful retry', async () => {
  const storage = new Map();
  storage.failWritesFor = new Set(['dmc_r']);
  const { app, context } = makeContext(null, storage);
  vm.runInContext(
    "clearTimeout(welcomeTimer); welcomeTimer=null; S={lang:'en',dept:'o0',a:{q1:1}}",
    context
  );

  await vm.runInContext('submit()', context);
  assert.match(app.innerHTML, /Your answers are still here/);
  assert.equal(vm.runInContext('S.a.q1', context), 1);
  storage.failWritesFor.clear();
  await vm.runInContext('submit()', context);

  assert.equal(JSON.parse(storage.get('dmc_r')).length, 1);
  assert.match(app.innerHTML, /THANK YOU FOR CHOOSING DREAM MEDICAL CENTER HOSPITAL!!!!!!!/);
});
