'use strict';
const { HttpError, bad, sendJson, readJson } = require('./util');
const { leerSesion, iniciarSesion, cerrarSesion } = require('./session');
const catalogo = require('./catalogo.service');
const cuentas = require('./cuentas.service');
const reservas = require('./reservas.service');
const admin = require('./admin.service');

const rutas = [];
function ruta(metodo, patron, acceso, handler) {
    const nombres = [];
    const re = new RegExp('^' + patron.replace(/:([a-z]+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; }) + '/?$');
    rutas.push({ metodo, re, nombres, acceso, handler });
}

const idDe = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'No encontramos lo que buscas.');
    return n;
};

// máximo de intentos de login por IP
const intentos = new Map();
function limitar(ctx, clave, max, ventanaMs) {
    const k = `${clave}:${ctx.req.socket.remoteAddress || '?'}`;
    const ahora = Date.now();
    let r = intentos.get(k);
    if (!r || r.hasta < ahora) {
        r = { n: 0, hasta: ahora + ventanaMs };
        intentos.set(k, r);
    }
    if (++r.n > max) throw new HttpError(429, 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.');
}
setInterval(() => {
    const ahora = Date.now();
    for (const [k, r] of intentos) if (r.hasta < ahora) intentos.delete(k);
}, 5 * 60 * 1000).unref();

ruta('GET', '/api/aeropuertos', null, () => catalogo.listarAeropuertos());

ruta('GET', '/api/vuelos', null, (ctx) => {
    const idCliente = ctx.sesion && ctx.sesion.rol === 'cliente' ? ctx.sesion.id : null;
    return catalogo.buscarVuelos({ ...ctx.query, registrar: ctx.query.registrar === '1' }, idCliente);
});

ruta('GET', '/api/tarifas', null, (ctx) => catalogo.tarifasPorIds(String(ctx.query.ids || '').split(',').map(Number)));

ruta('POST', '/api/auth/registro', null, async (ctx) => {
    limitar(ctx, 'registro', 10, 60_000);
    const c = await cuentas.registrarCliente(ctx.body);
    iniciarSesion(ctx.res, { rol: 'cliente', id: c.id_cliente }, false);
    ctx.status = 201;
    return { rol: 'cliente', nombre: c.nombre_completo };
});

ruta('POST', '/api/auth/login', null, async (ctx) => {
    limitar(ctx, 'login', 15, 60_000);
    const u = await cuentas.autenticar(ctx.body.correo, ctx.body.contrasena);
    iniciarSesion(ctx.res, u.rol === 'admin' ? { rol: 'admin', correo: u.correo } : { rol: 'cliente', id: u.id }, !!ctx.body.recordar);
    return { rol: u.rol, nombre: u.nombre };
});

ruta('POST', '/api/auth/logout', null, (ctx) => {
    cerrarSesion(ctx.res);
    return { ok: true };
});

ruta('GET', '/api/auth/sesion', null, (ctx) => cuentas.datosSesion(ctx.sesion));

ruta('GET', '/api/cliente/perfil', 'cliente', (ctx) => cuentas.obtenerPerfil(ctx.sesion.id));
ruta('PUT', '/api/cliente/perfil', 'cliente', (ctx) => cuentas.actualizarPerfil(ctx.sesion.id, ctx.body));
ruta('PUT', '/api/cliente/password', 'cliente', (ctx) => cuentas.cambiarPassword(ctx.sesion.id, ctx.body));
ruta('GET', '/api/cliente/pasajeros', 'cliente', (ctx) => cuentas.listarPasajeros(ctx.sesion.id));
ruta('GET', '/api/cliente/busquedas', 'cliente', (ctx) => cuentas.busquedasRecientes(ctx.sesion.id));

ruta('GET', '/api/reservas', 'cliente', (ctx) => reservas.listarReservasCliente(ctx.sesion.id));
ruta('POST', '/api/reservas', 'cliente', async (ctx) => {
    const r = await reservas.crearReserva(ctx.sesion.id, ctx.body);
    ctx.status = 201;
    return r;
});
ruta('GET', '/api/reservas/:id', 'cliente', (ctx) => reservas.obtenerReserva(idDe(ctx.params.id), ctx.sesion.id));
ruta('POST', '/api/reservas/:id/pagar', 'cliente', (ctx) => reservas.pagarReserva(idDe(ctx.params.id), ctx.sesion.id, ctx.body.metodo));
ruta('POST', '/api/reservas/:id/cancelar', 'cliente', (ctx) => reservas.cancelarReserva(idDe(ctx.params.id), ctx.sesion.id));

ruta('GET', '/api/admin/resumen', 'admin', () => admin.resumen());

ruta('GET', '/api/admin/vuelos', 'admin', (ctx) => admin.listarVuelos(ctx.query));
ruta('POST', '/api/admin/vuelos', 'admin', async (ctx) => {
    const v = await admin.crearVuelo(ctx.body);
    ctx.status = 201;
    return v;
});
ruta('PATCH', '/api/admin/vuelos/:id', 'admin', (ctx) => admin.cambiarEstadoVuelo(idDe(ctx.params.id), ctx.body.estado));
ruta('DELETE', '/api/admin/vuelos/:id', 'admin', (ctx) => admin.eliminarVuelo(idDe(ctx.params.id)));

ruta('GET', '/api/admin/reservas', 'admin', (ctx) => admin.listarReservasAdmin(ctx.query));
ruta('POST', '/api/admin/reservas/:id/cancelar', 'admin', (ctx) => reservas.cancelarReserva(idDe(ctx.params.id), null));

ruta('GET', '/api/admin/clientes', 'admin', (ctx) => admin.listarClientes(ctx.query));
ruta('PATCH', '/api/admin/clientes/:id', 'admin', (ctx) => admin.cambiarEstadoCliente(idDe(ctx.params.id), ctx.body.estado));

ruta('GET', '/api/admin/aerolineas', 'admin', () => admin.listarAerolineas());
ruta('PATCH', '/api/admin/aerolineas/:id', 'admin', (ctx) => admin.cambiarEstadoAerolinea(String(ctx.params.id), ctx.body.estado));

async function manejarApi(req, res, url) {
    let coincideRuta = false;
    for (const r of rutas) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        coincideRuta = true;
        if (r.metodo !== req.method) continue;

        const ctx = {
            req, res, status: 200,
            query: Object.fromEntries(url.searchParams),
            params: Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])])),
            body: {},
            sesion: leerSesion(req),
        };
        if (r.acceso) {
            if (!ctx.sesion) throw new HttpError(401, 'Inicia sesión para continuar.');
            if (ctx.sesion.rol !== r.acceso) throw new HttpError(403, 'No tienes permiso para hacer esto.');
            if (r.acceso === 'cliente' && !(await cuentas.clienteActivo(ctx.sesion.id))) {
                cerrarSesion(res);
                throw new HttpError(401, 'Tu sesión ya no es válida. Inicia sesión de nuevo.');
            }
        }
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
            ctx.body = await readJson(req);
            if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw bad('El cuerpo de la solicitud no es válido.');
        }
        const data = await r.handler(ctx);
        return sendJson(res, ctx.status, data === undefined ? { ok: true } : data);
    }
    throw new HttpError(coincideRuta ? 405 : 404, coincideRuta ? 'Método no permitido.' : 'Ruta no encontrada.');
}

module.exports = { manejarApi };
