/* =========================================================
   Sunrise Drivers Check-In  ·  app.js
   Vanilla ES2020+. No deps. PWA + camera + GPS + JSON submit.
   ========================================================= */

(() => {
  'use strict';

  const WEBHOOK_URL = 'https://sandyautomations.app.n8n.cloud/webhook/sunrise-attendance/ingest';
  const STORAGE_KEY = 'sd_session_v1';

  // ----- state -----

  const state = {
    phone: '',          // '+919999900001'
    code: '',           // '412563'
    checkinType: 'check_in',
    selfie: null,       // data URL string
    vehicle: null,      // data URL string
    gps: null,          // { lat, lng, accuracy }
    submitting: false,
  };

  // ----- helpers: DOM -----

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const screens = {
    login:   $('#screen-login'),
    capture: $('#screen-capture'),
    result:  $('#screen-result'),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      const active = key === name;
      el.classList.toggle('screen--active', active);
      el.hidden = !active;
    });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  // ----- helpers: formatting -----

  const onlyDigits = (s) => (s || '').replace(/\D+/g, '');

  function formatIndianPhoneDisplay(tenDigits) {
    // 9999900001 -> "+91 99999 00001"
    const d = onlyDigits(tenDigits).slice(0, 10);
    if (d.length <= 5) return '+91 ' + d;
    return '+91 ' + d.slice(0, 5) + ' ' + d.slice(5);
  }

  function e164India(tenDigits) {
    const d = onlyDigits(tenDigits).slice(0, 10);
    return '+91' + d;
  }

  // IST is UTC+5:30, no DST. Shift by 330 minutes then read UTC fields to get
  // IST values — works regardless of device timezone.
  function istShifted(now = new Date()) {
    return new Date(now.getTime() + 330 * 60000);
  }

  function istIso(now = new Date()) {
    // Build ISO 8601 like 2026-05-11T15:30:00+05:30 (IST, +330 min offset).
    const ist = istShifted(now);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const yyyy = ist.getUTCFullYear();
    const mm   = pad(ist.getUTCMonth() + 1);
    const dd   = pad(ist.getUTCDate());
    const HH   = pad(ist.getUTCHours());
    const MM   = pad(ist.getUTCMinutes());
    const SS   = pad(ist.getUTCSeconds());
    return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}+05:30`;
  }

  function istClock(now = new Date()) {
    // "15:32 IST"
    const ist = istShifted(now);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
  }

  // ----- session persistence (phone + code only, never images) -----

  function saveSession() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        phone: state.phone,
        code:  state.code,
      }));
    } catch (e) { /* ignore */ }
  }
  function loadSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && typeof obj.phone === 'string' && typeof obj.code === 'string') return obj;
      return null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ===========================================================
  // SCREEN 1: LOGIN
  // ===========================================================

  const phoneInput   = $('#phone');
  const codeInput    = $('#code');
  const continueBtn  = $('#btn-continue');
  const phoneErr     = $('#phone-error');
  const codeErr      = $('#code-error');
  const formLogin    = $('#form-login');

  function validatePhone(raw) {
    const d = onlyDigits(raw);
    if (d.length === 0) return { ok: false, msg: '' };
    if (d.length < 10)  return { ok: false, msg: 'Phone must be 10 digits.' };
    if (d.length > 10)  return { ok: false, msg: 'Phone must be 10 digits.' };
    if (!/^[6-9]/.test(d)) return { ok: false, msg: 'Indian mobile starts with 6, 7, 8 or 9.' };
    return { ok: true, msg: '', value: d };
  }
  function validateCode(raw) {
    const d = onlyDigits(raw);
    if (d.length === 0) return { ok: false, msg: '' };
    if (d.length !== 6) return { ok: false, msg: 'Code must be 6 digits.' };
    return { ok: true, msg: '', value: d };
  }

  function refreshLoginState() {
    const p = validatePhone(phoneInput.value);
    const c = validateCode(codeInput.value);
    phoneErr.textContent = p.msg;
    codeErr.textContent  = c.msg;
    continueBtn.disabled = !(p.ok && c.ok);
  }

  phoneInput.addEventListener('input', () => {
    const d = onlyDigits(phoneInput.value).slice(0, 10);
    if (phoneInput.value !== d) phoneInput.value = d;
    refreshLoginState();
  });
  codeInput.addEventListener('input', () => {
    const d = onlyDigits(codeInput.value).slice(0, 6);
    if (codeInput.value !== d) codeInput.value = d;
    refreshLoginState();
  });

  formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = validatePhone(phoneInput.value);
    const c = validateCode(codeInput.value);
    if (!(p.ok && c.ok)) { refreshLoginState(); return; }
    state.phone = e164India(p.value);
    state.code  = c.value;
    saveSession();
    enterCaptureScreen();
  });

  // ===========================================================
  // SCREEN 2: CAPTURE
  // ===========================================================

  const whoPhone     = $('#who-phone');
  const segWrap      = $('.seg');
  const segIn        = $('#seg-in');
  const segOut       = $('#seg-out');
  const btnLogout    = $('#btn-logout');

  const inputSelfie  = $('#input-selfie');
  const inputVehicle = $('#input-vehicle');
  const thumbSelfie  = $('#thumb-selfie');
  const thumbVehicle = $('#thumb-vehicle');
  const capSelfie    = document.querySelector('.cap[data-step="selfie"]');
  const capVehicle   = document.querySelector('.cap[data-step="vehicle"]');
  const capGps       = document.querySelector('.cap[data-step="gps"]');

  const btnGps       = $('#btn-gps');
  const gpsResult    = $('#gps-result');
  const gpsLat       = $('#gps-lat');
  const gpsLng       = $('#gps-lng');
  const gpsAcc       = $('#gps-acc');
  const gpsMap       = $('#gps-map');
  const gpsErr       = $('#gps-error');
  const gpsRetry     = $('#btn-gps-retry');

  const btnSubmit    = $('#btn-submit');
  const submitLabel  = btnSubmit.querySelector('.btn__label');

  const resizer      = $('#resizer');

  function enterCaptureScreen() {
    whoPhone.textContent = formatIndianPhoneDisplay(state.phone.replace(/^\+91/, ''));
    setSegment(state.checkinType);
    refreshSubmitState();
    showScreen('capture');
    // Reset only captures that don't belong to this submission (none on entry, but keep tidy).
  }

  function setSegment(type) {
    state.checkinType = type === 'check_out' ? 'check_out' : 'check_in';
    segWrap.dataset.active = state.checkinType;
    const isIn = state.checkinType === 'check_in';
    segIn.classList.toggle('seg__btn--active', isIn);
    segOut.classList.toggle('seg__btn--active', !isIn);
    segIn.setAttribute('aria-selected', isIn ? 'true' : 'false');
    segOut.setAttribute('aria-selected', isIn ? 'false' : 'true');
    submitLabel.textContent = isIn ? 'Submit check in' : 'Submit check out';
  }

  segIn.addEventListener('click', () => setSegment('check_in'));
  segOut.addEventListener('click', () => setSegment('check_out'));

  btnLogout.addEventListener('click', () => {
    clearSession();
    resetAll();
    showScreen('login');
  });

  function resetAll() {
    state.phone = '';
    state.code  = '';
    state.checkinType = 'check_in';
    resetCaptures();
    phoneInput.value = '';
    codeInput.value  = '';
    refreshLoginState();
  }

  function resetCaptures() {
    state.selfie = null;
    state.vehicle = null;
    state.gps = null;
    [
      { cap: capSelfie,  thumb: thumbSelfie,  retake: capSelfie.querySelector('.cap__retake')  },
      { cap: capVehicle, thumb: thumbVehicle, retake: capVehicle.querySelector('.cap__retake') },
    ].forEach(({ cap, thumb, retake }) => {
      cap.dataset.done = 'false';
      thumb.hidden = true;
      thumb.removeAttribute('src');
      retake.hidden = true;
    });
    capGps.dataset.done = 'false';
    gpsResult.hidden = true;
    gpsErr.hidden = true;
    gpsErr.textContent = '';
    gpsRetry.hidden = true;
    btnGps.disabled = false;
    btnGps.classList.remove('is-loading');
    btnGps.hidden = false;
    setSegment('check_in');
    refreshSubmitState();
  }

  // -------- photo capture + resize --------

  function bindPhotoCapture(target, inputEl, thumbEl, capEl) {
    const shotBtn = capEl.querySelector('.cap__shot');
    const retakeBtn = capEl.querySelector('.cap__retake');

    const triggerPick = () => {
      // Reset value so the same file can be re-picked.
      inputEl.value = '';
      inputEl.click();
    };

    shotBtn.addEventListener('click', triggerPick);
    retakeBtn.addEventListener('click', triggerPick);

    inputEl.addEventListener('change', async () => {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageToDataUrl(file, 1024, 0.78);
        if (target === 'selfie')  state.selfie  = dataUrl;
        if (target === 'vehicle') state.vehicle = dataUrl;
        thumbEl.src = dataUrl;
        thumbEl.hidden = false;
        capEl.dataset.done = 'true';
        retakeBtn.hidden = false;
        refreshSubmitState();
      } catch (err) {
        console.error('Photo capture failed:', err);
        alert('Could not read that photo. Try again.');
      }
    });
  }
  bindPhotoCapture('selfie',  inputSelfie,  thumbSelfie,  capSelfie);
  bindPhotoCapture('vehicle', inputVehicle, thumbVehicle, capVehicle);

  function resizeImageToDataUrl(file, maxLongSide, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read_failed'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const longSide = Math.max(img.naturalWidth, img.naturalHeight);
            const scale = longSide > maxLongSide ? maxLongSide / longSide : 1;
            const w = Math.round(img.naturalWidth  * scale);
            const h = Math.round(img.naturalHeight * scale);
            resizer.width  = w;
            resizer.height = h;
            const ctx = resizer.getContext('2d');
            ctx.fillStyle = '#FFFDF7';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const out = resizer.toDataURL('image/jpeg', quality);
            // Free memory.
            ctx.clearRect(0, 0, w, h);
            resolve(out);
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('decode_failed'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // -------- GPS --------

  btnGps.addEventListener('click', () => captureGps());
  gpsRetry.addEventListener('click', () => captureGps());

  function captureGps() {
    if (!('geolocation' in navigator)) {
      showGpsError('Your device does not support location. Use a phone with GPS.');
      return;
    }
    gpsErr.hidden = true;
    gpsErr.textContent = '';
    gpsRetry.hidden = true;
    gpsResult.hidden = true;
    btnGps.hidden = false;
    btnGps.disabled = true;
    btnGps.classList.add('is-loading');
    const labelEl = btnGps.querySelector('.gps__btn-label');
    const prevLabel = labelEl.textContent;
    labelEl.textContent = 'Getting location...';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btnGps.disabled = false;
        btnGps.classList.remove('is-loading');
        labelEl.textContent = prevLabel;
        const { latitude, longitude, accuracy } = pos.coords;
        if (typeof accuracy !== 'number' || accuracy > 100) {
          showGpsError('Signal too weak. Step outside, then retry.');
          return;
        }
        state.gps = {
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          accuracy: Number(accuracy.toFixed(1)),
        };
        gpsLat.textContent = state.gps.lat.toFixed(6);
        gpsLng.textContent = state.gps.lng.toFixed(6);
        gpsAcc.textContent = state.gps.accuracy + ' m';
        gpsMap.href = `https://www.google.com/maps?q=${state.gps.lat},${state.gps.lng}`;
        gpsResult.hidden = false;
        capGps.dataset.done = 'true';
        btnGps.hidden = true;
        refreshSubmitState();
      },
      (err) => {
        btnGps.disabled = false;
        btnGps.classList.remove('is-loading');
        labelEl.textContent = prevLabel;
        let msg = 'Could not get your location. Try again.';
        if (err && err.code === err.PERMISSION_DENIED)    msg = 'Allow location in browser settings, then retry.';
        if (err && err.code === err.POSITION_UNAVAILABLE) msg = 'GPS unavailable. Step outside, then retry.';
        if (err && err.code === err.TIMEOUT)              msg = 'Took too long. Try again.';
        showGpsError(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function showGpsError(msg) {
    state.gps = null;
    capGps.dataset.done = 'false';
    gpsResult.hidden = true;
    gpsErr.textContent = msg;
    gpsErr.hidden = false;
    gpsRetry.hidden = false;
    btnGps.hidden = true;
    refreshSubmitState();
  }

  // -------- submit gating --------

  function refreshSubmitState() {
    const ready = !!(state.selfie && state.vehicle && state.gps);
    btnSubmit.disabled = !ready || state.submitting;
  }

  // -------- submit --------

  btnSubmit.addEventListener('click', () => submitCheckin());

  async function submitCheckin() {
    if (state.submitting) return;
    if (!(state.selfie && state.vehicle && state.gps)) return;

    state.submitting = true;
    btnSubmit.disabled = true;
    btnSubmit.classList.add('is-loading');
    submitLabel.textContent = state.checkinType === 'check_in' ? 'Submitting...' : 'Submitting...';

    const payload = {
      phone:             state.phone,
      code:              state.code,
      checkin_type:      state.checkinType,
      lat:               state.gps.lat,
      lng:               state.gps.lng,
      accuracy_m:        state.gps.accuracy,
      selfie_b64:        state.selfie,
      vehicle_photo_b64: state.vehicle,
      client_ts:         istIso(),
      user_agent:        navigator.userAgent,
    };

    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let body = null;
      try { body = await res.json(); } catch (e) { body = null; }

      if (!res.ok) {
        if (body && body.error) {
          showResultError(humanizeError(body.error));
        } else {
          showResultError("Couldn't reach server. Check WiFi or mobile data.");
        }
        return;
      }

      if (body && body.success === true) {
        showResultSuccess(body);
      } else if (body && body.success === false) {
        showResultError(humanizeError(body.error || 'unknown'));
      } else {
        // 2xx with no JSON: treat as success-lite.
        showResultSuccess({});
      }
    } catch (err) {
      console.error('Submit failed:', err);
      showResultError("Couldn't reach server. Check WiFi or mobile data.");
    } finally {
      state.submitting = false;
      btnSubmit.classList.remove('is-loading');
      submitLabel.textContent = state.checkinType === 'check_in' ? 'Submit check in' : 'Submit check out';
      refreshSubmitState();
    }
  }

  function humanizeError(code) {
    const map = {
      wrong_code:            'Wrong phone or code. Check both and try again.',
      unknown_phone:         'Wrong phone or code. Check both and try again.',
      photo_upload_failed:   'Photo upload failed. Retake both photos and submit again.',
      selfie_upload_failed:  'Selfie upload failed. Take a clearer photo and submit again.',
      vehicle_upload_failed: 'Vehicle photo upload failed. Retake and submit again.',
      missing_fields:        'Some info is missing. Refresh the page and try again.',
      google_auth_failed:    'Server is having trouble saving. Try again in a minute.',
      ghl_lookup_failed:     "Couldn't find your account. Tell your fleet manager.",
      sheets_append_failed:  'Saved your check-in but the log had a hiccup. Tell your fleet manager.',
      unknown:               'Something went wrong. Try again.',
    };
    return map[code] || 'Something went wrong. Try again.';
  }

  // ===========================================================
  // SCREEN 3: RESULT
  // ===========================================================

  const resultSuccess     = $('#result-success');
  const resultError       = $('#result-error');
  const resultTitle       = resultSuccess.querySelector('.result__title');
  const resultTime        = $('#result-time');
  const resultName        = $('#result-name');
  const resultVehicle     = $('#result-vehicle');
  const resultMap         = $('#result-map');
  const resultErrorMsg    = $('#result-error-msg');
  const btnAnother        = $('#btn-another');
  const btnRetry          = $('#btn-retry');
  const btnBackLogin      = $('#btn-back-login');

  function showResultSuccess(body) {
    resultError.hidden   = true;
    resultSuccess.hidden = false;

    const checkinType = body.checkin_type || state.checkinType;
    resultTitle.textContent = checkinType === 'check_out' ? 'Checked out' : 'Checked in';

    if (body.timestamp) {
      resultTime.textContent = istClock(new Date(body.timestamp));
    } else {
      resultTime.textContent = istClock();
    }

    resultName.textContent    = body.driver_name || 'Driver';
    if (body.vehicle) {
      resultVehicle.textContent = body.vehicle;
      resultVehicle.style.opacity = '';
    } else {
      resultVehicle.textContent = 'Not assigned';
      resultVehicle.style.opacity = '0.5';
    }

    if (body.gps_link) {
      resultMap.href = body.gps_link;
      resultMap.hidden = false;
    } else if (state.gps) {
      resultMap.href = `https://www.google.com/maps?q=${state.gps.lat},${state.gps.lng}`;
      resultMap.hidden = false;
    } else {
      resultMap.hidden = true;
    }

    showScreen('result');
  }

  function showResultError(msg) {
    resultSuccess.hidden = true;
    resultError.hidden   = false;
    resultErrorMsg.textContent = msg;
    showScreen('result');
  }

  btnAnother.addEventListener('click', () => {
    // Keep phone + code, drop captures.
    state.selfie = null;
    state.vehicle = null;
    state.gps = null;
    [
      { cap: capSelfie,  thumb: thumbSelfie  },
      { cap: capVehicle, thumb: thumbVehicle },
    ].forEach(({ cap, thumb }) => {
      cap.dataset.done = 'false';
      thumb.hidden = true;
      thumb.removeAttribute('src');
      cap.querySelector('.cap__retake').hidden = true;
    });
    capGps.dataset.done = 'false';
    gpsResult.hidden = true;
    gpsErr.hidden = true;
    gpsErr.textContent = '';
    gpsRetry.hidden = true;
    btnGps.hidden = false;
    refreshSubmitState();
    showScreen('capture');
  });

  btnRetry.addEventListener('click', () => {
    // Go back to capture, keep everything; user can submit again.
    showScreen('capture');
    refreshSubmitState();
  });

  btnBackLogin.addEventListener('click', () => {
    clearSession();
    resetAll();
    showScreen('login');
  });

  // ===========================================================
  // BOOT
  // ===========================================================

  function boot() {
    refreshLoginState();

    const saved = loadSession();
    if (saved && validatePhone(saved.phone.replace(/^\+91/, '')).ok && validateCode(saved.code).ok) {
      state.phone = saved.phone.startsWith('+') ? saved.phone : e164India(saved.phone);
      state.code  = saved.code;
      phoneInput.value = onlyDigits(state.phone).slice(-10);
      codeInput.value  = state.code;
      refreshLoginState();
      enterCaptureScreen();
    } else {
      showScreen('login');
    }
  }

  boot();

  // ----- service worker -----

  window.addEventListener('load', () => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // If a waiting worker is already there, tell it to take over now.
      if (reg.waiting) reg.waiting.postMessage({ action: 'skipWaiting' });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // New version installed while an old one is controlling. Activate + reload.
            nw.postMessage({ action: 'skipWaiting' });
          }
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    }).catch((err) => console.warn('SW registration failed:', err));
  });

})();
