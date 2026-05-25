// login.js – flujo único: email → OTP → redirección según rol (admin/supplier)

window.APP_BASE = window.APP_BASE || window.location.pathname.replace(/\/[^/]*$/, '');
window.API = window.API || (window.__API_BASE__ || window.APP_BASE).replace(/\/$/, '');

let currentEmail = '';
let otpTimer = null;
window.token = null;

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'show' + (type ? ' toast-' + type : '');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => (t.className = ''), 4000);
}

// Página de email (ej. /): envía OTP
async function sendOtp(isResend = false) {
  const emailEl = document.getElementById('emailInput');
  const email = (emailEl ? emailEl.value : currentEmail).trim();
  const errEl = document.getElementById('emailError');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errEl) {
      errEl.textContent = 'Introduce un correo válido.';
      errEl.style.display = 'block';
    }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  currentEmail = email;
  const btn = document.getElementById('sendOtpBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando…';
  }

  try {
    const res = await fetch(`${API}/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Error al enviar el código.');

    // Guarda email y next para la página OTP
    const next = getQueryParam('next') || '';
    sessionStorage.setItem('portal_email', email);
    sessionStorage.setItem('portal_next', next);

    if (isResend) showToast('Nuevo código enviado.', 'success');

    // Navega a /login manteniendo next si lo hubiera
    const otpUrl = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
    if (!isResend) window.location.href = otpUrl;
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.5">' +
        '<path d="M22 2L11 13"></path>' +
        '<path d="M22 2L15 22l-4-9-9-4 20-7z"></path>' +
        '</svg> Enviar código de acceso';
    }
  }
}

function startOtpTimer() {
  clearInterval(otpTimer);
  let remaining = 300;
  const timerEl = document.getElementById('otpTimer');
  const resendEl = document.getElementById('resendBtn');
  //if (resendEl) resendEl.style.display = 'none';

  otpTimer = setInterval(() => {
    remaining--;
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    if (timerEl) {
      timerEl.textContent = `El código expira en ${m}:${s.toString().padStart(2, '0')}`;
    }
    if (remaining <= 0) {
      clearInterval(otpTimer);
      if (timerEl) timerEl.textContent = 'El código ha expirado.';
      if (resendEl) resendEl.style.display = 'inline-flex';
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  const otpSection = document.getElementById('step-otp');

  // Página OTP (/login)
  if (otpSection) {
    const storedEmail = sessionStorage.getItem('portal_email') || '';
    if (storedEmail) {
      currentEmail = storedEmail;
      const display = document.getElementById('otpEmailDisplay');
      if (display) display.textContent = storedEmail;
    }

    startOtpTimer();

    const inputs = otpSection.querySelectorAll('.otp-digit');
    inputs.forEach((input, i, all) => {
      input.addEventListener('input', () => {
        input.classList.toggle('filled', !!input.value);

        // Mover foco al siguiente
        if (input.value && i < all.length - 1) {
          all[i + 1].focus();
        }

        // NUEVO: cuando se rellenen los 6 dígitos, verificar automáticamente
        const code = Array.from(all).map(inp => inp.value).join('');
        if (code.length === all.length && code.replace(/\D/g, '').length === all.length) {
          // Llamas directamente a tu función de verificación
          verifyOtp();
        }
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !input.value && i > 0) all[i - 1].focus();
      });

      input.addEventListener('paste', e => {
        e.preventDefault();
        const p = (e.clipboardData || window.clipboardData)
          .getData('text')
          .replace(/\D/g, '')
          .slice(0, 6);
        [...p].forEach((ch, j) => {
          if (all[j]) {
            all[j].value = ch;
            all[j].classList.add('filled');
          }
        });

        // NUEVO: si se pega un código completo, verificar también
        const code = Array.from(all).map(inp => inp.value).join('');
        if (code.length === all.length && code.replace(/\D/g, '').length === all.length) {
          verifyOtp();
        }
      });
    });

    if (inputs[0]) inputs[0].focus();
  }
});

async function verifyOtp() {
  const digits = document.querySelectorAll('#step-otp .otp-digit');
  const otp = [...digits].map(i => i.value).join('');
  const errEl = document.getElementById('otpError');

  if (otp.length < 6) {
    if (errEl) {
      errEl.textContent = 'Introduce los 6 dígitos.';
      errEl.style.display = 'block';
    }
    return;
  }
  if (errEl) errEl.style.display = 'none';

  const btn = document.getElementById('verifyOtpBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verificando…';
  }

  try {
    const res = await fetch(`${API}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, otp })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Código incorrecto.');

    // Guardar token y rol en memoria y en sessionStorage
    window.token = data.access_token;
    sessionStorage.setItem('portal_token', data.access_token);
    sessionStorage.setItem('portal_role', data.role || 'supplier');
    sessionStorage.setItem('portal_email', currentEmail);

    clearInterval(otpTimer);

    const headerUser = document.getElementById('headerUser');
    const headerEmail = document.getElementById('headerEmail');
    if (headerUser) headerUser.style.display = 'flex';
    if (headerEmail) headerEmail.textContent = currentEmail;

    const storedNext = sessionStorage.getItem('portal_next') || getQueryParam('next') || '';
    const role = data.role || 'supplier';

    let target = '';
    // Si el next apunta a /proveedores pero el rol no es admin, ignora el next
    if (storedNext) {
      if ((storedNext.startsWith('/proveedores') || storedNext.includes('/proveedores')) && role !== 'admin') {
        target = '/perfil';
      } else {
        target = storedNext;
      }
      sessionStorage.removeItem('portal_next');
    } else {
      target = role === 'admin' ? '/proveedores' : '/perfil';
    }

    // Limpia el parámetro next de la URL tras login
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('next');
      window.history.replaceState({}, document.title, url.pathname);
    }

    window.location.href = target;
  } catch (e) {
    if (errEl) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verificar código';
    }
  }
}

// Volver a la pantalla de email respetando next si existe
function backToLogin() {
  clearInterval(otpTimer);
  const next = getQueryParam('next');
  const url = next ? `/?next=${encodeURIComponent(next)}` : '/';
  window.location.href = url;
}