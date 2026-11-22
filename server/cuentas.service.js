'use strict';
// Cuentas de clientes: registro, inicio de sesión, perfil, contraseña, pasajeros guardados e historial de búsquedas.
const { query } = require('./db');
const config = require('./config');
const { HttpError, bad, safeEqual } = require('./util');
const {
    TIPOS_DOC_CLIENTE, RE_EMAIL, RE_NOMBRE, RE_TELEFONO,
    texto, fechaValida, fechaMaxMayorDeEdad, validarPassword, validarNumeroDocumento,
} = require('./validators');
const { TS, AHORA_LOCAL } = require('./reservas.service');

function validarNombre(valor, etiqueta, max) {
    if (valor.length < 2 || valor.length > max || !RE_NOMBRE.test(valor)) return `Escribe ${etiqueta} (solo letras).`;
    return null;
}

// ------------------------------------------------------------------ registro
async function registrarCliente(body) {
    const campos = {};
    const tipo = String(body.tipo_documento || '').toUpperCase();
    let numero = texto(body.numero_documento).replace(/\s/g, '');
    const nombres = texto(body.nombres);
    const apellidos = texto(body.apellidos);
    const correo = texto(body.correo).toLowerCase();
    const telefono = texto(body.telefono);
    const nacimiento = fechaValida(body.fecha_nacimiento);
    const contrasena = body.contrasena;

    if (!TIPOS_DOC_CLIENTE.includes(tipo)) campos.tipo_documento = 'Selecciona un tipo de documento.';
    else {
        const e = validarNumeroDocumento(tipo, numero);
        if (e) campos.numero_documento = e;
        if (tipo === 'PAS') numero = numero.toUpperCase();
    }
    const eNombres = validarNombre(nombres, 'tus nombres', 70);
    if (eNombres) campos.nombres = eNombres;
    const eApellidos = validarNombre(apellidos, 'tus apellidos', 70);
    if (eApellidos) campos.apellidos = eApellidos;
    if (!RE_EMAIL.test(correo) || correo.length > 150) campos.correo = 'Escribe un correo válido.';
    if (!RE_TELEFONO.test(telefono)) campos.telefono = 'Escribe un teléfono válido (7 a 20 dígitos).';
    if (!nacimiento) campos.fecha_nacimiento = 'Indica tu fecha de nacimiento.';
    else if (nacimiento < '1900-01-01' || nacimiento > fechaMaxMayorDeEdad()) {
        campos.fecha_nacimiento = 'Debes ser mayor de 18 años para crear una cuenta.';
    }
    const ePass = validarPassword(contrasena);
    if (ePass) campos.contrasena = ePass;
    else if (body.confirmacion !== undefined && body.confirmacion !== contrasena) campos.confirmacion = 'Las contraseñas no coinciden.';

    if (Object.keys(campos).length) throw bad('Revisa los datos del formulario.', campos);

    try {
        const { rows } = await query(
            `INSERT INTO cliente (tipo_documento, numero_documento, nombre_completo, correo, telefono, fecha_nacimiento, contrasena)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_cliente, nombre_completo`,
            [tipo, numero, `${nombres} ${apellidos}`, correo, telefono, nacimiento, contrasena]
        );
        return rows[0];
    } catch (err) {
        if (err.code === '23505') {
            if (String(err.constraint).includes('correo')) {
                throw new HttpError(409, 'Ya existe una cuenta con ese correo.', { correo: 'Este correo ya está registrado.' });
            }
            throw new HttpError(409, 'Ya existe una cuenta con ese documento.', { numero_documento: 'Este documento ya está registrado.' });
        }
        throw err;
    }
}

// ------------------------------------------------------------------ login
/** Devuelve { rol, id?, correo?, nombre } si las credenciales son correctas. */
async function autenticar(correoEntrada, contrasenaEntrada) {
    const correo = texto(correoEntrada);
    const contrasena = typeof contrasenaEntrada === 'string' ? contrasenaEntrada : '';
    if (!correo || !contrasena) throw bad('Escribe tu correo y tu contraseña.');
    const fallo = () => new HttpError(401, 'Correo o contraseña incorrectos.');

    const { rows } = await query(
        'SELECT id_cliente, nombre_completo, correo, contrasena, estado FROM cliente WHERE lower(correo) = lower($1)',
        [correo]
    );
    if (rows.length) {
        const c = rows[0];
        if (!safeEqual(c.contrasena, contrasena)) throw fallo();
        if (c.estado !== 'ACTIVO') throw new HttpError(403, `Tu cuenta está ${c.estado.toLowerCase()}. Comunícate con soporte.`);
        return { rol: 'cliente', id: c.id_cliente, nombre: c.nombre_completo };
    }
    const adm = await query('SELECT correo, contrasena FROM administrador WHERE lower(correo) = lower($1)', [correo]);
    if (adm.rows.length && safeEqual(adm.rows[0].contrasena, contrasena)) {
        return { rol: 'admin', correo: adm.rows[0].correo, nombre: 'Administrador' };
    }
    throw fallo();
}

/** Estado de la sesión actual para el encabezado de las páginas. */
async function datosSesion(s) {
    if (!s) return { autenticado: false };
    if (s.rol === 'admin') return { autenticado: true, rol: 'admin', nombre: 'Administrador', correo: s.correo };
    const { rows } = await query(
        `SELECT c.nombre_completo, c.correo, c.estado,
                (SELECT COUNT(*)::int FROM reserva r
                  WHERE r.id_cliente = c.id_cliente AND r.estado_reserva = 'PENDIENTE'
                    AND r.fecha_reserva > ${AHORA_LOCAL} - ($2::int * INTERVAL '1 minute')) AS pendientes
           FROM cliente c WHERE c.id_cliente = $1`,
        [s.id, config.minutosParaPagar]
    );
    if (!rows.length || rows[0].estado !== 'ACTIVO') return { autenticado: false };
    const c = rows[0];
    return { autenticado: true, rol: 'cliente', nombre: c.nombre_completo, correo: c.correo, pendientes: c.pendientes };
}

/** Confirma que una cuenta de cliente sigue activa (se usa en cada acción de cliente). */
async function clienteActivo(id) {
    const { rows } = await query('SELECT estado FROM cliente WHERE id_cliente = $1', [id]);
    return rows.length > 0 && rows[0].estado === 'ACTIVO';
}

// ------------------------------------------------------------------ perfil
async function obtenerPerfil(id) {
    const { rows } = await query(
        `SELECT c.id_cliente, c.tipo_documento, c.numero_documento, c.nombre_completo, c.correo, c.telefono,
                to_char(c.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
                ${TS('c.fecha_registro')} AS fecha_registro, c.estado,
                (SELECT COUNT(*)::int FROM reserva r WHERE r.id_cliente = c.id_cliente) AS total_reservas,
                (SELECT COUNT(*)::int FROM reserva r WHERE r.id_cliente = c.id_cliente AND r.estado_reserva = 'CONFIRMADA') AS reservas_confirmadas
           FROM cliente c WHERE c.id_cliente = $1`,
        [id]
    );
    if (!rows.length) throw new HttpError(404, 'No encontramos tu cuenta.');
    return rows[0];
}

async function actualizarPerfil(id, body) {
    const campos = {};
    const nombre = texto(body.nombre_completo);
    const correo = texto(body.correo).toLowerCase();
    const telefono = texto(body.telefono);
    if (nombre.length < 3 || nombre.length > 150 || !RE_NOMBRE.test(nombre)) campos.nombre_completo = 'Escribe tu nombre completo (solo letras).';
    if (!RE_EMAIL.test(correo) || correo.length > 150) campos.correo = 'Escribe un correo válido.';
    if (!RE_TELEFONO.test(telefono)) campos.telefono = 'Escribe un teléfono válido (7 a 20 dígitos).';
    if (Object.keys(campos).length) throw bad('Revisa los datos del formulario.', campos);
    try {
        await query('UPDATE cliente SET nombre_completo = $2, correo = $3, telefono = $4 WHERE id_cliente = $1', [id, nombre, correo, telefono]);
    } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'Ese correo ya está en uso.', { correo: 'Este correo ya está registrado.' });
        throw err;
    }
    return obtenerPerfil(id);
}

async function cambiarPassword(id, body) {
    const { rows } = await query('SELECT contrasena FROM cliente WHERE id_cliente = $1', [id]);
    if (!rows.length) throw new HttpError(404, 'No encontramos tu cuenta.');
    if (!safeEqual(rows[0].contrasena, typeof body.actual === 'string' ? body.actual : '')) {
        throw bad('La contraseña actual no es correcta.', { actual: 'La contraseña actual no es correcta.' });
    }
    const e = validarPassword(body.nueva);
    if (e) throw bad('La nueva contraseña no es válida.', { nueva: e });
    if (body.confirmacion !== undefined && body.confirmacion !== body.nueva) {
        throw bad('Las contraseñas no coinciden.', { confirmacion: 'Las contraseñas no coinciden.' });
    }
    await query('UPDATE cliente SET contrasena = $2 WHERE id_cliente = $1', [id, body.nueva]);
    return { ok: true };
}

// ------------------------------------------------------------------ pasajeros y búsquedas
async function listarPasajeros(idCliente) {
    const { rows } = await query(
        `SELECT id_pasajero, tipo_documento, numero_documento, nombre_completo, nacionalidad,
                to_char(fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento
           FROM pasajero WHERE id_cliente = $1 ORDER BY nombre_completo`,
        [idCliente]
    );
    return rows;
}

/** Últimas rutas buscadas por el cliente (sin repetir ruta). */
async function busquedasRecientes(idCliente) {
    const { rows } = await query(
        `SELECT origen, destino, fecha_ida, fecha_regreso, pasajeros FROM (
             SELECT DISTINCT ON (aeropuerto_origen, aeropuerto_destino)
                    aeropuerto_origen AS origen, aeropuerto_destino AS destino,
                    to_char(fecha_ida, 'YYYY-MM-DD') AS fecha_ida,
                    to_char(fecha_regreso, 'YYYY-MM-DD') AS fecha_regreso,
                    cantidad_pasajeros AS pasajeros, fecha_consulta
               FROM historial_busqueda WHERE id_cliente = $1
              ORDER BY aeropuerto_origen, aeropuerto_destino, fecha_consulta DESC
         ) x ORDER BY fecha_consulta DESC LIMIT 6`,
        [idCliente]
    );
    return rows;
}

module.exports = {
    registrarCliente, autenticar, datosSesion, clienteActivo,
    obtenerPerfil, actualizarPerfil, cambiarPassword, listarPasajeros, busquedasRecientes,
};
