'use strict';
// Sesiones firmadas en una cookie HttpOnly (sin librerías externas).
const crypto = require('crypto');
const config = require('./config');
const { parseCookies, safeEqual } = require('./util');

const COOKIE = 'al_session';

const b64 = (s) => Buffer.from(s).toString('base64url');
const firmar = (texto) => crypto.createHmac('sha256', config.sessionSecret).update(texto).digest('base64url');

/** payload: { rol: 'cliente' | 'admin', id?, correo? } */
function crearToken(payload, segundos) {
    const cuerpo = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + segundos }));
    return `${cuerpo}.${firmar(cuerpo)}`;
}

function leerToken(token) {
    if (!token || !token.includes('.')) return null;
    const [cuerpo, firma] = token.split('.');
    if (!safeEqual(firma, firmar(cuerpo))) return null;
    try {
        const data = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
        if (!data.exp || data.exp < Date.now() / 1000) return null;
        return data;
    } catch (_) {
        return null;
    }
}

function leerSesion(req) {
    return leerToken(parseCookies(req)[COOKIE]);
}

/** recordar = true → cookie de 30 días; false → cookie de sesión (12 horas). */
function iniciarSesion(res, payload, recordar) {
    const segundos = recordar ? 30 * 24 * 3600 : 12 * 3600;
    const token = crearToken(payload, segundos);
    const partes = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
    if (recordar) partes.push(`Max-Age=${segundos}`);
    if (config.cookieSecure) partes.push('Secure');
    res.setHeader('Set-Cookie', partes.join('; '));
}

function cerrarSesion(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

module.exports = { leerSesion, iniciarSesion, cerrarSesion };
