'use strict';
const crypto = require('crypto');

class HttpError extends Error {
    constructor(status, message, campos) {
        super(message);
        this.status = status;
        this.campos = campos;
    }
}
const bad = (msg, campos) => new HttpError(400, msg, campos);

function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function readJson(req, limite = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const partes = [];
        let total = 0;
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > limite) {
                reject(new HttpError(413, 'La solicitud es demasiado grande.'));
                req.destroy();
                return;
            }
            partes.push(chunk);
        });
        req.on('end', () => {
            if (!total) return resolve({});
            try {
                resolve(JSON.parse(Buffer.concat(partes).toString('utf8')));
            } catch (_) {
                reject(bad('El cuerpo de la solicitud no es un JSON válido.'));
            }
        });
        req.on('error', reject);
    });
}

function parseCookies(req) {
    const out = {};
    for (const par of (req.headers.cookie || '').split(';')) {
        const i = par.indexOf('=');
        if (i < 0) continue;
        out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
    }
    return out;
}

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function traducirErrorPg(err) {
    if (/^AL\d{3}$/.test(err.code || '')) return new HttpError(Number(err.code.slice(2)), err.message);
    switch (err.code) {
        case '23505': return new HttpError(409, 'Ya existe un registro con esos datos.');
        case '23503': return new HttpError(409, 'No se puede completar la operación porque hay datos relacionados.');
        case '23514': return new HttpError(400, 'Los datos no cumplen las reglas de la base de datos.');
        case '23502': return new HttpError(400, 'Falta un dato obligatorio.');
        case '22001': return new HttpError(400, 'Uno de los textos es demasiado largo.');
        case '22P02':
        case '22007':
        case '22008': return new HttpError(400, 'Hay un dato con formato inválido.');
        default: return null;
    }
}

module.exports = { HttpError, bad, sendJson, readJson, parseCookies, safeEqual, traducirErrorPg };
