-- Datos de demostración. Se corre después de Proyecto_Aerolink.sql y se puede repetir:
-- solo agrega los días nuevos. Cliente de prueba: demo@aerolink.com / Demo1234

INSERT INTO cliente (tipo_documento, numero_documento, nombre_completo, correo, telefono, fecha_nacimiento, contrasena)
VALUES ('CC', '1000000001', 'Cliente Demo', 'demo@aerolink.com', '3001234567', DATE '1995-05-20', 'Demo1234')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_vuelo_ruta_fecha ON vuelo (aeropuerto_origen, aeropuerto_destino, fecha_salida);

-- Los vuelos de la primera versión de los datos usaban un código corto (AV11-1210).
-- Se reemplazan por los nuevos, salvo los que ya tengan reservas.
DELETE FROM vuelo v
WHERE v.codigo_vuelo ~ '^[A-Z0-9]{2}[0-9]{1,3}-[0-9]{4}$'
  AND NOT EXISTS (SELECT 1 FROM tarifa t JOIN detalle_reserva d ON d.id_tarifa = t.id_tarifa
                  WHERE t.id_vuelo = v.id_vuelo);

-- nivel 1: centros principales, 2: capitales y destinos grandes, 3: aeropuertos regionales
CREATE TEMP TABLE _apt (cod CHAR(3) PRIMARY KEY, lat DOUBLE PRECISION, lon DOUBLE PRECISION, nivel INT);
INSERT INTO _apt VALUES
    ('BOG',  4.701, -74.147, 1), ('MDE',  6.164, -75.423, 1),
    ('CLO',  3.543, -76.382, 2), ('CTG', 10.443, -75.513, 2), ('BAQ', 10.890, -74.781, 2),
    ('SMR', 11.120, -74.231, 2), ('BGA',  7.128, -73.181, 2), ('CUC',  7.928, -72.511, 2),
    ('PEI',  4.813, -75.739, 2), ('ADZ', 12.584, -81.711, 2), ('MTR',  8.824, -75.826, 2);
INSERT INTO _apt VALUES
    ('APO',  7.968, -76.716, 3), ('AUC',  7.069, -70.737, 3), ('AXM',  4.453, -75.766, 3),
    ('BSC',  6.203, -77.395, 3), ('BUN',  3.820, -76.990, 3), ('CZU',  9.332, -75.286, 3),
    ('EBG',  7.597, -74.809, 3), ('EJA',  7.024, -73.807, 3), ('EOH',  6.220, -75.591, 3),
    ('EYP',  5.319, -72.384, 3), ('FLA',  1.589, -75.564, 3), ('GIR',  4.282, -74.797, 3),
    ('GPI',  2.571, -77.887, 3), ('IBE',  4.422, -75.133, 3), ('IPI',  0.862, -77.672, 3),
    ('LET', -4.194, -69.943, 3), ('LGZ', -0.183, -74.771, 3), ('MVP',  1.254, -70.234, 3),
    ('MZL',  5.030, -75.465, 3), ('NVA',  2.950, -75.294, 3), ('OCV',  8.315, -73.358, 3),
    ('PCR',  6.185, -67.493, 3), ('PDA',  3.853, -67.906, 3), ('PPN',  2.454, -76.610, 3),
    ('PSO',  1.396, -77.291, 3), ('PTX',  1.858, -76.085, 3), ('PUU',  0.505, -76.501, 3),
    ('PVA', 13.357, -81.358, 3), ('RCH', 11.526, -72.926, 3), ('RVE',  6.952, -71.857, 3),
    ('SJE',  2.580, -72.640, 3), ('TCO',  1.814, -78.749, 3), ('TME',  6.455, -71.763, 3),
    ('UIB',  5.691, -76.641, 3), ('VUP', 10.435, -73.250, 3), ('VVC',  4.168, -73.614, 3);

-- Distancia en km entre cada par de aeropuertos
CREATE TEMP TABLE _dist AS
SELECT a.cod AS o, b.cod AS d, a.nivel AS nivel_o, b.nivel AS nivel_d,
       6371 * acos(LEAST(1, sin(radians(a.lat)) * sin(radians(b.lat))
                          + cos(radians(a.lat)) * cos(radians(b.lat)) * cos(radians(b.lon - a.lon)))) AS km
FROM _apt a JOIN _apt b ON a.cod <> b.cod;

CREATE TEMP TABLE _hub (cod CHAR(3));
INSERT INTO _hub VALUES ('BOG'), ('MDE'), ('CLO'), ('BAQ');

-- Una ruta por cada par ordenado de aeropuertos. Si no hay vuelo directo se pasa por el hub más cercano al camino.
CREATE TEMP TABLE _via AS
SELECT x.o, x.d, x.km, x.directo, x.frecuente,
       CASE WHEN x.directo THEN NULL ELSE
            (SELECT h.cod FROM _hub h
               JOIN _dist d1 ON d1.o = x.o AND d1.d = h.cod
               JOIN _dist d2 ON d2.o = h.cod AND d2.d = x.d
              ORDER BY d1.km + d2.km, h.cod LIMIT 1)
       END AS via
FROM (SELECT o, d, km,
             (o = 'BOG' OR d = 'BOG' OR (nivel_o <= 2 AND nivel_d <= 2) OR km < 250) AS directo,
             ((o = 'BOG' OR d = 'BOG' OR (nivel_o <= 2 AND nivel_d <= 2)) AND LEAST(nivel_o, nivel_d) <= 2) AS frecuente
      FROM _dist) x;

CREATE TEMP TABLE _ruta2 AS
SELECT row_number() OVER (ORDER BY v.o, v.d) AS id_dir,
       v.o AS origen, v.d AS destino, v.via, v.frecuente,
       CASE WHEN v.via IS NULL THEN round(25 + v.km / 10)::int ELSE round(25 + d1.km / 10)::int END AS dur1_min,
       CASE WHEN v.via IS NULL THEN 0 ELSE 60 + (abs(hashtext(v.o || v.d)) % 5) * 10 END AS espera_min,
       CASE WHEN v.via IS NULL THEN 0 ELSE round(25 + d2.km / 10)::int END AS dur2_min,
       CASE WHEN v.via IS NULL THEN round((120000 + v.km * 230) / 1000) * 1000
            ELSE round((110000 + (d1.km + d2.km) * 200) / 1000) * 1000 END AS precio_base
FROM _via v
LEFT JOIN _dist d1 ON d1.o = v.o AND d1.d = v.via
LEFT JOIN _dist d2 ON d2.o = v.via AND d2.d = v.d;

CREATE TEMP TABLE _franja (slot INT, hora TIME);
INSERT INTO _franja VALUES (1, '06:30'), (2, '12:15'), (3, '18:40');

-- Rutas frecuentes: 3 salidas al día. Las demás: 2 (se omite una franja distinta según la ruta).
-- Aerolíneas activas: AER-001 a AER-005.
INSERT INTO vuelo (codigo_vuelo, id_aerolinea, aeropuerto_origen, aeropuerto_destino,
                   fecha_salida, fecha_llegada, cantidad_escalas, capacidad_total,
                   cupos_disponibles, precio_base, estado)
SELECT
    al.codigo_iata || lpad(r.id_dir::text, 4, '0') || f.slot || '-' || to_char(d.dia, 'MMDD'),
    al.id_aerolinea,
    r.origen,
    r.destino,
    d.dia + f.hora + ((r.id_dir % 12) * 5) * INTERVAL '1 minute',
    d.dia + f.hora + ((r.id_dir % 12) * 5) * INTERVAL '1 minute'
        + (r.dur1_min + r.espera_min + r.dur2_min) * INTERVAL '1 minute',
    CASE WHEN r.via IS NULL THEN 0 ELSE 1 END,
    cap.capacidad,
    cap.capacidad - (random() * cap.capacidad * 0.35)::int,
    round((r.precio_base
           * (CASE f.slot WHEN 1 THEN 0.92 WHEN 2 THEN 1.00 ELSE 1.12 END)
           * (CASE WHEN EXTRACT(ISODOW FROM d.dia) IN (5, 7) THEN 1.15 ELSE 1.00 END)
           * (CASE al.id_aerolinea WHEN 'AER-003' THEN 0.82 ELSE 1.00 END)
           * (0.95 + random() * 0.20)) / 1000) * 1000,
    'PROGRAMADO'
FROM _ruta2 r
JOIN _franja f ON r.frecuente OR f.slot <> (r.id_dir % 3) + 1
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

-- Segmentos: uno por vuelo directo, dos por vuelo con escala
INSERT INTO segmento_vuelo (id_vuelo, orden_segmento, aeropuerto_salida, aeropuerto_llegada,
                            fecha_salida_seg, fecha_llegada_seg, tiempo_escala_min)
SELECT v.id_vuelo, 1, v.aeropuerto_origen, COALESCE(r.via, v.aeropuerto_destino),
       v.fecha_salida,
       CASE WHEN r.via IS NULL THEN v.fecha_llegada ELSE v.fecha_salida + r.dur1_min * INTERVAL '1 minute' END,
       0
FROM vuelo v
JOIN _ruta2 r ON r.origen = v.aeropuerto_origen AND r.destino = v.aeropuerto_destino
WHERE NOT EXISTS (SELECT 1 FROM segmento_vuelo s WHERE s.id_vuelo = v.id_vuelo AND s.orden_segmento = 1);

INSERT INTO segmento_vuelo (id_vuelo, orden_segmento, aeropuerto_salida, aeropuerto_llegada,
                            fecha_salida_seg, fecha_llegada_seg, tiempo_escala_min)
SELECT v.id_vuelo, 2, r.via, v.aeropuerto_destino,
       v.fecha_salida + (r.dur1_min + r.espera_min) * INTERVAL '1 minute',
       v.fecha_llegada,
       r.espera_min
FROM vuelo v
JOIN _ruta2 r ON r.origen = v.aeropuerto_origen AND r.destino = v.aeropuerto_destino
WHERE r.via IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM segmento_vuelo s WHERE s.id_vuelo = v.id_vuelo AND s.orden_segmento = 2);

-- Tarifas. Light = precio base del vuelo.
INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'ECONOMICA', 'Light', v.precio_base, 10, 0, FALSE, FALSE,
       GREATEST(1, (v.cupos_disponibles * 0.6)::int)
FROM vuelo v
WHERE NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.nombre_tarifa = 'Light');

INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'ECONOMICA', 'Classic', round(v.precio_base * 1.28 / 1000) * 1000, 10, 23, TRUE, FALSE,
       GREATEST(1, (v.cupos_disponibles * 0.4)::int)
FROM vuelo v
WHERE NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.nombre_tarifa = 'Classic');

-- Premium Flex no aplica a Wingo ni Satena
INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'ECONOMICA_PREMIUM', 'Premium Flex', round(v.precio_base * 1.75 / 1000) * 1000, 12, 23, TRUE, TRUE,
       GREATEST(1, (v.cupos_disponibles * 0.2)::int)
FROM vuelo v
WHERE v.id_aerolinea IN ('AER-001', 'AER-002', 'AER-005')
  AND NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.nombre_tarifa = 'Premium Flex');

-- Ejecutiva solo en Avianca y LATAM
INSERT INTO tarifa (id_vuelo, clase_cabina, nombre_tarifa, precio_tarifa, equipaje_mano_kg,
                    equipaje_bodega_kg, permite_cambios, reembolsable, cupos_tarifa)
SELECT v.id_vuelo, 'EJECUTIVA', 'Business', round(v.precio_base * 2.9 / 1000) * 1000, 15, 32, TRUE, TRUE,
       GREATEST(1, (v.cupos_disponibles * 0.08)::int)
FROM vuelo v
WHERE v.id_aerolinea IN ('AER-001', 'AER-002')
  AND NOT EXISTS (SELECT 1 FROM tarifa t WHERE t.id_vuelo = v.id_vuelo AND t.nombre_tarifa = 'Business');

SELECT (SELECT COUNT(*) FROM vuelo)          AS vuelos,
       (SELECT COUNT(*) FROM segmento_vuelo) AS segmentos,
       (SELECT COUNT(*) FROM tarifa)         AS tarifas;
