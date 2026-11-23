'use strict';
(async function () {
    const $ = (id) => document.getElementById(id);
    AL.iniciarPagina();

    const P = AL.params();
    const busqueda = {
        origen: (P.get('origen') || '').toUpperCase(),
        destino: (P.get('destino') || '').toUpperCase(),
        ida: P.get('ida') || '',
        vuelta: P.get('vuelta') || '',
        adultos: Math.max(1, parseInt(P.get('adultos'), 10) || 1),
        menores: Math.max(0, parseInt(P.get('menores'), 10) || 0),
    };
    busqueda.total = busqueda.adultos + busqueda.menores;
    const idaVuelta = !!busqueda.vuelta;

    const hoy = AL.hoy();
    const valida =
        /^[A-Z]{3}$/.test(busqueda.origen) && /^[A-Z]{3}$/.test(busqueda.destino) && busqueda.origen !== busqueda.destino &&
        /^\d{4}-\d{2}-\d{2}$/.test(busqueda.ida) && busqueda.total <= 9 &&
        (!idaVuelta || /^\d{4}-\d{2}-\d{2}$/.test(busqueda.vuelta));
    if (!valida) {
        $('tituloRuta').textContent = 'Búsqueda no válida';
        $('vistaResultados').hidden = true;
        $('stepper').hidden = true;
        $('vistaResumen').hidden = false;
        $('vistaResumen').innerHTML = estadoVacio('fa-circle-exclamation', 'No pudimos entender tu búsqueda', 'Vuelve al inicio y elige origen, destino y fechas.', '<a class="btn btn-primary" href="index.html">Nueva búsqueda</a>');
        return;
    }
    if (busqueda.ida < hoy) busqueda.ida = hoy;
    if (idaVuelta && busqueda.vuelta < busqueda.ida) busqueda.vuelta = busqueda.ida;

    let aeropuertos = {};
    try { aeropuertos = await AL.mapaAeropuertos(); } catch (_) { /* se muestran los códigos */ }
    const ciudad = (codigo) => (aeropuertos[codigo] ? aeropuertos[codigo].ciudad : codigo);

    const FRANJAS = [
        { id: 'madrugada', texto: 'Madrugada (00:00 – 05:59)', desde: 0, hasta: 6 },
        { id: 'manana', texto: 'Mañana (06:00 – 11:59)', desde: 6, hasta: 12 },
        { id: 'tarde', texto: 'Tarde (12:00 – 17:59)', desde: 12, hasta: 18 },
        { id: 'noche', texto: 'Noche (18:00 – 23:59)', desde: 18, hasta: 24 },
    ];
    const estado = {
        etapa: 'ida',
        fechas: { ida: busqueda.ida, vuelta: busqueda.vuelta },
        elegido: { ida: null, vuelta: null },
        vuelos: [],
        filtros: { escalas: 'todos', aerolineas: new Set(), franjas: new Set(), precioMax: Infinity },
        precioTope: 0,
        orden: 'precio',
        primeraBusqueda: true,
    };

    const precioDesde = (v) => Math.min(...v.tarifas.map((t) => t.precio));
    const duracionDe = (v) => AL.minutosEntre(v.salida, v.llegada);
    const horaDe = (v) => Number(v.salida.slice(11, 13));
    const totalPor = (t) => t.precio * busqueda.total;

    function estadoVacio(icono, titulo, texto, acciones = '') {
        return `
            <div class="empty-state card">
                <i class="fa-solid ${icono}"></i>
                <h3>${AL.esc(titulo)}</h3>
                <p>${AL.esc(texto)}</p>
                <div class="empty-actions">${acciones}</div>
            </div>`;
    }

    function parametrosModificar() {
        const q = new URLSearchParams({ origen: busqueda.origen, destino: busqueda.destino, ida: busqueda.ida, adultos: busqueda.adultos, menores: busqueda.menores });
        if (idaVuelta) q.set('vuelta', busqueda.vuelta);
        return 'index.html?' + q;
    }

    function pintarEncabezado() {
        const esIda = estado.etapa !== 'vuelta';
        const o = esIda ? busqueda.origen : busqueda.destino;
        const d = esIda ? busqueda.destino : busqueda.origen;
        $('tituloRuta').textContent = estado.etapa === 'resumen'
            ? 'Revisa tu viaje'
            : (esIda ? '' : 'Elige tu vuelo de regreso: ') + `${ciudad(o)} → ${ciudad(d)}`;
        const partes = [`Ida: ${AL.fechaCorta(estado.fechas.ida)}`];
        if (idaVuelta) partes.push(`Vuelta: ${AL.fechaCorta(estado.fechas.vuelta)}`);
        partes.push(AL.textoPasajeros(busqueda.adultos, busqueda.menores));
        $('subtituloBusqueda').innerHTML = `${AL.esc(partes.join(' · '))} · <a class="link-light" href="${AL.esc(parametrosModificar())}">Modificar búsqueda</a>`;
    }

    function pintarPasos() {
        const pasos = idaVuelta
            ? [['ida', 'Vuelo de ida'], ['vuelta', 'Vuelo de vuelta'], ['resumen', 'Resumen']]
            : [['ida', 'Vuelo de ida'], ['resumen', 'Resumen']];
        const indiceActual = pasos.findIndex(([id]) => id === estado.etapa);
        $('stepper').innerHTML = pasos.map(([id, texto], i) => `
            <li class="step${i === indiceActual ? ' active' : ''}${i < indiceActual ? ' done' : ''}">
                <span class="step-num">${i < indiceActual ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>
                <span class="step-text">${texto}</span>
            </li>`).join('');
    }

    function pintarSeleccionPrevia() {
        const cont = $('seleccionPrevia');
        if (estado.etapa !== 'vuelta' || !estado.elegido.ida) {
            cont.innerHTML = '';
            return;
        }
        const { vuelo, tarifa } = estado.elegido.ida;
        cont.innerHTML = `
            <div class="chosen-flight card">
                <div class="chosen-flight-info">
                    <span class="chosen-tag"><i class="fa-solid fa-circle-check"></i> Vuelo de ida elegido</span>
                    <p><strong>${AL.esc(ciudad(vuelo.origen))} → ${AL.esc(ciudad(vuelo.destino))}</strong> · ${AL.fechaCorta(vuelo.salida)} · ${AL.hora(vuelo.salida)} – ${AL.hora(vuelo.llegada)} · ${AL.esc(vuelo.aerolinea)} · Tarifa ${AL.esc(tarifa.nombre_tarifa)}</p>
                </div>
                <button type="button" class="btn btn-outline btn-sm" data-accion="cambiar-ida">Cambiar</button>
            </div>`;
    }

    async function cargarVuelos() {
        const esIda = estado.etapa === 'ida';
        const q = new URLSearchParams({
            origen: esIda ? busqueda.origen : busqueda.destino,
            destino: esIda ? busqueda.destino : busqueda.origen,
            fecha: estado.fechas[estado.etapa],
            pasajeros: busqueda.total,
        });
        if (!esIda) q.set('despues', estado.elegido.ida.vuelo.llegada);
        if (esIda && estado.primeraBusqueda) {
            q.set('registrar', '1');
            if (idaVuelta) q.set('regreso', busqueda.vuelta);
        }
        estado.primeraBusqueda = false;

        pintarEncabezado();
        pintarPasos();
        pintarSeleccionPrevia();
        pintarDia();
        $('contadorResultados').textContent = '';
        $('listaVuelos').innerHTML = '<div class="skeleton skeleton-flight"></div>'.repeat(3);

        try {
            estado.vuelos = await AL.api('/vuelos?' + q);
        } catch (err) {
            $('listaVuelos').innerHTML = estadoVacio('fa-plug-circle-exclamation', 'No pudimos cargar los vuelos', err.message, '<button type="button" class="btn btn-primary" data-accion="reintentar">Reintentar</button>');
            return;
        }
        reiniciarFiltros();
        pintarFiltros();
        pintarLista();
    }

    function limiteMinimo() {
        return estado.etapa === 'vuelta' ? estado.elegido.ida.vuelo.llegada.slice(0, 10) : hoy;
    }
    function pintarDia() {
        const fecha = estado.fechas[estado.etapa];
        $('diaActual').textContent = AL.fechaLarga(fecha);
        const input = $('cambiarFecha');
        input.min = limiteMinimo();
        input.max = AL.sumarDias(hoy, 365);
        input.value = fecha;
        $('diaAnterior').disabled = fecha <= limiteMinimo();
        $('diaSiguiente').disabled = fecha >= input.max;
    }
    function cambiarDia(nueva) {
        if (!nueva || nueva < limiteMinimo()) return;
        estado.fechas[estado.etapa] = nueva;
        if (estado.etapa === 'ida') {
            busqueda.ida = nueva;
            if (idaVuelta && estado.fechas.vuelta < nueva) estado.fechas.vuelta = busqueda.vuelta = nueva;
        } else busqueda.vuelta = nueva;
        cargarVuelos();
    }
    $('diaAnterior').addEventListener('click', () => cambiarDia(AL.sumarDias(estado.fechas[estado.etapa], -1)));
    $('diaSiguiente').addEventListener('click', () => cambiarDia(AL.sumarDias(estado.fechas[estado.etapa], 1)));
    $('cambiarFecha').addEventListener('change', (e) => cambiarDia(e.target.value));

    function reiniciarFiltros() {
        const precios = estado.vuelos.map(precioDesde);
        estado.precioTope = precios.length ? Math.ceil(Math.max(...precios) / 1000) * 1000 : 0;
        estado.filtros = { escalas: 'todos', aerolineas: new Set(), franjas: new Set(), precioMax: estado.precioTope };
    }

    function pintarFiltros() {
        const cuerpo = $('filtrosCuerpo');
        if (!estado.vuelos.length) {
            cuerpo.innerHTML = '<p class="muted">No hay filtros para mostrar.</p>';
            return;
        }
        const f = estado.filtros;
        const aerolineas = new Map();
        estado.vuelos.forEach((v) => {
            const a = aerolineas.get(v.id_aerolinea) || { nombre: v.aerolinea, n: 0 };
            a.n++;
            aerolineas.set(v.id_aerolinea, a);
        });
        const precios = estado.vuelos.map(precioDesde);
        const minimo = Math.floor(Math.min(...precios) / 1000) * 1000;
        const opcionesEscalas = [['todos', 'Todos'], ['0', 'Directos'], ['1', '1 escala'], ['2', '2 o más escalas']];

        cuerpo.innerHTML = `
            <div class="filter-group">
                <p class="filter-title">Escalas</p>
                ${opcionesEscalas.map(([v, t]) => `
                    <label class="check-row"><input type="radio" name="escalas" value="${v}" ${f.escalas === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
            </div>
            <div class="filter-group">
                <p class="filter-title">Aerolíneas</p>
                ${[...aerolineas].map(([id, a]) => `
                    <label class="check-row"><input type="checkbox" name="aerolinea" value="${AL.esc(id)}" ${f.aerolineas.has(id) ? 'checked' : ''}><span>${AL.esc(a.nombre)} <small>(${a.n})</small></span></label>`).join('')}
            </div>
            <div class="filter-group">
                <p class="filter-title">Horario de salida</p>
                ${FRANJAS.map((fr) => `
                    <label class="check-row"><input type="checkbox" name="franja" value="${fr.id}" ${f.franjas.has(fr.id) ? 'checked' : ''}><span>${fr.texto}</span></label>`).join('')}
            </div>
            <div class="filter-group">
                <p class="filter-title">Precio máximo por persona</p>
                <input type="range" class="range" name="precio" min="${minimo}" max="${estado.precioTope}" step="1000" value="${f.precioMax}" ${minimo === estado.precioTope ? 'disabled' : ''}>
                <p class="range-value" id="valorPrecio">${AL.dinero(f.precioMax)}</p>
            </div>
            <button type="button" class="btn btn-outline btn-sm btn-block" data-accion="limpiar-filtros">Limpiar filtros</button>`;
    }

    $('filtrosCuerpo').addEventListener('input', (e) => {
        if (e.target.name === 'precio') {
            estado.filtros.precioMax = Number(e.target.value);
            $('valorPrecio').textContent = AL.dinero(estado.filtros.precioMax);
            pintarLista();
        }
    });
    $('filtrosCuerpo').addEventListener('change', (e) => {
        const f = estado.filtros;
        const { name, value, checked } = e.target;
        if (name === 'escalas') f.escalas = value;
        else if (name === 'aerolinea') checked ? f.aerolineas.add(value) : f.aerolineas.delete(value);
        else if (name === 'franja') checked ? f.franjas.add(value) : f.franjas.delete(value);
        pintarLista();
    });
    $('filtrosCuerpo').addEventListener('click', (e) => {
        if (e.target.closest('[data-accion="limpiar-filtros"]')) {
            reiniciarFiltros();
            pintarFiltros();
            pintarLista();
        }
    });
    $('orden').addEventListener('change', (e) => {
        estado.orden = e.target.value;
        pintarLista();
    });

    function vuelosFiltrados() {
        const f = estado.filtros;
        const lista = estado.vuelos.filter((v) => {
            if (f.escalas !== 'todos') {
                const n = Number(f.escalas);
                if (n >= 2 ? v.escalas < 2 : v.escalas !== n) return false;
            }
            if (f.aerolineas.size && !f.aerolineas.has(v.id_aerolinea)) return false;
            if (f.franjas.size) {
                const h = horaDe(v);
                if (![...f.franjas].some((id) => { const fr = FRANJAS.find((x) => x.id === id); return h >= fr.desde && h < fr.hasta; })) return false;
            }
            return precioDesde(v) <= f.precioMax;
        });
        const orden = {
            precio: (a, b) => precioDesde(a) - precioDesde(b) || a.salida.localeCompare(b.salida),
            duracion: (a, b) => duracionDe(a) - duracionDe(b) || precioDesde(a) - precioDesde(b),
            salida: (a, b) => a.salida.localeCompare(b.salida),
        };
        return lista.sort(orden[estado.orden]);
    }

    const CARACTERISTICAS = (t) => [
        [true, `Equipaje de mano ${t.equipaje_mano_kg} kg`],
        [t.equipaje_bodega_kg > 0, t.equipaje_bodega_kg > 0 ? `Equipaje de bodega ${t.equipaje_bodega_kg} kg` : 'Sin equipaje de bodega'],
        [t.permite_cambios, t.permite_cambios ? 'Permite cambios' : 'No permite cambios'],
        [t.reembolsable, t.reembolsable ? 'Reembolsable' : 'No reembolsable'],
    ];

    function itinerario(v) {
        if (!v.segmentos || !v.segmentos.length) return '';
        const filas = v.segmentos.map((s, i) => {
            const espera = i > 0 ? AL.minutosEntre(v.segmentos[i - 1].llegada, s.salida) : 0;
            return `
                ${i > 0 ? `<li class="layover"><i class="fa-solid fa-hourglass-half"></i> Escala en ${AL.esc(ciudad(s.salida_aeropuerto))} · espera de ${AL.duracion(espera)}</li>` : ''}
                <li class="segment">
                    <span class="segment-time">${AL.hora(s.salida)}</span>
                    <span class="segment-place">${AL.esc(ciudad(s.salida_aeropuerto))} <small>${AL.esc(s.salida_aeropuerto)}</small></span>
                    <span class="segment-arrow"><i class="fa-solid fa-plane"></i> ${AL.duracion(AL.minutosEntre(s.salida, s.llegada))}</span>
                    <span class="segment-time">${AL.hora(s.llegada)}</span>
                    <span class="segment-place">${AL.esc(ciudad(s.llegada_aeropuerto))} <small>${AL.esc(s.llegada_aeropuerto)}</small></span>
                </li>`;
        }).join('');
        return `<ul class="itinerary">${filas}</ul>`;
    }

    function tarjetaVuelo(v, etiquetas) {
        const min = duracionDe(v);
        const paradas = v.escalas > 0 && v.segmentos && v.segmentos.length > 1
            ? v.segmentos.slice(0, -1).map((s) => AL.esc(s.llegada_aeropuerto)).join(', ')
            : '';
        const puntos = Array.from({ length: Math.min(v.escalas, 3) }, (_, i) => `<span class="flight-line-dot" style="left:${((i + 1) * 100) / (Math.min(v.escalas, 3) + 1)}%"></span>`).join('');
        const llegaOtroDia = v.llegada.slice(0, 10) > v.salida.slice(0, 10) ? '<sup class="plus-day">+1</sup>' : '';
        return `
            <article class="flight-card" data-vuelo="${v.id_vuelo}">
                <div class="flight-card-main">
                    <div class="flight-airline">
                        <span class="flight-airline-badge">${AL.esc(v.aerolinea_iata)}</span>
                        <div>
                            <p class="flight-airline-name">${AL.esc(v.aerolinea)}</p>
                            <p class="flight-airline-code">Vuelo ${AL.esc(v.codigo_vuelo)}</p>
                            ${etiquetas.map((t) => `<span class="flight-tag">${t}</span>`).join('')}
                        </div>
                    </div>
                    <div class="flight-route">
                        <div class="flight-point">
                            <p class="flight-time">${AL.hora(v.salida)}</p>
                            <p class="flight-airport">${AL.esc(v.origen)}</p>
                        </div>
                        <div class="flight-path">
                            <p class="flight-duration">${AL.duracion(min)}</p>
                            <div class="flight-line">${puntos}</div>
                            <p class="flight-stops ${v.escalas === 0 ? 'direct' : ''}">${AL.textoEscalas(v.escalas)}${paradas ? ' · ' + paradas : ''}</p>
                        </div>
                        <div class="flight-point">
                            <p class="flight-time">${AL.hora(v.llegada)}${llegaOtroDia}</p>
                            <p class="flight-airport">${AL.esc(v.destino)}</p>
                        </div>
                    </div>
                    <div class="flight-price">
                        <p class="flight-price-label">desde</p>
                        <p class="flight-price-value">${AL.dinero(precioDesde(v))}</p>
                        <p class="flight-price-note">por persona${busqueda.total > 1 ? ` · ${AL.dinero(precioDesde(v) * busqueda.total)} total` : ''}</p>
                        <button type="button" class="btn btn-primary btn-sm" data-accion="tarifas" aria-expanded="false">Ver tarifas <i class="fa-solid fa-chevron-down"></i></button>
                    </div>
                </div>
                <div class="flight-card-detail" hidden>
                    ${itinerario(v)}
                    <div class="fare-grid">
                        ${v.tarifas.map((t) => `
                            <div class="fare-card">
                                <p class="fare-class">${AL.esc(AL.CABINAS[t.clase_cabina] || t.clase_cabina)}</p>
                                <p class="fare-name">${AL.esc(t.nombre_tarifa)}</p>
                                <ul class="fare-features">
                                    ${CARACTERISTICAS(t).map(([ok, txt]) => `<li class="${ok ? 'ok' : 'no'}"><i class="fa-solid ${ok ? 'fa-check' : 'fa-xmark'}"></i>${AL.esc(txt)}</li>`).join('')}
                                </ul>
                                ${t.cupos <= 9 ? `<p class="fare-scarcity"><i class="fa-solid fa-fire"></i> ${t.cupos === 1 ? 'Queda 1 cupo' : `Quedan ${t.cupos} cupos`}</p>` : ''}
                                <p class="fare-price">${AL.dinero(t.precio)}<small> por persona</small></p>
                                ${busqueda.total > 1 ? `<p class="fare-total">Total ${busqueda.total} pasajeros: <strong>${AL.dinero(totalPor(t))}</strong></p>` : ''}
                                <button type="button" class="btn btn-primary btn-block" data-accion="elegir" data-vuelo="${v.id_vuelo}" data-tarifa="${t.id_tarifa}">Elegir esta tarifa</button>
                            </div>`).join('')}
                    </div>
                </div>
            </article>`;
    }

    function pintarLista() {
        const lista = vuelosFiltrados();
        const total = estado.vuelos.length;
        const esIda = estado.etapa !== 'vuelta';
        $('contadorResultados').textContent = total
            ? `${lista.length} ${lista.length === 1 ? 'vuelo' : 'vuelos'}${lista.length !== total ? ` de ${total}` : ''} para el ${AL.fechaLarga(estado.fechas[estado.etapa]).toLowerCase()}`
            : '';

        if (!total) {
            $('listaVuelos').innerHTML = estadoVacio(
                'fa-plane-circle-xmark',
                esIda ? 'No encontramos vuelos para ese día' : 'No encontramos vuelos de regreso para ese día',
                'Prueba con el día anterior o el siguiente, o cambia la fecha desde el calendario. También revisa que haya cupos para todos tus pasajeros.',
                `<button type="button" class="btn btn-outline" data-accion="dia-anterior-vacio">Día anterior</button>
                 <button type="button" class="btn btn-primary" data-accion="dia-siguiente-vacio">Día siguiente</button>`
            );
            return;
        }
        if (!lista.length) {
            $('listaVuelos').innerHTML = estadoVacio('fa-filter-circle-xmark', 'Ningún vuelo cumple tus filtros', 'Quita algún filtro para ver más opciones.', '<button type="button" class="btn btn-primary" data-accion="limpiar-filtros">Limpiar filtros</button>');
            return;
        }
        const masBarato = lista.reduce((a, b) => (precioDesde(b) < precioDesde(a) ? b : a));
        const masRapido = lista.reduce((a, b) => (duracionDe(b) < duracionDe(a) ? b : a));
        $('listaVuelos').innerHTML = lista.map((v) => {
            const etiquetas = [];
            if (lista.length > 1 && v === masBarato) etiquetas.push('<i class="fa-solid fa-tag"></i> Más barato');
            if (lista.length > 1 && v === masRapido && duracionDe(masRapido) < Math.max(...lista.map(duracionDe))) etiquetas.push('<i class="fa-solid fa-bolt"></i> Más rápido');
            return tarjetaVuelo(v, etiquetas);
        }).join('');
    }

    function elegir(idVuelo, idTarifa) {
        const vuelo = estado.vuelos.find((v) => v.id_vuelo === idVuelo);
        const tarifa = vuelo && vuelo.tarifas.find((t) => t.id_tarifa === idTarifa);
        if (!vuelo || !tarifa) return;

        if (estado.etapa === 'ida') {
            estado.elegido.ida = { vuelo, tarifa };
            estado.elegido.vuelta = null;
            if (idaVuelta) {
                estado.etapa = 'vuelta';
                // la vuelta no puede salir antes de la llegada de la ida
                const dia = vuelo.llegada.slice(0, 10);
                if (estado.fechas.vuelta < dia) estado.fechas.vuelta = dia;
                window.scrollTo({ top: 0, behavior: 'smooth' });
                cargarVuelos();
                return;
            }
        } else estado.elegido.vuelta = { vuelo, tarifa };
        irAResumen();
    }

    function irAResumen() {
        estado.etapa = 'resumen';
        $('vistaResultados').hidden = true;
        $('seleccionPrevia').innerHTML = '';
        pintarEncabezado();
        pintarPasos();
        const tramos = [['Vuelo de ida', estado.elegido.ida], ...(idaVuelta ? [['Vuelo de vuelta', estado.elegido.vuelta]] : [])];
        const total = tramos.reduce((s, [, e]) => s + totalPor(e.tarifa), 0);

        $('vistaResumen').hidden = false;
        $('vistaResumen').innerHTML = `
            <div class="summary-layout">
                <div class="summary-flights">
                    ${tramos.map(([titulo, e], i) => `
                        <article class="card summary-leg">
                            <div class="summary-leg-head">
                                <span class="summary-leg-title">${titulo}</span>
                                <button type="button" class="btn btn-ghost btn-sm" data-accion="${i === 0 ? 'cambiar-ida' : 'cambiar-vuelta'}">Cambiar</button>
                            </div>
                            <div class="summary-leg-route">
                                <div><p class="flight-time">${AL.hora(e.vuelo.salida)}</p><p class="flight-airport">${AL.esc(ciudad(e.vuelo.origen))} (${AL.esc(e.vuelo.origen)})</p></div>
                                <div class="summary-leg-mid"><i class="fa-solid fa-plane"></i><small>${AL.duracion(duracionDe(e.vuelo))} · ${AL.textoEscalas(e.vuelo.escalas)}</small></div>
                                <div><p class="flight-time">${AL.hora(e.vuelo.llegada)}</p><p class="flight-airport">${AL.esc(ciudad(e.vuelo.destino))} (${AL.esc(e.vuelo.destino)})</p></div>
                            </div>
                            <p class="summary-leg-meta">${AL.fechaLarga(e.vuelo.salida)} · ${AL.esc(e.vuelo.aerolinea)} · vuelo ${AL.esc(e.vuelo.codigo_vuelo)}</p>
                            <p class="summary-leg-meta"><strong>${AL.esc(AL.CABINAS[e.tarifa.clase_cabina] || '')} · ${AL.esc(e.tarifa.nombre_tarifa)}</strong> —
                                ${e.tarifa.equipaje_bodega_kg > 0 ? `maleta de ${e.tarifa.equipaje_bodega_kg} kg` : 'sin maleta de bodega'}, ${e.tarifa.permite_cambios ? 'con cambios' : 'sin cambios'}, ${e.tarifa.reembolsable ? 'reembolsable' : 'no reembolsable'}</p>
                        </article>`).join('')}
                </div>
                <aside class="card summary-total">
                    <h3 class="card-title">Total de tu viaje</h3>
                    ${tramos.map(([titulo, e]) => `
                        <div class="price-row"><span>${titulo} · ${busqueda.total} × ${AL.dinero(e.tarifa.precio)}</span><strong>${AL.dinero(totalPor(e.tarifa))}</strong></div>`).join('')}
                    <div class="price-row price-total"><span>Total</span><strong>${AL.dinero(total)}</strong></div>
                    <p class="muted small">${AL.textoPasajeros(busqueda.adultos, busqueda.menores)}. Precio final en pesos colombianos.</p>
                    <button type="button" class="btn btn-primary btn-block" data-accion="continuar">Continuar con la reserva <i class="fa-solid fa-arrow-right"></i></button>
                </aside>
            </div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function continuar() {
        AL.guardarSeleccion({
            tarifas: [estado.elegido.ida.tarifa.id_tarifa, ...(idaVuelta ? [estado.elegido.vuelta.tarifa.id_tarifa] : [])],
            adultos: busqueda.adultos,
            menores: busqueda.menores,
            origen: busqueda.origen,
            destino: busqueda.destino,
        });
        location.href = 'reservar.html';
    }

    function volverA(etapa) {
        estado.etapa = etapa;
        $('vistaResumen').hidden = true;
        $('vistaResultados').hidden = false;
        if (etapa === 'ida') estado.elegido.vuelta = null;
        cargarVuelos();
    }

    document.querySelector('.page-container').addEventListener('click', (e) => {
        const b = e.target.closest('[data-accion]');
        if (!b) return;
        switch (b.dataset.accion) {
            case 'tarifas': {
                const detalle = b.closest('.flight-card').querySelector('.flight-card-detail');
                const abrir = detalle.hidden;
                detalle.hidden = !abrir;
                b.setAttribute('aria-expanded', String(abrir));
                b.classList.toggle('is-open', abrir);
                break;
            }
            case 'elegir': elegir(Number(b.dataset.vuelo), Number(b.dataset.tarifa)); break;
            case 'continuar': continuar(); break;
            case 'cambiar-ida': volverA('ida'); break;
            case 'cambiar-vuelta': volverA('vuelta'); break;
            case 'reintentar': cargarVuelos(); break;
            case 'limpiar-filtros': reiniciarFiltros(); pintarFiltros(); pintarLista(); break;
            case 'dia-anterior-vacio': $('diaAnterior').click(); break;
            case 'dia-siguiente-vacio': $('diaSiguiente').click(); break;
        }
    });

    if (window.matchMedia('(min-width: 900px)').matches) $('filtros').open = true;

    cargarVuelos();
})();
