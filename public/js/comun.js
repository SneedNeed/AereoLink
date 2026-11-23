'use strict';
(function () {
    const esc = (v) =>
        String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    const dinero = (n) => COP.format(Math.round(Number(n) || 0)).replace(/\s/g, ' ');

    const pad = (n) => String(n).padStart(2, '0');
    const aISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    function aFecha(s) {
        const t = String(s);
        const [a, m, d] = t.slice(0, 10).split('-').map(Number);
        const [h, mi] = t.length > 10 ? t.slice(11, 16).split(':').map(Number) : [0, 0];
        return new Date(a, m - 1, d, h || 0, mi || 0);
    }
    const hoy = () => aISO(new Date());
    const sumarDias = (f, n) => {
        const d = aFecha(f);
        d.setDate(d.getDate() + n);
        return aISO(d);
    };
    const hace18 = (ref) => {
        const [y, m, d] = ref.split('-');
        return `${Number(y) - 18}-${m}-${d}`;
    };
    function edad(nacimiento, ref) {
        const [y1, m1, d1] = nacimiento.split('-').map(Number);
        const [y2, m2, d2] = (ref || hoy()).split('-').map(Number);
        let e = y2 - y1;
        if (m2 < m1 || (m2 === m1 && d2 < d1)) e--;
        return e;
    }

    const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const F_CORTA = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
    const F_LARGA = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const F_DIA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
    const fechaCorta = (s) => mayus(F_CORTA.format(aFecha(s)).replace(/\./g, '').replace(',', ''));
    const fechaLarga = (s) => mayus(F_LARGA.format(aFecha(s)));
    const fechaDia = (s) => F_DIA.format(aFecha(s)).replace(/\./g, '');
    const hora = (s) => String(s).slice(11, 16);
    const minutosEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 60000);
    function duracion(min) {
        const h = Math.floor(min / 60);
        const m = min % 60;
        return h ? `${h} h ${pad(m)} min` : `${m} min`;
    }
    const textoPasajeros = (adultos, menores) =>
        `${adultos} ${adultos === 1 ? 'adulto' : 'adultos'}` + (menores ? `, ${menores} ${menores === 1 ? 'menor' : 'menores'}` : '');

    const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    const CABINAS = { ECONOMICA: 'Económica', ECONOMICA_PREMIUM: 'Económica Premium', EJECUTIVA: 'Ejecutiva', PRIMERA: 'Primera clase' };
    const TIPOS_DOC = { CC: 'Cédula de ciudadanía', CE: 'Cédula de extranjería', PAS: 'Pasaporte', TI: 'Tarjeta de identidad', RC: 'Registro civil' };
    const ESTADOS_RESERVA = {
        PENDIENTE: { texto: 'Pendiente de pago', clase: 'badge-warning' },
        CONFIRMADA: { texto: 'Confirmada', clase: 'badge-success' },
        CANCELADA: { texto: 'Cancelada', clase: 'badge-danger' },
        EXPIRADA: { texto: 'Expirada', clase: 'badge-muted' },
    };
    const badgeReserva = (estado) => {
        const e = ESTADOS_RESERVA[estado] || { texto: estado, clase: 'badge-muted' };
        return `<span class="badge ${e.clase}">${esc(e.texto)}</span>`;
    };
    const textoEscalas = (n) => (n === 0 ? 'Directo' : n === 1 ? '1 escala' : `${n} escalas`);

    const params = () => new URLSearchParams(location.search);

    class ApiError extends Error {
        constructor(mensaje, status, campos) {
            super(mensaje);
            this.status = status;
            this.campos = campos || {};
        }
    }

    async function api(ruta, { method = 'GET', body } = {}) {
        const opciones = { method, headers: {}, credentials: 'same-origin' };
        if (body !== undefined) {
            opciones.headers['Content-Type'] = 'application/json';
            opciones.body = JSON.stringify(body);
        }
        let res;
        try {
            res = await fetch('/api' + ruta, opciones);
        } catch (_) {
            throw new ApiError('No hay conexión con el servidor. Revisa que esté encendido e inténtalo de nuevo.', 0);
        }
        let data = null;
        try {
            data = await res.json();
        } catch (_) { /* respuesta sin cuerpo */ }
        if (!res.ok) throw new ApiError((data && data.error) || 'Ocurrió un error inesperado.', res.status, data && data.campos);
        return data;
    }

    function aviso(mensaje, tipo = 'info', ms = 4500) {
        let caja = document.getElementById('avisos');
        if (!caja) {
            caja = document.createElement('div');
            caja.id = 'avisos';
            caja.className = 'toast-container';
            caja.setAttribute('aria-live', 'polite');
            document.body.appendChild(caja);
        }
        const iconos = { exito: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
        const el = document.createElement('div');
        el.className = `toast toast-${tipo}`;
        el.innerHTML = `<i class="fa-solid ${iconos[tipo] || iconos.info}"></i><span>${esc(mensaje)}</span>`;
        caja.appendChild(el);
        setTimeout(() => {
            el.classList.add('toast-out');
            setTimeout(() => el.remove(), 300);
        }, ms);
    }

    function confirmar({ titulo, mensaje, textoConfirmar = 'Confirmar', textoCancelar = 'Volver', peligro = false }) {
        return new Promise((resolve) => {
            const dlg = document.createElement('dialog');
            dlg.className = 'modal';
            dlg.innerHTML = `
                <form method="dialog" class="modal-card">
                    <h3 class="modal-title">${esc(titulo)}</h3>
                    <p class="modal-text">${esc(mensaje)}</p>
                    <div class="modal-actions">
                        <button type="submit" value="no" class="btn btn-outline">${esc(textoCancelar)}</button>
                        <button type="submit" value="si" class="btn ${peligro ? 'btn-danger' : 'btn-primary'}">${esc(textoConfirmar)}</button>
                    </div>
                </form>`;
            document.body.appendChild(dlg);
            dlg.addEventListener('close', () => {
                const ok = dlg.returnValue === 'si';
                dlg.remove();
                resolve(ok);
            });
            dlg.showModal();
        });
    }

    function informar(titulo, mensaje) {
        return confirmar({ titulo, mensaje, textoConfirmar: 'Entendido', textoCancelar: 'Cerrar' });
    }

    function cargando(boton, activo) {
        if (!boton) return;
        boton.disabled = activo;
        boton.classList.toggle('is-loading', activo);
    }

    function limpiarErrores(form) {
        form.querySelectorAll('.has-error').forEach((e) => e.classList.remove('has-error'));
        form.querySelectorAll('.field-error').forEach((p) => (p.textContent = ''));
        const a = form.querySelector('.form-alert');
        if (a) a.hidden = true;
    }
    function errorCampo(form, nombre, mensaje) {
        const input = form.querySelector(`[name="${nombre}"]`);
        const cont = input && input.closest('.field-container');
        if (!cont) return false;
        cont.classList.add('has-error');
        const p = cont.querySelector('.field-error');
        if (p) p.textContent = mensaje;
        return true;
    }
    function alerta(form, mensaje, tipo = 'error') {
        const a = form.querySelector('.form-alert');
        if (!a) return aviso(mensaje, tipo === 'error' ? 'error' : 'exito');
        a.className = `form-alert ${tipo}`;
        a.textContent = mensaje;
        a.hidden = false;
        a.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function mostrarErrorApi(form, err) {
        limpiarErrores(form);
        let sinCampo = false;
        for (const [campo, msg] of Object.entries(err.campos || {})) {
            if (!errorCampo(form, campo, msg)) sinCampo = true;
        }
        const hayCampos = Object.keys(err.campos || {}).length > 0;
        if (!hayCampos || sinCampo) alerta(form, err.message);
        else {
            alerta(form, err.message);
            const primero = form.querySelector('.has-error');
            if (primero) primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }

    const CLAVE_SESION = 'al_sesion';
    const CLAVE_SELECCION = 'al_seleccion';

    const leerCache = () => {
        try { return JSON.parse(sessionStorage.getItem(CLAVE_SESION)); } catch (_) { return null; }
    };
    const guardarCache = (s) => {
        try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(s)); } catch (_) { /* sin almacenamiento */ }
    };

    async function sesion() {
        const s = await api('/auth/sesion').catch(() => ({ autenticado: false }));
        guardarCache(s);
        return s;
    }

    const primerNombre = (n) => String(n || '').trim().split(' ')[0];

    function htmlHeader(s) {
        let opciones = `
            <div class="header-option support-option">
                <i class="fa-solid fa-headphones"></i>
                <p class="header-option-text">Soporte 123 4567 89</p>
            </div>`;
        if (!s.autenticado) {
            opciones += `
            <a class="header-option login-option" href="auth.html?modo=registro">
                <i class="fa-solid fa-user-plus"></i><p class="header-option-text">Crear cuenta</p>
            </a>
            <a class="header-option login-option" href="auth.html">
                <i class="fa-solid fa-right-to-bracket"></i><p class="header-option-text">Ingresar</p>
            </a>`;
        } else if (s.rol === 'admin') {
            opciones += `
            <a class="header-option" href="admin.html">
                <i class="fa-solid fa-gauge-high"></i><p class="header-option-text">Panel de administración</p>
            </a>
            <a class="header-option" href="#" data-accion="salir">
                <i class="fa-solid fa-right-from-bracket"></i><p class="header-option-text">Salir</p>
            </a>`;
        } else {
            const pendientes = s.pendientes ? `<span class="header-badge" title="Reservas pendientes de pago">${s.pendientes}</span>` : '';
            opciones += `
            <div class="header-option profile-option" tabindex="0">
                <i class="fa-solid fa-user"></i>
                <p class="header-option-text">${esc(primerNombre(s.nombre))}</p>
                <div class="profile-menu">
                    <p class="profile-menu-title">${esc(s.nombre)}</p>
                    <div class="profile-menu-options">
                        <a class="profile-menu-option" href="perfil.html">
                            <i class="fa-solid fa-address-card"></i><p class="profile-menu-option-text">Ver perfil completo</p>
                        </a>
                        <a class="profile-menu-option" href="mis-reservas.html">
                            <i class="fa-solid fa-plane-departure"></i><p class="profile-menu-option-text">Historial de Vuelos</p>
                        </a>
                        <a class="profile-menu-option" href="#" data-accion="salir">
                            <i class="fa-solid fa-right-from-bracket"></i><p class="profile-menu-option-text">Cerrar sesión</p>
                        </a>
                    </div>
                </div>
            </div>
            <a class="header-option cart-option" href="mis-reservas.html" title="Mis reservas">
                <i class="fa-solid fa-ticket"></i>${pendientes}
            </a>`;
        }
        return `
            <a class="mainLogue" href="index.html">
                <img src="img/logo.svg" alt="" class="mainLogue-img">
                <h1 class="main-title">AereoLink</h1>
            </a>
            <div class="headerOptions">${opciones}</div>`;
    }

    function montarHeader(s) {
        const header = document.getElementById('appHeader');
        if (header) header.innerHTML = htmlHeader(s);
    }

    async function cerrarSesion() {
        try { await api('/auth/logout', { method: 'POST', body: {} }); } catch (_) { /* da igual */ }
        try { sessionStorage.removeItem(CLAVE_SESION); sessionStorage.removeItem(CLAVE_SELECCION); } catch (_) { /* nada */ }
        location.href = 'index.html';
    }

    function activarMenuHeader() {
        const header = document.getElementById('appHeader');
        if (!header || header.dataset.listo) return;
        header.dataset.listo = '1';
        header.addEventListener('click', (e) => {
            const salir = e.target.closest('[data-accion="salir"]');
            if (salir) {
                e.preventDefault();
                cerrarSesion();
                return;
            }
            const perfil = e.target.closest('.profile-option');
            if (perfil && !e.target.closest('.profile-menu')) perfil.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.profile-option')) header.querySelector('.profile-option')?.classList.remove('open');
        });
    }

    async function iniciarPagina({ requiere = null } = {}) {
        activarMenuHeader();
        montarHeader(leerCache() || { autenticado: false });
        const s = await sesion();
        montarHeader(s);
        if (requiere) {
            if (!s.autenticado) {
                const destino = location.pathname.replace(/^\//, '') + location.search;
                location.replace('auth.html?next=' + encodeURIComponent(destino));
                return null;
            }
            if (s.rol !== requiere) {
                location.replace(s.rol === 'admin' ? 'admin.html' : 'index.html');
                return null;
            }
        }
        return s;
    }

    let _aeropuertos = null;
    function aeropuertos() {
        if (!_aeropuertos) {
            _aeropuertos = api('/aeropuertos').catch((e) => {
                _aeropuertos = null;
                throw e;
            });
        }
        return _aeropuertos;
    }
    async function mapaAeropuertos() {
        const lista = await aeropuertos();
        return Object.fromEntries(lista.map((a) => [a.codigo, a]));
    }

    const guardarSeleccion = (sel) => {
        try { sessionStorage.setItem(CLAVE_SELECCION, JSON.stringify(sel)); } catch (_) { /* nada */ }
    };
    const leerSeleccion = () => {
        try { return JSON.parse(sessionStorage.getItem(CLAVE_SELECCION)); } catch (_) { return null; }
    };
    const borrarSeleccion = () => {
        try { sessionStorage.removeItem(CLAVE_SELECCION); } catch (_) { /* nada */ }
    };

    window.AL = {
        esc, dinero, aFecha, aISO, hoy, sumarDias, hace18, edad, fechaCorta, fechaLarga, fechaDia, hora, minutosEntre, duracion,
        textoPasajeros, normalizar, CABINAS, TIPOS_DOC, ESTADOS_RESERVA, badgeReserva, textoEscalas, params,
        ApiError, api, aviso, confirmar, informar, cargando,
        limpiarErrores, errorCampo, alerta, mostrarErrorApi,
        iniciarPagina, cerrarSesion, aeropuertos, mapaAeropuertos,
        guardarSeleccion, leerSeleccion, borrarSeleccion,
    };
})();
