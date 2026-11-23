'use strict';
const { bad } = require('./util');

const TIPOS_DOC_CLIENTE = ['CC', 'CE', 'PAS'];
const TIPOS_DOC_PASAJERO = ['CC', 'CE', 'PAS', 'TI', 'RC'];
const TIPOS_DOC_MAYOR = ['CC', 'CE', 'PAS'];
const TIPOS_DOC_MENOR = ['TI', 'RC', 'PAS'];

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_NOMBRE = /^[\p{L}][\p{L}\p{M}\s'.-]*$/u;
const RE_TELEFONO = /^[0-9+()\s-]{7,20}$/;

const texto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

function fechaValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T00:00:00Z`);
    return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null;
}

function hoy() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function sumarDias(fecha, dias) {
    const d = new Date(`${fecha}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

function edadEn(nacimiento, referencia) {
    const [y1, m1, d1] = nacimiento.split('-').map(Number);
    const [y2, m2, d2] = referencia.split('-').map(Number);
    let e = y2 - y1;
    if (m2 < m1 || (m2 === m1 && d2 < d1)) e--;
    return e;
}

function fechaMaxMayorDeEdad() {
    const [y, m, d] = hoy().split('-');
    return `${Number(y) - 18}-${m}-${d}`;
}

function validarPassword(p) {
    if (typeof p !== 'string' || p.length < 8 || p.length > 20) return 'Debe tener entre 8 y 20 caracteres.';
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Debe combinar letras y números.';
    return null;
}

function validarNumeroDocumento(tipo, numero) {
    if (tipo === 'PAS') return /^[A-Za-z0-9]{5,20}$/.test(numero) ? null : 'El pasaporte debe tener entre 5 y 20 letras o números.';
    return /^\d{5,15}$/.test(numero) ? null : 'El número de documento debe tener entre 5 y 15 dígitos.';
}

function validarPasajero(p, fechaRef) {
    const campos = {};
    const tipo = String(p.tipo_documento || '').toUpperCase();
    const numero = texto(p.numero_documento).replace(/\s/g, '');
    const nombre = texto(p.nombre_completo);
    const nacionalidad = texto(p.nacionalidad);
    const nacimiento = fechaValida(p.fecha_nacimiento);

    if (!TIPOS_DOC_PASAJERO.includes(tipo)) campos.tipo_documento = 'Selecciona un tipo de documento válido.';
    else {
        const errDoc = tipo === 'RC' || tipo === 'TI' ? (/^\d{5,15}$/.test(numero) ? null : 'Debe tener entre 5 y 15 dígitos.') : validarNumeroDocumento(tipo, numero);
        if (errDoc) campos.numero_documento = errDoc;
    }
    if (nombre.length < 3 || nombre.length > 150 || !RE_NOMBRE.test(nombre)) campos.nombre_completo = 'Escribe el nombre completo (solo letras).';
    if (nacionalidad.length < 3 || nacionalidad.length > 80) campos.nacionalidad = 'Indica la nacionalidad.';
    if (!nacimiento) campos.fecha_nacimiento = 'Fecha de nacimiento inválida.';
    else if (nacimiento < '1900-01-01' || nacimiento > hoy()) campos.fecha_nacimiento = 'La fecha de nacimiento no es válida.';

    if (!campos.fecha_nacimiento && !campos.tipo_documento) {
        const edad = edadEn(nacimiento, fechaRef || hoy());
        if (edad >= 18 && !TIPOS_DOC_MAYOR.includes(tipo)) campos.tipo_documento = 'Un mayor de edad debe usar CC, CE o pasaporte.';
        if (edad < 18 && !TIPOS_DOC_MENOR.includes(tipo)) campos.tipo_documento = 'Un menor de edad debe usar TI, RC o pasaporte.';
    }
    if (Object.keys(campos).length) throw bad('Revisa los datos del pasajero.', campos);

    return {
        tipo_documento: tipo,
        numero_documento: tipo === 'PAS' ? numero.toUpperCase() : numero,
        nombre_completo: nombre,
        fecha_nacimiento: nacimiento,
        nacionalidad,
        edad: edadEn(nacimiento, fechaRef || hoy()),
    };
}

module.exports = {
    TIPOS_DOC_CLIENTE, TIPOS_DOC_PASAJERO, RE_EMAIL, RE_NOMBRE, RE_TELEFONO,
    texto, fechaValida, hoy, sumarDias, edadEn, fechaMaxMayorDeEdad,
    validarPassword, validarNumeroDocumento, validarPasajero,
};
