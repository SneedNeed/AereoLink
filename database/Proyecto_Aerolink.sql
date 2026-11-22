-- ====================================================
-- PROYECTO: AeroLink - Agencia Intermediaria de Vuelos
-- ====================================================

-- Limpieza controlada para permitir reconstrucción desde cero
DROP VIEW IF EXISTS vw_pasajeros_edad_equipaje CASCADE;
DROP VIEW IF EXISTS vw_resumen_reservas_clientes CASCADE;
DROP VIEW IF EXISTS vw_catalogo_vuelos_disponibles CASCADE;

DROP TABLE IF EXISTS historial_busqueda CASCADE;
DROP TABLE IF EXISTS pago CASCADE;
DROP TABLE IF EXISTS detalle_reserva CASCADE;
DROP TABLE IF EXISTS reserva CASCADE;
DROP TABLE IF EXISTS tarifa CASCADE;
DROP TABLE IF EXISTS segmento_vuelo CASCADE;
DROP TABLE IF EXISTS vuelo CASCADE;
DROP TABLE IF EXISTS pasajero CASCADE;
DROP TABLE IF EXISTS cliente CASCADE;
DROP TABLE IF EXISTS aerolinea CASCADE;
DROP TABLE IF EXISTS aeropuerto CASCADE;
DROP TABLE IF EXISTS ciudad CASCADE;

DROP SEQUENCE IF EXISTS seq_codigo_reserva CASCADE;

-- ----------------------------------------------------------------------------
-- 1. CIUDAD
-- ----------------------------------------------------------------------------
CREATE TABLE ciudad (
    id_ciudad   VARCHAR(10)  PRIMARY KEY,          -- formato CIU-001
    nombre      VARCHAR(100) NOT NULL,
    region      VARCHAR(100) NOT NULL,
    pais        VARCHAR(100) NOT NULL,
    codigo_pais CHAR(2)      NOT NULL DEFAULT 'CO',
    CONSTRAINT uq_ciudad_nombre_region_pais UNIQUE (nombre, region, pais),
    CONSTRAINT chk_ciudad_id CHECK (id_ciudad ~ '^CIU-[0-9]{3,5}$'),
    CONSTRAINT chk_ciudad_codigo_pais CHECK (
        codigo_pais = UPPER(codigo_pais) AND LENGTH(TRIM(codigo_pais)) = 2
    )
);

-- ----------------------------------------------------------------------------
-- 2. AEROPUERTO
-- ----------------------------------------------------------------------------
CREATE TABLE aeropuerto (
    codigo_iata CHAR(3)      PRIMARY KEY,
    nombre      VARCHAR(150) NOT NULL,
    id_ciudad   VARCHAR(10)  NOT NULL,
    CONSTRAINT fk_aeropuerto_ciudad
        FOREIGN KEY (id_ciudad) REFERENCES ciudad(id_ciudad) ON DELETE RESTRICT,
    CONSTRAINT chk_aeropuerto_iata CHECK (
        codigo_iata = UPPER(codigo_iata) AND LENGTH(TRIM(codigo_iata)) = 3
    )
);

-- ----------------------------------------------------------------------------
-- 3. AEROLINEA
-- ----------------------------------------------------------------------------
CREATE TABLE aerolinea (
    id_aerolinea VARCHAR(10)  PRIMARY KEY,         -- formato AER-001
    codigo_iata  VARCHAR(3)   NOT NULL,
    nombre       VARCHAR(150) NOT NULL,
    pais_origen  VARCHAR(100) NOT NULL,
    estado       CHAR(1)      NOT NULL DEFAULT 'Y',   -- Y = activa, N = inactiva
    CONSTRAINT uq_aerolinea_codigo UNIQUE (codigo_iata),
    CONSTRAINT uq_aerolinea_nombre UNIQUE (nombre),
    CONSTRAINT chk_aerolinea_codigo CHECK (
        codigo_iata = UPPER(codigo_iata) AND LENGTH(TRIM(codigo_iata)) >= 2
    ),
    CONSTRAINT chk_aerolinea_id     CHECK (id_aerolinea ~ '^AER-[0-9]{3,5}$'),
    CONSTRAINT chk_aerolinea_estado CHECK (estado IN ('Y', 'N'))
);

-- ----------------------------------------------------------------------------
-- 4. CLIENTE
-- ----------------------------------------------------------------------------
CREATE TABLE cliente (
    id_cliente       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo_documento   VARCHAR(10)  NOT NULL,
    numero_documento VARCHAR(30)  NOT NULL,
    nombre_completo  VARCHAR(150) NOT NULL,
    correo           VARCHAR(150) NOT NULL,
    telefono         VARCHAR(20)  NOT NULL,
    fecha_nacimiento DATE         NOT NULL,
    fecha_registro   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado           VARCHAR(15)  NOT NULL DEFAULT 'ACTIVO',
	contrasena VARCHAR(20) NOT NULL,
    CONSTRAINT uq_cliente_documento UNIQUE (numero_documento),
    CONSTRAINT uq_cliente_correo    UNIQUE (correo),
    CONSTRAINT chk_cliente_tipo_doc CHECK (tipo_documento IN ('CC', 'CE', 'PAS', 'TI')),
    CONSTRAINT chk_cliente_correo   CHECK (correo LIKE '%_@_%._%'),
    CONSTRAINT chk_cliente_mayor_edad CHECK (
        fecha_nacimiento >= DATE '1900-01-01'
        AND fecha_nacimiento <= (CURRENT_DATE - INTERVAL '18 years')
    ),
    CONSTRAINT chk_cliente_estado CHECK (estado IN ('ACTIVO', 'INACTIVO', 'SUSPENDIDO'))
);

-- ----------------------------------------------------------------------------
-- 5. PASAJERO
-- ----------------------------------------------------------------------------
CREATE TABLE pasajero (
    id_pasajero      INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_cliente       INT          NOT NULL,
    tipo_documento   VARCHAR(10)  NOT NULL,
    numero_documento VARCHAR(30)  NOT NULL,
    nombre_completo  VARCHAR(150) NOT NULL,
    fecha_nacimiento DATE         NOT NULL,
    nacionalidad     VARCHAR(80)  NOT NULL,
    CONSTRAINT fk_pasajero_cliente
        FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente) ON DELETE RESTRICT,
    CONSTRAINT uq_pasajero_por_cliente UNIQUE (id_cliente, tipo_documento, numero_documento),
    CONSTRAINT chk_pasajero_tipo_doc CHECK (tipo_documento IN ('CC', 'CE', 'PAS', 'TI', 'RC')),
    CONSTRAINT chk_pasajero_fecha_nac CHECK (
        fecha_nacimiento >= DATE '1900-01-01' AND fecha_nacimiento <= CURRENT_DATE
    )
);
CREATE TABLE administrador (
	correo           VARCHAR(150) NOT NULL,
	contrasena VARCHAR(15) NOT NULL
);
-- ----------------------------------------------------------------------------
-- 6. VUELO
-- ----------------------------------------------------------------------------
CREATE TABLE vuelo (
    id_vuelo           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_vuelo       VARCHAR(15)    NOT NULL,
    id_aerolinea       VARCHAR(10)    NOT NULL,
    aeropuerto_origen  CHAR(3)        NOT NULL,
    aeropuerto_destino CHAR(3)        NOT NULL,
    fecha_salida       TIMESTAMP      NOT NULL,
    fecha_llegada      TIMESTAMP      NOT NULL,
    cantidad_escalas   INT            NOT NULL DEFAULT 0,
    capacidad_total    INT            NOT NULL,
    cupos_disponibles  INT            NOT NULL,
    precio_base        NUMERIC(12,2)  NOT NULL,
    estado             VARCHAR(15)    NOT NULL DEFAULT 'PROGRAMADO',
    CONSTRAINT uq_vuelo_codigo UNIQUE (codigo_vuelo),
    CONSTRAINT fk_vuelo_aerolinea
        FOREIGN KEY (id_aerolinea) REFERENCES aerolinea(id_aerolinea) ON DELETE RESTRICT,
    CONSTRAINT fk_vuelo_origen
        FOREIGN KEY (aeropuerto_origen) REFERENCES aeropuerto(codigo_iata) ON DELETE RESTRICT,
    CONSTRAINT fk_vuelo_destino
        FOREIGN KEY (aeropuerto_destino) REFERENCES aeropuerto(codigo_iata) ON DELETE RESTRICT,
    CONSTRAINT chk_vuelo_rutas_distintas CHECK (aeropuerto_origen <> aeropuerto_destino),
    CONSTRAINT chk_vuelo_fechas          CHECK (fecha_llegada > fecha_salida),
    CONSTRAINT chk_vuelo_escalas         CHECK (cantidad_escalas >= 0 AND cantidad_escalas <= 5),
    CONSTRAINT chk_vuelo_capacidad       CHECK (capacidad_total > 0 AND capacidad_total <= 850),
    CONSTRAINT chk_vuelo_cupos           CHECK (cupos_disponibles >= 0 AND cupos_disponibles <= capacidad_total),
    CONSTRAINT chk_vuelo_precio_base     CHECK (precio_base > 0),
    CONSTRAINT chk_vuelo_estado          CHECK (
        estado IN ('PROGRAMADO', 'RETRASADO', 'EN_VUELO', 'ATERRIZADO', 'CANCELADO')
    )
);

-- ----------------------------------------------------------------------------
-- 7. SEGMENTO_VUELO
-- ----------------------------------------------------------------------------
CREATE TABLE segmento_vuelo (
    id_segmento        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_vuelo           INT       NOT NULL,
    orden_segmento     INT       NOT NULL,
    aeropuerto_salida  CHAR(3)   NOT NULL,
    aeropuerto_llegada CHAR(3)   NOT NULL,
    fecha_salida_seg   TIMESTAMP NOT NULL,
    fecha_llegada_seg  TIMESTAMP NOT NULL,
    tiempo_escala_min  INT       NOT NULL DEFAULT 0,
    CONSTRAINT fk_segmento_vuelo
        FOREIGN KEY (id_vuelo) REFERENCES vuelo(id_vuelo) ON DELETE CASCADE,
    CONSTRAINT fk_segmento_salida
        FOREIGN KEY (aeropuerto_salida) REFERENCES aeropuerto(codigo_iata) ON DELETE RESTRICT,
    CONSTRAINT fk_segmento_llegada
        FOREIGN KEY (aeropuerto_llegada) REFERENCES aeropuerto(codigo_iata) ON DELETE RESTRICT,
    CONSTRAINT uq_segmento_orden        UNIQUE (id_vuelo, orden_segmento),
    CONSTRAINT chk_segmento_orden       CHECK (orden_segmento >= 1),
    CONSTRAINT chk_segmento_aeropuertos CHECK (aeropuerto_salida <> aeropuerto_llegada),
    CONSTRAINT chk_segmento_fechas      CHECK (fecha_llegada_seg > fecha_salida_seg),
    CONSTRAINT chk_segmento_espera      CHECK (tiempo_escala_min >= 0)
);

-- ----------------------------------------------------------------------------
-- 8. TARIFA
-- ----------------------------------------------------------------------------
CREATE TABLE tarifa (
    id_tarifa          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_vuelo           INT           NOT NULL,
    clase_cabina       VARCHAR(20)   NOT NULL,
    nombre_tarifa      VARCHAR(50)   NOT NULL,
    precio_tarifa      NUMERIC(12,2) NOT NULL,
    equipaje_mano_kg   NUMERIC(5,2)  NOT NULL,
    equipaje_bodega_kg NUMERIC(5,2)  NOT NULL,
    permite_cambios    BOOLEAN       NOT NULL DEFAULT FALSE,
    reembolsable       BOOLEAN       NOT NULL DEFAULT FALSE,
    cupos_tarifa       INT           NOT NULL,
    CONSTRAINT fk_tarifa_vuelo
        FOREIGN KEY (id_vuelo) REFERENCES vuelo(id_vuelo) ON DELETE CASCADE,
    CONSTRAINT uq_tarifa_vuelo_clase_nombre UNIQUE (id_vuelo, clase_cabina, nombre_tarifa),
    CONSTRAINT chk_tarifa_clase CHECK (
        clase_cabina IN ('ECONOMICA', 'ECONOMICA_PREMIUM', 'EJECUTIVA', 'PRIMERA')
    ),
    CONSTRAINT chk_tarifa_precio     CHECK (precio_tarifa > 0),
    CONSTRAINT chk_tarifa_mano_kg    CHECK (equipaje_mano_kg >= 0 AND equipaje_mano_kg <= 15),
    CONSTRAINT chk_tarifa_bodega_kg  CHECK (equipaje_bodega_kg >= 0 AND equipaje_bodega_kg <= 64),
    CONSTRAINT chk_tarifa_cupos      CHECK (cupos_tarifa >= 0)
);

-- ----------------------------------------------------------------------------
-- 9. RESERVA
-- ----------------------------------------------------------------------------
CREATE TABLE reserva (
    id_reserva     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo_reserva VARCHAR(12)   NOT NULL,
    id_cliente     INT           NOT NULL,
    fecha_reserva  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado_reserva VARCHAR(15)   NOT NULL DEFAULT 'PENDIENTE',
    monto_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
    observaciones  VARCHAR(255),
    CONSTRAINT uq_reserva_codigo UNIQUE (codigo_reserva),
    CONSTRAINT fk_reserva_cliente
        FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente) ON DELETE RESTRICT,
    CONSTRAINT chk_reserva_estado CHECK (
        estado_reserva IN ('PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'EXPIRADA')
    ),
    CONSTRAINT chk_reserva_monto CHECK (monto_total >= 0)
);

-- ----------------------------------------------------------------------------
-- 10. DETALLE_RESERVA (Resolución N:M entre RESERVA, TARIFA y PASAJERO)
-- ----------------------------------------------------------------------------
CREATE TABLE detalle_reserva (
    id_detalle           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_reserva           INT           NOT NULL,
    id_tarifa            INT           NOT NULL,
    id_pasajero          INT           NOT NULL,
    asiento_asignado     VARCHAR(5),
    peso_equipaje_kg     NUMERIC(5,2)  NOT NULL DEFAULT 0,
    descripcion_equipaje VARCHAR(200),
    precio_pagado        NUMERIC(12,2) NOT NULL,
    CONSTRAINT fk_detalle_reserva
        FOREIGN KEY (id_reserva) REFERENCES reserva(id_reserva) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_tarifa
        FOREIGN KEY (id_tarifa) REFERENCES tarifa(id_tarifa) ON DELETE RESTRICT,
    CONSTRAINT fk_detalle_pasajero
        FOREIGN KEY (id_pasajero) REFERENCES pasajero(id_pasajero) ON DELETE RESTRICT,
    CONSTRAINT uq_detalle_reserva_tarifa_pasajero UNIQUE (id_reserva, id_tarifa, id_pasajero),
    CONSTRAINT chk_detalle_peso   CHECK (peso_equipaje_kg >= 0 AND peso_equipaje_kg <= 64),
    CONSTRAINT chk_detalle_precio CHECK (precio_pagado > 0)
);

-- ----------------------------------------------------------------------------
-- 11. PAGO
-- ----------------------------------------------------------------------------
--CREATE TABLE pago (
--    id_pago                INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--    id_reserva             INT           NOT NULL,
--    fecha_pago             TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
--    metodo_pago            VARCHAR(25)   NOT NULL,
--    monto_pagado           NUMERIC(12,2) NOT NULL,
--    estado_pago            VARCHAR(15)   NOT NULL DEFAULT 'PENDIENTE',
--    referencia_transaccion VARCHAR(60)   NOT NULL,
--    CONSTRAINT uq_pago_referencia UNIQUE (referencia_transaccion),
--    CONSTRAINT fk_pago_reserva
--        FOREIGN KEY (id_reserva) REFERENCES reserva(id_reserva) ON DELETE RESTRICT,
--    CONSTRAINT chk_pago_metodo CHECK (
--        metodo_pago IN ('TARJETA_CREDITO', 'TARJETA_DEBITO', 'PSE', 'TRANSFERENCIA', 'EFECTIVO')
--    ),
--    CONSTRAINT chk_pago_monto  CHECK (monto_pagado > 0),
--    CONSTRAINT chk_pago_estado CHECK (
--        estado_pago IN ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'REEMBOLSADO')
--    )
--);

-- ----------------------------------------------------------------------------
-- 12. HISTORIAL_BUSQUEDA
-- ----------------------------------------------------------------------------
CREATE TABLE historial_busqueda (
    id_busqueda        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_cliente         INT,
    aeropuerto_origen  CHAR(3)   NOT NULL,
    aeropuerto_destino CHAR(3)   NOT NULL,
    fecha_ida          DATE      NOT NULL,
    fecha_regreso      DATE,
    escalas_maximas    INT,
    cantidad_pasajeros INT       NOT NULL DEFAULT 1,
    fecha_consulta     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_busqueda_cliente
        FOREIGN KEY (id_cliente) REFERENCES cliente(id_cliente) ON DELETE SET NULL,
    CONSTRAINT fk_busqueda_origen
        FOREIGN KEY (aeropuerto_origen) REFERENCES aeropuerto(codigo_iata) ON DELETE RESTRICT,
    CONSTRAINT fk_busqueda_destino
        FOREIGN KEY (aeropuerto_destino) REFERENCES aeropuerto(codigo_iata) ON DELETE RESTRICT,
    CONSTRAINT chk_busqueda_rutas   CHECK (aeropuerto_origen <> aeropuerto_destino),
    CONSTRAINT chk_busqueda_fechas  CHECK (fecha_regreso IS NULL OR fecha_regreso >= fecha_ida),
    CONSTRAINT chk_busqueda_escalas CHECK (escalas_maximas IS NULL OR (escalas_maximas >= 0 AND escalas_maximas <= 5)),
    CONSTRAINT chk_busqueda_pax     CHECK (cantidad_pasajeros >= 1 AND cantidad_pasajeros <= 9)
);

-- ============================================================================
-- CARGA INICIAL DE DATOS (generada desde ciudades.json, aeropuertos.json, aerolineas.json)
-- Orden: ciudad -> aeropuerto (FK a ciudad) -> aerolinea
-- ============================================================================

-- CIUDADES CON AEROPUERTO
INSERT INTO ciudad (id_ciudad, nombre, region, pais, codigo_pais) VALUES
    ('CIU-001', 'Bogotá', 'Andina', 'Colombia', 'CO'),
    ('CIU-002', 'Medellín', 'Andina', 'Colombia', 'CO'),
    ('CIU-003', 'Rionegro', 'Andina', 'Colombia', 'CO'),
 --   ('CIU-004', 'Cali', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-005', 'Palmira', 'Pacífica', 'Colombia', 'CO'),
 --   ('CIU-006', 'Barranquilla', 'Caribe', 'Colombia', 'CO'),
    ('CIU-007', 'Soledad', 'Caribe', 'Colombia', 'CO'),
    ('CIU-008', 'Cartagena', 'Caribe', 'Colombia', 'CO'),
    ('CIU-009', 'Santa Marta', 'Caribe', 'Colombia', 'CO'),
 --   ('CIU-010', 'Bucaramanga', 'Andina', 'Colombia', 'CO'),
    ('CIU-011', 'Lebrija', 'Andina', 'Colombia', 'CO'),
    ('CIU-012', 'Cúcuta', 'Andina', 'Colombia', 'CO'),
    ('CIU-013', 'Pereira', 'Andina', 'Colombia', 'CO'),
 --  ('CIU-014', 'Armenia', 'Andina', 'Colombia', 'CO'),
    ('CIU-015', 'La Tebaida', 'Andina', 'Colombia', 'CO'),
    ('CIU-016', 'Manizales', 'Andina', 'Colombia', 'CO'),
    ('CIU-017', 'Ibagué', 'Andina', 'Colombia', 'CO'),
    ('CIU-018', 'Neiva', 'Andina', 'Colombia', 'CO'),
  --  ('CIU-019', 'Pasto', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-020', 'Chachagüí', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-021', 'Popayán', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-022', 'Montería', 'Caribe', 'Colombia', 'CO'),
    ('CIU-023', 'Valledupar', 'Caribe', 'Colombia', 'CO'),
    ('CIU-024', 'Riohacha', 'Caribe', 'Colombia', 'CO'),
    ('CIU-025', 'San Andrés', 'Insular', 'Colombia', 'CO'),
    ('CIU-026', 'Providencia', 'Insular', 'Colombia', 'CO'),
    ('CIU-027', 'Leticia', 'Amazonía', 'Colombia', 'CO'),
    ('CIU-028', 'Villavicencio', 'Orinoquía', 'Colombia', 'CO'),
    ('CIU-029', 'Yopal', 'Orinoquía', 'Colombia', 'CO'),
    ('CIU-030', 'Arauca', 'Orinoquía', 'Colombia', 'CO'),
    ('CIU-031', 'Puerto Carreño', 'Orinoquía', 'Colombia', 'CO'),
    ('CIU-032', 'Florencia', 'Amazonía', 'Colombia', 'CO'),
    ('CIU-033', 'Puerto Asís', 'Amazonía', 'Colombia', 'CO'),
    ('CIU-034', 'Quibdó', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-035', 'Tumaco', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-036', 'Buenaventura', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-037', 'Barrancabermeja', 'Andina', 'Colombia', 'CO'),
    ('CIU-038', 'Corozal', 'Caribe', 'Colombia', 'CO'),
    ('CIU-039', 'Carepa', 'Andina', 'Colombia', 'CO'),
    ('CIU-040', 'Ipiales', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-041', 'San José del Guaviare', 'Amazonía', 'Colombia', 'CO'),
    ('CIU-042', 'Mitú', 'Amazonía', 'Colombia', 'CO'),
    ('CIU-043', 'Inírida', 'Amazonía', 'Colombia', 'CO'),
    ('CIU-044', 'Puerto Leguízamo', 'Amazonía', 'Colombia', 'CO'),
    ('CIU-045', 'Bahía Solano', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-046', 'Guapi', 'Pacífica', 'Colombia', 'CO'),
    ('CIU-047', 'El Bagre', 'Andina', 'Colombia', 'CO'),
    ('CIU-048', 'Tame', 'Orinoquía', 'Colombia', 'CO'),
    ('CIU-049', 'Ocaña', 'Andina', 'Colombia', 'CO'),
    ('CIU-050', 'Girardot', 'Andina', 'Colombia', 'CO'),
    ('CIU-051', 'Pitalito', 'Andina', 'Colombia', 'CO'),
    ('CIU-052', 'Saravena', 'Orinoquía', 'Colombia', 'CO');

-- AEROPUERTO (47 registros)
INSERT INTO aeropuerto (codigo_iata, nombre, id_ciudad) VALUES
    ('ADZ', 'Aeropuerto Internacional Gustavo Rojas Pinilla', 'CIU-025'),
    ('APO', 'Aeropuerto Antonio Roldán Betancourt', 'CIU-039'),
    ('AUC', 'Aeropuerto Santiago Pérez Quiroz', 'CIU-030'),
    ('AXM', 'Aeropuerto Internacional El Edén', 'CIU-015'),
    ('BAQ', 'Aeropuerto Internacional Ernesto Cortissoz', 'CIU-007'),
    ('BGA', 'Aeropuerto Internacional Palonegro', 'CIU-011'),
    ('BOG', 'Aeropuerto Internacional El Dorado', 'CIU-001'),
    ('BSC', 'Aeropuerto José Celestino Mutis', 'CIU-045'),
    ('BUN', 'Aeropuerto Gerardo Tobar López', 'CIU-036'),
    ('CLO', 'Aeropuerto Internacional Alfonso Bonilla Aragón', 'CIU-005'),
    ('CTG', 'Aeropuerto Internacional Rafael Núñez', 'CIU-008'),
    ('CUC', 'Aeropuerto Internacional Camilo Daza', 'CIU-012'),
    ('CZU', 'Aeropuerto Las Brujas', 'CIU-038'),
    ('EBG', 'Aeropuerto El Tomín', 'CIU-047'),
    ('EJA', 'Aeropuerto Yariguíes', 'CIU-037'),
    ('EOH', 'Aeropuerto Olaya Herrera', 'CIU-002'),
    ('EYP', 'Aeropuerto El Alcaraván', 'CIU-029'),
    ('FLA', 'Aeropuerto Gustavo Artunduaga Paredes', 'CIU-032'),
    ('GIR', 'Aeropuerto Santiago Vila', 'CIU-050'),
    ('GPI', 'Aeropuerto Juan Casiano Solís', 'CIU-046'),
    ('IBE', 'Aeropuerto Perales', 'CIU-017'),
    ('IPI', 'Aeropuerto San Luis', 'CIU-040'),
    ('LET', 'Aeropuerto Internacional Alfredo Vásquez Cobo', 'CIU-027'),
    ('LGZ', 'Aeropuerto Caucayá', 'CIU-044'),
    ('MDE', 'Aeropuerto Internacional José María Córdova', 'CIU-003'),
    ('MTR', 'Aeropuerto Los Garzones', 'CIU-022'),
    ('MVP', 'Aeropuerto Fabio Alberto León Bentley', 'CIU-042'),
    ('MZL', 'Aeropuerto La Nubia', 'CIU-016'),
    ('NVA', 'Aeropuerto Benito Salas', 'CIU-018'),
    ('OCV', 'Aeropuerto Aguas Claras', 'CIU-049'),
    ('PCR', 'Aeropuerto Germán Olano', 'CIU-031'),
    ('PDA', 'Aeropuerto Obando', 'CIU-043'),
    ('PEI', 'Aeropuerto Internacional Matecaña', 'CIU-013'),
    ('PPN', 'Aeropuerto Guillermo León Valencia', 'CIU-021'),
    ('PSO', 'Aeropuerto Antonio Nariño', 'CIU-020'),
    ('PTX', 'Aeropuerto Contador', 'CIU-051'),
    ('PUU', 'Aeropuerto Tres de Mayo', 'CIU-033'),
    ('PVA', 'Aeropuerto El Embrujo', 'CIU-026'),
    ('RCH', 'Aeropuerto Almirante Padilla', 'CIU-024'),
    ('RVE', 'Aeropuerto Los Colonizadores', 'CIU-052'),
    ('SJE', 'Aeropuerto Jorge Enrique González Torres', 'CIU-041'),
    ('SMR', 'Aeropuerto Internacional Simón Bolívar', 'CIU-009'),
    ('TCO', 'Aeropuerto La Florida', 'CIU-035'),
    ('TME', 'Aeropuerto Gustavo Vargas', 'CIU-048'),
    ('UIB', 'Aeropuerto El Caraño', 'CIU-034'),
    ('VUP', 'Aeropuerto Alfonso López Pumarejo', 'CIU-023'),
    ('VVC', 'Aeropuerto Vanguardia', 'CIU-028');

 
-- AEROLINEA (6 registros)
INSERT INTO aerolinea (id_aerolinea, codigo_iata, nombre, pais_origen, estado) VALUES
    ('AER-001', 'AV', 'Avianca', 'Colombia', 'Y'),
    ('AER-002', '4C', 'LATAM Airlines Colombia', 'Colombia', 'Y'),
    ('AER-003', 'P5', 'Wingo', 'Colombia', 'Y'),
    ('AER-004', '9R', 'Satena', 'Colombia', 'Y'),
    ('AER-005', 'VE', 'Clic (antes EasyFly)', 'Colombia', 'Y'),
    ('AER-006', 'VH', 'Viva Air Colombia', 'Colombia', 'N');
	
--ADMINISTRADOR
INSERT INTO administrador (correo, contrasena) values
 ('admin','admin');
 
SELECT * FROM aeropuerto a
 

