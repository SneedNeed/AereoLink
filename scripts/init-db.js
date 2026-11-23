'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../server/config');

const DIR = path.join(__dirname, '..', 'database');
const soloDemo = process.argv.includes('--solo-demo');
const forzar = process.argv.includes('--forzar');

function nombreBd() {
    return config.db.connectionString ? decodeURIComponent(new URL(config.db.connectionString).pathname.slice(1)) : config.db.database;
}

function configAdmin() {
    if (config.db.connectionString) {
        const u = new URL(config.db.connectionString);
        u.pathname = '/postgres';
        return { connectionString: u.toString() };
    }
    return { ...config.db, database: 'postgres' };
}

async function conectar() {
    const cliente = new Client(config.db);
    try {
        await cliente.connect();
        return cliente;
    } catch (err) {
        if (err.code !== '3D000') throw err; // 3D000: la base no existe
        const nombre = nombreBd();
        console.log(`La base de datos "${nombre}" no existe. Creándola...`);
        const admin = new Client(configAdmin());
        await admin.connect();
        await admin.query(`CREATE DATABASE "${nombre.replace(/"/g, '""')}"`);
        await admin.end();
        const nuevo = new Client(config.db);
        await nuevo.connect();
        return nuevo;
    }
}

async function ejecutarArchivo(cliente, nombreArchivo) {
    const sql = fs.readFileSync(path.join(DIR, nombreArchivo), 'utf8');
    console.log(`→ Ejecutando ${nombreArchivo} ...`);
    await cliente.query(sql);
}

async function main() {
    const cliente = await conectar();
    try {
        await cliente.query("SET TIME ZONE 'America/Bogota'");

        if (!soloDemo) {
            const existe = (await cliente.query("SELECT to_regclass('public.cliente') AS t")).rows[0].t;
            if (existe && !forzar) {
                const n = (await cliente.query('SELECT COUNT(*)::int AS n FROM cliente')).rows[0].n;
                if (n > 0) {
                    console.error(`✘ La base ya tiene ${n} cliente(s). Crear las tablas de nuevo BORRARÍA todos los datos.`);
                    console.error('  Si es lo que quieres, ejecuta:  npm run db:init -- --forzar');
                    process.exitCode = 1;
                    return;
                }
            }
            // el script no borra la tabla administrador
            await cliente.query('DROP TABLE IF EXISTS administrador CASCADE');
            await ejecutarArchivo(cliente, 'Proyecto_Aerolink.sql');
        }
        await ejecutarArchivo(cliente, 'datos_demo.sql');

        const r = await cliente.query(
            `SELECT (SELECT COUNT(*)::int FROM aeropuerto) AS aeropuertos, (SELECT COUNT(*)::int FROM aerolinea) AS aerolineas,
                    (SELECT COUNT(*)::int FROM vuelo) AS vuelos, (SELECT COUNT(*)::int FROM tarifa) AS tarifas`
        );
        console.log('✔ Listo:', r.rows[0]);
        console.log('  Cliente de prueba → demo@aerolink.com / Demo1234');
        console.log('  Administrador     → admin / admin');
    } finally {
        await cliente.end();
    }
}

main().catch((err) => {
    console.error('✘ Error:', err.message);
    process.exitCode = 1;
});
