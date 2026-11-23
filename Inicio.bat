@echo off
setlocal EnableExtensions
title AereoLink
cd /d "%~dp0"

if not exist "package.json" goto sin_carpeta

rem ============================================================
rem  CAMINO RAPIDO: si todo ya esta instalado, solo enciende.
rem  (instalado.flag lo crea este mismo archivo al terminar la instalacion)
rem ============================================================
if not exist "instalado.flag" goto instalar
rem  Si pasaron 30 dias o mas, renueva los vuelos de demostracion (no borra nada).
forfiles /m "instalado.flag" /d -30 >nul 2>&1
if errorlevel 1 goto servidor
echo.
echo  Renovando los vuelos de demostracion (no se borra nada)...
call npm run db:demo
echo ok> "instalado.flag"
goto servidor

rem ============================================================
rem  INSTALACION (solo la primera vez)
rem ============================================================
:instalar
echo.
echo  ==========================================
echo    AereoLink  -  Primera instalacion
echo  ==========================================
echo.
where node >nul 2>&1
if errorlevel 1 goto sin_node

if exist "node_modules\pg" goto config
echo  [1/4] Instalando dependencias (puede tardar un poco)...
call npm install
if errorlevel 1 goto error_npm

:config
if exist ".env" goto base
:pedir_clave
echo.
echo  [2/4] Configuracion de PostgreSQL
echo        Escribe la contrasena que pusiste al INSTALAR PostgreSQL
echo        (la del usuario "postgres") y pulsa Enter.
echo.
copy /y ".env.example" ".env" >nul
set "DBPW="
set /p "DBPW=  Contrasena: "
if not defined DBPW goto pedir_clave
powershell -NoProfile -Command "$p=$env:DBPW; $s=-join ((48..57)+(97..122)|Get-Random -Count 40|ForEach-Object{[char]$_}); $l=Get-Content -Encoding UTF8 '.env'|ForEach-Object{ if($_ -match '^DB_PASSWORD='){'DB_PASSWORD='+$p} elseif($_ -match '^SESSION_SECRET='){'SESSION_SECRET='+$s} else{$_} }; [IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'),$l)"
set "DBPW="

:base
echo.
echo  [3/4] Revisando la base de datos...
rem  Codigos: 0 = tablas ya existen, 1 = faltan, 3 = contrasena mala, 4 = PostgreSQL apagado
node -e "const {Client}=require('pg');const c=new Client(require('./server/config').db);c.connect().then(()=>c.query('SELECT 1 FROM cliente LIMIT 1')).then(()=>process.exit(0)).catch(e=>{const k=e.code||(e.errors&&e.errors[0]&&e.errors[0].code);process.exit(k==='28P01'?3:(k==='ECONNREFUSED'||k==='ETIMEDOUT')?4:1)})"
set "ESTADO=%errorlevel%"
if "%ESTADO%"=="0" goto listo
if "%ESTADO%"=="3" goto clave_mala
if "%ESTADO%"=="4" goto sin_postgres

echo        Creando tablas y vuelos de demostracion...
call npm run db:init
if errorlevel 1 goto error_bd

:listo
echo ok> "instalado.flag"
echo.
echo  Instalacion completa. La proxima vez Inicio.bat encendera directo.
goto servidor

:clave_mala
echo.
echo  La contrasena de PostgreSQL no es correcta. Vamos a escribirla de nuevo.
del /q ".env" >nul 2>&1
goto pedir_clave

rem ============================================================
rem  SERVIDOR
rem ============================================================
:servidor
set "PUERTO=3000"
if exist ".env" for /f "tokens=2 delims==" %%a in ('findstr /b /c:"PORT=" ".env"') do set "PUERTO=%%a"
echo.
echo  ------------------------------------------------------------
echo   AereoLink:      http://localhost:%PUERTO%
echo   Cliente demo:   demo@aerolink.com  /  Demo1234
echo   Administrador:  admin  /  admin
echo.
echo   NO cierres esta ventana mientras uses la pagina.
echo   Para apagar el servidor pulsa Ctrl + C (o cierra la ventana).
echo  ------------------------------------------------------------
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%PUERTO%'"
call npm start
echo.
echo  El servidor se detuvo.
pause
exit /b 0

rem ============================================================
rem  ERRORES
rem ============================================================
:sin_carpeta
echo  Este archivo debe estar DENTRO de la carpeta aerolink, junto a package.json.
goto fin_error

:sin_node
echo  No se encontro Node.js. Instalalo con:   winget install OpenJS.NodeJS.LTS
echo  Luego cierra esta ventana y vuelve a abrir Inicio.bat.
goto fin_error

:error_npm
echo.
echo  Fallo "npm install". Revisa tu conexion a internet y vuelve a intentarlo.
goto fin_error

:sin_postgres
echo.
echo  PostgreSQL esta apagado o el puerto de .env no es el correcto.
echo  Abre "Servicios" (Win + R, escribe services.msc), busca postgresql-x64-...
echo  e inicialo. Luego vuelve a abrir Inicio.bat.
goto fin_error

:error_bd
echo.
echo  No se pudo preparar la base de datos. Lee el mensaje de arriba.
goto fin_error

:fin_error
echo.
pause
exit /b 1
