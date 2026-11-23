'use strict';
(async function () {
    const $ = (id) => document.getElementById(id);
    const contenido = $('contenido');

    const sesion = await AL.iniciarPagina({ requiere: 'cliente' });
    if (!sesion) return;

    let perfil, pasajeros, busquedas, aeros;
    try {
        [perfil, pasajeros, busquedas, aeros] = await Promise.all([
            AL.api('/cliente/perfil'),
            AL.api('/cliente/pasajeros'),
            AL.api('/cliente/busquedas'),
            AL.mapaAeropuertos().catch(() => ({})),
        ]);
    } catch (err) {
        contenido.innerHTML = `
            <div class="empty-state card">
                <i class="fa-solid fa-plug-circle-exclamation"></i>
                <h3>No pudimos cargar tu perfil</h3>
                <p>${AL.esc(err.message)}</p>
                <div class="empty-actions"><button type="button" class="btn btn-primary" onclick="location.reload()">Reintentar</button></div>
            </div>`;
        return;
    }

    const ciudad = (codigo) => (aeros[codigo] ? aeros[codigo].ciudad : codigo);
    const iniciales = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

    const ojo = '<button type="button" class="password-toggle" aria-label="Mostrar u ocultar contraseña"><i class="fa-regular fa-eye"></i></button>';

    function pintar() {
        contenido.innerHTML = `
            <div class="profile-layout">
                <aside class="card profile-side">
                    <div class="avatar" aria-hidden="true">${AL.esc(iniciales(perfil.nombre_completo))}</div>
                    <h3 class="profile-name">${AL.esc(perfil.nombre_completo)}</h3>
                    <p class="muted small">${AL.esc(perfil.correo)}</p>
                    <dl class="profile-facts">
                        <div><dt>Documento</dt><dd>${AL.esc(perfil.tipo_documento)} ${AL.esc(perfil.numero_documento)}</dd></div>
                        <div><dt>Nacimiento</dt><dd>${AL.fechaDia(perfil.fecha_nacimiento)}</dd></div>
                        <div><dt>Cliente desde</dt><dd>${AL.fechaDia(perfil.fecha_registro)}</dd></div>
                    </dl>
                    <div class="profile-stats">
                        <div><strong>${perfil.total_reservas}</strong><span>Reservas</span></div>
                        <div><strong>${perfil.reservas_confirmadas}</strong><span>Confirmadas</span></div>
                    </div>
                    <a class="btn btn-outline btn-block" href="mis-reservas.html"><i class="fa-solid fa-plane-departure"></i> Historial de vuelos</a>
                </aside>

                <div class="profile-main">
                    <form class="card" id="formPerfil" novalidate>
                        <h3 class="card-title"><i class="fa-solid fa-address-card"></i> Datos de contacto</h3>
                        <p class="form-alert" role="alert" hidden></p>
                        <div class="field-container">
                            <input class="field-input input" type="text" name="nombre_completo" placeholder=" " maxlength="150" value="${AL.esc(perfil.nombre_completo)}" autocomplete="name">
                            <label class="label field-label">Nombre completo</label>
                            <p class="field-error"></p>
                        </div>
                        <div class="field-row">
                            <div class="field-container">
                                <input class="field-input input" type="email" name="correo" placeholder=" " maxlength="150" value="${AL.esc(perfil.correo)}" autocomplete="email">
                                <label class="label field-label">Correo electrónico</label>
                                <p class="field-error"></p>
                            </div>
                            <div class="field-container">
                                <input class="field-input input" type="tel" name="telefono" placeholder=" " maxlength="20" value="${AL.esc(perfil.telefono)}" autocomplete="tel">
                                <label class="label field-label">Teléfono</label>
                                <p class="field-error"></p>
                            </div>
                        </div>
                        <p class="field-help">El documento y la fecha de nacimiento no se pueden modificar. Si hay un error, comunícate con soporte.</p>
                        <div class="form-actions"><button type="submit" class="btn btn-primary">Guardar cambios</button></div>
                    </form>

                    <form class="card" id="formPassword" novalidate>
                        <h3 class="card-title"><i class="fa-solid fa-lock"></i> Cambiar contraseña</h3>
                        <p class="form-alert" role="alert" hidden></p>
                        <div class="field-container password-container">
                            <input class="field-input input" type="password" name="actual" placeholder=" " maxlength="20" autocomplete="current-password">
                            <label class="label field-label">Contraseña actual</label>
                            ${ojo}
                            <p class="field-error"></p>
                        </div>
                        <div class="field-row">
                            <div class="field-container password-container">
                                <input class="field-input input" type="password" name="nueva" placeholder=" " maxlength="20" autocomplete="new-password">
                                <label class="label field-label">Nueva contraseña</label>
                                ${ojo}
                                <p class="field-error"></p>
                            </div>
                            <div class="field-container password-container">
                                <input class="field-input input" type="password" name="confirmacion" placeholder=" " maxlength="20" autocomplete="new-password">
                                <label class="label field-label">Confirmar nueva contraseña</label>
                                ${ojo}
                                <p class="field-error"></p>
                            </div>
                        </div>
                        <p class="field-help">Entre 8 y 20 caracteres, combinando letras y números.</p>
                        <div class="form-actions"><button type="submit" class="btn btn-primary">Actualizar contraseña</button></div>
                    </form>

                    <section class="card">
                        <h3 class="card-title"><i class="fa-solid fa-users"></i> Pasajeros guardados</h3>
                        ${pasajeros.length ? `
                            <ul class="saved-list">
                                ${pasajeros.map((p) => `
                                    <li>
                                        <span class="saved-avatar">${AL.esc(iniciales(p.nombre_completo))}</span>
                                        <span class="saved-info">
                                            <strong>${AL.esc(p.nombre_completo)}</strong>
                                            <small>${AL.esc(p.tipo_documento)} ${AL.esc(p.numero_documento)} · ${AL.esc(p.nacionalidad)} · ${AL.fechaDia(p.fecha_nacimiento)}</small>
                                        </span>
                                    </li>`).join('')}
                            </ul>
                            <p class="field-help">Se guardan automáticamente al hacer una reserva y puedes reutilizarlos en tus próximas compras.</p>`
                        : '<p class="muted">Todavía no tienes pasajeros guardados. Se guardan automáticamente cuando haces una reserva.</p>'}
                    </section>

                    <section class="card">
                        <h3 class="card-title"><i class="fa-solid fa-clock-rotate-left"></i> Búsquedas recientes</h3>
                        ${busquedas.length ? `
                            <ul class="saved-list">
                                ${busquedas.map((b) => `
                                    <li>
                                        <span class="saved-avatar"><i class="fa-solid fa-plane"></i></span>
                                        <span class="saved-info">
                                            <strong>${AL.esc(ciudad(b.origen))} ${b.fecha_regreso ? '⇄' : '→'} ${AL.esc(ciudad(b.destino))}</strong>
                                            <small>${AL.fechaDia(b.fecha_ida)}${b.fecha_regreso ? ' – ' + AL.fechaDia(b.fecha_regreso) : ''} · ${b.pasajeros} ${b.pasajeros === 1 ? 'pasajero' : 'pasajeros'}</small>
                                        </span>
                                        <a class="btn btn-ghost btn-sm" href="index.html?origen=${encodeURIComponent(b.origen)}&destino=${encodeURIComponent(b.destino)}">Buscar de nuevo</a>
                                    </li>`).join('')}
                            </ul>`
                        : '<p class="muted">Aquí aparecerán las rutas que busques.</p>'}
                    </section>
                </div>
            </div>`;
    }
    pintar();

    contenido.addEventListener('click', (e) => {
        const b = e.target.closest('.password-toggle');
        if (!b) return;
        const input = b.parentElement.querySelector('input');
        const ver = input.type === 'password';
        input.type = ver ? 'text' : 'password';
        const icono = b.querySelector('i');
        icono.classList.toggle('fa-eye', !ver);
        icono.classList.toggle('fa-eye-slash', ver);
    });

    contenido.addEventListener('input', (e) => {
        const cont = e.target.closest('.field-container');
        if (!cont) return;
        cont.classList.remove('has-error');
        const p = cont.querySelector('.field-error');
        if (p) p.textContent = '';
    });

    contenido.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const boton = form.querySelector('[type="submit"]');
        AL.limpiarErrores(form);
        const datos = Object.fromEntries(new FormData(form).entries());

        if (form.id === 'formPerfil') {
            AL.cargando(boton, true);
            try {
                perfil = await AL.api('/cliente/perfil', { method: 'PUT', body: datos });
                pintar();
                AL.aviso('Tus datos fueron actualizados.', 'exito');
                AL.iniciarPagina({ requiere: 'cliente' });
            } catch (err) {
                AL.mostrarErrorApi(form, err);
                AL.cargando(boton, false);
            }
        } else if (form.id === 'formPassword') {
            if (datos.nueva !== datos.confirmacion) {
                AL.errorCampo(form, 'confirmacion', 'Las contraseñas no coinciden.');
                return;
            }
            AL.cargando(boton, true);
            try {
                await AL.api('/cliente/password', { method: 'PUT', body: datos });
                form.reset();
                AL.alerta(form, 'Tu contraseña fue actualizada.', 'success');
                AL.aviso('Contraseña actualizada.', 'exito');
            } catch (err) {
                AL.mostrarErrorApi(form, err);
            }
            AL.cargando(boton, false);
        }
    });
})();
