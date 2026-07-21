/* ============================================================
   VKREA 2026 — Generic Enquiry / Partnership Forms
   Reuses the OTP SDK + analytics helpers defined in main.js.
   Each <form class="enquiry-form"> is independent (class-scoped,
   so multiple forms can coexist on one page without ID clashes).
   Required data attributes:
     data-form-name  · analytics label
     data-purpose    · "attend" | "partnership" | ...
   Optional:
     data-endpoint   · submission URL (defaults to the shared one)
   ============================================================ */

'use strict';

(function () {
  const DEFAULT_ENDPOINT =
    'https://script.google.com/macros/s/AKfycbwLV6oKSWBW7kJ3SQvW9jLP5qDCONrC9j10H_BySVUqSPujLXYXGJwpulix-G0YBWUp/exec';

  function initEnquiryForm(form) {
    const q = (sel) => form.querySelector(sel);
    const formName = form.dataset.formName || 'Enquiry';
    const purpose = form.dataset.purpose || 'enquiry';
    const endpoint = form.dataset.endpoint || DEFAULT_ENDPOINT;

    const el = {
      body: q('.ef-body'),
      success: q('.ef-success'),
      name: q('.ef-name'),
      phone: q('.ef-phone'),
      sendOtp: q('.ef-send-otp'),
      otpRow: q('.ef-otp-row'),
      otp: q('.ef-otp'),
      verifyOtp: q('.ef-verify-otp'),
      otpVerified: q('.ef-otp-verified'),
      otpHint: q('.ef-otp-hint'),
      email: q('.ef-email'),
      company: q('.ef-company'),
      designation: q('.ef-designation'),
      type: q('.ef-type'),
      message: q('.ef-message'),
      waOptin: q('.ef-wa-optin'),
      emailOptin: q('.ef-email-optin'),
      terms: q('.ef-terms'),
      submit: q('.ef-submit'),
      phoneError: q('.ef-phone-error'),
    };

    if (!el.phone || !el.submit) return;

    const otpState = {
      phone: '', otp: '', ssoId: null,
      isRegistrationFlow: false, isOtpVerified: false,
      resendTimerRef: null, resendRemaining: 0, resendClicks: 0,
    };

    const track = (key, extra) =>
      trackEvent(key, { form_name: formName, form_type: 'visitors', purpose, ...(extra || {}) });

    const setOtpHint = (message, type) => {
      if (!el.otpHint) return;
      el.otpHint.textContent = message || '';
      el.otpHint.hidden = !message;
      el.otpHint.classList.remove('success', 'error', 'info');
      if (type) el.otpHint.classList.add(type);
    };

    const updateSendOtpButton = () => {
      if (!el.sendOtp) return;
      if (otpState.isOtpVerified) { el.sendOtp.disabled = true; el.sendOtp.textContent = 'Verified'; return; }
      if (otpState.resendRemaining > 0) { el.sendOtp.disabled = true; el.sendOtp.textContent = `Resend in ${otpState.resendRemaining}s`; return; }
      if (otpState.resendClicks >= OTP_MAX_RESENDS && otpState.phone) { el.sendOtp.disabled = true; el.sendOtp.textContent = 'Resend limit reached'; return; }
      el.sendOtp.disabled = false;
      el.sendOtp.textContent = otpState.phone ? 'Resend OTP' : 'Send OTP';
    };

    const clearResendTimer = () => {
      if (otpState.resendTimerRef) { clearInterval(otpState.resendTimerRef); otpState.resendTimerRef = null; }
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
        if (otpState.resendRemaining <= 0) { clearInterval(otpState.resendTimerRef); otpState.resendTimerRef = null; }
      }, 1000);
    };

    const resetOtpState = (clearPhone) => {
      otpState.otp = '';
      otpState.ssoId = null;
      otpState.isRegistrationFlow = false;
      otpState.isOtpVerified = false;
      otpState.resendClicks = 0;
      if (clearPhone) { otpState.phone = ''; if (el.phone) el.phone.value = ''; }
      clearResendTimer();
      if (el.otp) el.otp.value = '';
      if (el.otpRow) el.otpRow.hidden = true;
      if (el.otpVerified) el.otpVerified.hidden = true;
      setOtpHint('', null);
      updateSendOtpButton();
    };

    const groupOf = (input) => input && (input.closest('.form-group') || input.closest('.checkbox-group'));
    const clearError = (input) => { const g = groupOf(input); if (g) g.classList.remove('has-error'); };
    const showError = (input) => { const g = groupOf(input); if (g) g.classList.add('has-error'); };

    // Input sanitising + error clearing
    [el.name, el.company, el.designation].forEach((input) => {
      if (!input) return;
      input.addEventListener('input', () => {
        clearError(input);
        input.value = input.value.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
      });
    });
    if (el.email) el.email.addEventListener('input', () => clearError(el.email));
    if (el.type) el.type.addEventListener('change', () => clearError(el.type));
    if (el.terms) el.terms.addEventListener('change', () => clearError(el.terms));

    if (el.phone) {
      el.phone.addEventListener('input', () => {
        clearError(el.phone);
        el.phone.value = el.phone.value.replace(/\D/g, '').slice(0, 10);
        if (otpState.phone && el.phone.value !== otpState.phone) resetOtpState(false);
      });
    }
    if (el.otp) {
      el.otp.addEventListener('input', () => {
        el.otp.value = el.otp.value.replace(/\D/g, '').slice(0, 6);
        clearError(el.phone);
        setOtpHint('', null);
      });
    }

    async function sendOtp() {
      if (!otpSdkState.ready) { setOtpHint('OTP service not ready. Please wait…', 'info'); return; }
      const phoneVal = el.phone.value.trim();
      if (!PHONE_REGEX.test(phoneVal)) {
        showError(el.phone); el.phone.focus();
        setOtpHint('Please enter a valid 10-digit mobile number.', 'error');
        return;
      }
      clearError(el.phone);
      track('otpSendClick', { phone_number: phoneVal });
      if (el.sendOtp) { el.sendOtp.disabled = true; el.sendOtp.textContent = 'Sending…'; }

      try {
        const checkResp = await sdkCall('checkUserExists', phoneVal);
        if (!checkResp || checkResp.code !== 200) throw new Error('Could not validate user. Try again.');
        const checkStatus = Number((checkResp.data && checkResp.data.statusCode) || 0);
        otpState.phone = phoneVal;

        if (STATUS_CODES.VERIFIED.includes(checkStatus)) {
          otpState.isRegistrationFlow = false;
          otpState.ssoId = null;
          const otpResp = await sdkCall('getMobileLoginOtp', phoneVal);
          if (!isOtpDispatchSuccess(otpResp)) throw new Error('Unable to send OTP.');
        } else if (STATUS_CODES.UNREGISTERED.includes(checkStatus) || STATUS_CODES.UNVERIFIED.includes(checkStatus)) {
          otpState.isRegistrationFlow = true;
          const registerResp = await sdkCall('registerUser', 'Member', '', '', '', '', phoneVal, '123Times@', false, '1', '0', '0', '', '');
          otpState.ssoId = extractSsoId(registerResp) || extractSsoId(checkResp);
          if (!isRegisterOtpDispatchSuccess(registerResp)) throw new Error('Unable to send OTP.');
        } else {
          throw new Error('Unable to initiate OTP. Please try again.');
        }

        if (el.otpRow) el.otpRow.hidden = false;
        if (el.otpVerified) el.otpVerified.hidden = true;
        startResendTimer();
        setOtpHint(`OTP sent to +91 ${phoneVal}`, 'success');
        track('otpSent', { phone_number: phoneVal });
        if (el.otp) el.otp.focus();
      } catch (error) {
        setOtpHint(error.message || 'Unable to send OTP. Please try again.', 'error');
      } finally {
        updateSendOtpButton();
      }
    }

    async function verifyOtp() {
      const otpVal = (el.otp && el.otp.value || '').trim();
      if (!OTP_REGEX.test(otpVal)) { setOtpHint('Enter valid 6-digit OTP.', 'error'); el.otp && el.otp.focus(); return; }
      if (el.verifyOtp) { el.verifyOtp.disabled = true; el.verifyOtp.textContent = 'Verifying…'; }
      try {
        otpState.otp = otpVal;
        let verifyResp;
        if (otpState.isRegistrationFlow || otpState.ssoId) {
          if (!otpState.ssoId) throw new Error('Unable to verify OTP. Please request OTP again.');
          verifyResp = await verifySignUpOtp(otpState.phone, otpState.ssoId, otpVal);
        } else {
          verifyResp = await sdkCall('verifyMobileLogin', otpState.phone, otpVal);
        }
        if (!isOtpVerifySuccess(verifyResp)) throw new Error('Invalid OTP. Please try again.');
        otpState.isOtpVerified = true;
        if (el.otpRow) el.otpRow.hidden = true;
        if (el.otpVerified) el.otpVerified.hidden = false;
        clearResendTimer();
        setOtpHint('', null);
        updateSendOtpButton();
        track('otpVerifySuccess', { phone_number: otpState.phone });
      } catch (error) {
        track('otpVerifyFailure', { phone_number: otpState.phone });
        setOtpHint(error.message || 'OTP verification failed.', 'error');
      } finally {
        if (el.verifyOtp) { el.verifyOtp.disabled = false; el.verifyOtp.textContent = 'Verify OTP'; }
      }
    }

    async function resendOtp() {
      if (!otpState.phone || otpState.resendRemaining > 0 || otpState.resendClicks >= OTP_MAX_RESENDS) return;
      try {
        if (otpState.isRegistrationFlow) {
          if (!otpState.ssoId) throw new Error('Unable to resend OTP.');
          const otpResp = await resendSignUpOtp(otpState.phone, otpState.ssoId);
          if (!isOtpDispatchSuccess(otpResp)) throw new Error('Unable to resend OTP. Please try again.');
        } else {
          const otpResp = await sdkCall('getMobileLoginOtp', otpState.phone);
          if (!isOtpDispatchSuccess(otpResp)) throw new Error('Unable to resend OTP. Please try again.');
        }
        otpState.resendClicks += 1;
        startResendTimer();
        setOtpHint('OTP resent.', 'success');
        track('otpResend', { phone_number: otpState.phone, attempt: otpState.resendClicks });
      } catch (error) {
        setOtpHint(error.message || 'Unable to resend OTP.', 'error');
      } finally {
        updateSendOtpButton();
      }
    }

    if (el.sendOtp) {
      el.sendOtp.addEventListener('click', () => {
        if (otpState.phone && !otpState.isOtpVerified && otpState.resendRemaining === 0) resendOtp();
        else sendOtp();
      });
    }
    if (el.verifyOtp) el.verifyOtp.addEventListener('click', verifyOtp);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let isValid = true;
      let firstInvalid = null;
      const invalid = (input, msg) => {
        showError(input);
        isValid = false;
        if (!firstInvalid) firstInvalid = input;
        if (msg && input === el.phone && el.phoneError) el.phoneError.textContent = msg;
      };

      if (el.name && !el.name.value.trim()) invalid(el.name);
      const phoneVal = el.phone.value.trim();
      if (!PHONE_REGEX.test(phoneVal)) invalid(el.phone, 'Please enter a valid 10-digit mobile number.');
      if (el.email && !EMAIL_REGEX.test(el.email.value.trim())) invalid(el.email);
      if (el.company && !el.company.value.trim()) invalid(el.company);
      if (el.designation && !el.designation.value.trim()) invalid(el.designation);
      if (el.type && el.type.required && !el.type.value) invalid(el.type);
      if (el.terms && !el.terms.checked) invalid(el.terms);
      if (!otpState.isOtpVerified || otpState.phone !== phoneVal) {
        invalid(el.phone, 'Please verify your phone number with OTP.');
        setOtpHint('Please verify your phone number before submitting.', 'error');
      }

      if (!isValid) {
        if (firstInvalid) { firstInvalid.scrollIntoView({ block: 'center', behavior: 'smooth' }); firstInvalid.focus(); }
        return;
      }

      const payload = {
        purpose,
        form_name: formName,
        name: el.name ? el.name.value.trim() : '',
        phone: phoneVal,
        email: el.email ? el.email.value.trim() : '',
        company: el.company ? el.company.value.trim() : '',
        designation: el.designation ? el.designation.value.trim() : '',
        enquiry_type: el.type ? el.type.value : '',
        message: el.message ? el.message.value.trim() : '',
        whatsapp_opt_in: !!(el.waOptin && el.waOptin.checked),
        email_opt_in: !!(el.emailOptin && el.emailOptin.checked),
        terms: !!(el.terms && el.terms.checked),
      };

      const grxData = {
        form_name: formName,
        purpose,
        full_name: payload.name,
        phone_number: payload.phone,
        email: payload.email.toLowerCase(),
        company: payload.company,
        designation: payload.designation,
        enquiry_type: payload.enquiry_type,
        whatsapp_opt_in: String(payload.whatsapp_opt_in),
        email_opt_in: String(payload.email_opt_in),
        terms_privacy_opt_in: String(payload.terms),
        sso_id: otpState.ssoId ||
          (window.loginSupporter && window.loginSupporter.userDetails && window.loginSupporter.userDetails.ssoid) || '',
        host_url: window.location.href,
      };

      trackEvent('formSubmit', grxData);
      fireProfileSubmit(grxData);

      if (el.submit) { el.submit.disabled = true; el.submit.textContent = 'Submitting…'; }
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
        let result = null;
        try { result = await response.json(); } catch (_) { result = { success: response.ok }; }

        if (result && result.success) {
          if (el.body) el.body.hidden = true;
          if (el.success) {
            el.success.hidden = false;
            el.success.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          alert('Submission failed. Please try again.');
        }
      } catch (error) {
        alert('Something went wrong. Please try again.');
      } finally {
        if (el.submit) { el.submit.disabled = false; el.submit.textContent = 'Submit Enquiry'; }
      }
    });

    updateSendOtpButton();
  }

  function initEnquiryForms() {
    document.querySelectorAll('form.enquiry-form').forEach(initEnquiryForm);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEnquiryForms);
  } else {
    initEnquiryForms();
  }
})();
