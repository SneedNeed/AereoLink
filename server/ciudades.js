'use strict';
// CLO queda en Palmira pero se vende como Cali (igual con otras ciudades)
const ALIAS_CIUDAD = { CLO: 'Cali', BAQ: 'Barranquilla', BGA: 'Bucaramanga', AXM: 'Armenia', PSO: 'Pasto', MDE: 'Medellín' };

const ciudadVisible = (iata, ciudad) => ALIAS_CIUDAD[String(iata).trim()] || ciudad;

module.exports = { ALIAS_CIUDAD, ciudadVisible };
