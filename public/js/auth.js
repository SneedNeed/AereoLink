'use strict';
// Inicio de sesión y registro (una sola página, dos formularios).
(async function () {
    const loginTab = document.querySelector('.login-tab');
    const registerTab = document.querySelector('.register-tab');
    const loginForm = document.getElementById('formLogin');
    const registerForm = document.getElementById('formRegistro');

    // ------------------------------------------------------------------ a dónde ir después de entrar
    // Solo se aceptan destinos de este mismo sitio (nada de https://otro-sitio).
    const P = AL.params();
    const siguiente = (() => {
        const n = P.get('next') || '';
        return /^[a-zA-Z0-9_-]+(\.html)?(\?[^\s#]*)?$/.test(n) ? n : '';
    })();
    const irDespues = (rol) => location.replace(rol === 'admin' ? 'admin.html' : siguiente || 'index.html');

    const s = await AL.iniciarPagina();
    if (s && s.autenticado) return irDespues(s.rol);

    // ------------------------------------------------------------------ alternar entre ingreso y registro
    function cambiarFormulario(destino) {
        const verLogin = destino === 'login';
        loginTab.classList.toggle('active', verLogin);
        registerTab.classList.toggle('active', !verLogin);
        loginForm.classList.toggle('active', verLogin);
        registerForm.classList.toggle('active', !verLogin);
        document.title = verLogin ? 'AereoLink - Iniciar sesión' : 'AereoLink - Crear cuenta';
    }
    loginTab.addEventListener('click', () => cambiarFormulario('login'));
    registerTab.addEventListener('click', () => cambiarFormulario('registro'));
    document.querySelector('.to-register-link').addEventListener('click', () => cambiarFormulario('registro'));
    document.querySelector('.to-login-link').addEventListener('click', () => cambiarFormulario('login'));
    if (P.get('modo') === 'registro') cambiarFormulario('registro');

    if (siguiente) AL.alerta(loginForm, 'Inicia sesión para continuar con tu reserva.', 'info');

    // ------------------------------------------------------------------ ojito de las contraseñas
    document.querySelectorAll('.password-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = btn.parentElement.querySelector('input');
            const ver = input.type === 'password';
            input.type = ver ? 'text' : 'password';
            const icono = btn.querySelector('i');
            icono.classList.toggle('fa-eye', !ver);
            icono.classList.toggle('fa-eye-slash', ver);
        });
    });

    // Al escribir se quita el error de ese campo
    document.querySelectorAll('.field-input').forEach((input) => {
        input.addEventListener('input', () => {
            const cont = input.closest('.field-container');
            cont.classList.remove('has-error');
            const p = cont.querySelector('.field-error');
            if (p) p.textContent = '';
        });
    });

    // La fecha de nacimiento debe permitir ser mayor de 18 años
    const nacimiento = document.getElementById('regNacimiento');
    nacimiento.max = AL.hace18(AL.hoy());
    nacimiento.min = '1900-01-01';

    // ------------------------------------------------------------------ validaciones del lado del cliente
    const valor = (form, nombre) => form.querySelector(`[name="${nombre}"]`).value.trim();

    function validarLogin() {
        const errores = {};
        if (!valor(loginForm, 'correo')) errores.correo = 'Escribe tu correo.';
        if (!loginForm.querySelector('[name="contrasena"]').value) errores.contrasena = 'Escribe tu contraseña.';
        return errores;
    }

    function validarRegistro() {
        const f = registerForm;
        const e = {};
        const nombre = /^[\p{L}][\p{L}\p{M}\s'.-]*$/u;
        if (valor(f, 'nombres').length < 2 || !nombre.test(valor(f, 'nombres'))) e.nombres = 'Escribe tus nombres (solo letras).';
        if (valor(f, 'apellidos').length < 2 || !nombre.test(valor(f, 'apellidos'))) e.apellidos = 'Escribe tus apellidos (solo letras).';
        const tipo = valor(f, 'tipo_documento');
        const doc = valor(f, 'numero_documento').replace(/\s/g, '');
        if (tipo === 'PAS' ? !/^[A-Za-z0-9]{5,20}$/.test(doc) : !/^\d{5,15}$/.test(doc)) {
            e.numero_documento = tipo === 'PAS' ? 'El pasaporte debe tener entre 5 y 20 letras o números.' : 'Debe tener entre 5 y 15 dígitos.';
        }
        const nac = valor(f, 'fecha_nacimiento');
        if (!nac) e.fecha_nacimiento = 'Indica tu fecha de nacimiento.';
        else if (nac > AL.hace18(AL.hoy())) e.fecha_nacimiento = 'Debes ser mayor de 18 años para crear una cuenta.';
        if (!/^[0-9+()\s-]{7,20}$/.test(valor(f, 'telefono'))) e.telefono = 'Escribe un teléfono válido (7 a 20 dígitos).';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor(f, 'correo'))) e.correo = 'Escribe un correo válido.';
        const pass = f.querySelector('[name="contrasena"]').value;
        if (pass.length < 8 || pass.length > 20) e.contrasena = 'Debe tener entre 8 y 20 caracteres.';
        else if (!/[A-Za-z]/.test(pass) || !/\d/.test(pass)) e.contrasena = 'Debe combinar letras y números.';
        if (f.querySelector('[name="confirmacion"]').value !== pass) e.confirmacion = 'Las contraseñas no coinciden.';
        if (!f.querySelector('[name="terminos"]').checked) e.terminos = 'Debes aceptar los términos para continuar.';
        return e;
    }

    function mostrarErrores(form, errores) {
        AL.limpiarErrores(form);
        for (const [campo, msg] of Object.entries(errores)) {
            if (campo === 'terminos') AL.alerta(form, msg);
            else AL.errorCampo(form, campo, msg);
        }
        const primero = form.querySelector('.has-error input, .has-error select');
        if (primero) primero.focus();
    }

    // ------------------------------------------------------------------ enviar
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errores = validarLogin();
        if (Object.keys(errores).length) return mostrarErrores(loginForm, errores);
        AL.limpiarErrores(loginForm);
        const boton = loginForm.querySelector('.submit-button');
        AL.cargando(boton, true);
        try {
            const r = await AL.api('/auth/login', {
                method: 'POST',
                body: {
                    correo: valor(loginForm, 'correo'),
                    contrasena: loginForm.querySelector('[name="contrasena"]').value,
                    recordar: loginForm.querySelector('[name="recordar"]').checked,
                },
            });
            irDespues(r.rol);
        } catch (err) {
            AL.mostrarErrorApi(loginForm, err);
            AL.cargando(boton, false);
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errores = validarRegistro();
        if (Object.keys(errores).length) return mostrarErrores(registerForm, errores);
        AL.limpiarErrores(registerForm);
        const boton = registerForm.querySelector('.submit-button');
        AL.cargando(boton, true);
        const f = registerForm;
        try {
            await AL.api('/auth/registro', {
                method: 'POST',
                body: {
                    tipo_documento: valor(f, 'tipo_documento'),
                    numero_documento: valor(f, 'numero_documento'),
                    nombres: valor(f, 'nombres'),
                    apellidos: valor(f, 'apellidos'),
                    fecha_nacimiento: valor(f, 'fecha_nacimiento'),
                    telefono: valor(f, 'telefono'),
                    correo: valor(f, 'correo'),
                    contrasena: f.querySelector('[name="contrasena"]').value,
                    confirmacion: f.querySelector('[name="confirmacion"]').value,
                },
            });
            irDespues('cliente'); // el registro ya deja la sesión iniciada
        } catch (err) {
            AL.mostrarErrorApi(registerForm, err);
            AL.cargando(boton, false);
        }
    });

    // ------------------------------------------------------------------ textos informativos
    document.getElementById('olvidoContrasena').addEventListener('click', () => {
        AL.informar('Recuperar tu contraseña', 'Por ahora el restablecimiento se hace con nuestro equipo de soporte. Llama al 123 4567 89 con tu documento de identidad a la mano.');
    });
    document.querySelectorAll('[data-info]').forEach((a) => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const terminos = a.dataset.info === 'terminos';
            AL.informar(
                terminos ? 'Términos y condiciones' : 'Política de privacidad',
                terminos
                    ? 'AereoLink actúa como intermediario entre tú y las aerolíneas. Las condiciones de cada tarifa (equipaje, cambios y reembolsos) son las que se muestran antes de reservar.'
                    : 'Usamos tus datos únicamente para gestionar tus reservas y tu cuenta. No compartimos tu información con terceros ajenos al servicio.'
            );
        });
    });
})();
