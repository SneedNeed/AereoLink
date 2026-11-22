'use strict';
// Algunos aeropuertos están registrados con el nombre del municipio donde queda la pista.
// Para el usuario mostramos la ciudad que conoce (ej. el aeropuerto CLO queda en Palmira, pero se vende como "Cali").
const ALIAS_CIUDAD = { CLO: 'Cali', BAQ: 'Barranquilla', BGA: 'Bucaramanga', AXM: 'Armenia', PSO: 'Pasto', MDE: 'Medellín' };

const ciudadVisible = (iata, ciudad) => ALIAS_CIUDAD[String(iata).trim()] || ciudad;

module.exports = { ALIAS_CIUDAD, ciudadVisible };
