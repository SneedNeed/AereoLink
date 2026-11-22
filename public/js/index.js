'use strict';
// Página de inicio: buscador de vuelos (autocompletado de aeropuertos, fechas y pasajeros).
(async function () {
    const $ = (id) => document.getElementById(id);
    const MAX_PASAJEROS = 9;

    const inOrigen = $('origen');
    const inDestino = $('destino');
    const fIda = $('fechaIda');
    const fVuelta = $('fechaVuelta');
    const tipoVuelo = $('tipoVuelo');
    const dateSearcher = document.querySelector('.dateSearcher');
    const chooser = $('pasajeros');
    const inAdultos = $('adultos');
    const inMenores = $('menores');
    const errorBox = $('errorBusqueda');

    const sesionPromesa = AL.iniciarPagina();

    // ------------------------------------------------------------------ aeropuertos
    let aeropuertos = [];
    try {
        aeropuertos = await AL.aeropuertos();
    } catch (e) {
        mostrarError('No se pudo cargar la lista de aeropuertos. ' + e.message);
    }

    const etiqueta = (a) => `${a.ciudad} (${a.codigo})`;

    function elegirAeropuerto(input, codigo) {
        const a = aeropuertos.find((x) => x.codigo === codigo);
        if (!a) return;
        input.value = etiqueta(a);
        input.dataset.codigo = a.codigo;
        input.closest('.trayect-child-container').classList.add('is-filled');
    }

    /** Autocompletado: filtra por ciudad, código IATA o nombre del aeropuerto. */
    function autocompletar(input, lista, siguiente) {
        const contenedor = input.closest('.trayect-child-container');
        let items = [];
        let activo = -1;

        const puntaje = (a, q) => {
            const ciudad = AL.normalizar(a.ciudad);
            const registrada = AL.normalizar(a.ciudad_registrada);
            if (a.codigo.toLowerCase() === q) return 0;
            if (ciudad.startsWith(q)) return 1;
            if (registrada.startsWith(q)) return 2;
            if (ciudad.includes(q) || registrada.includes(q)) return 3;
            if (a.codigo.toLowerCase().startsWith(q)) return 4;
            if (AL.normalizar(a.nombre).includes(q)) return 5;
            return 99;
        };

        function pintar() {
            const q = input.dataset.codigo ? '' : AL.normalizar(input.value.trim());
            items = (q
                ? aeropuertos.map((a) => ({ a, p: puntaje(a, q) })).filter((x) => x.p < 99).sort((x, y) => x.p - y.p || x.a.ciudad.localeCompare(y.a.ciudad, 'es'))
                : aeropuertos.map((a) => ({ a, p: 0 }))
            ).slice(0, 8).map((x) => x.a);
            activo = items.length ? 0 : -1;
            lista.innerHTML = items.length
                ? items.map((a, i) => `
                    <li class="suggestion${i === activo ? ' active' : ''}" role="option" data-i="${i}" id="${lista.id}-${i}">
                        <i class="fa-solid fa-location-dot"></i>
                        <div>
                            <p class="suggestion-city">${AL.esc(a.ciudad)} <span class="suggestion-code">${AL.esc(a.codigo)}</span></p>
                            <p class="suggestion-detail">${AL.esc(a.nombre)}</p>
                        </div>
                    </li>`).join('')
                : '<li class="suggestion-empty">No encontramos aeropuertos con ese nombre</li>';
            lista.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }

        function cerrar() {
            lista.hidden = true;
            input.setAttribute('aria-expanded', 'false');
        }

        function marcarActivo(nuevo) {
            if (!items.length) return;
            activo = (nuevo + items.length) % items.length;
            lista.querySelectorAll('.suggestion').forEach((li, i) => li.classList.toggle('active', i === activo));
            lista.querySelector('.suggestion.active')?.scrollIntoView({ block: 'nearest' });
        }

        function elegir(i) {
            const a = items[i];
            if (!a) return;
            elegirAeropuerto(input, a.codigo);
            cerrar();
            if (siguiente && !siguiente.value) siguiente.focus();
        }

        input.addEventListener('focus', () => {
            input.select();
            pintar();
        });
        input.addEventListener('input', () => {
            delete input.dataset.codigo;
            contenedor.classList.toggle('is-filled', input.value !== '');
            limpiarError();
            pintar();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (lista.hidden) pintar(); else marcarActivo(activo + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); marcarActivo(activo - 1); }
            else if (e.key === 'Enter' && !lista.hidden && items.length) { e.preventDefault(); elegir(activo); }
            else if (e.key === 'Escape') cerrar();
        });
        input.addEventListener('blur', () => {
            // Si escribió algo y no eligió de la lista, se toma la mejor coincidencia
            setTimeout(() => {
                if (!input.dataset.codigo && input.value.trim() && items.length) elegirAeropuerto(input, items[0].codigo);
                else if (!input.dataset.codigo) contenedor.classList.toggle('is-filled', input.value !== '');
                cerrar();
            }, 120);
        });
        // mousedown (no click) para que el campo no pierda el foco antes de elegir
        lista.addEventListener('mousedown', (e) => {
            const li = e.target.closest('.suggestion');
            if (!li) return;
            e.preventDefault();
            elegir(Number(li.dataset.i));
        });
    }

    autocompletar(inOrigen, $('origenLista'), inDestino);
    autocompletar(inDestino, $('destinoLista'), fIda);

    $('intercambiar').addEventListener('click', () => {
        const o = { v: inOrigen.value, c: inOrigen.dataset.codigo };
        inOrigen.value = inDestino.value;
        inDestino.value = o.v;
        for (const [input, codigo] of [[inOrigen, inDestino.dataset.codigo], [inDestino, o.c]]) {
            if (codigo) input.dataset.codigo = codigo; else delete input.dataset.codigo;
            input.closest('.trayect-child-container').classList.toggle('is-filled', input.value !== '');
        }
    });

    // ------------------------------------------------------------------ fechas
    const hoy = AL.hoy();
    fIda.min = fVuelta.min = hoy;
    fIda.max = fVuelta.max = AL.sumarDias(hoy, 365);
    fIda.value = AL.sumarDias(hoy, 7);
    fVuelta.value = AL.sumarDias(hoy, 14);

    fIda.addEventListener('change', () => {
        if (!fIda.value) return;
        fVuelta.min = fIda.value;
        if (!fVuelta.value || fVuelta.value < fIda.value) fVuelta.value = fIda.value;
    });

    function aplicarTipoVuelo() {
        dateSearcher.classList.toggle('one-way', tipoVuelo.value === 'ida');
    }
    tipoVuelo.addEventListener('change', aplicarTipoVuelo);

    // ------------------------------------------------------------------ pasajeros
    function leerNumero(input, min, max) {
        const n = parseInt(input.value, 10);
        return Math.min(max, Math.max(min, Number.isNaN(n) ? min : n));
    }

    function actualizarPasajeros(origen) {
        let adultos = leerNumero(inAdultos, 1, MAX_PASAJEROS);
        let menores = leerNumero(inMenores, 0, MAX_PASAJEROS - 1);
        // Si se pasa del máximo, se recorta el campo que el usuario NO está tocando
        if (adultos + menores > MAX_PASAJEROS) {
            if (origen === 'menores') menores = MAX_PASAJEROS - adultos;
            else adultos = MAX_PASAJEROS - menores;
        }
        inAdultos.value = adultos;
        inMenores.value = menores;
        $('totalPasajeros').textContent = adultos + menores;
        const total = adultos + menores;
        chooser.querySelector('.oldPerson-minus-button').disabled = adultos <= 1;
        chooser.querySelector('.youngPerson-minus-button').disabled = menores <= 0;
        chooser.querySelector('.oldPerson-increment-button').disabled = total >= MAX_PASAJEROS;
        chooser.querySelector('.youngPerson-increment-button').disabled = total >= MAX_PASAJEROS;
    }

    chooser.querySelector('.oldPerson-increment-button').addEventListener('click', () => { inAdultos.value = Number(inAdultos.value) + 1; actualizarPasajeros('adultos'); });
    chooser.querySelector('.oldPerson-minus-button').addEventListener('click', () => { inAdultos.value = Number(inAdultos.value) - 1; actualizarPasajeros('adultos'); });
    chooser.querySelector('.youngPerson-increment-button').addEventListener('click', () => { inMenores.value = Number(inMenores.value) + 1; actualizarPasajeros('menores'); });
    chooser.querySelector('.youngPerson-minus-button').addEventListener('click', () => { inMenores.value = Number(inMenores.value) - 1; actualizarPasajeros('menores'); });
    inAdultos.addEventListener('change', () => actualizarPasajeros('adultos'));
    inMenores.addEventListener('change', () => actualizarPasajeros('menores'));

    function abrirPasajeros(abrir) {
        chooser.classList.toggle('open', abrir);
        chooser.setAttribute('aria-expanded', String(abrir));
    }
    chooser.addEventListener('click', (e) => {
        if (e.target.closest('.peopleChooser-panel')) return;
        abrirPasajeros(!chooser.classList.contains('open'));
    });
    chooser.addEventListener('keydown', (e) => {
        if (e.target === chooser && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirPasajeros(!chooser.classList.contains('open')); }
        if (e.key === 'Escape') abrirPasajeros(false);
    });
    document.addEventListener('click', (e) => { if (!chooser.contains(e.target)) abrirPasajeros(false); });
    chooser.querySelector('.peopleChooser-button').addEventListener('click', () => abrirPasajeros(false));
    actualizarPasajeros();

    // ------------------------------------------------------------------ enviar búsqueda
    function mostrarError(msg) {
        errorBox.textContent = msg;
        errorBox.hidden = false;
    }
    function limpiarError() {
        errorBox.hidden = true;
    }

    $('searchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        limpiarError();
        const origen = inOrigen.dataset.codigo;
        const destino = inDestino.dataset.codigo;
        const soloIda = tipoVuelo.value === 'ida';

        if (!origen) return mostrarError('Selecciona el origen de la lista de aeropuertos.');
        if (!destino) return mostrarError('Selecciona el destino de la lista de aeropuertos.');
        if (origen === destino) return mostrarError('El origen y el destino deben ser distintos.');
        if (!fIda.value || fIda.value < hoy) return mostrarError('Elige una fecha de ida desde hoy en adelante.');
        if (!soloIda && (!fVuelta.value || fVuelta.value < fIda.value)) return mostrarError('La fecha de vuelta no puede ser anterior a la de ida.');

        const q = new URLSearchParams({ origen, destino, ida: fIda.value, adultos: inAdultos.value, menores: inMenores.value });
        if (!soloIda) q.set('vuelta', fVuelta.value);
        location.href = 'resultados.html?' + q;
    });

    // ------------------------------------------------------------------ precargar desde la URL (?origen=BOG&destino=MDE...)
    const P = AL.params();
    if (P.get('origen')) elegirAeropuerto(inOrigen, P.get('origen').toUpperCase());
    if (P.get('destino')) elegirAeropuerto(inDestino, P.get('destino').toUpperCase());
    if (P.get('ida') && P.get('ida') >= hoy) fIda.value = P.get('ida');
    if (P.has('ida')) {
        const vuelta = P.get('vuelta');
        tipoVuelo.value = vuelta ? 'ida-vuelta' : 'ida';
        if (vuelta && vuelta >= fIda.value) fVuelta.value = vuelta;
        else if (vuelta) fVuelta.value = fIda.value;
    }
    fVuelta.min = fIda.value;
    if (P.get('adultos')) inAdultos.value = P.get('adultos');
    if (P.get('menores')) inMenores.value = P.get('menores');
    actualizarPasajeros();
    aplicarTipoVuelo();

    // ------------------------------------------------------------------ destinos sugeridos
    const DESTINOS = [
        { codigo: 'CTG', texto: 'Playa y ciudad amurallada', icono: 'fa-umbrella-beach' },
        { codigo: 'ADZ', texto: 'El mar de los siete colores', icono: 'fa-water' },
        { codigo: 'MDE', texto: 'La ciudad de la eterna primavera', icono: 'fa-city' },
        { codigo: 'SMR', texto: 'Caribe, sierra y parques', icono: 'fa-mountain-sun' },
        { codigo: 'CLO', texto: 'Capital mundial de la salsa', icono: 'fa-music' },
        { codigo: 'LET', texto: 'Puerta de entrada al Amazonas', icono: 'fa-tree' },
    ];
    $('destinosPopulares').innerHTML = DESTINOS
        .map((d) => ({ ...d, a: aeropuertos.find((x) => x.codigo === d.codigo) }))
        .filter((d) => d.a)
        .map((d) => `
            <button type="button" class="route-card" data-codigo="${d.codigo}">
                <span class="route-card-icon"><i class="fa-solid ${d.icono}"></i></span>
                <span class="route-card-city">${AL.esc(d.a.ciudad)}</span>
                <span class="route-card-text">${AL.esc(d.texto)}</span>
            </button>`).join('');
    $('destinosPopulares').addEventListener('click', (e) => {
        const b = e.target.closest('.route-card');
        if (!b) return;
        elegirAeropuerto(inDestino, b.dataset.codigo);
        if (!inOrigen.dataset.codigo || inOrigen.dataset.codigo === b.dataset.codigo) {
            delete inOrigen.dataset.codigo;
            inOrigen.value = '';
            inOrigen.closest('.trayect-child-container').classList.remove('is-filled');
            inOrigen.focus();
        } else fIda.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // ------------------------------------------------------------------ búsquedas recientes (solo con sesión de cliente)
    const sesion = await sesionPromesa;
    if (sesion && sesion.autenticado && sesion.rol === 'cliente') {
        try {
            const recientes = await AL.api('/cliente/busquedas');
            if (recientes.length) {
                const mapa = Object.fromEntries(aeropuertos.map((a) => [a.codigo, a]));
                $('listaRecientes').innerHTML = recientes.map((r) => {
                    const o = mapa[r.origen] ? mapa[r.origen].ciudad : r.origen;
                    const d = mapa[r.destino] ? mapa[r.destino].ciudad : r.destino;
                    const fechas = AL.fechaDia(r.fecha_ida) + (r.fecha_regreso ? ' – ' + AL.fechaDia(r.fecha_regreso) : '');
                    return `
                        <button type="button" class="recent-item" data-origen="${AL.esc(r.origen)}" data-destino="${AL.esc(r.destino)}"
                                data-ida="${AL.esc(r.fecha_ida)}" data-vuelta="${AL.esc(r.fecha_regreso || '')}" data-pasajeros="${r.pasajeros}">
                            <i class="fa-solid fa-clock-rotate-left"></i>
                            <span><strong>${AL.esc(o)} → ${AL.esc(d)}</strong><small>${AL.esc(fechas)} · ${r.pasajeros} ${r.pasajeros === 1 ? 'pasajero' : 'pasajeros'}</small></span>
                        </button>`;
                }).join('');
                $('busquedasRecientes').hidden = false;
            }
        } catch (_) { /* el historial es opcional */ }
    }
    $('listaRecientes').addEventListener('click', (e) => {
        const b = e.target.closest('.recent-item');
        if (!b) return;
        elegirAeropuerto(inOrigen, b.dataset.origen);
        elegirAeropuerto(inDestino, b.dataset.destino);
        fIda.value = b.dataset.ida >= hoy ? b.dataset.ida : AL.sumarDias(hoy, 7);
        const hayVuelta = !!b.dataset.vuelta;
        tipoVuelo.value = hayVuelta ? 'ida-vuelta' : 'ida';
        fVuelta.min = fIda.value;
        fVuelta.value = hayVuelta && b.dataset.vuelta >= fIda.value ? b.dataset.vuelta : AL.sumarDias(fIda.value, 7);
        inAdultos.value = b.dataset.pasajeros;
        inMenores.value = 0;
        actualizarPasajeros();
        aplicarTipoVuelo();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
})();
