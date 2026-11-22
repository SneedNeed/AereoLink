'use strict';
// Catálogo público: aeropuertos, búsqueda de vuelos y consulta de tarifas.
const { query } = require('./db');
const { TS, AHORA_LOCAL } = require('./reservas.service');
const { bad } = require('./util');
const { fechaValida, hoy } = require('./validators');
const { ciudadVisible } = require('./ciudades');

// Fragmentos SQL reutilizados
const SEGMENTOS_JSON = `COALESCE((
    SELECT json_agg(json_build_object(
               'orden', s.orden_segmento,
               'salida_aeropuerto', s.aeropuerto_salida,
               'llegada_aeropuerto', s.aeropuerto_llegada,
               'salida', ${TS('s.fecha_salida_seg')},
               'llegada', ${TS('s.fecha_llegada_seg')},
               'espera_min', s.tiempo_escala_min) ORDER BY s.orden_segmento)
      FROM segmento_vuelo s WHERE s.id_vuelo = v.id_vuelo), '[]'::json)`;

const TARIFA_COLS = `t.id_tarifa, t.clase_cabina, t.nombre_tarifa, t.precio_tarifa::float8 AS precio,
       t.equipaje_mano_kg::float8 AS equipaje_mano_kg, t.equipaje_bodega_kg::float8 AS equipaje_bodega_kg,
       t.permite_cambios, t.reembolsable, t.cupos_tarifa AS cupos`;

const VUELO_JOINS = `JOIN aerolinea al ON al.id_aerolinea = v.id_aerolinea
       JOIN aeropuerto ao ON ao.codigo_iata = v.aeropuerto_origen
       JOIN ciudad co ON co.id_ciudad = ao.id_ciudad
       JOIN aeropuerto ad ON ad.codigo_iata = v.aeropuerto_destino
       JOIN ciudad cd ON cd.id_ciudad = ad.id_ciudad`;

function conCiudades(v) {
    v.origen_ciudad = ciudadVisible(v.origen, v.origen_ciudad);
    v.destino_ciudad = ciudadVisible(v.destino, v.destino_ciudad);
    return v;
}

async function listarAeropuertos() {
    const { rows } = await query(
        `SELECT a.codigo_iata AS codigo, a.nombre, c.nombre AS ciudad, c.region
           FROM aeropuerto a JOIN ciudad c ON c.id_ciudad = a.id_ciudad
          ORDER BY c.nombre, a.nombre`
    );
    return rows.map((r) => ({
        codigo: r.codigo,
        nombre: r.nombre,
        ciudad: ciudadVisible(r.codigo, r.ciudad),
        ciudad_registrada: r.ciudad,
        region: r.region,
    }));
}

/**
 * Busca vuelos de un día entre dos aeropuertos con cupos para N pasajeros.
 * - despues: (opcional) solo vuelos que salgan después de esa fecha/hora (para el vuelo de regreso).
 * - registrar: guarda la búsqueda en historial_busqueda.
 */
async function buscarVuelos(p, idCliente) {
    const origen = String(p.origen || '').toUpperCase();
    const destino = String(p.destino || '').toUpperCase();
    const fecha = fechaValida(p.fecha);
    const pasajeros = Number(p.pasajeros || 1);
    const despues = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(p.despues || '') ? p.despues : null;

    if (!/^[A-Z]{3}$/.test(origen) || !/^[A-Z]{3}$/.test(destino)) throw bad('Selecciona el origen y el destino.');
    if (origen === destino) throw bad('El origen y el destino deben ser distintos.');
    if (!fecha) throw bad('La fecha del viaje no es válida.');
    if (fecha < hoy()) throw bad('La fecha del viaje no puede ser anterior a hoy.');
    if (!Number.isInteger(pasajeros) || pasajeros < 1 || pasajeros > 9) throw bad('Puedes buscar para entre 1 y 9 pasajeros.');

    if (p.registrar) {
        const regreso = fechaValida(p.regreso);
        try {
            await query(
                `INSERT INTO historial_busqueda (id_cliente, aeropuerto_origen, aeropuerto_destino, fecha_ida, fecha_regreso, cantidad_pasajeros)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [idCliente || null, origen, destino, fecha, regreso && regreso >= fecha ? regreso : null, pasajeros]
            );
        } catch (err) {
            console.error('[busqueda] no se pudo guardar el historial:', err.message);
        }
    }

    const { rows } = await query(
        `SELECT v.id_vuelo, v.codigo_vuelo, al.id_aerolinea, al.nombre AS aerolinea, al.codigo_iata AS aerolinea_iata,
                v.aeropuerto_origen AS origen, v.aeropuerto_destino AS destino,
                co.nombre AS origen_ciudad, cd.nombre AS destino_ciudad,
                ${TS('v.fecha_salida')} AS salida, ${TS('v.fecha_llegada')} AS llegada,
                v.cantidad_escalas AS escalas, v.cupos_disponibles, v.estado,
                COALESCE((SELECT json_agg(json_build_object(
                              'id_tarifa', t.id_tarifa, 'clase_cabina', t.clase_cabina, 'nombre_tarifa', t.nombre_tarifa,
                              'precio', t.precio_tarifa::float8, 'equipaje_mano_kg', t.equipaje_mano_kg::float8,
                              'equipaje_bodega_kg', t.equipaje_bodega_kg::float8, 'permite_cambios', t.permite_cambios,
                              'reembolsable', t.reembolsable, 'cupos', t.cupos_tarifa) ORDER BY t.precio_tarifa)
                            FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.cupos_tarifa >= $4), '[]'::json) AS tarifas,
                ${SEGMENTOS_JSON} AS segmentos
           FROM vuelo v
           ${VUELO_JOINS}
          WHERE v.aeropuerto_origen = $1 AND v.aeropuerto_destino = $2
            AND v.fecha_salida >= $3::date AND v.fecha_salida < $3::date + 1
            AND v.estado IN ('PROGRAMADO', 'RETRASADO') AND al.estado = 'Y'
            AND v.cupos_disponibles >= $4
            AND v.fecha_salida > ${AHORA_LOCAL}
            AND ($5::timestamp IS NULL OR v.fecha_salida > $5::timestamp)
            AND EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.cupos_tarifa >= $4)
          ORDER BY v.fecha_salida, v.precio_base`,
        [origen, destino, fecha, pasajeros, despues]
    );
    return rows.map(conCiudades);
}

/** Datos de las tarifas elegidas (con su vuelo), en el mismo orden en que se piden. */
async function tarifasPorIds(ids) {
    const lista = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0).slice(0, 2);
    if (!lista.length) throw bad('Indica las tarifas que quieres consultar.');
    const { rows } = await query(
        `SELECT ${TARIFA_COLS},
                v.id_vuelo, v.codigo_vuelo, v.aeropuerto_origen AS origen, v.aeropuerto_destino AS destino,
                co.nombre AS origen_ciudad, cd.nombre AS destino_ciudad,
                ${TS('v.fecha_salida')} AS salida, ${TS('v.fecha_llegada')} AS llegada,
                v.cantidad_escalas AS escalas, v.estado, v.cupos_disponibles,
                (v.fecha_salida > ${AHORA_LOCAL}) AS futuro,
                al.nombre AS aerolinea, al.codigo_iata AS aerolinea_iata,
                ${SEGMENTOS_JSON} AS segmentos
           FROM tarifa t
           JOIN vuelo v ON v.id_vuelo = t.id_vuelo
           ${VUELO_JOINS}
          WHERE t.id_tarifa = ANY($1::int[])`,
        [lista]
    );
    return lista.map((id) => rows.find((r) => r.id_tarifa === id)).filter(Boolean).map(conCiudades);
}

module.exports = { listarAeropuertos, buscarVuelos, tarifasPorIds, conCiudades, SEGMENTOS_JSON, VUELO_JOINS };
