-- ============================================================================
-- AereoLink - DATOS DEMO (opcional)
-- Ejecutar DESPUÉS de Proyecto_Aerolink.sql.
--
-- Genera vuelos, segmentos y tarifas para los próximos 45 días en varias rutas
-- de Colombia, más un cliente de prueba:
--     correo: demo@aerolink.com      contraseña: Demo1234
--
-- Se puede volver a ejecutar cuando quieras: agrega los días nuevos y no
-- duplica lo que ya existe.
-- ============================================================================

-- ---------- Cliente de prueba ----------
INSERT INTO cliente (tipo_documento, numero_documento, nombre_completo, correo, telefono, fecha_nacimiento, contrasena)
VALUES ('CC', '1000000001', 'Cliente Demo', 'demo@aerolink.com', '3001234567', DATE '1995-05-20', 'Demo1234')
ON CONFLICT DO NOTHING;

-- ---------- Rutas base (se generan en ambos sentidos) ----------
-- via = aeropuerto de escala (NULL = directo)
CREATE TEMP TABLE _ruta (
    id_ruta     INT,
    origen      CHAR(3),
    destino     CHAR(3),
    via         CHAR(3),
    dur1_min    INT,      -- duración del primer tramo (o del vuelo directo)
    espera_min  INT,      -- espera en la escala
    dur2_min    INT,      -- duración del segundo tramo
    precio_base NUMERIC
);

INSERT INTO _ruta VALUES
    ( 1, 'BOG', 'MDE', NULL,  50,   0,   0, 189000),
    ( 2, 'BOG', 'CTG', NULL,  95,   0,   0, 259000),
    ( 3, 'BOG', 'CLO', NULL,  65,   0,   0, 199000),
    ( 4, 'BOG', 'BAQ', NULL,  90,   0,   0, 249000),
    ( 5, 'BOG', 'SMR', NULL,  95,   0,   0, 269000),
    ( 6, 'BOG', 'ADZ', NULL, 140,   0,   0, 389000),
    ( 7, 'BOG', 'PEI', NULL,  50,   0,   0, 179000),
    ( 8, 'BOG', 'BGA', NULL,  60,   0,   0, 189000),
    ( 9, 'BOG', 'CUC', NULL,  75,   0,   0, 219000),
    (10, 'BOG', 'LET', NULL, 105,   0,   0, 329000),
    (11, 'BOG', 'MTR', NULL,  80,   0,   0, 229000),
    (12, 'MDE', 'CTG', NULL,  70,   0,   0, 219000),
    (13, 'MDE', 'CLO', NULL,  55,   0,   0, 169000),
    (14, 'MDE', 'ADZ', NULL, 110,   0,   0, 349000),
    (15, 'CLO', 'CTG', 'BOG', 65,  75,  95, 329000),
    (16, 'CLO', 'BAQ', 'BOG', 65,  80,  90, 319000),
    (17, 'BAQ', 'MDE', NULL,  70,   0,   0, 209000),
    (18, 'CTG', 'PEI', 'BOG', 95,  70,  50, 299000),
    (19, 'SMR', 'MDE', 'BOG', 95,  90,  50, 309000),
    (20, 'BGA', 'CTG', 'BOG', 60,  75,  95, 289000);

-- Ambos sentidos
CREATE TEMP TABLE _ruta2 AS
SELECT id_ruta * 2 - 1 AS id_dir, origen, destino, via, dur1_min, espera_min, dur2_min, precio_base FROM _ruta
UNION ALL
SELECT id_ruta * 2, destino, origen, via,
       CASE WHEN via IS NULL THEN dur1_min ELSE dur2_min END,
       espera_min,
       CASE WHEN via IS NULL THEN 0 ELSE dur1_min END,
       precio_base
FROM _ruta;

-- Franjas horarias diarias
CREATE TEMP TABLE _franja (slot INT, hora TIME);
INSERT INTO _franja VALUES (1, '06:30'), (2, '12:15'), (3, '18:40');

-- ---------- VUELOS ----------
-- Aerolíneas activas: AER-001 ... AER-005
INSERT INTO vuelo (codigo_vuelo, id_aerolinea, aeropuerto_origen, aeropuerto_destino,
                   fecha_salida, fecha_llegada, cantidad_escalas, capacidad_total,
                   cupos_disponibles, precio_base, estado)
SELECT
    al.codigo_iata || (r.id_dir * 10 + f.slot) || '-' || to_char(d.dia, 'MMDD'),
    al.id_aerolinea,
    r.origen,
    r.destino,
    d.dia + f.hora + ((r.id_dir % 4) * 5) * INTERVAL '1 minute',
    d.dia + f.hora + ((r.id_dir % 4) * 5) * INTERVAL '1 minute'
        + (r.dur1_min + r.espera_min + r.dur2_min) * INTERVAL '1 minute',
    CASE WHEN r.via IS NULL THEN 0 ELSE 1 END,
    cap.capacidad,
    cap.capacidad - (random() * cap.capacidad * 0.35)::int,
    -- precio: base de la ruta con variación por franja y por día de la semana
    round((r.precio_base
           * (CASE f.slot WHEN 1 THEN 0.92 WHEN 2 THEN 1.00 ELSE 1.12 END)
           * (CASE WHEN EXTRACT(ISODOW FROM d.dia) IN (5, 7) THEN 1.15 ELSE 1.00 END)
           * (CASE al.id_aerolinea WHEN 'AER-003' THEN 0.82 ELSE 1.00 END)
           * (0.95 + random() * 0.20)) / 1000) * 1000,
    'PROGRAMADO'
FROM _ruta2 r
CROSS JOIN _franja f
CROSS JOIN (SELECT (CURRENT_DATE + n)::date AS dia FROM generate_series(0, 44) AS n) AS d
JOIN aerolinea al
  ON al.id_aerolinea = 'AER-00' || (1 + ((r.id_dir + f.slot) % 5))
CROSS JOIN LATERAL (
    SELECT CASE al.id_aerolinea
             WHEN 'AER-004' THEN 78
             WHEN 'AER-005' THEN 90
             WHEN 'AER-003' THEN 186
             ELSE 174
           END AS capacidad
) cap
ON CONFLICT (codigo_vuelo) DO NOTHING;

-- ---------- SEGMENTOS (solo para vuelos que todavía no los tienen) ----------
-- Vuelos directos: un segmento
INSERT INTO segmento_vuelo (id_vuelo, orden_segmento, aeropuerto_salida, aeropuerto_llegada,
                            fecha_salida_seg, fecha_llegada_seg, tiempo_escala_min)
SELECT v.id_vuelo, 1, v.aeropuerto_origen, v.aeropuerto_destino, v.fecha_salida, v.fecha_llegada, 0
FROM vuelo v
WHERE v.cantidad_escalas = 0
  AND NOT EXISTS (SELECT 1 FROM segmento_vuelo s WHERE s.id_vuelo = v.id_vuelo);

-- Vuelos con 1 escala: dos segmentos (tramo 1, espera, tramo 2)
INSERT INTO segmento_vuelo (id_vuelo, orden_segmento, aeropuerto_salida, aeropuerto_llegada,
                            fecha_salida_seg, fecha_llegada_seg, tiempo_escala_min)
SELECT v.id_vuelo, 1, v.aeropuerto_origen, r.via,
       v.fecha_salida, v.fecha_salida + r.dur1_min * INTERVAL '1 minute', 0
FROM vuelo v
JOIN _ruta2 r ON r.origen = v.aeropuerto_origen AND r.destino = v.aeropuerto_destino
WHERE v.cantidad_escalas = 1
  AND NOT EXISTS (SELECT 1 FROM segmento_vuelo s WHERE s.id_vuelo = v.id_vuelo);

INSERT INTO segmento_vuelo (id_vuelo, orden_segmento, aeropuerto_salida, aeropuerto_llegada,
                            fecha_salida_seg, fecha_llegada_seg, tiempo_escala_min)
SELECT v.id_vuelo, 2, r.via, v.aeropuerto_destino,
       v.fecha_salida + (r.dur1_min + r.espera_min) * INTERVAL '1 minute',
       v.fecha_llegada,
       r.espera_min
FROM vuelo v
JOIN _ruta2 r ON r.origen = v.aeropuerto_origen AND r.destino = v.aeropuerto_destino
WHERE v.cantidad_escalas = 1
  AND NOT EXISTS (SELECT 1 FROM segmento_vuelo s WHERE s.id_vuelo = v.id_vuelo AND s.orden_segmento = 2)
  AND EXISTS     (SELECT 1 FROM segmento_vuelo s WHERE s.id_vuelo = v.id_vuelo AND s.orden_segmento = 1);

-- ---------- TARIFAS (solo para vuelos sin tarifas) ----------
-- Económica Light: la más barata (= precio_base del vuelo)
INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'ECONOMICA', 'Light', v.precio_base, 10, 0, FALSE, FALSE,
       GREATEST(1, (v.cupos_disponibles * 0.6)::int)
FROM vuelo v
WHERE NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo);

-- Económica Classic: con maleta de bodega y cambios
INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'ECONOMICA', 'Classic', round(v.precio_base * 1.28 / 1000) * 1000, 10, 23, TRUE, FALSE,
       GREATEST(1, (v.cupos_disponibles * 0.4)::int)
FROM vuelo v
WHERE NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.nombre_tarifa = 'Classic');

-- Económica Premium Flex (no aplica a Wingo ni Satena)
INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'ECONOMICA_PREMIUM', 'Premium Flex', round(v.precio_base * 1.75 / 1000) * 1000, 12, 23, TRUE, TRUE,
       GREATEST(1, (v.cupos_disponibles * 0.2)::int)
FROM vuelo v
WHERE v.id_aerolinea IN ('AER-001', 'AER-002', 'AER-005')
  AND NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.nombre_tarifa = 'Premium Flex');

-- Ejecutiva (solo Avianca y LATAM)
INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'EJECUTIVA', 'Business', round(v.precio_base * 2.9 / 1000) * 1000, 15, 32, TRUE, TRUE,
       GREATEST(1, (v.cupos_disponibles * 0.08)::int)
FROM vuelo v
WHERE v.id_aerolinea IN ('AER-001', 'AER-002')
  AND NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.nombre_tarifa = 'Business');

-- Resumen
SELECT (SELECT COUNT(*) FROM vuelo)          AS vuelos,
       (SELECT COUNT(*) FROM segmento_vuelo) AS segmentos,
       (SELECT COUNT(*) FROM tarifa)         AS tarifas;
