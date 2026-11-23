'use strict';
(async function () {
    const $ = (id) => document.getElementById(id);
    const contenido = $('contenido');

    const sesion = await AL.iniciarPagina({ requiere: 'cliente' });
    if (!sesion) return;

    function mostrarProblema(icono, titulo, texto, accion = '<a class="btn btn-primary" href="index.html">Buscar vuelos</a>') {
        contenido.innerHTML = `
            <div class="empty-state card">
                <i class="fa-solid ${icono}"></i>
                <h3>${AL.esc(titulo)}</h3>
                <p>${AL.esc(texto)}</p>
                <div class="empty-actions">${accion}</div>
            </div>`;
    }

    const sel = AL.leerSeleccion();
    if (!sel || !Array.isArray(sel.tarifas) || !sel.tarifas.length) {
        return mostrarProblema('fa-ticket', 'Aún no has elegido un vuelo', 'Busca tu vuelo, elige una tarifa y vuelve aquí para completar la reserva.');
    }
    const n = sel.adultos + sel.menores;

    let tarifas, perfil, guardados;
    try {
        [tarifas, perfil, guardados] = await Promise.all([
            AL.api('/tarifas?ids=' + sel.tarifas.join(',')),
            AL.api('/cliente/perfil'),
            AL.api('/cliente/pasajeros'),
        ]);
    } catch (err) {
        return mostrarProblema('fa-plug-circle-exclamation', 'No pudimos cargar tu selección', err.message, '<button type="button" class="btn btn-primary" onclick="location.reload()">Reintentar</button>');
    }
    if (tarifas.length !== sel.tarifas.length) {
        return mostrarProblema('fa-plane-circle-xmark', 'Una de las tarifas ya no existe', 'Es posible que el vuelo haya cambiado. Vuelve a buscar para ver las opciones actuales.');
    }
    const noDisponible = tarifas.find((t) => !t.futuro || !['PROGRAMADO', 'RETRASADO'].includes(t.estado));
    if (noDisponible) {
        return mostrarProblema('fa-plane-circle-xmark', 'Un vuelo ya no está disponible', `El vuelo ${noDisponible.origen} → ${noDisponible.destino} ya no se puede reservar. Busca de nuevo para ver otras opciones.`);
    }
    const sinCupos = tarifas.find((t) => t.cupos < n || t.cupos_disponibles < n);
    if (sinCupos) {
        return mostrarProblema('fa-users-slash', 'Ya no quedan cupos suficientes', `En el vuelo ${sinCupos.origen} → ${sinCupos.destino} no hay lugar para ${n} pasajeros. Busca de nuevo para elegir otra opción.`);
    }

    const fechaRef = tarifas[0].salida.slice(0, 10); // la edad se calcula al día del primer vuelo
    const minBodega = Math.min(...tarifas.map((t) => t.equipaje_bodega_kg));
    const total = tarifas.reduce((s, t) => s + t.precio * n, 0);
    const adultoMax = AL.hace18(fechaRef);
    const menorMin = AL.sumarDias(adultoMax, 1);

    const pintarTramo = (t, i) => `
        <div class="summary-flight">
            <p class="summary-flight-title">${tarifas.length > 1 ? (i === 0 ? 'Ida' : 'Vuelta') + ' · ' : ''}${AL.fechaCorta(t.salida)}</p>
            <p class="summary-flight-route"><strong>${AL.esc(t.origen_ciudad)}</strong> <i class="fa-solid fa-arrow-right"></i> <strong>${AL.esc(t.destino_ciudad)}</strong></p>
            <p class="summary-flight-meta">${AL.hora(t.salida)} – ${AL.hora(t.llegada)} · ${AL.textoEscalas(t.escalas)} · ${AL.esc(t.aerolinea)}</p>
            <p class="summary-flight-meta">Tarifa ${AL.esc(AL.CABINAS[t.clase_cabina] || '')} ${AL.esc(t.nombre_tarifa)} · ${t.equipaje_bodega_kg > 0 ? `maleta ${t.equipaje_bodega_kg} kg` : 'sin maleta de bodega'}</p>
        </div>`;

    function tarjetaPasajero(i) {
        const adulto = i < sel.adultos;
        const tipos = adulto ? ['CC', 'CE', 'PAS'] : ['TI', 'RC', 'PAS'];
        const opcionesGuardados = guardados
            .filter((g) => (AL.edad(g.fecha_nacimiento, fechaRef) >= 18) === adulto)
            .map((g) => `<option value="${g.id_pasajero}">${AL.esc(g.nombre_completo)} · ${AL.esc(g.tipo_documento)} ${AL.esc(g.numero_documento)}</option>`)
            .join('');
        return `
            <section class="card passenger-card" data-i="${i}" data-categoria="${adulto ? 'adulto' : 'menor'}">
                <div class="passenger-head">
                    <h3 class="card-title"><i class="fa-solid fa-user"></i> Pasajero ${i + 1} <span class="badge badge-info">${adulto ? 'Adulto' : 'Menor de 18 años'}</span></h3>
                    <div class="passenger-tools">
                        ${i === 0 ? '<button type="button" class="btn btn-outline btn-sm" data-accion="usar-mis-datos"><i class="fa-solid fa-id-card"></i> Usar mis datos</button>' : ''}
                    </div>
                </div>

                ${opcionesGuardados ? `
                <div class="field-container saved-container">
                    <select class="field-input input" name="guardado" data-accion="guardado">
                        <option value="">Nuevo pasajero</option>
                        ${opcionesGuardados}
                    </select>
                    <label class="label field-label">Pasajeros guardados</label>
                    <p class="field-error"></p>
                </div>` : ''}

                <div class="field-container">
                    <input class="field-input input" type="text" name="nombre_completo" placeholder=" " maxlength="150" autocomplete="off">
                    <label class="label field-label">Nombre completo</label>
                    <p class="field-error"></p>
                </div>

                <div class="field-row document-row">
                    <div class="field-container">
                        <select class="field-input input" name="tipo_documento">
                            ${tipos.map((t) => `<option value="${t}">${AL.TIPOS_DOC[t]}</option>`).join('')}
                        </select>
                        <label class="label field-label">Tipo de documento</label>
                        <p class="field-error"></p>
                    </div>
                    <div class="field-container">
                        <input class="field-input input" type="text" name="numero_documento" placeholder=" " maxlength="20" autocomplete="off">
                        <label class="label field-label">Número de documento</label>
                        <p class="field-error"></p>
                    </div>
                </div>

                <div class="field-row">
                    <div class="field-container">
                        <input class="field-input input" type="date" name="fecha_nacimiento" ${adulto ? `max="${adultoMax}" min="1900-01-01"` : `min="${menorMin}" max="${AL.hoy()}"`}>
                        <label class="label field-label">Fecha de nacimiento</label>
                        <p class="field-error"></p>
                    </div>
                    <div class="field-container">
                        <input class="field-input input" type="text" name="nacionalidad" placeholder=" " maxlength="80" value="Colombiana" autocomplete="off">
                        <label class="label field-label">Nacionalidad</label>
                        <p class="field-error"></p>
                    </div>
                </div>

                <div class="field-row">
                    <div class="field-container">
                        <input class="field-input input" type="number" name="equipaje_kg" placeholder=" " min="0" max="${minBodega}" step="1" value="0" ${minBodega === 0 ? 'disabled' : ''}>
                        <label class="label field-label">Equipaje de bodega (kg)</label>
                        <p class="field-error"></p>
                    </div>
                    <div class="field-container">
                        <input class="field-input input" type="text" name="descripcion_equipaje" placeholder=" " maxlength="200" ${minBodega === 0 ? 'disabled' : ''} autocomplete="off">
                        <label class="label field-label">Descripción del equipaje (opcional)</label>
                        <p class="field-error"></p>
                    </div>
                </div>
                <p class="field-help">${minBodega > 0 ? `Tu tarifa incluye hasta ${minBodega} kg de equipaje de bodega por pasajero.` : 'Tu tarifa no incluye equipaje de bodega; solo equipaje de mano.'}</p>
            </section>`;
    }

    contenido.innerHTML = `
        <div class="checkout-layout">
            <form class="checkout-main" id="formPasajeros" novalidate>
                <p class="form-alert" role="alert" hidden></p>
                ${Array.from({ length: n }, (_, i) => tarjetaPasajero(i)).join('')}
                <div class="checkout-actions">
                    <a class="btn btn-outline" href="javascript:history.back()"><i class="fa-solid fa-arrow-left"></i> Volver a los vuelos</a>
                    <button type="submit" class="btn btn-primary btn-lg" id="btnReservar">Continuar al pago <i class="fa-solid fa-arrow-right"></i></button>
                </div>
            </form>

            <aside class="card summary-card">
                <h3 class="card-title">Resumen del viaje</h3>
                ${tarifas.map(pintarTramo).join('')}
                <div class="summary-passengers"><i class="fa-solid fa-users"></i> ${AL.textoPasajeros(sel.adultos, sel.menores)}</div>
                <div class="summary-prices">
                    ${tarifas.map((t, i) => `<div class="price-row"><span>${tarifas.length > 1 ? (i === 0 ? 'Ida' : 'Vuelta') : 'Vuelo'} · ${n} × ${AL.dinero(t.precio)}</span><strong>${AL.dinero(t.precio * n)}</strong></div>`).join('')}
                    <div class="price-row price-total"><span>Total</span><strong>${AL.dinero(total)}</strong></div>
                </div>
                <p class="muted small"><i class="fa-regular fa-clock"></i> Al continuar apartamos tus asientos. La reserva queda pendiente de pago y se libera sola si no se paga a tiempo.</p>
            </aside>
        </div>`;

    const form = $('formPasajeros');
    const tarjetas = [...form.querySelectorAll('.passenger-card')];

    const campo = (card, nombre) => card.querySelector(`[name="${nombre}"]`);

    function bloquearDatos(card, bloquear) {
        ['nombre_completo', 'tipo_documento', 'numero_documento', 'fecha_nacimiento', 'nacionalidad'].forEach((nombre) => {
            const el = campo(card, nombre);
            el.disabled = bloquear;
        });
    }

    function rellenar(card, d) {
        campo(card, 'nombre_completo').value = d.nombre_completo || '';
        const tipo = campo(card, 'tipo_documento');
        if ([...tipo.options].some((o) => o.value === d.tipo_documento)) tipo.value = d.tipo_documento;
        campo(card, 'numero_documento').value = d.numero_documento || '';
        campo(card, 'fecha_nacimiento').value = d.fecha_nacimiento || '';
        campo(card, 'nacionalidad').value = d.nacionalidad || 'Colombiana';
    }

    form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-accion="usar-mis-datos"]');
        if (!b) return;
        const card = b.closest('.passenger-card');
        const sg = campo(card, 'guardado');
        if (sg) { sg.value = ''; bloquearDatos(card, false); }
        if (AL.edad(perfil.fecha_nacimiento, fechaRef) < 18) return AL.aviso('Tu cuenta es de un adulto, revisa tu fecha de nacimiento.', 'error');
        rellenar(card, perfil);
        AL.limpiarErrores(card);
    });

    form.addEventListener('change', (e) => {
        if (e.target.name !== 'guardado') return;
        const card = e.target.closest('.passenger-card');
        const g = guardados.find((x) => String(x.id_pasajero) === e.target.value);
        if (g) {
            rellenar(card, g);
            bloquearDatos(card, true);
            card.querySelectorAll('.has-error').forEach((c) => c.classList.remove('has-error'));
        } else {
            bloquearDatos(card, false);
        }
    });

    form.addEventListener('input', (e) => {
        const cont = e.target.closest('.field-container');
        if (!cont) return;
        cont.classList.remove('has-error');
        const p = cont.querySelector('.field-error');
        if (p) p.textContent = '';
    });

    const RE_NOMBRE = /^[\p{L}][\p{L}\p{M}\s'.-]*$/u;

    function validarTarjeta(card) {
        const errores = {};
        const v = (nombre) => campo(card, nombre).value.trim();
        const adulto = card.dataset.categoria === 'adulto';
        const tipo = v('tipo_documento');
        const doc = v('numero_documento').replace(/\s/g, '');
        if (v('nombre_completo').length < 3 || !RE_NOMBRE.test(v('nombre_completo'))) errores.nombre_completo = 'Escribe el nombre completo (solo letras).';
        if (tipo === 'PAS' ? !/^[A-Za-z0-9]{5,20}$/.test(doc) : !/^\d{5,15}$/.test(doc)) {
            errores.numero_documento = tipo === 'PAS' ? 'Entre 5 y 20 letras o números.' : 'Entre 5 y 15 dígitos.';
        }
        const nac = v('fecha_nacimiento');
        if (!nac) errores.fecha_nacimiento = 'Indica la fecha de nacimiento.';
        else if (adulto && nac > adultoMax) errores.fecha_nacimiento = 'Un adulto debe tener 18 años o más el día del vuelo.';
        else if (!adulto && (nac < menorMin || nac > AL.hoy())) errores.fecha_nacimiento = 'Un menor debe tener menos de 18 años el día del vuelo.';
        if (v('nacionalidad').length < 3) errores.nacionalidad = 'Indica la nacionalidad.';
        const kg = Number(campo(card, 'equipaje_kg').value || 0);
        if (!Number.isFinite(kg) || kg < 0 || kg > minBodega) errores.equipaje_kg = minBodega > 0 ? `Máximo ${minBodega} kg.` : 'Tu tarifa no incluye equipaje de bodega.';
        return errores;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        AL.limpiarErrores(form);
        let hayError = false;
        const vistos = new Set();

        tarjetas.forEach((card) => {
            const guardado = campo(card, 'guardado') && campo(card, 'guardado').value;
            if (!guardado) {
                for (const [nombre, msg] of Object.entries(validarTarjeta(card))) {
                    const cont = campo(card, nombre).closest('.field-container');
                    cont.classList.add('has-error');
                    cont.querySelector('.field-error').textContent = msg;
                    hayError = true;
                }
            }
            const clave = `${campo(card, 'tipo_documento').value}|${campo(card, 'numero_documento').value.trim().toUpperCase()}`;
            if (vistos.has(clave) && !hayError) {
                const cont = campo(card, 'numero_documento').closest('.field-container');
                cont.classList.add('has-error');
                cont.querySelector('.field-error').textContent = 'Este documento ya está en otro pasajero.';
                hayError = true;
            }
            vistos.add(clave);
        });
        if (hayError) {
            AL.alerta(form, 'Revisa los campos marcados en rojo.');
            const primero = form.querySelector('.has-error');
            if (primero) primero.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
        }

        const pasajeros = tarjetas.map((card) => {
            const equipaje = {
                equipaje_kg: Number(campo(card, 'equipaje_kg').value || 0),
                descripcion_equipaje: campo(card, 'descripcion_equipaje').value.trim(),
            };
            const guardado = campo(card, 'guardado') && campo(card, 'guardado').value;
            if (guardado) return { id_pasajero: Number(guardado), ...equipaje };
            return {
                tipo_documento: campo(card, 'tipo_documento').value,
                numero_documento: campo(card, 'numero_documento').value.trim(),
                nombre_completo: campo(card, 'nombre_completo').value.trim(),
                fecha_nacimiento: campo(card, 'fecha_nacimiento').value,
                nacionalidad: campo(card, 'nacionalidad').value.trim(),
                ...equipaje,
            };
        });

        const boton = $('btnReservar');
        AL.cargando(boton, true);
        try {
            const r = await AL.api('/reservas', { method: 'POST', body: { tarifas: sel.tarifas, pasajeros } });
            AL.borrarSeleccion();
            location.href = 'pago.html?id=' + r.id_reserva;
        } catch (err) {
            AL.alerta(form, err.message);
            AL.aviso(err.message, 'error');
            AL.cargando(boton, false);
        }
    });
})();
