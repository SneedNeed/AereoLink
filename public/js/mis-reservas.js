'use strict';
(async function () {
    const $ = (id) => document.getElementById(id);
    const lista = $('lista');

    const sesion = await AL.iniciarPagina({ requiere: 'cliente' });
    if (!sesion) return;

    let reservas = [];
    let filtro = 'todas';
    const abiertas = new Set();

    const coincide = (r, f) => f === 'todas' || r.estado === f || (f === 'cerradas' && ['CANCELADA', 'EXPIRADA'].includes(r.estado));
    const yaSalio = (r) => r.vuelos.some((v) => v.salida <= nowLocal());
    // hora de Bogotá como texto comparable con las del servidor
    const nowLocal = () => {
        const p = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
        return p.replace(' ', 'T');
    };

    function actualizarCuentas() {
        document.querySelectorAll('[data-cuenta]').forEach((el) => {
            el.textContent = reservas.filter((r) => coincide(r, el.dataset.cuenta)).length;
        });
    }

    function pintarVuelo(v, i, total) {
        const etiqueta = total > 1 ? (i === 0 ? 'Ida' : 'Vuelta') : 'Vuelo';
        const segmentos = v.segmentos.length > 1
            ? `<ul class="booking-segments">${v.segmentos.map((s) => `
                <li><strong>${AL.hora(s.salida)}</strong> ${AL.esc(s.salida_aeropuerto)} <i class="fa-solid fa-arrow-right"></i> <strong>${AL.hora(s.llegada)}</strong> ${AL.esc(s.llegada_aeropuerto)}
                ${s.espera_min ? `<span class="muted">· escala de ${AL.duracion(s.espera_min)}</span>` : ''}</li>`).join('')}</ul>`
            : '';
        return `
            <div class="booking-flight">
                <div class="booking-flight-top">
                    <span class="flight-tag">${etiqueta}</span>
                    <strong>${AL.fechaLarga(v.salida)}</strong>
                    ${v.estado_vuelo !== 'PROGRAMADO' ? `<span class="badge ${v.estado_vuelo === 'CANCELADO' ? 'badge-danger' : 'badge-warning'}">${AL.esc(v.estado_vuelo.replace('_', ' ').toLowerCase())}</span>` : ''}
                </div>
                <div class="booking-flight-route">
                    <div><span class="flight-time">${AL.hora(v.salida)}</span><span class="flight-airport">${AL.esc(v.origen_ciudad)} (${AL.esc(v.origen)})</span></div>
                    <div class="booking-flight-mid"><span class="muted small">${AL.duracion(AL.minutosEntre(v.salida, v.llegada))}</span><span class="flight-line"></span><span class="muted small">${AL.textoEscalas(v.escalas)}</span></div>
                    <div><span class="flight-time">${AL.hora(v.llegada)}${v.llegada.slice(0, 10) > v.salida.slice(0, 10) ? '<sup class="plus-day">+1</sup>' : ''}</span><span class="flight-airport">${AL.esc(v.destino_ciudad)} (${AL.esc(v.destino)})</span></div>
                </div>
                ${segmentos}
                <p class="muted small">${AL.esc(v.aerolinea)} · vuelo ${AL.esc(v.codigo_vuelo)} · Tarifa ${AL.esc(AL.CABINAS[v.tarifa.clase_cabina] || '')} ${AL.esc(v.tarifa.nombre_tarifa)}</p>
                <div class="booking-passengers">
                    ${v.pasajeros.map((p) => `
                        <div class="booking-passenger">
                            <span><i class="fa-solid fa-user"></i> ${AL.esc(p.nombre)}</span>
                            <span class="muted small">${AL.esc(p.tipo_documento)} ${AL.esc(p.numero_documento)}</span>
                            <span class="muted small">Asiento ${AL.esc(p.asiento || '—')}</span>
                            <span class="muted small">${p.equipaje_kg > 0 ? `Equipaje ${p.equipaje_kg} kg` : 'Solo equipaje de mano'}</span>
                        </div>`).join('')}
                </div>
            </div>`;
    }

    function pintarReserva(r) {
        const abierta = abiertas.has(r.id_reserva);
        const primero = r.vuelos[0];
        const ultimo = r.vuelos[r.vuelos.length - 1];
        const resumenRuta = r.vuelos.length > 1
            ? `${AL.esc(primero.origen_ciudad)} ⇄ ${AL.esc(primero.destino_ciudad)}`
            : `${AL.esc(primero.origen_ciudad)} → ${AL.esc(primero.destino_ciudad)}`;
        const fechas = r.vuelos.length > 1 ? `${AL.fechaDia(primero.salida)} – ${AL.fechaDia(ultimo.salida)}` : AL.fechaDia(primero.salida);
        const puedeCancelar = ['PENDIENTE', 'CONFIRMADA'].includes(r.estado) && !yaSalio(r);

        return `
            <article class="card booking-card" data-id="${r.id_reserva}">
                <div class="booking-head">
                    <div>
                        <p class="booking-route">${resumenRuta}</p>
                        <p class="muted small">${fechas} · ${r.n_pasajeros} ${r.n_pasajeros === 1 ? 'pasajero' : 'pasajeros'}</p>
                    </div>
                    <div class="booking-head-right">
                        ${AL.badgeReserva(r.estado)}
                        <strong class="booking-total">${AL.dinero(r.monto_total)}</strong>
                    </div>
                </div>
                <div class="booking-meta">
                    <span><i class="fa-solid fa-hashtag"></i> ${AL.esc(r.codigo_reserva)}</span>
                    <span><i class="fa-regular fa-calendar"></i> Reservada el ${AL.fechaDia(r.fecha_reserva)}</span>
                    ${r.estado === 'PENDIENTE' ? `<span class="pending-time"><i class="fa-regular fa-clock"></i> Paga en los próximos ${r.minutos_para_pagar} min</span>` : ''}
                </div>
                ${r.estado === 'CANCELADA' && r.observaciones ? `<p class="muted small"><i class="fa-solid fa-circle-info"></i> ${AL.esc(r.observaciones)}</p>` : ''}
                <div class="booking-detail" ${abierta ? '' : 'hidden'}>
                    ${r.vuelos.map((v, i) => pintarVuelo(v, i, r.vuelos.length)).join('')}
                </div>
                <div class="booking-actions">
                    <button type="button" class="btn btn-ghost btn-sm" data-accion="detalle">
                        <i class="fa-solid ${abierta ? 'fa-chevron-up' : 'fa-chevron-down'}"></i> ${abierta ? 'Ocultar detalle' : 'Ver detalle'}
                    </button>
                    <span class="spacer"></span>
                    ${puedeCancelar ? '<button type="button" class="btn btn-outline btn-sm" data-accion="cancelar"><i class="fa-solid fa-xmark"></i> Cancelar</button>' : ''}
                    ${r.estado === 'PENDIENTE' ? `<a class="btn btn-primary btn-sm" href="pago.html?id=${r.id_reserva}">Pagar ahora</a>` : ''}
                    ${r.estado === 'CONFIRMADA' ? `<a class="btn btn-primary btn-sm" href="pago.html?id=${r.id_reserva}">Ver confirmación</a>` : ''}
                </div>
            </article>`;
    }

    function pintar() {
        actualizarCuentas();
        const visibles = reservas.filter((r) => coincide(r, filtro));
        if (!visibles.length) {
            lista.innerHTML = `
                <div class="empty-state card">
                    <i class="fa-solid fa-suitcase-rolling"></i>
                    <h3>${reservas.length ? 'No hay reservas en esta categoría' : 'Aún no tienes reservas'}</h3>
                    <p>${reservas.length ? 'Prueba con otro filtro.' : 'Cuando reserves un vuelo, lo verás aquí.'}</p>
                    <div class="empty-actions"><a class="btn btn-primary" href="index.html">Buscar vuelos</a></div>
                </div>`;
            return;
        }
        lista.innerHTML = visibles.map(pintarReserva).join('');
    }

    async function cargar() {
        try {
            reservas = await AL.api('/reservas');
            pintar();
        } catch (err) {
            lista.innerHTML = `
                <div class="empty-state card">
                    <i class="fa-solid fa-plug-circle-exclamation"></i>
                    <h3>No pudimos cargar tus reservas</h3>
                    <p>${AL.esc(err.message)}</p>
                    <div class="empty-actions"><button type="button" class="btn btn-primary" onclick="location.reload()">Reintentar</button></div>
                </div>`;
        }
    }

    $('filtros').addEventListener('click', (e) => {
        const b = e.target.closest('.tab-btn');
        if (!b) return;
        filtro = b.dataset.filtro;
        document.querySelectorAll('#filtros .tab-btn').forEach((t) => t.classList.toggle('active', t === b));
        pintar();
    });

    lista.addEventListener('click', async (e) => {
        const card = e.target.closest('.booking-card');
        const boton = e.target.closest('[data-accion]');
        if (!card || !boton) return;
        const id = Number(card.dataset.id);

        if (boton.dataset.accion === 'detalle') {
            if (abiertas.has(id)) abiertas.delete(id); else abiertas.add(id);
            const r = reservas.find((x) => x.id_reserva === id);
            card.outerHTML = pintarReserva(r);
            return;
        }

        if (boton.dataset.accion === 'cancelar') {
            const r = reservas.find((x) => x.id_reserva === id);
            const ok = await AL.confirmar({
                titulo: '¿Cancelar esta reserva?',
                mensaje: r.estado === 'CONFIRMADA'
                    ? `Se cancelará la reserva ${r.codigo_reserva} y se liberarán los asientos. Esta acción no se puede deshacer.`
                    : `Se cancelará la reserva ${r.codigo_reserva} y se liberarán los asientos apartados.`,
                textoConfirmar: 'Sí, cancelar',
                peligro: true,
            });
            if (!ok) return;
            AL.cargando(boton, true);
            try {
                const nueva = await AL.api(`/reservas/${id}/cancelar`, { method: 'POST', body: {} });
                reservas = reservas.map((x) => (x.id_reserva === id ? nueva : x));
                pintar();
                AL.aviso('La reserva fue cancelada.', 'exito');
                AL.api('/auth/sesion').then((s) => { try { sessionStorage.setItem('al_sesion', JSON.stringify(s)); } catch (_) { /* nada */ } });
            } catch (err) {
                AL.cargando(boton, false);
                AL.aviso(err.message, 'error');
                if (err.status === 409) cargar();
            }
        }
    });

    await cargar();
})();
