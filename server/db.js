'use strict';
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({ ...config.db, max: 10 });

// hora de Colombia
pool.on('connect', (client) => {
    client.query(`SET TIME ZONE '${config.zonaHoraria}'`).catch(() => {});
});
pool.on('error', (err) => console.error('[db] error inesperado en el pool:', err.message));

const query = (texto, params) => pool.query(texto, params);

async function tx(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultado = await fn(client);
        await client.query('COMMIT');
        return resultado;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* nada */ }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, tx };
