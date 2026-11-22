'use strict';
// Configuración del servidor. Lee el archivo .env (si existe) sin necesitar librerías extra.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function cargarEnv() {
    const archivo = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(archivo)) return;
    for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
        if (!linea.trim() || linea.trim().startsWith('#')) continue;
        const m = linea.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        let valor = m[2];
        if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
            valor = valor.slice(1, -1);
        }
        if (!(m[1] in process.env)) process.env[m[1]] = valor;
    }
}
cargarEnv();

const env = process.env;

const db = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
          host: env.DB_HOST || 'localhost',
          port: Number(env.DB_PORT || 5432),
          database: env.DB_NAME || 'aerolink',
          user: env.DB_USER || 'postgres',
          password: env.DB_PASSWORD || undefined,
      };

module.exports = {
    port: Number(env.PORT || 3000),
    db,
    // Si no defines SESSION_SECRET se genera uno al arrancar (las sesiones se cierran al reiniciar).
    sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    cookieSecure: env.COOKIE_SECURE === 'true',
    minutosParaPagar: Number(env.MINUTOS_PARA_PAGAR || 30),
    zonaHoraria: 'America/Bogota',
};
