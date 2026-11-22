'use strict';
// Servidor web de AereoLink: sirve las páginas de /public y la API de /api.
// Solo necesita la librería "pg" (el resto es Node puro).
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const { HttpError, sendJson, traducirErrorPg } = require('./util');
const { manejarApi } = require('./routes');
const { expirarPendientes } = require('./reservas.service');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
};

function servirArchivo(req, res, pathname) {
    let relativa;
    try {
        relativa = decodeURIComponent(pathname);
    } catch (_) {
        res.writeHead(400);
        return res.end('Solicitud inválida');
    }
    if (relativa.endsWith('/')) relativa += 'index.html';
    let archivo = path.normalize(path.join(PUBLIC_DIR, relativa));
    if (!archivo.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403);
        return res.end('Acceso denegado');
    }
    // /perfil → /perfil.html
    if (!path.extname(archivo) && fs.existsSync(archivo + '.html')) archivo += '.html';

    fs.stat(archivo, (err, st) => {
        if (err || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end('<h1>404</h1><p>Página no encontrada. <a href="/">Volver al inicio</a></p>');
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
        });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(archivo).pipe(res);
    });
}

function responderError(res, err) {
    if (res.headersSent) return res.end();
    const e = err instanceof HttpError ? err : traducirErrorPg(err);
    if (e) return sendJson(res, e.status, { error: e.message, campos: e.campos });
    console.error('[error]', err);
    return sendJson(res, 500, { error: 'Ocurrió un error en el servidor. Inténtalo de nuevo.' });
}

const servidor = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.startsWith('/api/')) return await manejarApi(req, res, url);
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405);
            return res.end();
        }
        return servirArchivo(req, res, url.pathname);
    } catch (err) {
        return responderError(res, err);
    }
});

async function iniciar() {
    try {
        const { rows } = await db.query('SELECT current_database() AS bd, version() AS version');
        console.log(`✔ Conectado a PostgreSQL (base de datos "${rows[0].bd}")`);
        const { rows: [n] } = await db.query('SELECT COUNT(*)::int AS vuelos FROM vuelo');
        if (!n.vuelos) console.log('⚠ No hay vuelos cargados. Ejecuta: npm run db:demo   (o crea vuelos desde el panel de administración)');
    } catch (err) {
        console.error('✘ No se pudo usar la base de datos:', err.message);
        console.error('  Revisa los datos de conexión en el archivo .env y que hayas creado las tablas (npm run db:init).');
    }
    servidor.listen(config.port, () => console.log(`✔ AereoLink listo en http://localhost:${config.port}`));
    // Libera los cupos de las reservas que no se pagaron a tiempo.
    setInterval(() => expirarPendientes().catch((e) => console.error('[expirar]', e.message)), 60 * 1000).unref();
}

iniciar();
