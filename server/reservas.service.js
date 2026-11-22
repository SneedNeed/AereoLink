'use strict';
// Lógica de reservas: crear, consultar, pagar (simulado), cancelar y expirar.
const crypto = require('crypto');
const { query, tx } = require('./db');
const config = require('./config');
const { HttpError, bad } = require('./util');
const { validarPasajero, hoy } = require('./validators');
const { ciudadVisible } = require('./ciudades');

const TS = (col) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
const AHORA_LOCAL = 'CURRENT_TIMESTAMP::timestamp'; // la sesión usa hora de Colombia (ver db.js)

const METODOS_PAGO = ['TARJETA_CREDITO', 'TARJETA_DEBITO', 'PSE', 'TRANSFERENCIA'];

// ---------------------------------------------------------------- asientos
const LETRAS = 'ABCDEF';
const asientoDeIndice = (i) => `${Math.floor(i / 6) + 1}${LETRAS[i % 6]}`;
const indiceDeAsiento = (s) => {
    const m = /^(\d+)([A-F])$/.exec(s || '');
    return m ? (Number(m[1]) - 1) * 6 + LETRAS.indexOf(m[2]) : -1;
};

function generarCodigo() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'AL';
    for (let i = 0; i < 8; i++) s += alfabeto[crypto.randomInt(alfabeto.length)];
    return s; // 10 caracteres (la columna admite 12)
}

// ---------------------------------------------------------------- cupos
/** Devuelve los cupos de una reserva y cambia su estado (CANCELADA / EXPIRADA). */
async function liberarYCambiarEstado(c, idReserva, nuevoEstado, observacion) {
    await c.query(
        `UPDATE vuelo v
            SET cupos_disponibles = LEAST(v.capacidad_total, v.cupos_disponibles + x.n)
           FROM (SELECT t.id_vuelo, COUNT(*)::int AS n
                   FROM detalle_reserva d JOIN tarifa t ON t.id_tarifa = d.id_tarifa
                  WHERE d.id_reserva = $1 GROUP BY t.id_vuelo) x
          WHERE v.id_vuelo = x.id_vuelo`,
        [idReserva]
    );
    await c.query(
        `UPDATE tarifa t
            SET cupos_tarifa = t.cupos_tarifa + x.n
           FROM (SELECT d.id_tarifa, COUNT(*)::int AS n
                   FROM detalle_reserva d WHERE d.id_reserva = $1 GROUP BY d.id_tarifa) x
          WHERE t.id_tarifa = x.id_tarifa`,
        [idReserva]
    );
    await c.query(
        `UPDATE reserva SET estado_reserva = $2, observaciones = COALESCE($3, observaciones) WHERE id_reserva = $1`,
        [idReserva, nuevoEstado, observacion || null]
    );
}

/** Las reservas PENDIENTES sin pagar después de N minutos pasan a EXPIRADA y liberan sus cupos. */
async function expirarPendientes() {
    await tx(async (c) => {
        const { rows } = await c.query(
            `SELECT id_reserva FROM reserva
              WHERE estado_reserva = 'PENDIENTE'
                AND fecha_reserva < ${AHORA_LOCAL} - ($1::int * INTERVAL '1 minute')
              ORDER BY id_reserva FOR UPDATE SKIP LOCKED`,
            [config.minutosParaPagar]
        );
        for (const r of rows) {
            await liberarYCambiarEstado(c, r.id_reserva, 'EXPIRADA', 'Expirada por falta de pago');
        }
    });
}

// ---------------------------------------------------------------- crear
async function crearReserva(idCliente, body) {
    const idsTarifa = Array.isArray(body.tarifas) ? body.tarifas.map(Number) : [];
    if (idsTarifa.length < 1 || idsTarifa.length > 2 || idsTarifa.some((n) => !Number.isInteger(n) || n <= 0) || new Set(idsTarifa).size !== idsTarifa.length) {
        throw bad('Selecciona el vuelo de ida (y el de vuelta si viajas ida y vuelta).');
    }
    const entrada = Array.isArray(body.pasajeros) ? body.pasajeros : [];
    if (entrada.length < 1 || entrada.length > 9) throw bad('Debes registrar entre 1 y 9 pasajeros.');

    await expirarPendientes();

    return tx(async (c) => {
        // 1) Vuelos y tarifas elegidos (se bloquean para evitar sobreventa)
        const { rows: filas } = await c.query(
            `SELECT t.id_tarifa, t.id_vuelo, t.precio_tarifa::float8 AS precio, t.equipaje_bodega_kg::float8 AS bodega,
                    t.cupos_tarifa, v.aeropuerto_origen, v.aeropuerto_destino, v.estado, v.cupos_disponibles,
                    ${TS('v.fecha_salida')} AS salida, ${TS('v.fecha_llegada')} AS llegada,
                    to_char(v.fecha_salida, 'YYYY-MM-DD') AS dia_salida,
                    (v.fecha_salida > ${AHORA_LOCAL}) AS futuro, al.estado AS aerolinea_estado
               FROM tarifa t
               JOIN vuelo v ON v.id_vuelo = t.id_vuelo
               JOIN aerolinea al ON al.id_aerolinea = v.id_aerolinea
              WHERE t.id_tarifa = ANY($1::int[])
              ORDER BY v.id_vuelo, t.id_tarifa
                FOR UPDATE OF t, v`,
            [idsTarifa]
        );
        if (filas.length !== idsTarifa.length) throw bad('Una de las tarifas seleccionadas ya no existe.');
        const legs = idsTarifa.map((id) => filas.find((f) => f.id_tarifa === id)); // [ida, vuelta?]
        const n = entrada.length;

        for (const l of legs) {
            if (!['PROGRAMADO', 'RETRASADO'].includes(l.estado) || l.aerolinea_estado !== 'Y' || !l.futuro) {
                throw new HttpError(409, `El vuelo ${l.aeropuerto_origen} → ${l.aeropuerto_destino} ya no está disponible.`);
            }
            if (l.cupos_disponibles < n || l.cupos_tarifa < n) {
                throw new HttpError(409, `No hay cupos suficientes en el vuelo ${l.aeropuerto_origen} → ${l.aeropuerto_destino}.`);
            }
        }
        if (legs.length === 2) {
            const [ida, vuelta] = legs;
            if (vuelta.aeropuerto_origen !== ida.aeropuerto_destino || vuelta.aeropuerto_destino !== ida.aeropuerto_origen) {
                throw bad('El vuelo de vuelta debe ser el trayecto inverso al de ida.');
            }
            if (vuelta.salida <= ida.llegada) throw bad('El vuelo de vuelta debe salir después de la llegada del vuelo de ida.');
        }
        const fechaRef = legs[0].dia_salida;

        // 2) Pasajeros (guardados o nuevos)
        const idsGuardados = entrada.filter((p) => p.id_pasajero).map((p) => Number(p.id_pasajero));
        let guardados = [];
        if (idsGuardados.length) {
            const r = await c.query(
                `SELECT id_pasajero, tipo_documento, numero_documento, nombre_completo, nacionalidad,
                        to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento
                   FROM pasajero WHERE id_cliente = $1 AND id_pasajero = ANY($2::int[])`,
                [idCliente, idsGuardados]
            );
            guardados = r.rows;
            if (guardados.length !== new Set(idsGuardados).size) throw bad('Uno de los pasajeros guardados no existe.');
        }
        const minBodega = Math.min(...legs.map((l) => l.bodega));
        const pasajeros = entrada.map((p, i) => {
            const base = p.id_pasajero ? guardados.find((g) => g.id_pasajero === Number(p.id_pasajero)) : p;
            let datos;
            try {
                datos = validarPasajero(base, fechaRef);
            } catch (e) {
                if (e.campos) e.message = `Pasajero ${i + 1}: ${Object.values(e.campos)[0]}`;
                throw e;
            }
            const kg = Number(p.equipaje_kg || 0);
            if (!Number.isFinite(kg) || kg < 0 || kg > minBodega) {
                throw bad(minBodega > 0
                    ? `Pasajero ${i + 1}: el equipaje de bodega no puede superar ${minBodega} kg.`
                    : `Pasajero ${i + 1}: tu tarifa no incluye equipaje de bodega.`);
            }
            const desc = typeof p.descripcion_equipaje === 'string' ? p.descripcion_equipaje.trim().slice(0, 200) : '';
            return { ...datos, id_pasajero: p.id_pasajero ? Number(p.id_pasajero) : null, kg, desc: desc || null };
        });
        const claves = new Set(pasajeros.map((p) => `${p.tipo_documento}|${p.numero_documento}`));
        if (claves.size !== pasajeros.length) throw bad('Hay pasajeros repetidos (mismo documento).');
        if (!pasajeros.some((p) => p.edad >= 18)) throw bad('Debe viajar al menos un adulto (mayor de 18 años).');

        // 3) Crear/actualizar pasajeros en la base de datos
        for (const p of pasajeros) {
            if (p.id_pasajero) continue;
            const r = await c.query(
                `INSERT INTO pasajero (id_cliente, tipo_documento, numero_documento, nombre_completo, fecha_nacimiento, nacionalidad)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id_cliente, tipo_documento, numero_documento)
                 DO UPDATE SET nombre_completo = EXCLUDED.nombre_completo,
                               fecha_nacimiento = EXCLUDED.fecha_nacimiento,
                               nacionalidad = EXCLUDED.nacionalidad
                 RETURNING id_pasajero`,
                [idCliente, p.tipo_documento, p.numero_documento, p.nombre_completo, p.fecha_nacimiento, p.nacionalidad]
            );
            p.id_pasajero = r.rows[0].id_pasajero;
        }

        // 4) Reserva
        let codigo;
        do {
            codigo = generarCodigo();
        } while ((await c.query('SELECT 1 FROM reserva WHERE codigo_reserva = $1', [codigo])).rowCount);
        const { rows: [reserva] } = await c.query(
            `INSERT INTO reserva (codigo_reserva, id_cliente, estado_reserva, monto_total)
             VALUES ($1, $2, 'PENDIENTE', 0) RETURNING id_reserva`,
            [codigo, idCliente]
        );

        // 5) Detalle por vuelo y pasajero, con asiento asignado
        let total = 0;
        for (const l of legs) {
            const { rows: ocupados } = await c.query(
                `SELECT d.asiento_asignado FROM detalle_reserva d
                   JOIN tarifa t ON t.id_tarifa = d.id_tarifa
                   JOIN reserva r ON r.id_reserva = d.id_reserva
                  WHERE t.id_vuelo = $1 AND r.estado_reserva IN ('PENDIENTE', 'CONFIRMADA') AND d.asiento_asignado IS NOT NULL`,
                [l.id_vuelo]
            );
            const tomados = new Set(ocupados.map((o) => indiceDeAsiento(o.asiento_asignado)));
            let libre = 0;
            for (const p of pasajeros) {
                while (tomados.has(libre)) libre++;
                tomados.add(libre);
                await c.query(
                    `INSERT INTO detalle_reserva (id_reserva, id_tarifa, id_pasajero, asiento_asignado, peso_equipaje_kg, descripcion_equipaje, precio_pagado)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [reserva.id_reserva, l.id_tarifa, p.id_pasajero, asientoDeIndice(libre), p.kg, p.desc, l.precio]
                );
                total += l.precio;
            }
            const v = await c.query(
                'UPDATE vuelo SET cupos_disponibles = cupos_disponibles - $2 WHERE id_vuelo = $1 AND cupos_disponibles >= $2',
                [l.id_vuelo, n]
            );
            const t = await c.query(
                'UPDATE tarifa SET cupos_tarifa = cupos_tarifa - $2 WHERE id_tarifa = $1 AND cupos_tarifa >= $2',
                [l.id_tarifa, n]
            );
            if (!v.rowCount || !t.rowCount) throw new HttpError(409, 'Ya no hay cupos disponibles en uno de los vuelos.');
        }
        await c.query('UPDATE reserva SET monto_total = $2 WHERE id_reserva = $1', [reserva.id_reserva, total]);

        return { id_reserva: reserva.id_reserva, codigo_reserva: codigo, monto_total: total };
    });
}

// ---------------------------------------------------------------- consultar
/** Arma el detalle completo (vuelos, tarifas, segmentos y pasajeros) de una o varias reservas. */
async function detalleReservas(ids) {
    if (!ids.length) return [];
    const { rows: cab } = await query(
        `SELECT r.id_reserva, r.codigo_reserva, r.id_cliente, ${TS('r.fecha_reserva')} AS fecha_reserva,
                r.estado_reserva AS estado, r.monto_total::float8 AS monto_total, r.observaciones,
                c.nombre_completo AS cliente, c.correo,
                CASE WHEN r.estado_reserva = 'PENDIENTE'
                     THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (r.fecha_reserva + ($2::int * INTERVAL '1 minute') - ${AHORA_LOCAL})) / 60))::int
                     ELSE NULL END AS minutos_para_pagar
           FROM reserva r JOIN cliente c ON c.id_cliente = r.id_cliente
          WHERE r.id_reserva = ANY($1::int[])`,
        [ids, config.minutosParaPagar]
    );
    const { rows: det } = await query(
        `SELECT d.id_reserva, d.id_detalle, d.asiento_asignado AS asiento, d.peso_equipaje_kg::float8 AS equipaje_kg,
                d.descripcion_equipaje, d.precio_pagado::float8 AS precio,
                p.id_pasajero, p.nombre_completo AS pasajero, p.tipo_documento, p.numero_documento, p.nacionalidad,
                to_char(p.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
                t.id_tarifa, t.clase_cabina, t.nombre_tarifa, t.equipaje_mano_kg::float8 AS equipaje_mano_kg,
                t.equipaje_bodega_kg::float8 AS equipaje_bodega_kg, t.permite_cambios, t.reembolsable,
                v.id_vuelo, v.codigo_vuelo, v.aeropuerto_origen AS origen, v.aeropuerto_destino AS destino,
                ${TS('v.fecha_salida')} AS salida, ${TS('v.fecha_llegada')} AS llegada,
                v.cantidad_escalas AS escalas, v.estado AS estado_vuelo,
                al.nombre AS aerolinea, al.codigo_iata AS aerolinea_iata,
                co.nombre AS origen_ciudad, cd.nombre AS destino_ciudad
           FROM detalle_reserva d
           JOIN pasajero p ON p.id_pasajero = d.id_pasajero
           JOIN tarifa t ON t.id_tarifa = d.id_tarifa
           JOIN vuelo v ON v.id_vuelo = t.id_vuelo
           JOIN aerolinea al ON al.id_aerolinea = v.id_aerolinea
           JOIN aeropuerto ao ON ao.codigo_iata = v.aeropuerto_origen
           JOIN ciudad co ON co.id_ciudad = ao.id_ciudad
           JOIN aeropuerto ad ON ad.codigo_iata = v.aeropuerto_destino
           JOIN ciudad cd ON cd.id_ciudad = ad.id_ciudad
          WHERE d.id_reserva = ANY($1::int[])
          ORDER BY d.id_reserva, v.fecha_salida, d.id_detalle`,
        [ids]
    );
    const idsVuelo = [...new Set(det.map((d) => d.id_vuelo))];
    const { rows: segs } = idsVuelo.length
        ? await query(
              `SELECT s.id_vuelo, s.orden_segmento AS orden, s.aeropuerto_salida AS salida_aeropuerto,
                      s.aeropuerto_llegada AS llegada_aeropuerto, ${TS('s.fecha_salida_seg')} AS salida,
                      ${TS('s.fecha_llegada_seg')} AS llegada, s.tiempo_escala_min AS espera_min
                 FROM segmento_vuelo s WHERE s.id_vuelo = ANY($1::int[]) ORDER BY s.id_vuelo, s.orden_segmento`,
              [idsVuelo]
          )
        : { rows: [] };

    return cab.map((r) => {
        const filas = det.filter((d) => d.id_reserva === r.id_reserva);
        const vuelos = [];
        for (const d of filas) {
            let v = vuelos.find((x) => x.id_vuelo === d.id_vuelo);
            if (!v) {
                v = {
                    id_vuelo: d.id_vuelo, codigo_vuelo: d.codigo_vuelo, origen: d.origen, destino: d.destino,
                    origen_ciudad: ciudadVisible(d.origen, d.origen_ciudad), destino_ciudad: ciudadVisible(d.destino, d.destino_ciudad),
                    salida: d.salida, llegada: d.llegada,
                    escalas: d.escalas, estado_vuelo: d.estado_vuelo, aerolinea: d.aerolinea, aerolinea_iata: d.aerolinea_iata,
                    tarifa: {
                        id_tarifa: d.id_tarifa, clase_cabina: d.clase_cabina, nombre_tarifa: d.nombre_tarifa,
                        equipaje_mano_kg: d.equipaje_mano_kg, equipaje_bodega_kg: d.equipaje_bodega_kg,
                        permite_cambios: d.permite_cambios, reembolsable: d.reembolsable,
                    },
                    segmentos: segs.filter((s) => s.id_vuelo === d.id_vuelo).map(({ id_vuelo, ...resto }) => resto),
                    pasajeros: [],
                };
                vuelos.push(v);
            }
            v.pasajeros.push({
                id_pasajero: d.id_pasajero, nombre: d.pasajero, tipo_documento: d.tipo_documento,
                numero_documento: d.numero_documento, nacionalidad: d.nacionalidad, fecha_nacimiento: d.fecha_nacimiento,
                asiento: d.asiento, equipaje_kg: d.equipaje_kg, descripcion_equipaje: d.descripcion_equipaje, precio: d.precio,
            });
        }
        return { ...r, vuelos, n_pasajeros: vuelos[0] ? vuelos[0].pasajeros.length : 0 };
    });
}

async function obtenerReserva(idReserva, idCliente) {
    await expirarPendientes();
    const { rows } = await query(
        'SELECT id_reserva FROM reserva WHERE id_reserva = $1 AND ($2::int IS NULL OR id_cliente = $2::int)',
        [idReserva, idCliente || null]
    );
    if (!rows.length) throw new HttpError(404, 'No encontramos esa reserva.');
    return (await detalleReservas([idReserva]))[0];
}

async function listarReservasCliente(idCliente) {
    await expirarPendientes();
    const { rows } = await query(
        'SELECT id_reserva FROM reserva WHERE id_cliente = $1 ORDER BY fecha_reserva DESC, id_reserva DESC LIMIT 100',
        [idCliente]
    );
    const detalle = await detalleReservas(rows.map((r) => r.id_reserva));
    // detalleReservas no garantiza orden: se reordena igual que la consulta
    return rows.map((r) => detalle.find((d) => d.id_reserva === r.id_reserva));
}

// ---------------------------------------------------------------- pagar / cancelar
async function pagarReserva(idReserva, idCliente, metodo) {
    if (!METODOS_PAGO.includes(metodo)) throw bad('Selecciona un método de pago válido.');
    await expirarPendientes();
    await tx(async (c) => {
        const { rows } = await c.query(
            'SELECT estado_reserva FROM reserva WHERE id_reserva = $1 AND id_cliente = $2 FOR UPDATE',
            [idReserva, idCliente]
        );
        if (!rows.length) throw new HttpError(404, 'No encontramos esa reserva.');
        if (rows[0].estado_reserva === 'EXPIRADA') throw new HttpError(409, 'La reserva expiró por falta de pago. Realiza una nueva búsqueda.');
        if (rows[0].estado_reserva !== 'PENDIENTE') throw new HttpError(409, 'Esta reserva ya no está pendiente de pago.');
        const referencia = crypto.randomBytes(5).toString('hex').toUpperCase();
        await c.query(
            `UPDATE reserva SET estado_reserva = 'CONFIRMADA', observaciones = $2 WHERE id_reserva = $1`,
            [idReserva, `Pago simulado (${metodo}) ref. ${referencia}`]
        );
    });
    return obtenerReserva(idReserva, idCliente);
}

/** idCliente = null cuando cancela un administrador. */
async function cancelarReserva(idReserva, idCliente, observacion) {
    await expirarPendientes();
    await tx(async (c) => {
        const { rows } = await c.query(
            'SELECT estado_reserva FROM reserva WHERE id_reserva = $1 AND ($2::int IS NULL OR id_cliente = $2::int) FOR UPDATE',
            [idReserva, idCliente || null]
        );
        if (!rows.length) throw new HttpError(404, 'No encontramos esa reserva.');
        if (!['PENDIENTE', 'CONFIRMADA'].includes(rows[0].estado_reserva)) {
            throw new HttpError(409, 'Esta reserva ya no se puede cancelar.');
        }
        if (idCliente) {
            const ya = await c.query(
                `SELECT 1 FROM detalle_reserva d JOIN tarifa t ON t.id_tarifa = d.id_tarifa
                   JOIN vuelo v ON v.id_vuelo = t.id_vuelo
                  WHERE d.id_reserva = $1 AND v.fecha_salida <= ${AHORA_LOCAL} LIMIT 1`,
                [idReserva]
            );
            if (ya.rowCount) throw new HttpError(409, 'No puedes cancelar una reserva con vuelos que ya salieron.');
        }
        await liberarYCambiarEstado(c, idReserva, 'CANCELADA', observacion || (idCliente ? 'Cancelada por el cliente' : 'Cancelada por el administrador'));
    });
    return obtenerReserva(idReserva, idCliente);
}

module.exports = {
    crearReserva, obtenerReserva, listarReservasCliente, detalleReservas, pagarReserva, cancelarReserva,
    expirarPendientes, liberarYCambiarEstado, TS, AHORA_LOCAL, METODOS_PAGO,
};
