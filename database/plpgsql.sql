-- Lógica en PL/pgSQL. Se puede correr varias veces (CREATE OR REPLACE); el servidor la aplica al arrancar.
-- Errores de negocio: AL404 (no existe), AL409 (conflicto), AL400 (dato inválido).

-- devuelve los cupos de la reserva y le cambia el estado
CREATE OR REPLACE PROCEDURE sp_liberar_reserva(p_id_reserva INT, p_estado VARCHAR, p_observacion VARCHAR DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE vuelo v
       SET cupos_disponibles = LEAST(v.capacidad_total, v.cupos_disponibles + x.n)
      FROM (SELECT t.id_vuelo, COUNT(*)::int AS n
              FROM detalle_reserva d JOIN tarifa t ON t.id_tarifa = d.id_tarifa
             WHERE d.id_reserva = p_id_reserva
             GROUP BY t.id_vuelo) x
     WHERE v.id_vuelo = x.id_vuelo;

    UPDATE tarifa t
       SET cupos_tarifa = t.cupos_tarifa + x.n
      FROM (SELECT d.id_tarifa, COUNT(*)::int AS n
              FROM detalle_reserva d
             WHERE d.id_reserva = p_id_reserva
             GROUP BY d.id_tarifa) x
     WHERE t.id_tarifa = x.id_tarifa;

    UPDATE reserva
       SET estado_reserva = p_estado,
           observaciones  = COALESCE(p_observacion, observaciones)
     WHERE id_reserva = p_id_reserva;
END;
$$;

-- expira las pendientes que no se pagaron a tiempo
CREATE OR REPLACE PROCEDURE sp_expirar_reservas(p_minutos INT)
LANGUAGE plpgsql AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id_reserva
          FROM reserva
         WHERE estado_reserva = 'PENDIENTE'
           AND fecha_reserva < (now() AT TIME ZONE 'America/Bogota') - make_interval(mins => p_minutos)
         ORDER BY id_reserva
           FOR UPDATE SKIP LOCKED
    LOOP
        CALL sp_liberar_reserva(r.id_reserva, 'EXPIRADA', 'Expirada por falta de pago');
    END LOOP;
END;
$$;

-- p_id_cliente NULL = cancela un administrador
CREATE OR REPLACE PROCEDURE sp_cancelar_reserva(p_id_reserva INT, p_id_cliente INT, p_observacion VARCHAR DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE
    v_estado reserva.estado_reserva%TYPE;
BEGIN
    SELECT estado_reserva INTO v_estado
      FROM reserva
     WHERE id_reserva = p_id_reserva AND (p_id_cliente IS NULL OR id_cliente = p_id_cliente)
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No encontramos esa reserva.' USING ERRCODE = 'AL404';
    END IF;
    IF v_estado NOT IN ('PENDIENTE', 'CONFIRMADA') THEN
        RAISE EXCEPTION 'Esta reserva ya no se puede cancelar.' USING ERRCODE = 'AL409';
    END IF;
    IF p_id_cliente IS NOT NULL AND EXISTS (
        SELECT 1
          FROM detalle_reserva d
          JOIN tarifa t ON t.id_tarifa = d.id_tarifa
          JOIN vuelo  v ON v.id_vuelo  = t.id_vuelo
         WHERE d.id_reserva = p_id_reserva
           AND v.fecha_salida <= (now() AT TIME ZONE 'America/Bogota')
    ) THEN
        RAISE EXCEPTION 'No puedes cancelar una reserva con vuelos que ya salieron.' USING ERRCODE = 'AL409';
    END IF;

    CALL sp_liberar_reserva(
        p_id_reserva, 'CANCELADA',
        COALESCE(p_observacion, CASE WHEN p_id_cliente IS NULL THEN 'Cancelada por el administrador' ELSE 'Cancelada por el cliente' END)
    );
END;
$$;

-- pago simulado: devuelve la referencia
CREATE OR REPLACE FUNCTION fn_pagar_reserva(p_id_reserva INT, p_id_cliente INT, p_metodo VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql AS $$
DECLARE
    v_estado     reserva.estado_reserva%TYPE;
    v_referencia VARCHAR(10);
BEGIN
    IF p_metodo NOT IN ('TARJETA_CREDITO', 'TARJETA_DEBITO', 'PSE', 'TRANSFERENCIA') THEN
        RAISE EXCEPTION 'Selecciona un método de pago válido.' USING ERRCODE = 'AL400';
    END IF;

    SELECT estado_reserva INTO v_estado
      FROM reserva
     WHERE id_reserva = p_id_reserva AND id_cliente = p_id_cliente
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No encontramos esa reserva.' USING ERRCODE = 'AL404';
    ELSIF v_estado = 'EXPIRADA' THEN
        RAISE EXCEPTION 'La reserva expiró por falta de pago. Realiza una nueva búsqueda.' USING ERRCODE = 'AL409';
    ELSIF v_estado <> 'PENDIENTE' THEN
        RAISE EXCEPTION 'Esta reserva ya no está pendiente de pago.' USING ERRCODE = 'AL409';
    END IF;

    v_referencia := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
    UPDATE reserva
       SET estado_reserva = 'CONFIRMADA',
           observaciones  = format('Pago simulado (%s) ref. %s', p_metodo, v_referencia)
     WHERE id_reserva = p_id_reserva;

    RETURN v_referencia;
END;
$$;

-- mantiene reserva.monto_total igual a la suma de los detalles
CREATE OR REPLACE FUNCTION fn_actualizar_monto_reserva()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_id reserva.id_reserva%TYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN v_id := OLD.id_reserva; ELSE v_id := NEW.id_reserva; END IF;

    UPDATE reserva
       SET monto_total = COALESCE((SELECT SUM(precio_pagado) FROM detalle_reserva WHERE id_reserva = v_id), 0)
     WHERE id_reserva = v_id;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_detalle_monto ON detalle_reserva;
CREATE TRIGGER trg_detalle_monto
AFTER INSERT OR UPDATE OF precio_pagado OR DELETE ON detalle_reserva
FOR EACH ROW EXECUTE FUNCTION fn_actualizar_monto_reserva();

-- solo deja pasar los cambios de estado válidos
CREATE OR REPLACE FUNCTION fn_validar_estado_reserva()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.estado_reserva <> OLD.estado_reserva AND NOT (
        (OLD.estado_reserva = 'PENDIENTE'  AND NEW.estado_reserva IN ('CONFIRMADA', 'CANCELADA', 'EXPIRADA')) OR
        (OLD.estado_reserva = 'CONFIRMADA' AND NEW.estado_reserva = 'CANCELADA')
    ) THEN
        RAISE EXCEPTION 'Cambio de estado no permitido: % -> %', OLD.estado_reserva, NEW.estado_reserva USING ERRCODE = 'AL409';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reserva_estado ON reserva;
CREATE TRIGGER trg_reserva_estado
BEFORE UPDATE OF estado_reserva ON reserva
FOR EACH ROW EXECUTE FUNCTION fn_validar_estado_reserva();
