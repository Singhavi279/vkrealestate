/* ============================================================
   VKREA 2026 — Main JavaScript
   ============================================================ */

'use strict';

const PHONE_REGEX = /^[6-9]\d{9}$/;
const OTP_REGEX = /^\d{6}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRICT_TEXT_REGEX = /^[A-Za-z][A-Za-z .'-]*$/;
const NAME_HAS_LETTER_REGEX = /[a-z]/i;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_RESENDS = 3;
const STATUS_CODES = {
  VERIFIED: [212, 213],
  UNREGISTERED: [214, 215],
  UNVERIFIED: [205, 206],
};
const GRX_EVENTS = {
  otpSendClick: { type: 'visitors', action: 'Send OTP Click', ga: 'otp_send_click' },
  otpSent: { type: 'visitors', action: 'OTP Sent', ga: 'otp_sent' },
  otpVerifySuccess: { type: 'visitors', action: 'OTP Verified', ga: 'otp_verified' },
  otpVerifyFailure: { type: 'visitors', action: 'OTP Incorrect', ga: 'otp_failed' },
  otpResend: { type: 'visitors', action: 'OTP Resend', ga: 'otp_resend' },
  formSubmit: { type: 'visitors', action: 'Submit', ga: 'form_submit' },
};

/* Fire a Google Analytics (gtag) event. Never sends PII (phone/email) to GA. */
function gaTrack(action, params) {
  if (typeof window.gtag !== 'function' || !action) return;
  try {
    window.gtag('event', action, params || {});
  } catch (_) { /* no-op */ }
}
const DEFAULT_GRX_API_KEY =
  (window.constants &&
    (window.constants.grx_apikey ||
      window.constants.grxApiKey ||
      (window.constants.envDetails &&
        ((window.constants.envDetails.production &&
          window.constants.envDetails.production.grxApiKey) ||
          (window.constants.envDetails.testing &&
            window.constants.envDetails.testing.grxApiKey))))) ||
  '';
const GRX_TRACKING_NAME ='vkrealestate2026';
const pendingTracks = [];
const otpSdkState = { ready: false };

const Analytics = {
  init(apiKey) {
    if (!apiKey) return;
    (function (g, r, o, w, t, h, rx) {
      g[t] = g[t] || function () { (g[t].q = g[t].q || []).push(arguments); };
      g[t].l = 1 * new Date();
      h = r.createElement(o);
      rx = r.getElementsByTagName(o)[0];
      h.async = 1;
      h.src = w;
      h.onload = function () {
        window.grx('init', apiKey);
        Analytics.flushPending();
        setTimeout(() => {
          if (typeof window.grx === 'function') {
            window.grx('track', 'page_view', { url: window.location.href });
            Analytics.flushPending();
          }
        }, 100);
      };
      rx.parentNode.insertBefore(h, rx);
    })(window, document, 'script', 'https://static.growthrx.in/js/v2/web-sdk.js', 'grx');
  },
  track(eventName, data, type) {
    if (typeof window.grx !== 'function') {
      pendingTracks.push({ eventName, data, type });
      return;
    }
    if (type === 'profile') window.grx('profile', eventName, data);
    else window.grx('track', eventName, data);
  },
  flushPending() {
    if (typeof window.grx !== 'function' || !pendingTracks.length) return;
    while (pendingTracks.length) {
      const item = pendingTracks.shift();
      if (!item) continue;
      if (item.type === 'profile') window.grx('profile', item.eventName, item.data);
      else window.grx('track', item.eventName, item.data);
    }
  },
};

function getMetaData() {
  const searchParams = new URLSearchParams(window.location.search);
  return {
    url: window.location.href,
    ...(searchParams.get('utm_source') && { utm_source: searchParams.get('utm_source') }),
    ...(searchParams.get('utm_medium') && { utm_medium: searchParams.get('utm_medium') }),
    ...(searchParams.get('utm_campaign') && { utm_campaign: searchParams.get('utm_campaign') }),
    ...(searchParams.get('acqsource') && { acqsource: searchParams.get('acqsource') }),
    ...(searchParams.get('acqsubsource') && { acqsubsource: searchParams.get('acqsubsource') }),
  };
}

function trackEvent(eventKey, data) {
  const config = GRX_EVENTS[eventKey];
  if (!config) return;
  const formName = (data && data.form_name) || 'Register for Nomination';
  Analytics.track(
    GRX_TRACKING_NAME,
    {
      ...(data || {}),
      ...getMetaData(),
      form_name: formName,
      form_type: (data && data.form_type) || config.type || 'visitors',
      event_action: config.action,
      timestamp: new Date().toISOString(),
    },
    (data && data.form_type) || config.type || 'visitors',
  );

  // Mirror every form event into Google Analytics (gtag) — no PII.
  gaTrack(config.ga, {
    event_category: 'form',
    event_label: formName,
    form_name: formName,
    form_purpose: (data && data.purpose) || undefined,
  });
  if (eventKey === 'formSubmit') {
    gaTrack('generate_lead', {
      event_category: 'form',
      event_label: formName,
      form_name: formName,
      form_purpose: (data && data.purpose) || undefined,
    });
  }
}

function fireProfileSubmit(data) {
  Analytics.track(
    GRX_TRACKING_NAME,
    {
      ...(data || {}),
      ...getMetaData(),
      form_name: (data && data.form_name) || 'Register for Nomination',
      form_type: (data && data.form_type) || GRX_EVENTS.formSubmit.type || 'visitors',
      event_action: GRX_EVENTS.formSubmit.action,
      timestamp: new Date().toISOString(),
    },
    'profile',
  );
}

function getGrxApiKey() {
  const constants = window.constants || {};
  const isProd = String(window.isProdEnv) !== 'false';
  const envConfig = constants.envDetails
    ? constants.envDetails[isProd ? 'production' : 'testing']
    : null;
  return (
    constants.grx_apikey ||
    constants.grxApiKey ||
    (envConfig && envConfig.grxApiKey) ||
    DEFAULT_GRX_API_KEY
  );
}

function getPlatform() {
  return window.platform || (window.innerWidth < 768 ? 'mweb' : 'web');
}

function waitForJssoRef() {
  if (window.jssoRef && typeof window.jssoRef.checkUserExists === 'function') {
    otpSdkState.ready = true;
    return;
  }
  window.addEventListener('jssoScriptLoaded', () => {
    if (window.jssoRef && typeof window.jssoRef.checkUserExists === 'function') {
      otpSdkState.ready = true;
    }
  }, { once: true });
  let tries = 0;
  const pollInterval = setInterval(() => {
    if (window.jssoRef && typeof window.jssoRef.checkUserExists === 'function') {
      clearInterval(pollInterval);
      otpSdkState.ready = true;
    }
    if (++tries > 50) clearInterval(pollInterval);
  }, 100);
}

function initializeOtpSdk() {
  if (window.jssoRef && typeof window.jssoRef.checkUserExists === 'function') {
    otpSdkState.ready = true;
    return;
  }
  if (typeof window.LoginSupporter !== 'function') return;
  try {
    window.loginSupporter = new window.LoginSupporter({
      config: {
        channel: (window.constants && (window.constants.login_channel || window.constants.channel)) || 'nbt',
        platform: getPlatform(),
        useProdScript: true,
        loginOptions: ['mobile'],
      },
    });
    window.loginSupporter.initialize(function () {
      if (window.loginSupporter && typeof window.loginSupporter.returnJSsoObject === 'function') {
        window.jssoRef = window.loginSupporter.returnJSsoObject();
      }
      const userDetails = window.loginSupporter && window.loginSupporter.userDetails;
      if (userDetails && userDetails.ssoid && typeof window.grx === 'function') {
        window.grx('userId', userDetails.ssoid);
      }
      if (window.jssoRef && typeof window.jssoRef.checkUserExists === 'function') {
        otpSdkState.ready = true;
      }
    });
    waitForJssoRef();
  } catch (_) {
    otpSdkState.ready = false;
  }
}

async function waitForSdk(timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (window.jssoRef && typeof window.jssoRef.checkUserExists === 'function') {
      otpSdkState.ready = true;
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

async function sdkCall(methodName, ...args) {
  const ready = await waitForSdk();
  if (!ready || !window.jssoRef || typeof window.jssoRef[methodName] !== 'function') {
    throw new Error('OTP service unavailable');
  }
  return new Promise((resolve, reject) => {
    try {
      window.jssoRef[methodName](...args, resp => resolve(resp));
    } catch (error) {
      reject(error);
    }
  });
}

function getStatusCode(resp) {
  return Number(resp && (resp.code || resp.statusCode || resp.status || resp.responseCode));
}

function isOtpDispatchSuccess(resp) {
  const statusCode = getStatusCode(resp);
  if (statusCode >= 200 && statusCode < 300) return true;
  const message = `${(resp && (resp.message || resp.statusText)) || ''}`.toLowerCase();
  return message.includes('otp') && (message.includes('sent') || message.includes('generated'));
}

function isRegisterOtpDispatchSuccess(resp) {
  const statusCode = getStatusCode(resp);
  if (statusCode === 200 || statusCode === 429) return true;
  return isOtpDispatchSuccess(resp);
}

function extractSsoId(resp) {
  if (!resp) return null;
  return (
    (resp.data && (resp.data.ssoid || resp.data.ssoId || resp.data.userId)) ||
    (resp.data && resp.data.data && (resp.data.data.ssoid || resp.data.data.ssoId || resp.data.data.userId)) ||
    resp.ssoid || resp.ssoId || resp.userId || null
  );
}

function isOtpVerifySuccess(resp) {
  const statusCode = getStatusCode(resp);
  if (statusCode >= 200 && statusCode < 300) return true;
  const message = `${(resp && (resp.message || resp.statusText)) || ''}`.toLowerCase();
  return message.includes('success') || message.includes('verified');
}

async function verifySignUpOtp(phone, ssoId, otp) {
  const payload = { mobile: phone, ssoid: ssoId, otp };
  const ref = window.jssoRef || {};
  if (typeof ref.verifySignUpOTP === 'function') {
    try {
      return await sdkCall('verifySignUpOTP', payload);
    } catch (_) {
      return sdkCall('verifySignUpOTP', phone, ssoId, otp);
    }
  }
  if (typeof ref.verifyMobileSignUp === 'function') {
    return sdkCall('verifyMobileSignUp', phone, ssoId, otp);
  }
  throw new Error('Signup OTP verification service unavailable.');
}

async function resendSignUpOtp(phone, ssoId) {
  const ref = window.jssoRef || {};
  if (typeof ref.resendMobileSignUpOtp === 'function') {
    return sdkCall('resendMobileSignUpOtp', phone, ssoId);
  }
  throw new Error('Unable to resend signup OTP.');
}

document.addEventListener('DOMContentLoaded', () => {
  Analytics.init(getGrxApiKey());
  initializeOtpSdk();
  initNavbar();
  initCategories();
  initFAQ();
  initNominationForm();
  initReadMore();
});

/* ============================================================
   NAVBAR
   ============================================================ */
function initNavbar() {
  const nav = document.getElementById('nav');
  const burger = document.getElementById('nav-burger');
  const navLinks = nav ? nav.querySelectorAll('.nav-links a, .nav-cta') : [];

  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 40);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (burger && nav) {
    burger.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('menu-open');
      burger.classList.toggle('open', isOpen);
      burger.setAttribute('aria-expanded', String(isOpen));
    });

    navLinks.forEach(link => {
      link.addEventListener('click', () => {
        nav.classList.remove('menu-open');
        burger.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }
}

/* ============================================================
   CATEGORIES · Tab Navigation + Accordion Panels
   ============================================================ */
function initCategories() {
  // Each `.js-tab-accordion` root is an independent tab + accordion widget
  // (Award Categories and Eligibility Criteria both use this same UI).
  const roots = document.querySelectorAll('.js-tab-accordion');
  if (roots.length) {
    roots.forEach(initTabAccordion);
  } else {
    // Fallback for markup without the wrapper class (scoped to whole document).
    initTabAccordion(document);
  }
}

function initTabAccordion(root) {
  const tabs = root.querySelectorAll('.cat-tab-button');
  const panels = root.querySelectorAll('.cat-tab-panel');

  if (!tabs.length || !panels.length) return;

  function initAccordions() {
    const accordions = root.querySelectorAll('.acc-item');
    accordions.forEach(item => {
      const header = item.querySelector('.acc-header');
      const body = item.querySelector('.acc-body');

      if (!header || !body) return;

      header.addEventListener('click', () => {
        const isActive = item.classList.contains('active');
        const parentPanel = item.closest('.cat-tab-panel');

        if (parentPanel) {
          const siblings = parentPanel.querySelectorAll('.acc-item');
          siblings.forEach(sibling => {
            if (sibling !== item) {
              sibling.classList.remove('active');
              const siblingHeader = sibling.querySelector('.acc-header');
              const siblingBody = sibling.querySelector('.acc-body');
              if (siblingHeader) siblingHeader.setAttribute('aria-expanded', 'false');
              if (siblingBody) siblingBody.style.maxHeight = '0';
            }
          });
        }

        if (isActive) {
          item.classList.remove('active');
          header.setAttribute('aria-expanded', 'false');
          body.style.maxHeight = '0';
        } else {
          item.classList.add('active');
          header.setAttribute('aria-expanded', 'true');
          body.style.maxHeight = body.scrollHeight + 'px';
        }
      });
    });
  }

  function setFirstAccordionActive(panel) {
    const items = panel.querySelectorAll('.acc-item');
    items.forEach((item, index) => {
      const header = item.querySelector('.acc-header');
      const body = item.querySelector('.acc-body');

      if (!header || !body) return;

      if (index === 0) {
        item.classList.add('active');
        header.setAttribute('aria-expanded', 'true');
        body.style.maxHeight = body.scrollHeight + 'px';
      } else {
        item.classList.remove('active');
        header.setAttribute('aria-expanded', 'false');
        body.style.maxHeight = '0';
      }
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.getAttribute('aria-controls');
      const targetPanel = document.getElementById(targetId);

      if (!targetPanel) return;

      tabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      panels.forEach(p => p.classList.remove('active'));
      targetPanel.classList.add('active');

      setFirstAccordionActive(targetPanel);
    });
  });

  initAccordions();

  const activePanel = root.querySelector('.cat-tab-panel.active');
  if (activePanel) setFirstAccordionActive(activePanel);

  window.addEventListener('resize', () => {
    root.querySelectorAll('.acc-item.active .acc-body').forEach(body => {
      body.style.maxHeight = body.scrollHeight + 'px';
    });
  });
}

/* ============================================================
   FAQ · single-open behavior
   ============================================================ */
function initFAQ() {
  const items = document.querySelectorAll('.faq-item');
  items.forEach(item => {
    item.addEventListener('toggle', () => {
      if (item.open) {
        items.forEach(o => { if (o !== item && o.open) o.open = false; });
      }
    });
  });
}

/* ============================================================
   READ MORE · truncate long overview copy to ~30 words / 300 chars,
   rounded off to the end of the sentence, with an expand toggle
   ============================================================ */
function initReadMore() {
  document.querySelectorAll('.overview-text').forEach(container => {
    const paras = Array.from(container.querySelectorAll(':scope > p'));
    // Each visual unit is a run of paragraphs sharing the same class
    // (e.g. the larger .overview-lead vs the smaller .overview-body block).
    const units = [];
    paras.forEach(p => {
      const last = units[units.length - 1];
      if (last && last[0].className === p.className) last.push(p);
      else units.push([p]);
    });
    units.forEach(truncateUnit);
  });
}

function truncateUnit(unitParas) {
  const MIN_WORDS = 30;
  const MIN_CHARS = 300;

  let wordCount = 0;
  let charCount = 0;
  let cutParaIndex = -1;
  let cutOffset = -1;

  outer:
  for (let i = 0; i < unitParas.length; i++) {
    const text = unitParas[i].textContent;
    const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)/g) || [text];
    let offset = 0;
    for (const sentence of sentences) {
      offset += sentence.length;
      wordCount += sentence.trim().split(/\s+/).filter(Boolean).length;
      charCount += sentence.length;
      if (wordCount >= MIN_WORDS || charCount >= MIN_CHARS) {
        cutParaIndex = i;
        cutOffset = offset;
        break outer;
      }
    }
  }

  // Unit is already short enough — nothing to truncate.
  const lastIdx = unitParas.length - 1;
  const cutPara = unitParas[cutParaIndex];
  if (cutParaIndex === -1 || (cutParaIndex === lastIdx && cutOffset >= cutPara.textContent.length)) {
    return;
  }

  const fullText = cutPara.textContent;
  const visible = fullText.slice(0, cutOffset).trim();
  const tail = fullText.slice(cutOffset);
  const restParas = unitParas.slice(cutParaIndex + 1);

  const ellipsis = document.createElement('span');
  ellipsis.className = 'overview-ellipsis';
  ellipsis.textContent = '…';

  const hiddenTail = document.createElement('span');
  hiddenTail.className = 'overview-hidden-tail';
  hiddenTail.hidden = true;
  hiddenTail.textContent = tail;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'overview-readmore-btn';
  btn.textContent = 'Read More';
  btn.setAttribute('aria-expanded', 'false');

  cutPara.textContent = '';
  cutPara.append(document.createTextNode(visible + ' '), ellipsis, hiddenTail, ' ', btn);

  restParas.forEach(p => { p.hidden = true; });

  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    hiddenTail.hidden = expanded;
    ellipsis.hidden = !expanded;
    restParas.forEach(p => { p.hidden = expanded; });
    btn.textContent = expanded ? 'Read More' : 'Read Less';
    btn.setAttribute('aria-expanded', String(!expanded));
  });
}

/* ============================================================
   NOMINATION FORM
   ============================================================ */
function initNominationForm() {
  const form = document.getElementById('nomination-form');
  if (!form) return;

  const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwLV6oKSWBW7kJ3SQvW9jLP5qDCONrC9j10H_BySVUqSPujLXYXGJwpulix-G0YBWUp/exec';
  const successOverlay = document.getElementById('success-overlay');
  const btnSuccessClose = document.getElementById('btn-success-close');
  const successCard = successOverlay ? successOverlay.querySelector('.success-card') : null;
  const submitBtn = document.getElementById('btn-submit-nomination');

  const inputName = document.getElementById('form-name');
  const inputPhone = document.getElementById('form-phone');
  const sendOtpBtn = document.getElementById('btn-send-otp');
  const otpRow = document.getElementById('otp-row');
  const otpInput = document.getElementById('form-otp');
  const verifyOtpBtn = document.getElementById('btn-verify-otp');
  const otpVerified = document.getElementById('otp-verified');
  const otpHint = document.getElementById('otp-hint');
  const inputEmail = document.getElementById('form-email');
  const inputDesignation = document.getElementById('form-designation');
  const inputCompany = document.getElementById('form-company');
  const inputTier = document.getElementById('form-tier');
  const checkUpdates = document.getElementById('check-updates');
  const checkTerms = document.getElementById('check-terms');
  const otpState = {
    phone: '',
    otp: '',
    ssoId: null,
    isRegistrationFlow: false,
    isOtpVerified: false,
    resendTimerRef: null,
    resendRemaining: 0,
    resendClicks: 0,
  };

  const setOtpHint = (message, type) => {
    if (!otpHint) return;
    otpHint.textContent = message || '';
    otpHint.hidden = !message;
    otpHint.classList.remove('success', 'error', 'info');
    if (type) otpHint.classList.add(type);
  };

  const updateSendOtpButton = () => {
    if (!sendOtpBtn) return;
    if (otpState.isOtpVerified) {
      sendOtpBtn.disabled = true;
      sendOtpBtn.textContent = 'Verified';
      return;
    }
    if (otpState.resendRemaining > 0) {
      sendOtpBtn.disabled = true;
      sendOtpBtn.textContent = `Resend in ${otpState.resendRemaining}s`;
      return;
    }
    if (otpState.resendClicks >= OTP_MAX_RESENDS && otpState.phone) {
      sendOtpBtn.disabled = true;
      sendOtpBtn.textContent = 'Resend limit reached';
      return;
    }
    sendOtpBtn.disabled = false;
    sendOtpBtn.textContent = otpState.phone ? 'Resend OTP' : 'Send OTP';
  };

  const clearResendTimer = () => {
    if (otpState.resendTimerRef) {
      clearInterval(otpState.resendTimerRef);
      otpState.resendTimerRef = null;
    }
    otpState.resendRemaining = 0;
    updateSendOtpButton();
  };

  const startResendTimer = () => {
    otpState.resendRemaining = OTP_RESEND_SECONDS;
    updateSendOtpButton();
    if (otpState.resendTimerRef) clearInterval(otpState.resendTimerRef);
    otpState.resendTimerRef = setInterval(() => {
      otpState.resendRemaining -= 1;
      updateSendOtpButton();
      if (otpState.resendRemaining <= 0) {
        clearInterval(otpState.resendTimerRef);
        otpState.resendTimerRef = null;
      }
    }, 1000);
  };

  const resetOtpState = (clearPhone = false) => {
    otpState.phone = clearPhone ? '' : otpState.phone;
    otpState.otp = '';
    otpState.ssoId = null;
    otpState.isRegistrationFlow = false;
    otpState.isOtpVerified = false;
    otpState.resendClicks = 0;
    clearResendTimer();
    if (clearPhone && inputPhone) inputPhone.value = '';
    if (otpInput) otpInput.value = '';
    if (otpRow) otpRow.hidden = true;
    if (otpVerified) otpVerified.hidden = true;
    setOtpHint('', null);
    updateSendOtpButton();
  };

  const clearError = (inputEl) => {
    if (!inputEl) return;
    const group = inputEl.closest('.form-group') || inputEl.closest('.checkbox-group');
    if (group) group.classList.remove('has-error');
  };

  const showError = (inputEl) => {
    if (!inputEl) return;
    const group = inputEl.closest('.form-group') || inputEl.closest('.checkbox-group');
    if (group) group.classList.add('has-error');
  };

  const fields = [inputName, inputPhone, inputEmail, inputDesignation, inputCompany, inputTier];

  fields.forEach(input => {
    if (input) {
      input.addEventListener('input', () => {
        clearError(input);
        if (input === inputPhone) {
          inputPhone.value = inputPhone.value.replace(/\D/g, '').slice(0, 10);
          if (otpState.phone && inputPhone.value !== otpState.phone) {
            otpState.phone = '';
            resetOtpState(false);
          }
        } else if (input.type === 'text') {
          input.value = input.value.replace(/[^A-Za-z .'-]/g, '').replace(/\s{2,}/g, ' ').replace(/^\s+/, '');
        }
      });
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', () => clearError(input));
      }
    }
  });

  if (checkTerms) {
    checkTerms.addEventListener('change', () => clearError(checkTerms));
  }

  if (otpInput) {
    otpInput.addEventListener('input', () => {
      otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
      clearError(inputPhone);
      setOtpHint('', null);
    });
  }

  async function sendOtp() {
    if (!otpSdkState.ready) {
      setOtpHint('OTP service not ready. Please wait...', 'info');
      return;
    }

    const phoneVal = inputPhone.value.trim();
    if (!PHONE_REGEX.test(phoneVal)) {
      showError(inputPhone);
      inputPhone.focus();
      setOtpHint('Please enter a valid 10-digit mobile number.', 'error');
      return;
    }

    clearError(inputPhone);
    trackEvent('otpSendClick', { phone_number: phoneVal, form_name: 'Register for Nomination' });
    if (sendOtpBtn) {
      sendOtpBtn.disabled = true;
      sendOtpBtn.textContent = 'Sending...';
    }

    try {
      const checkResp = await sdkCall('checkUserExists', phoneVal);
      if (!checkResp || checkResp.code !== 200) {
        throw new Error('Could not validate user. Try again.');
      }

      const checkStatus = Number(checkResp?.data?.statusCode || 0);
      otpState.phone = phoneVal;

      if (STATUS_CODES.VERIFIED.includes(checkStatus)) {
        otpState.isRegistrationFlow = false;
        otpState.ssoId = null;
        const otpResp = await sdkCall('getMobileLoginOtp', phoneVal);
        if (!isOtpDispatchSuccess(otpResp)) throw new Error('Unable to send OTP.');
      } else if (STATUS_CODES.UNREGISTERED.includes(checkStatus) || STATUS_CODES.UNVERIFIED.includes(checkStatus)) {
        otpState.isRegistrationFlow = true;
        const registerResp = await sdkCall(
          'registerUser',
          'Member',
          '',
          '',
          '',
          '',
          phoneVal,
          '123Times@',
          false,
          '1',
          '0',
          '0',
          '',
          '',
        );
        otpState.ssoId = extractSsoId(registerResp) || extractSsoId(checkResp);
        if (!isRegisterOtpDispatchSuccess(registerResp)) throw new Error('Unable to send OTP.');
      } else {
        throw new Error('Unable to initiate OTP. Please try again.');
      }

      if (otpRow) otpRow.hidden = false;
      if (otpVerified) otpVerified.hidden = true;
      startResendTimer();
      setOtpHint(`OTP sent to +91 ${phoneVal}`, 'success');
      trackEvent('otpSent', { phone_number: phoneVal, form_name: 'Register for Nomination' });
      if (otpInput) otpInput.focus();
    } catch (error) {
      setOtpHint(error.message || 'Unable to send OTP. Please try again.', 'error');
    } finally {
      updateSendOtpButton();
    }
  }

  async function verifyOtp() {
    const otpVal = (otpInput?.value || '').trim();
    if (!OTP_REGEX.test(otpVal)) {
      setOtpHint('Enter valid 6-digit OTP.', 'error');
      otpInput?.focus();
      return;
    }

    if (verifyOtpBtn) {
      verifyOtpBtn.disabled = true;
      verifyOtpBtn.textContent = 'Verifying...';
    }

    try {
      otpState.otp = otpVal;
      let verifyResp;
      if (otpState.isRegistrationFlow || otpState.ssoId) {
        if (!otpState.ssoId) throw new Error('Unable to verify signup OTP. Please request OTP again.');
        verifyResp = await verifySignUpOtp(otpState.phone, otpState.ssoId, otpVal);
      } else {
        verifyResp = await sdkCall('verifyMobileLogin', otpState.phone, otpVal);
      }

      if (!isOtpVerifySuccess(verifyResp)) throw new Error('Invalid OTP. Please try again.');

      otpState.isOtpVerified = true;
      if (otpRow) otpRow.hidden = true;
      if (otpVerified) otpVerified.hidden = false;
      clearResendTimer();
      setOtpHint('', null);
      updateSendOtpButton();
      trackEvent('otpVerifySuccess', { phone_number: otpState.phone, form_name: 'Register for Nomination' });
    } catch (error) {
      trackEvent('otpVerifyFailure', { phone_number: otpState.phone, form_name: 'Register for Nomination' });
      setOtpHint(error.message || 'OTP verification failed.', 'error');
    } finally {
      if (verifyOtpBtn) {
        verifyOtpBtn.disabled = false;
        verifyOtpBtn.textContent = 'Verify OTP';
      }
    }
  }

  async function resendOtp() {
    if (!otpState.phone || otpState.resendRemaining > 0 || otpState.resendClicks >= OTP_MAX_RESENDS) return;
    try {
      if (otpState.isRegistrationFlow) {
        if (!otpState.ssoId) throw new Error('Unable to resend signup OTP.');
        const otpResp = await resendSignUpOtp(otpState.phone, otpState.ssoId);
        if (!isOtpDispatchSuccess(otpResp)) throw new Error('Unable to resend OTP. Please try again.');
      } else {
        const otpResp = await sdkCall('getMobileLoginOtp', otpState.phone);
        if (!isOtpDispatchSuccess(otpResp)) throw new Error('Unable to resend OTP. Please try again.');
      }
      otpState.resendClicks += 1;
      startResendTimer();
      setOtpHint('OTP resent.', 'success');
      trackEvent('otpResend', {
        phone_number: otpState.phone,
        attempt: otpState.resendClicks,
        form_name: 'Register for Nomination',
      });
    } catch (error) {
      setOtpHint(error.message || 'Unable to resend OTP.', 'error');
    } finally {
      updateSendOtpButton();
    }
  }

  sendOtpBtn?.addEventListener('click', () => {
    if (otpState.phone && !otpState.isOtpVerified && otpState.resendRemaining === 0) resendOtp();
    else sendOtp();
  });
  verifyOtpBtn?.addEventListener('click', verifyOtp);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let isValid = true;
    let firstInvalidField = null;

    const setInvalid = (inputEl, textElId, customMsg) => {
      showError(inputEl);
      isValid = false;
      if (!firstInvalidField) firstInvalidField = inputEl;
      if (customMsg && textElId) {
        const errorTextEl = document.getElementById(textElId);
        if (errorTextEl) errorTextEl.textContent = customMsg;
      }
    };

    if (!inputName.value.trim()) setInvalid(inputName);

    const phoneVal = inputPhone.value.trim();
    if (!PHONE_REGEX.test(phoneVal)) {
      setInvalid(inputPhone, 'error-phone', 'Please enter a valid 10-digit mobile number.');
    }

    const emailVal = inputEmail.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) setInvalid(inputEmail);

    if (!inputDesignation.value.trim()) setInvalid(inputDesignation);
    if (!inputCompany.value.trim()) setInvalid(inputCompany);
    if (inputTier && !inputTier.value) setInvalid(inputTier);
    if (checkTerms && !checkTerms.checked) setInvalid(checkTerms);
    if (!otpState.isOtpVerified || otpState.phone !== phoneVal) {
      setInvalid(inputPhone, 'error-phone', 'Please verify your phone number with OTP.');
      setOtpHint('Please verify your phone number before submitting.', 'error');
    }

    if (!isValid) {
      if (firstInvalidField) {
        firstInvalidField.scrollIntoView({ block: 'center' });
        firstInvalidField.focus();
      }
      return;
    }

    const tierMetaMap = {
      standard: { label: 'Standard Entry', amount: 32000, base_amount: 40000, gst: true },
      spotlight: { label: 'Spotlight Plan', amount: 56000, base_amount: 80000, gst: true },
      elite: { label: 'Elite Entry', amount: 94999, base_amount: 160000, gst: true }
    };
    const tierKey = inputTier.value;
    const selectedTierOption = inputTier.options[inputTier.selectedIndex];
    const selectedTierText = selectedTierOption ? selectedTierOption.textContent.trim() : '';
    const selectedTierMeta = tierMetaMap[tierKey] || {};

    const formData = {
      name: inputName.value.trim(),
      phone: inputPhone.value.trim(),
      email: inputEmail.value.trim(),
      designation: inputDesignation.value.trim(),
      company: inputCompany.value.trim(),
      tier: tierKey,
      tier_label: selectedTierMeta.label || selectedTierText || tierKey,
      tier_option_text: selectedTierText,
      tier_amount: selectedTierMeta.amount || null,
      tier_base_amount: selectedTierMeta.base_amount || null,
      tier_gst_applicable: typeof selectedTierMeta.gst === 'boolean' ? selectedTierMeta.gst : true,
      updates: !!(checkUpdates && checkUpdates.checked),
      terms: !!(checkTerms && checkTerms.checked)
    };

    const grxFormData = {
      form_name: 'Register for Nomination',
      purpose: 'nomination',
      full_name: formData.name,
      phone_number: formData.phone,
      email: formData.email.toLowerCase(),
      designation: formData.designation,
      company: formData.company,
      tier: formData.tier,
      tier_label: formData.tier_label,
      whatsapp_opt_in: String(formData.updates),
      email_opt_in: String(formData.updates),
      terms_privacy_opt_in: String(formData.terms),
      sso_id:
        otpState.ssoId ||
        (window.loginSupporter &&
          window.loginSupporter.userDetails &&
          window.loginSupporter.userDetails.ssoid) ||
        '',
      host_url: window.location.href,
    };

    trackEvent('formSubmit', grxFormData);
    fireProfileSubmit(grxFormData);

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
      }

      const response = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(formData)
      });

      let result = null;
      try {
        result = await response.json();
      } catch (jsonErr) {
        result = { success: response.ok };
      }

      if (result && result.success) {
        form.reset();
        resetOtpState(true);
        if (successOverlay) {
          successOverlay.style.display = 'flex';
          successOverlay.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.setTimeout(() => {
            if (successCard) successCard.focus();
          }, 120);
        } else {
          alert('Nomination submitted successfully!');
        }
      } else {
        console.error((result && result.error) || 'Submission failed.');
        alert('Submission failed. Please try again.');
      }
    } catch (error) {
      console.error('Submission error:', error);
      alert('Something went wrong. Please try again.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Nomination';
      }
    }
  });

  if (btnSuccessClose && successOverlay) {
    btnSuccessClose.addEventListener('click', () => {
      successOverlay.style.display = 'none';
    });
  }

  updateSendOtpButton();

  const pricingTierBtns = document.querySelectorAll('.pricing-grid [data-tier]');
  pricingTierBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tierVal = btn.getAttribute('data-tier');
      if (inputTier) {
        inputTier.value = tierVal;
        clearError(inputTier);
      }
    });
  });
}