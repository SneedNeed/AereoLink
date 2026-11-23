'use strict';
const { query, tx } = require('./db');
const { HttpError, bad } = require('./util');
const { texto, fechaValida } = require('./validators');
const { TS, AHORA_LOCAL, detalleReservas, cancelarReserva, expirarPendientes } = require('./reservas.service');

const ESTADOS_VUELO = ['PROGRAMADO', 'RETRASADO', 'EN_VUELO', 'ATERRIZADO', 'CANCELADO'];
const ESTADOS_RESERVA = ['PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'EXPIRADA'];
const ESTADOS_CLIENTE = ['ACTIVO', 'INACTIVO', 'SUSPENDIDO'];
const POR_PAGINA = 25;

const vacioANull = (v) => {
    const t = texto(v);
    return t === '' ? null : t;
};

async function resumen() {
    await expirarPendientes();
    const { rows: [g] } = await query(
        `SELECT
            (SELECT COUNT(*)::int FROM cliente) AS clientes,
            (SELECT COUNT(*)::int FROM reserva WHERE estado_reserva = 'CONFIRMADA') AS reservas_confirmadas,
            (SELECT COUNT(*)::int FROM reserva WHERE estado_reserva = 'PENDIENTE') AS reservas_pendientes,
            (SELECT COUNT(*)::int FROM reserva WHERE estado_reserva IN ('CANCELADA', 'EXPIRADA')) AS reservas_canceladas,
            (SELECT COALESCE(SUM(monto_total), 0)::float8 FROM reserva WHERE estado_reserva = 'CONFIRMADA') AS ingresos,
            (SELECT COUNT(*)::int FROM vuelo WHERE estado IN ('PROGRAMADO', 'RETRASADO') AND fecha_salida > ${AHORA_LOCAL}) AS vuelos_programados,
            (SELECT COUNT(*)::int FROM aerolinea WHERE estado = 'Y') AS aerolineas_activas`
    );
    const { rows: rutas } = await query(
        `SELECT v.aeropuerto_origen AS origen, v.aeropuerto_destino AS destino,
                COUNT(*)::int AS pasajeros, SUM(d.precio_pagado)::float8 AS ventas
           FROM detalle_reserva d
           JOIN reserva r ON r.id_reserva = d.id_reserva
           JOIN tarifa t ON t.id_tarifa = d.id_tarifa
           JOIN vuelo v ON v.id_vuelo = t.id_vuelo
          WHERE r.estado_reserva = 'CONFIRMADA'
          GROUP BY v.aeropuerto_origen, v.aeropuerto_destino
          ORDER BY pasajeros DESC, ventas DESC LIMIT 5`
    );
    const { rows: aerolineas } = await query(
        `SELECT al.nombre AS aerolinea, COUNT(*)::int AS pasajeros, SUM(d.precio_pagado)::float8 AS ventas
           FROM detalle_reserva d
           JOIN reserva r ON r.id_reserva = d.id_reserva
           JOIN tarifa t ON t.id_tarifa = d.id_tarifa
           JOIN vuelo v ON v.id_vuelo = t.id_vuelo
           JOIN aerolinea al ON al.id_aerolinea = v.id_aerolinea
          WHERE r.estado_reserva = 'CONFIRMADA'
          GROUP BY al.nombre ORDER BY ventas DESC LIMIT 5`
    );
    return { ...g, rutas_top: rutas, aerolineas_top: aerolineas };
}

async function listarVuelos(p) {
    const origen = /^[A-Za-z]{3}$/.test(p.origen || '') ? p.origen.toUpperCase() : null;
    const destino = /^[A-Za-z]{3}$/.test(p.destino || '') ? p.destino.toUpperCase() : null;
    const fecha = fechaValida(p.fecha);
    const estado = ESTADOS_VUELO.includes(p.estado) ? p.estado : null;
    const q = vacioANull(p.q);
    const pagina = Math.max(1, parseInt(p.pagina, 10) || 1);
    const pasados = p.pasados === '1' || p.pasados === 'true';

    const { rows } = await query(
        `SELECT v.id_vuelo, v.codigo_vuelo, al.nombre AS aerolinea, v.aeropuerto_origen AS origen, v.aeropuerto_destino AS destino,
                ${TS('v.fecha_salida')} AS salida, ${TS('v.fecha_llegada')} AS llegada, v.cantidad_escalas AS escalas,
                v.capacidad_total, v.cupos_disponibles, v.precio_base::float8 AS precio_base, v.estado,
                COUNT(*) OVER()::int AS total
           FROM vuelo v JOIN aerolinea al ON al.id_aerolinea = v.id_aerolinea
          WHERE ($1::text IS NULL OR v.aeropuerto_origen = $1)
            AND ($2::text IS NULL OR v.aeropuerto_destino = $2)
            AND ($3::date IS NULL OR (v.fecha_salida >= $3::date AND v.fecha_salida < $3::date + 1))
            AND ($4::text IS NULL OR v.estado = $4)
            AND ($5::text IS NULL OR v.codigo_vuelo ILIKE '%' || $5 || '%')
            AND ($6::boolean OR $3::date IS NOT NULL OR v.fecha_salida >= CURRENT_DATE)
          ORDER BY v.fecha_salida, v.id_vuelo
          LIMIT ${POR_PAGINA} OFFSET $7`,
        [origen, destino, fecha, estado, q, pasados, (pagina - 1) * POR_PAGINA]
    );
    return { total: rows.length ? rows[0].total : 0, pagina, por_pagina: POR_PAGINA, vuelos: rows.map(({ total, ...v }) => v) };
}

const FECHA_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

async function crearVuelo(body) {
    const campos = {};
    const idAerolinea = texto(body.id_aerolinea);
    const origen = texto(body.origen).toUpperCase();
    const destino = texto(body.destino).toUpperCase();
    const salida = texto(body.salida);
    const llegada = texto(body.llegada);
    const escalas = Number(body.escalas || 0);
    const capacidad = Number(body.capacidad_total);
    const precio = Number(body.precio_base);
    let codigo = texto(body.codigo_vuelo).toUpperCase();

    if (!idAerolinea) campos.id_aerolinea = 'Selecciona la aerolínea.';
    if (!/^[A-Z]{3}$/.test(origen)) campos.origen = 'Selecciona el origen.';
    if (!/^[A-Z]{3}$/.test(destino)) campos.destino = 'Selecciona el destino.';
    if (!campos.origen && !campos.destino && origen === destino) campos.destino = 'El destino debe ser distinto al origen.';
    if (!FECHA_HORA.test(salida)) campos.salida = 'Indica la fecha y hora de salida.';
    if (!FECHA_HORA.test(llegada)) campos.llegada = 'Indica la fecha y hora de llegada.';
    if (!Number.isInteger(escalas) || escalas < 0 || escalas > 5) campos.escalas = 'Entre 0 y 5 escalas.';
    if (!Number.isInteger(capacidad) || capacidad < 1 || capacidad > 850) campos.capacidad_total = 'Entre 1 y 850 sillas.';
    if (!Number.isFinite(precio) || precio <= 0 || precio > 99999999) campos.precio_base = 'Indica un precio válido.';
    if (codigo && !/^[A-Z0-9-]{3,15}$/.test(codigo)) campos.codigo_vuelo = 'Usa de 3 a 15 letras, números o guiones.';
    if (Object.keys(campos).length) throw bad('Revisa los datos del vuelo.', campos);

    const { rows: [fechas] } = await query(
        `SELECT ($1::timestamp > ${AHORA_LOCAL}) AS futuro, ($2::timestamp > $1::timestamp) AS orden`,
        [salida, llegada]
    );
    if (!fechas.futuro) throw bad('La salida debe ser en el futuro.', { salida: 'La salida debe ser en el futuro.' });
    if (!fechas.orden) throw bad('La llegada debe ser después de la salida.', { llegada: 'La llegada debe ser después de la salida.' });

    return tx(async (c) => {
        const al = await c.query('SELECT codigo_iata, estado FROM aerolinea WHERE id_aerolinea = $1', [idAerolinea]);
        if (!al.rows.length) throw bad('La aerolínea no existe.', { id_aerolinea: 'La aerolínea no existe.' });
        if (al.rows[0].estado !== 'Y') throw bad('La aerolínea está inactiva.', { id_aerolinea: 'La aerolínea está inactiva.' });
        const aeros = await c.query('SELECT codigo_iata FROM aeropuerto WHERE codigo_iata = ANY($1::text[])', [[origen, destino]]);
        if (aeros.rows.length !== 2) throw bad('Alguno de los aeropuertos no existe.');

        if (!codigo) {
            for (let i = 0; i < 20 && !codigo; i++) {
                const intento = `${al.rows[0].codigo_iata}${1000 + Math.floor(Math.random() * 9000)}`;
                const existe = await c.query('SELECT 1 FROM vuelo WHERE codigo_vuelo = $1', [intento]);
                if (!existe.rowCount) codigo = intento;
            }
            if (!codigo) throw new HttpError(500, 'No se pudo generar un código de vuelo. Escríbelo manualmente.');
        } else if ((await c.query('SELECT 1 FROM vuelo WHERE codigo_vuelo = $1', [codigo])).rowCount) {
            throw new HttpError(409, 'Ya existe un vuelo con ese código.', { codigo_vuelo: 'Ese código ya existe.' });
        }

        const { rows: [v] } = await c.query(
            `INSERT INTO vuelo (codigo_vuelo, id_aerolinea, aeropuerto_origen, aeropuerto_destino, fecha_salida, fecha_llegada,
                                cantidad_escalas, capacidad_total, cupos_disponibles, precio_base, estado)
             VALUES ($1, $2, $3, $4, $5::timestamp, $6::timestamp, $7, $8, $8, $9, 'PROGRAMADO') RETURNING id_vuelo`,
            [codigo, idAerolinea, origen, destino, salida, llegada, escalas, capacidad, precio]
        );
        if (escalas === 0) {
            await c.query(
                `INSERT INTO segmento_vuelo (id_vuelo, orden_segmento, aeropuerto_salida, aeropuerto_llegada, fecha_salida_seg, fecha_llegada_seg, tiempo_escala_min)
                 VALUES ($1, 1, $2, $3, $4::timestamp, $5::timestamp, 0)`,
                [v.id_vuelo, origen, destino, salida, llegada]
            );
        }
        const tarifas = [
            ['ECONOMICA', 'Light', 1.0, 10, 0, false, false, 0.6],
            ['ECONOMICA', 'Classic', 1.28, 10, 23, true, false, 0.4],
            ['ECONOMICA_PREMIUM', 'Premium Flex', 1.75, 12, 23, true, true, 0.2],
        ];
        for (const [clase, nombre, factor, mano, bodega, cambios, reemb, cupos] of tarifas) {
            await c.query(
                `INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg, equipaje_bodega_kg,
                                     permite_cambios, reembolsable, cupos_tarifa)
                 VALUES ($1, $2, $3, round($4::numeric * $5::numeric / 1000) * 1000, $6, $7, $8, $9, $10)`,
                [v.id_vuelo, clase, nombre, precio, factor, mano, bodega, cambios, reemb, Math.max(1, Math.floor(capacidad * cupos))]
            );
        }
        return { id_vuelo: v.id_vuelo, codigo_vuelo: codigo };
    });
}

async function cambiarEstadoVuelo(id, estado) {
    if (!ESTADOS_VUELO.includes(estado)) throw bad('Estado de vuelo no válido.');
    const r = await query('UPDATE vuelo SET estado = $2 WHERE id_vuelo = $1 RETURNING id_vuelo', [id, estado]);
    if (!r.rowCount) throw new HttpError(404, 'No encontramos ese vuelo.');
    let canceladas = 0;
    if (estado === 'CANCELADO') {
        // al cancelar el vuelo se cancelan sus reservas
        const { rows } = await query(
            `SELECT DISTINCT d.id_reserva
               FROM detalle_reserva d
               JOIN tarifa t ON t.id_tarifa = d.id_tarifa
               JOIN reserva r ON r.id_reserva = d.id_reserva
              WHERE t.id_vuelo = $1 AND r.estado_reserva IN ('PENDIENTE', 'CONFIRMADA')`,
            [id]
        );
        for (const { id_reserva } of rows) {
            await cancelarReserva(id_reserva, null, 'Cancelada porque el vuelo fue cancelado');
            canceladas++;
        }
    }
    return { ok: true, reservas_canceladas: canceladas };
}

async function eliminarVuelo(id) {
    try {
        const r = await query('DELETE FROM vuelo WHERE id_vuelo = $1', [id]);
        if (!r.rowCount) throw new HttpError(404, 'No encontramos ese vuelo.');
    } catch (err) {
        if (err.code === '23503') throw new HttpError(409, 'Este vuelo tiene reservas asociadas. Cancélalo en lugar de eliminarlo.');
        throw err;
    }
    return { ok: true };
}

async function listarReservasAdmin(p) {
    const estado = ESTADOS_RESERVA.includes(p.estado) ? p.estado : null;
    const q = vacioANull(p.q);
    await expirarPendientes();
    const { rows } = await query(
        `SELECT r.id_reserva
           FROM reserva r JOIN cliente c ON c.id_cliente = r.id_cliente
          WHERE ($1::text IS NULL OR r.estado_reserva = $1)
            AND ($2::text IS NULL OR r.codigo_reserva ILIKE '%' || $2 || '%'
                 OR c.nombre_completo ILIKE '%' || $2 || '%' OR c.correo ILIKE '%' || $2 || '%')
          ORDER BY r.fecha_reserva DESC, r.id_reserva DESC LIMIT 100`,
        [estado, q]
    );
    const detalle = await detalleReservas(rows.map((r) => r.id_reserva));
    return rows.map((r) => detalle.find((d) => d.id_reserva === r.id_reserva)).filter(Boolean);
}

async function listarClientes(p) {
    const q = vacioANull(p.q);
    const { rows } = await query(
        `SELECT c.id_cliente, c.tipo_documento, c.numero_documento, c.nombre_completo, c.correo, c.telefono,
                ${TS('c.fecha_registro')} AS fecha_registro, c.estado,
                (SELECT COUNT(*)::int FROM reserva r WHERE r.id_cliente = c.id_cliente) AS reservas
           FROM cliente c
          WHERE ($1::text IS NULL OR c.nombre_completo ILIKE '%' || $1 || '%' OR c.correo ILIKE '%' || $1 || '%'
                 OR c.numero_documento ILIKE '%' || $1 || '%')
          ORDER BY c.fecha_registro DESC LIMIT 300`,
        [q]
    );
    return rows;
}

async function cambiarEstadoCliente(id, estado) {
    if (!ESTADOS_CLIENTE.includes(estado)) throw bad('Estado de cliente no válido.');
    const r = await query('UPDATE cliente SET estado = $2 WHERE id_cliente = $1', [id, estado]);
    if (!r.rowCount) throw new HttpError(404, 'No encontramos ese cliente.');
    return { ok: true };
}

async function listarAerolineas() {
    const { rows } = await query(
        `SELECT a.id_aerolinea, a.codigo_iata, a.nombre, a.pais_origen, a.estado,
                (SELECT COUNT(*)::int FROM vuelo v
                  WHERE v.id_aerolinea = a.id_aerolinea AND v.estado IN ('PROGRAMADO', 'RETRASADO')
                    AND v.fecha_salida > ${AHORA_LOCAL}) AS vuelos_futuros
           FROM aerolinea a ORDER BY a.nombre`
    );
    return rows;
}

async function cambiarEstadoAerolinea(id, estado) {
    if (!['Y', 'N'].includes(estado)) throw bad('Estado de aerolínea no válido.');
    const r = await query('UPDATE aerolinea SET estado = $2 WHERE id_aerolinea = $1', [id, estado]);
    if (!r.rowCount) throw new HttpError(404, 'No encontramos esa aerolínea.');
    return { ok: true };
}

module.exports = {
    ESTADOS_VUELO, ESTADOS_RESERVA, ESTADOS_CLIENTE,
    resumen, listarVuelos, crearVuelo, cambiarEstadoVuelo, eliminarVuelo,
    listarReservasAdmin, listarClientes, cambiarEstadoCliente, listarAerolineas, cambiarEstadoAerolinea,
};
