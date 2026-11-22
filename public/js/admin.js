'use strict';
// Panel de administración: resumen, vuelos, reservas, clientes y aerolíneas.
(async function () {
    const $ = (id) => document.getElementById(id);

    const sesion = await AL.iniciarPagina({ requiere: 'admin' });
    if (!sesion) return;

    const ESTADOS_VUELO = { PROGRAMADO: 'Programado', RETRASADO: 'Retrasado', EN_VUELO: 'En vuelo', ATERRIZADO: 'Aterrizado', CANCELADO: 'Cancelado' };
    const ESTADOS_CLIENTE = { ACTIVO: 'Activo', INACTIVO: 'Inactivo', SUSPENDIDO: 'Suspendido' };

    const cargadas = new Set();
    let aerolineas = [];
    let aeropuertos = [];
    let paginaVuelos = 1;
    let reservasAdmin = [];

    const vacio = (t) => `<tbody><tr><td class="table-empty" colspan="12">${AL.esc(t)}</td></tr></tbody>`;
    const cargandoTabla = (tabla) => { tabla.innerHTML = vacio('Cargando…'); };
    const falla = (tabla, err) => { tabla.innerHTML = vacio(err.message); };
    const opciones = (mapa, actual) => Object.entries(mapa).map(([k, t]) => `<option value="${k}" ${k === actual ? 'selected' : ''}>${t}</option>`).join('');

    // ------------------------------------------------------------------ pestañas
    const cargadores = { resumen: cargarResumen, vuelos: cargarVuelos, reservas: cargarReservas, clientes: cargarClientes, aerolineas: cargarAerolineas };

    function abrirTab(nombre) {
        document.querySelectorAll('#tabs .tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === nombre));
        document.querySelectorAll('.admin-panel').forEach((p) => { p.hidden = p.id !== 'panel-' + nombre; });
        if (!cargadas.has(nombre)) {
            cargadas.add(nombre);
            cargadores[nombre]();
        }
        if (history.replaceState) history.replaceState(null, '', '#' + nombre);
    }
    $('tabs').addEventListener('click', (e) => {
        const b = e.target.closest('.tab-btn');
        if (b) abrirTab(b.dataset.tab);
    });

    // ------------------------------------------------------------------ resumen
    async function cargarResumen() {
        try {
            const r = await AL.api('/admin/resumen');
            const stat = (icono, valor, texto) => `<div class="card stat"><i class="fa-solid ${icono}"></i><div><strong>${valor}</strong><span>${texto}</span></div></div>`;
            $('estadisticas').innerHTML = [
                stat('fa-sack-dollar', AL.dinero(r.ingresos), 'Ingresos (reservas confirmadas)'),
                stat('fa-circle-check', r.reservas_confirmadas, 'Reservas confirmadas'),
                stat('fa-hourglass-half', r.reservas_pendientes, 'Reservas pendientes'),
                stat('fa-ban', r.reservas_canceladas, 'Canceladas o expiradas'),
                stat('fa-plane-departure', r.vuelos_programados, 'Vuelos por salir'),
                stat('fa-users', r.clientes, 'Clientes registrados'),
                stat('fa-building', r.aerolineas_activas, 'Aerolíneas activas'),
            ].join('');
            $('rutasTop').innerHTML = r.rutas_top.length
                ? `<ol class="rank-list">${r.rutas_top.map((x) => `<li><span>${AL.esc(x.origen)} → ${AL.esc(x.destino)}</span><small>${x.pasajeros} pasajeros</small><strong>${AL.dinero(x.ventas)}</strong></li>`).join('')}</ol>`
                : '<p class="muted">Todavía no hay ventas confirmadas.</p>';
            $('aerolineasTop').innerHTML = r.aerolineas_top.length
                ? `<ol class="rank-list">${r.aerolineas_top.map((x) => `<li><span>${AL.esc(x.aerolinea)}</span><small>${x.pasajeros} pasajeros</small><strong>${AL.dinero(x.ventas)}</strong></li>`).join('')}</ol>`
                : '<p class="muted">Todavía no hay ventas confirmadas.</p>';
        } catch (err) {
            $('estadisticas').innerHTML = `<p class="muted">${AL.esc(err.message)}</p>`;
        }
    }

    // ------------------------------------------------------------------ catálogos usados en varios sitios
    async function cargarCatalogos() {
        if (aerolineas.length && aeropuertos.length) return;
        [aerolineas, aeropuertos] = await Promise.all([AL.api('/admin/aerolineas'), AL.aeropuertos()]);
    }

    // ------------------------------------------------------------------ vuelos
    async function cargarVuelos() {
        const tabla = $('tablaVuelos');
        cargandoTabla(tabla);
        try {
            await cargarCatalogos();
        } catch (err) { return falla(tabla, err); }
        const opAero = aeropuertos.map((a) => `<option value="${a.codigo}">${AL.esc(a.ciudad)} (${a.codigo})</option>`).join('');
        const f = $('filtrosVuelos');
        f.origen.insertAdjacentHTML('beforeend', opAero);
        f.destino.insertAdjacentHTML('beforeend', opAero);
        await buscarVuelos(1);
    }

    async function buscarVuelos(pagina) {
        paginaVuelos = pagina;
        const tabla = $('tablaVuelos');
        const f = $('filtrosVuelos');
        const p = new URLSearchParams({ pagina });
        for (const nombre of ['q', 'origen', 'destino', 'fecha', 'estado']) if (f[nombre].value) p.set(nombre, f[nombre].value);
        if (f.pasados.checked) p.set('pasados', '1');
        try {
            const r = await AL.api('/admin/vuelos?' + p);
            if (!r.vuelos.length) {
                tabla.innerHTML = vacio('No hay vuelos con esos filtros.');
                $('paginadorVuelos').innerHTML = '';
                return;
            }
            tabla.innerHTML = `
                <thead><tr><th>Código</th><th>Aerolínea</th><th>Ruta</th><th>Salida</th><th>Llegada</th><th>Cupos</th><th>Precio base</th><th>Estado</th><th></th></tr></thead>
                <tbody>${r.vuelos.map((v) => `
                    <tr data-id="${v.id_vuelo}">
                        <td><strong>${AL.esc(v.codigo_vuelo)}</strong></td>
                        <td>${AL.esc(v.aerolinea)}</td>
                        <td>${AL.esc(v.origen)} → ${AL.esc(v.destino)}${v.escalas ? ` <small class="muted">(${AL.textoEscalas(v.escalas)})</small>` : ''}</td>
                        <td>${AL.fechaDia(v.salida)} ${AL.hora(v.salida)}</td>
                        <td>${AL.fechaDia(v.llegada)} ${AL.hora(v.llegada)}</td>
                        <td>${v.cupos_disponibles} / ${v.capacidad_total}</td>
                        <td>${AL.dinero(v.precio_base)}</td>
                        <td><select class="control control-sm" data-accion="estado-vuelo" data-actual="${v.estado}" aria-label="Estado del vuelo ${AL.esc(v.codigo_vuelo)}">${opciones(ESTADOS_VUELO, v.estado)}</select></td>
                        <td><button type="button" class="btn btn-ghost btn-sm btn-icon" data-accion="eliminar-vuelo" title="Eliminar vuelo" aria-label="Eliminar vuelo ${AL.esc(v.codigo_vuelo)}"><i class="fa-solid fa-trash"></i></button></td>
                    </tr>`).join('')}</tbody>`;
            const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
            $('paginadorVuelos').innerHTML = `
                <span class="muted small">${r.total} ${r.total === 1 ? 'vuelo' : 'vuelos'} · página ${r.pagina} de ${paginas}</span>
                <span class="spacer"></span>
                <button type="button" class="btn btn-outline btn-sm" data-pag="${r.pagina - 1}" ${r.pagina <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Anterior</button>
                <button type="button" class="btn btn-outline btn-sm" data-pag="${r.pagina + 1}" ${r.pagina >= paginas ? 'disabled' : ''}>Siguiente <i class="fa-solid fa-chevron-right"></i></button>`;
        } catch (err) { falla(tabla, err); }
    }

    $('filtrosVuelos').addEventListener('submit', (e) => { e.preventDefault(); buscarVuelos(1); });
    $('limpiarVuelos').addEventListener('click', () => { $('filtrosVuelos').reset(); buscarVuelos(1); });
    $('paginadorVuelos').addEventListener('click', (e) => {
        const b = e.target.closest('[data-pag]');
        if (b && !b.disabled) buscarVuelos(Number(b.dataset.pag));
    });

    $('tablaVuelos').addEventListener('change', async (e) => {
        const sel = e.target.closest('[data-accion="estado-vuelo"]');
        if (!sel) return;
        const id = Number(sel.closest('tr').dataset.id);
        const anterior = sel.dataset.actual;
        if (sel.value === 'CANCELADO') {
            const ok = await AL.confirmar({
                titulo: '¿Cancelar este vuelo?',
                mensaje: 'Las reservas pendientes y confirmadas que incluyan este vuelo también se cancelarán y se liberarán sus asientos.',
                textoConfirmar: 'Sí, cancelar vuelo',
                peligro: true,
            });
            if (!ok) { sel.value = anterior; return; }
        }
        try {
            const r = await AL.api('/admin/vuelos/' + id, { method: 'PATCH', body: { estado: sel.value } });
            sel.dataset.actual = sel.value;
            AL.aviso(r.reservas_canceladas ? `Vuelo cancelado. Se cancelaron ${r.reservas_canceladas} reserva(s).` : 'Estado actualizado.', 'exito');
            cargadas.delete('resumen');
        } catch (err) {
            sel.value = anterior;
            AL.aviso(err.message, 'error');
        }
    });

    $('tablaVuelos').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-accion="eliminar-vuelo"]');
        if (!b) return;
        const fila = b.closest('tr');
        const ok = await AL.confirmar({
            titulo: '¿Eliminar este vuelo?',
            mensaje: `Se eliminará el vuelo ${fila.querySelector('strong').textContent} con sus tarifas. Solo es posible si no tiene reservas.`,
            textoConfirmar: 'Eliminar',
            peligro: true,
        });
        if (!ok) return;
        try {
            await AL.api('/admin/vuelos/' + fila.dataset.id, { method: 'DELETE', body: {} });
            AL.aviso('Vuelo eliminado.', 'exito');
            buscarVuelos(paginaVuelos);
        } catch (err) { AL.aviso(err.message, 'error'); }
    });

    // ---- nuevo vuelo
    const dlgVuelo = $('dlgVuelo');
    const formVuelo = $('formVuelo');

    $('nuevoVuelo').addEventListener('click', async () => {
        try { await cargarCatalogos(); } catch (err) { return AL.aviso(err.message, 'error'); }
        formVuelo.id_aerolinea.innerHTML = '<option value="">Selecciona…</option>' + aerolineas.filter((a) => a.estado === 'Y')
            .map((a) => `<option value="${AL.esc(a.id_aerolinea)}">${AL.esc(a.nombre)}</option>`).join('');
        const ops = '<option value="">Selecciona…</option>' + aeropuertos.map((a) => `<option value="${a.codigo}">${AL.esc(a.ciudad)} (${a.codigo})</option>`).join('');
        formVuelo.origen.innerHTML = ops;
        formVuelo.destino.innerHTML = ops;
        formVuelo.reset();
        formVuelo.salida.min = AL.hoy() + 'T00:00';
        AL.limpiarErrores(formVuelo);
        dlgVuelo.showModal();
    });
    dlgVuelo.addEventListener('click', (e) => {
        if (e.target.closest('[data-cerrar]') || e.target === dlgVuelo) dlgVuelo.close();
    });
    formVuelo.addEventListener('input', (e) => {
        const c = e.target.closest('.field-container');
        if (c) { c.classList.remove('has-error'); c.querySelector('.field-error').textContent = ''; }
    });
    formVuelo.addEventListener('submit', async (e) => {
        e.preventDefault();
        AL.limpiarErrores(formVuelo);
        const d = Object.fromEntries(new FormData(formVuelo).entries());
        const boton = formVuelo.querySelector('[type="submit"]');
        AL.cargando(boton, true);
        try {
            const r = await AL.api('/admin/vuelos', {
                method: 'POST',
                body: {
                    id_aerolinea: d.id_aerolinea, codigo_vuelo: d.codigo_vuelo, origen: d.origen, destino: d.destino,
                    salida: d.salida, llegada: d.llegada, escalas: 0,
                    capacidad_total: Number(d.capacidad_total), precio_base: Number(d.precio_base),
                },
            });
            dlgVuelo.close();
            AL.aviso(`Vuelo ${r.codigo_vuelo} creado.`, 'exito');
            cargadas.delete('resumen');
            buscarVuelos(1);
        } catch (err) {
            AL.mostrarErrorApi(formVuelo, err);
        }
        AL.cargando(boton, false);
    });

    // ------------------------------------------------------------------ reservas
    async function cargarReservas() {
        const tabla = $('tablaReservas');
        cargandoTabla(tabla);
        const f = $('filtrosReservas');
        const p = new URLSearchParams();
        if (f.q.value) p.set('q', f.q.value);
        if (f.estado.value) p.set('estado', f.estado.value);
        try {
            reservasAdmin = await AL.api('/admin/reservas?' + p);
            if (!reservasAdmin.length) { tabla.innerHTML = vacio('No hay reservas con esos filtros.'); return; }
            tabla.innerHTML = `
                <thead><tr><th>Código</th><th>Cliente</th><th>Ruta</th><th>Pasajeros</th><th>Total</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
                <tbody>${reservasAdmin.map((r) => {
                    const v = r.vuelos[0];
                    return `
                    <tr data-id="${r.id_reserva}">
                        <td><strong>${AL.esc(r.codigo_reserva)}</strong></td>
                        <td>${AL.esc(r.cliente)}<br><small class="muted">${AL.esc(r.correo)}</small></td>
                        <td>${v ? `${AL.esc(v.origen)} ${r.vuelos.length > 1 ? '⇄' : '→'} ${AL.esc(v.destino)}<br><small class="muted">${AL.fechaDia(v.salida)}</small>` : '—'}</td>
                        <td>${r.n_pasajeros}</td>
                        <td>${AL.dinero(r.monto_total)}</td>
                        <td>${AL.fechaDia(r.fecha_reserva)}</td>
                        <td>${AL.badgeReserva(r.estado)}</td>
                        <td class="row-actions">
                            <button type="button" class="btn btn-outline btn-sm" data-accion="ver-reserva">Detalle</button>
                            ${['PENDIENTE', 'CONFIRMADA'].includes(r.estado) ? '<button type="button" class="btn btn-ghost btn-sm" data-accion="cancelar-reserva">Cancelar</button>' : ''}
                        </td>
                    </tr>`;
                }).join('')}</tbody>`;
        } catch (err) { falla(tabla, err); }
    }
    $('filtrosReservas').addEventListener('submit', (e) => { e.preventDefault(); cargarReservas(); });
    $('limpiarReservas').addEventListener('click', () => { $('filtrosReservas').reset(); cargarReservas(); });

    const dlgReserva = $('dlgReserva');
    dlgReserva.addEventListener('click', (e) => {
        if (e.target.closest('[data-cerrar]') || e.target === dlgReserva) dlgReserva.close();
    });

    function detalleHtml(r) {
        return `
            <h3 class="modal-title">Reserva ${AL.esc(r.codigo_reserva)} ${AL.badgeReserva(r.estado)}</h3>
            <p class="muted small">${AL.esc(r.cliente)} · ${AL.esc(r.correo)} · reservada el ${AL.fechaDia(r.fecha_reserva)} ${AL.hora(r.fecha_reserva)}</p>
            ${r.observaciones ? `<p class="muted small"><i class="fa-solid fa-circle-info"></i> ${AL.esc(r.observaciones)}</p>` : ''}
            ${r.vuelos.map((v, i) => `
                <div class="booking-flight">
                    <div class="booking-flight-top"><span class="flight-tag">${r.vuelos.length > 1 ? (i === 0 ? 'Ida' : 'Vuelta') : 'Vuelo'}</span>
                        <strong>${AL.esc(v.origen_ciudad)} (${AL.esc(v.origen)}) → ${AL.esc(v.destino_ciudad)} (${AL.esc(v.destino)})</strong></div>
                    <p class="muted small">${AL.fechaLarga(v.salida)} · ${AL.hora(v.salida)} – ${AL.hora(v.llegada)} · ${AL.esc(v.aerolinea)} ${AL.esc(v.codigo_vuelo)} · ${AL.esc(v.tarifa.nombre_tarifa)}</p>
                    <div class="booking-passengers">${v.pasajeros.map((p) => `
                        <div class="booking-passenger"><span><i class="fa-solid fa-user"></i> ${AL.esc(p.nombre)}</span>
                        <span class="muted small">${AL.esc(p.tipo_documento)} ${AL.esc(p.numero_documento)}</span>
                        <span class="muted small">Asiento ${AL.esc(p.asiento || '—')}</span>
                        <span class="muted small">${AL.dinero(p.precio)}</span></div>`).join('')}</div>
                </div>`).join('')}
            <div class="price-row price-total"><span>Total</span><strong>${AL.dinero(r.monto_total)}</strong></div>
            <div class="modal-actions"><button type="button" class="btn btn-primary" data-cerrar>Cerrar</button></div>`;
    }

    $('tablaReservas').addEventListener('click', async (e) => {
        const boton = e.target.closest('[data-accion]');
        if (!boton) return;
        const id = Number(boton.closest('tr').dataset.id);
        const r = reservasAdmin.find((x) => x.id_reserva === id);
        if (boton.dataset.accion === 'ver-reserva') {
            $('detalleReserva').innerHTML = detalleHtml(r);
            dlgReserva.showModal();
        } else if (boton.dataset.accion === 'cancelar-reserva') {
            const ok = await AL.confirmar({
                titulo: '¿Cancelar la reserva?',
                mensaje: `Se cancelará la reserva ${r.codigo_reserva} de ${r.cliente} y se liberarán los asientos.`,
                textoConfirmar: 'Sí, cancelar',
                peligro: true,
            });
            if (!ok) return;
            try {
                await AL.api(`/admin/reservas/${id}/cancelar`, { method: 'POST', body: {} });
                AL.aviso('Reserva cancelada.', 'exito');
                cargadas.delete('resumen');
                cargarReservas();
            } catch (err) { AL.aviso(err.message, 'error'); }
        }
    });

    // ------------------------------------------------------------------ clientes
    async function cargarClientes() {
        const tabla = $('tablaClientes');
        cargandoTabla(tabla);
        const q = $('filtrosClientes').q.value;
        try {
            const lista = await AL.api('/admin/clientes' + (q ? '?q=' + encodeURIComponent(q) : ''));
            if (!lista.length) { tabla.innerHTML = vacio('No hay clientes con esa búsqueda.'); return; }
            tabla.innerHTML = `
                <thead><tr><th>Cliente</th><th>Documento</th><th>Contacto</th><th>Registro</th><th>Reservas</th><th>Estado</th></tr></thead>
                <tbody>${lista.map((c) => `
                    <tr data-id="${c.id_cliente}">
                        <td><strong>${AL.esc(c.nombre_completo)}</strong></td>
                        <td>${AL.esc(c.tipo_documento)} ${AL.esc(c.numero_documento)}</td>
                        <td>${AL.esc(c.correo)}<br><small class="muted">${AL.esc(c.telefono)}</small></td>
                        <td>${AL.fechaDia(c.fecha_registro)}</td>
                        <td>${c.reservas}</td>
                        <td><select class="control control-sm" data-accion="estado-cliente" data-actual="${c.estado}" aria-label="Estado de ${AL.esc(c.nombre_completo)}">${opciones(ESTADOS_CLIENTE, c.estado)}</select></td>
                    </tr>`).join('')}</tbody>`;
        } catch (err) { falla(tabla, err); }
    }
    $('filtrosClientes').addEventListener('submit', (e) => { e.preventDefault(); cargarClientes(); });
    $('limpiarClientes').addEventListener('click', () => { $('filtrosClientes').reset(); cargarClientes(); });
    $('tablaClientes').addEventListener('change', async (e) => {
        const sel = e.target.closest('[data-accion="estado-cliente"]');
        if (!sel) return;
        try {
            await AL.api('/admin/clientes/' + sel.closest('tr').dataset.id, { method: 'PATCH', body: { estado: sel.value } });
            sel.dataset.actual = sel.value;
            AL.aviso('Estado del cliente actualizado.', 'exito');
        } catch (err) {
            sel.value = sel.dataset.actual;
            AL.aviso(err.message, 'error');
        }
    });

    // ------------------------------------------------------------------ aerolíneas
    async function cargarAerolineas() {
        const tabla = $('tablaAerolineas');
        cargandoTabla(tabla);
        try {
            aerolineas = await AL.api('/admin/aerolineas');
            tabla.innerHTML = `
                <thead><tr><th>Código IATA</th><th>Aerolínea</th><th>País</th><th>Vuelos por salir</th><th>Estado</th><th></th></tr></thead>
                <tbody>${aerolineas.map((a) => `
                    <tr data-id="${AL.esc(a.id_aerolinea)}">
                        <td><strong>${AL.esc(a.codigo_iata)}</strong></td>
                        <td>${AL.esc(a.nombre)}</td>
                        <td>${AL.esc(a.pais_origen)}</td>
                        <td>${a.vuelos_futuros}</td>
                        <td><span class="badge ${a.estado === 'Y' ? 'badge-success' : 'badge-muted'}">${a.estado === 'Y' ? 'Activa' : 'Inactiva'}</span></td>
                        <td><button type="button" class="btn btn-outline btn-sm" data-accion="alternar" data-estado="${a.estado === 'Y' ? 'N' : 'Y'}">${a.estado === 'Y' ? 'Desactivar' : 'Activar'}</button></td>
                    </tr>`).join('')}</tbody>`;
        } catch (err) { falla(tabla, err); }
    }
    $('tablaAerolineas').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-accion="alternar"]');
        if (!b) return;
        const fila = b.closest('tr');
        try {
            await AL.api('/admin/aerolineas/' + encodeURIComponent(fila.dataset.id), { method: 'PATCH', body: { estado: b.dataset.estado } });
            AL.aviso('Aerolínea actualizada.', 'exito');
            cargadas.delete('resumen');
            cargarAerolineas();
        } catch (err) { AL.aviso(err.message, 'error'); }
    });

    // ------------------------------------------------------------------ inicio
    const inicial = location.hash.replace('#', '');
    abrirTab(cargadores[inicial] ? inicial : 'resumen');
})();
