'use strict';
// Pago (simulado) de una reserva PENDIENTE y pantalla de confirmación.
(async function () {
    const $ = (id) => document.getElementById(id);
    const contenido = $('contenido');

    const sesion = await AL.iniciarPagina({ requiere: 'cliente' });
    if (!sesion) return;

    const id = Number(AL.params().get('id'));
    let reserva = null;
    let temporizador = null;

    const METODOS = [
        { id: 'TARJETA_CREDITO', texto: 'Tarjeta de crédito', detalle: 'Visa, Mastercard y otras', icono: 'fa-credit-card' },
        { id: 'TARJETA_DEBITO', texto: 'Tarjeta débito', detalle: 'Débito de tu cuenta', icono: 'fa-wallet' },
        { id: 'PSE', texto: 'PSE', detalle: 'Pago desde tu banco', icono: 'fa-building-columns' },
        { id: 'TRANSFERENCIA', texto: 'Transferencia bancaria', detalle: 'Desde tu app bancaria', icono: 'fa-money-bill-transfer' },
    ];

    function mensaje(icono, titulo, texto, acciones) {
        contenido.innerHTML = `
            <div class="empty-state card">
                <i class="fa-solid ${icono}"></i>
                <h3>${AL.esc(titulo)}</h3>
                <p>${AL.esc(texto)}</p>
                <div class="empty-actions">${acciones}</div>
            </div>`;
    }

    // ------------------------------------------------------------------ resumen de la reserva (se reutiliza)
    function vuelosHtml(r) {
        return r.vuelos.map((v, i) => `
            <div class="summary-flight">
                <p class="summary-flight-title">${r.vuelos.length > 1 ? (i === 0 ? 'Ida' : 'Vuelta') + ' · ' : ''}${AL.fechaCorta(v.salida)}</p>
                <p class="summary-flight-route"><strong>${AL.esc(v.origen_ciudad)}</strong> <i class="fa-solid fa-arrow-right"></i> <strong>${AL.esc(v.destino_ciudad)}</strong></p>
                <p class="summary-flight-meta">${AL.hora(v.salida)} – ${AL.hora(v.llegada)} · ${AL.textoEscalas(v.escalas)} · ${AL.esc(v.aerolinea)} · vuelo ${AL.esc(v.codigo_vuelo)}</p>
                <p class="summary-flight-meta">Tarifa ${AL.esc(v.tarifa.nombre_tarifa)}</p>
                <ul class="mini-passengers">
                    ${v.pasajeros.map((p) => `<li><i class="fa-solid fa-user"></i> ${AL.esc(p.nombre)} <span>Asiento ${AL.esc(p.asiento || '—')}</span></li>`).join('')}
                </ul>
            </div>`).join('');
    }

    // ------------------------------------------------------------------ pantallas según el estado
    function pantallaPago() {
        const r = reserva;
        $('tituloPago').textContent = 'Paga tu reserva';
        $('subtituloPago').textContent = `Código de reserva ${r.codigo_reserva}`;
        let segundos = Math.max(0, (r.minutos_para_pagar || 0) * 60);

        contenido.innerHTML = `
            <div class="checkout-layout">
                <div class="checkout-main">
                    <section class="card countdown-card">
                        <i class="fa-regular fa-clock"></i>
                        <div>
                            <p class="countdown-label">Tus asientos están apartados por</p>
                            <p class="countdown" id="cuentaRegresiva">--:--</p>
                        </div>
                        <p class="countdown-note">Si no pagas a tiempo, la reserva expira y los cupos se liberan.</p>
                    </section>

                    <form class="card" id="formPago" novalidate>
                        <h3 class="card-title">¿Cómo quieres pagar?</h3>
                        <p class="form-alert" role="alert" hidden></p>
                        <div class="pay-methods">
                            ${METODOS.map((m, i) => `
                                <label class="pay-method">
                                    <input type="radio" name="metodo" value="${m.id}" ${i === 0 ? 'checked' : ''}>
                                    <span class="pay-method-body">
                                        <i class="fa-solid ${m.icono}"></i>
                                        <span><strong>${m.texto}</strong><small>${m.detalle}</small></span>
                                    </span>
                                </label>`).join('')}
                        </div>
                        <p class="sim-note"><i class="fa-solid fa-flask"></i> <span><strong>Pago simulado.</strong> No se te pedirán datos de tarjeta ni se hará ningún cobro real: al pagar, la reserva pasa a confirmada.</span></p>
                        <div class="checkout-actions">
                            <button type="button" class="btn btn-outline" data-accion="cancelar"><i class="fa-solid fa-xmark"></i> Cancelar reserva</button>
                            <button type="submit" class="btn btn-primary btn-lg" id="btnPagar">Pagar ${AL.dinero(r.monto_total)}</button>
                        </div>
                    </form>
                </div>

                <aside class="card summary-card">
                    <h3 class="card-title">Tu reserva</h3>
                    ${vuelosHtml(r)}
                    <div class="summary-passengers"><i class="fa-solid fa-users"></i> ${r.n_pasajeros} ${r.n_pasajeros === 1 ? 'pasajero' : 'pasajeros'}</div>
                    <div class="summary-prices">
                        <div class="price-row price-total"><span>Total a pagar</span><strong>${AL.dinero(r.monto_total)}</strong></div>
                    </div>
                </aside>
            </div>`;

        const pintarCuenta = () => {
            const m = Math.floor(segundos / 60);
            const s = segundos % 60;
            const el = $('cuentaRegresiva');
            if (el) el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        };
        pintarCuenta();
        clearInterval(temporizador);
        temporizador = setInterval(async () => {
            segundos--;
            pintarCuenta();
            if (segundos <= 0) {
                clearInterval(temporizador);
                await recargar(); // el servidor dirá si ya expiró o si aún quedan minutos
            }
        }, 1000);
    }

    function pantallaConfirmada() {
        clearInterval(temporizador);
        const r = reserva;
        $('tituloPago').textContent = '¡Reserva confirmada!';
        $('subtituloPago').textContent = 'Te dejamos el detalle de tu viaje.';
        $('stepperPago').innerHTML = `
            <li class="step done"><span class="step-num"><i class="fa-solid fa-check"></i></span><span class="step-text">Vuelos</span></li>
            <li class="step done"><span class="step-num"><i class="fa-solid fa-check"></i></span><span class="step-text">Pasajeros</span></li>
            <li class="step done"><span class="step-num"><i class="fa-solid fa-check"></i></span><span class="step-text">Pago</span></li>`;
        contenido.innerHTML = `
            <div class="checkout-layout">
                <section class="card success-card">
                    <div class="success-icon"><i class="fa-solid fa-circle-check"></i></div>
                    <h3>¡Todo listo, ${AL.esc(sesion.nombre.split(' ')[0])}!</h3>
                    <p>Tu pago fue recibido y tus vuelos están confirmados.</p>
                    <div class="reservation-code">
                        <span>Código de reserva</span>
                        <strong>${AL.esc(r.codigo_reserva)}</strong>
                    </div>
                    <p class="muted small">${AL.esc(r.observaciones || '')}</p>
                    <div class="empty-actions">
                        <a class="btn btn-primary" href="mis-reservas.html">Ver mis reservas</a>
                        <a class="btn btn-outline" href="index.html">Buscar otro vuelo</a>
                        <button type="button" class="btn btn-outline" onclick="window.print()"><i class="fa-solid fa-print"></i> Imprimir</button>
                    </div>
                </section>
                <aside class="card summary-card">
                    <h3 class="card-title">Detalle del viaje</h3>
                    ${vuelosHtml(r)}
                    <div class="summary-prices">
                        <div class="price-row price-total"><span>Total pagado</span><strong>${AL.dinero(r.monto_total)}</strong></div>
                    </div>
                </aside>
            </div>`;
    }

    function pantallaCerrada() {
        clearInterval(temporizador);
        const r = reserva;
        $('stepperPago').hidden = true;
        $('tituloPago').textContent = r.estado === 'EXPIRADA' ? 'La reserva expiró' : 'Reserva cancelada';
        $('subtituloPago').textContent = `Código de reserva ${r.codigo_reserva}`;
        mensaje(
            r.estado === 'EXPIRADA' ? 'fa-hourglass-end' : 'fa-ban',
            r.estado === 'EXPIRADA' ? 'No se pagó a tiempo' : 'Esta reserva fue cancelada',
            'Los cupos se liberaron. Si todavía quieres viajar, haz una nueva búsqueda.',
            '<a class="btn btn-primary" href="index.html">Buscar vuelos</a><a class="btn btn-outline" href="mis-reservas.html">Mis reservas</a>'
        );
    }

    function pintar() {
        if (reserva.estado === 'PENDIENTE') pantallaPago();
        else if (reserva.estado === 'CONFIRMADA') pantallaConfirmada();
        else pantallaCerrada();
    }

    async function recargar() {
        try {
            reserva = await AL.api('/reservas/' + id);
            pintar();
        } catch (err) {
            mensaje('fa-plug-circle-exclamation', 'No pudimos cargar la reserva', err.message, '<a class="btn btn-primary" href="mis-reservas.html">Mis reservas</a>');
        }
    }

    // ------------------------------------------------------------------ acciones
    contenido.addEventListener('submit', async (e) => {
        if (e.target.id !== 'formPago') return;
        e.preventDefault();
        const form = e.target;
        AL.limpiarErrores(form);
        const boton = $('btnPagar');
        AL.cargando(boton, true);
        try {
            reserva = await AL.api(`/reservas/${id}/pagar`, { method: 'POST', body: { metodo: form.querySelector('[name="metodo"]:checked').value } });
            window.scrollTo({ top: 0, behavior: 'smooth' });
            pintar();
            AL.aviso('¡Pago recibido! Tu reserva está confirmada.', 'exito');
        } catch (err) {
            AL.alerta(form, err.message);
            AL.cargando(boton, false);
            if (err.status === 409) recargar();
        }
    });

    contenido.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-accion="cancelar"]')) return;
        const ok = await AL.confirmar({
            titulo: '¿Cancelar la reserva?',
            mensaje: 'Se liberarán los asientos apartados. Esta acción no se puede deshacer.',
            textoConfirmar: 'Sí, cancelar',
            peligro: true,
        });
        if (!ok) return;
        try {
            reserva = await AL.api(`/reservas/${id}/cancelar`, { method: 'POST', body: {} });
            pintar();
        } catch (err) {
            AL.aviso(err.message, 'error');
        }
    });

    if (!Number.isInteger(id) || id <= 0) {
        return mensaje('fa-ticket', 'Falta indicar la reserva', 'Entra desde "Mis reservas" para pagar una reserva pendiente.', '<a class="btn btn-primary" href="mis-reservas.html">Mis reservas</a>');
    }
    await recargar();
})();
