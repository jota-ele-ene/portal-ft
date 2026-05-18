const API = '/api';
let currentEmail = '', otpTimer = null;
window.token = null;

function showStep(id) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (type ? ' toast-' + type : '');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.className = '', 4000);
}

async function sendOtp(isResend = false) {
  const emailEl = document.getElementById('emailInput');
  const email = (emailEl ? emailEl.value : currentEmail).trim();
  const errEl = document.getElementById('emailError');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errEl) { errEl.textContent = 'Introduce un correo válido.'; errEl.style.display = 'block'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  currentEmail = email;
  const btn = document.getElementById('sendOtpBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    const res = await fetch(`${API}/auth/otp/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al enviar el código.');
    document.getElementById('otpEmailDisplay').textContent = email;
    showStep('step-otp');
    document.querySelectorAll('.otp-digit').forEach(i => i.value = '');
    document.querySelector('#step-otp .otp-digit').focus();
    startOtpTimer();
    if (isResend) showToast('Nuevo código enviado.', 'success');
  } catch (e) { showToast(e.message, 'error'); }
  finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg> Enviar código de acceso'; }
  }
}

function startOtpTimer() {
  clearInterval(otpTimer);
  let remaining = 300;
  const timerEl = document.getElementById('otpTimer');
  const resendEl = document.getElementById('resendBtn');
  if (resendEl) resendEl.style.display = 'none';
  otpTimer = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60), s = remaining % 60;
    if (timerEl) timerEl.textContent = `El código expira en ${m}:${s.toString().padStart(2,'0')}`;
    if (remaining <= 0) {
      clearInterval(otpTimer);
      if (timerEl) timerEl.textContent = 'El código ha expirado.';
      if (resendEl) resendEl.style.display = 'inline-flex';
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#step-otp .otp-digit').forEach((input, i, all) => {
    input.addEventListener('input', () => {
      input.classList.toggle('filled', !!input.value);
      if (input.value && i < all.length - 1) all[i+1].focus();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !input.value && i > 0) all[i-1].focus();
    });
    input.addEventListener('paste', e => {
      e.preventDefault();
      const p = (e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
      [...p].forEach((ch,j) => { if (all[j]) { all[j].value = ch; all[j].classList.add('filled'); } });
      if (all[Math.min(p.length, all.length-1)]) all[Math.min(p.length, all.length-1)].focus();
    });
  });
});

async function verifyOtp() {
  const otp = [...document.querySelectorAll('#step-otp .otp-digit')].map(i => i.value).join('');
  const errEl = document.getElementById('otpError');
  if (otp.length < 6) { errEl.textContent='Introduce los 6 dígitos.'; errEl.style.display='block'; return; }
  errEl.style.display = 'none';
  const btn = document.getElementById('verifyOtpBtn');
  btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const res = await fetch(`${API}/auth/otp/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, otp })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Código incorrecto.');
    window.token = data.access_token;
    clearInterval(otpTimer);
    document.getElementById('headerUser').style.display = 'flex';
    document.getElementById('headerEmail').textContent = currentEmail;
    showStep('step-form');
    if (window.loadSupplierData) window.loadSupplierData();
  } catch (e) { errEl.textContent = e.message; errEl.style.display='block'; btn.disabled=false; btn.textContent='Verificar código'; }
}

function backToLogin() { clearInterval(otpTimer); showStep('step-login'); }
function goToForm()    { showStep('step-form'); }
