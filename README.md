# AereoLink

Intermediaria de vuelos (estilo Despegar): buscador, resultados con tarifas, reserva con datos de pasajeros,
pago simulado, historial de reservas, perfil y panel de administración. Todo sobre tu base de datos PostgreSQL.

## Cómo ejecutarlo

**En Windows, lo más fácil:** haz doble clic en **`Inicio.bat`**. La primera vez instala lo necesario, te pide la contraseña de PostgreSQL,
crea las tablas y los vuelos de demostración; las siguientes veces solo enciende el servidor y abre la página.

O a mano:

Necesitas **Node.js 18 o superior** y **PostgreSQL** encendido.

```bash
npm install                 # instala la única dependencia (pg)
cp .env.example .env        # en Windows: copy .env.example .env
# edita .env con tu usuario y contraseña de PostgreSQL (DB_USER, DB_PASSWORD, ...)
npm run db:init             # crea la base "aerolink", las tablas y los vuelos de demostración
npm start                   # abre http://localhost:3000
```

* `npm run db:init` **borra y recrea las tablas**. Si ya hay clientes, pide confirmar con `npm run db:init -- --forzar`.
* `npm run db:demo` solo renueva los vuelos de demostración (no borra nada). Úsalo cuando pasen los días y se acaben los vuelos futuros.
* Los vuelos de demostración cubren todas las rutas entre los 47 aeropuertos (ida y vuelta), con 2 o 3 salidas al día durante 45 días desde que ejecutas el comando. Las rutas sin vuelo directo pasan por una escala (BOG, MDE, CLO o BAQ).

## Cuentas de prueba

| Rol | Usuario | Contraseña |
| --- | --- | --- |
| Cliente | `demo@aerolink.com` | `Demo1234` |
| Administrador | `admin` | `admin` |

## Estructura

```
database/   Proyecto_Aerolink.sql (tu script) y datos_demo.sql
server/     API en Node (sin frameworks, solo "pg"): rutas, sesiones y servicios
public/     El sitio (HTML + CSS + JS puro)
  index.html        buscador            auth.html        ingreso / registro
  resultados.html   vuelos y tarifas    reservar.html    datos de pasajeros
  pago.html         pago y confirmación mis-reservas.html historial
  perfil.html       datos de la cuenta  admin.html        panel de administración
  css/  styles.css (base) · auth.css (formularios) · app.css (resto)
  js/   comun.js (utilidades y conexión con la API) + un archivo por página
scripts/    init-db.js
```

## Flujo de una reserva

1. **Buscar** (`/api/vuelos`): origen, destino, fechas y pasajeros. Se guarda en `historial_busqueda` si hay sesión.
2. **Elegir tarifa** de ida (y de vuelta si aplica).
3. **Pasajeros** (`/api/reservas`): crea la reserva en estado `PENDIENTE`, descuenta cupos, asigna asientos y calcula el total en el servidor.
4. **Pago** (`/api/reservas/:id/pagar`): pasa a `CONFIRMADA`. Si no se paga en 30 minutos queda `EXPIRADA` y se liberan los cupos
   (cámbialo con `MINUTOS_PARA_PAGAR` en `.env`).
5. **Cancelar**: libera los cupos. Si el administrador cancela un vuelo, se cancelan las reservas que lo incluyen.

## Cosas que debes saber

* **El pago es simulado**: no se piden datos de tarjeta ni hay cobro real (la tabla `pago` está comentada en tu SQL).
* **Las contraseñas se guardan en texto plano**, porque el esquema las tiene como `VARCHAR(20)`. Es válido para un proyecto académico;
  en un sistema real irían con hash (bcrypt/argon2) y la columna tendría que ser más larga.
* Tu `Proyecto_Aerolink.sql` no incluye `DROP TABLE administrador`, así que ejecutarlo a mano dos veces falla. `npm run db:init` ya lo resuelve.
* El panel de administración crea **vuelos directos** (con sus tres tarifas: Light, Classic y Premium Flex).
