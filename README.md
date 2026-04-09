# gol_mobile

Juego de cartas de futbol hecho con React/Vite.

## Estructura actual

- `src/`: frontend del juego, pensado para desplegarse en Vercel
- `server/`: backend Node.js + Socket.IO, pensado para desplegarse en Render
- `shared/`: reglas y utilidades compartidas entre frontend y backend

## Desarrollo local

En una terminal:

```bash
npm install
npm run dev:client
```

En otra terminal:

```bash
cd server
npm install
npm run dev
```

Frontend por defecto: `http://localhost:5173`

Backend por defecto: `http://localhost:3001`

## Variables de entorno

### Frontend

- `VITE_API_URL`: URL publica del backend
- `VITE_BASE_PATH`: solo si se vuelve a desplegar en un subpath como GitHub Pages

### Backend

- `PORT`: puerto del servidor, por defecto `3001`
- `CLIENT_ORIGIN`: uno o varios origenes permitidos para CORS separados por coma

Archivos de ejemplo:

- [`.env.example`](/c:/Users/yhs/OneDrive%20-%20Cuanta/Documentos/cartas/gol_app_git/.env.example)
- [`server/.env.example`](/c:/Users/yhs/OneDrive%20-%20Cuanta/Documentos/cartas/gol_app_git/server/.env.example)

## Despliegue propuesto

### Vercel

- Root Directory: repositorio raiz
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variables:
  - `VITE_API_URL=https://TU-SERVICIO-RENDER.onrender.com`
- Archivo opcional incluido: [`vercel.json`](/c:/Users/yhs/OneDrive%20-%20Cuanta/Documentos/cartas/gol_app_git/vercel.json)

### Render

- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables:
  - `CLIENT_ORIGIN=https://TU-APP-VERCEL.vercel.app`
- Archivo opcional incluido: [`render.yaml`](/c:/Users/yhs/OneDrive%20-%20Cuanta/Documentos/cartas/gol_app_git/render.yaml)

## Orden recomendado de deploy

1. Subir esta rama a GitHub.
2. Crear el servicio backend en Render usando la carpeta `server/`.
3. Esperar a que Render entregue la URL publica, por ejemplo `https://gol-app-server.onrender.com`.
4. Crear el proyecto frontend en Vercel apuntando a la raiz del repositorio.
5. En Vercel, definir `VITE_API_URL` con la URL publica de Render.
6. En Render, definir `CLIENT_ORIGIN` con la URL publica final de Vercel.
7. Volver a desplegar ambos servicios.

## Testeo inicial online

1. Abrir la app de Vercel en dos navegadores o dos dispositivos.
2. En el primero, usar `Modo online` y crear sala.
3. En el segundo, unirse con el codigo de la sala.
4. Iniciar la partida desde el host.
5. Validar:
   - que ambos clientes vean el mismo marcador y turno
   - que solo el jugador activo pueda jugar
   - que `Finalizar turno` se refleje en ambos clientes
   - que las cartas jugadas actualicen el estado en los dos lados

## Estado actual del online

La base para testear ya esta lista:

- frontend conectado a backend por `socket.io-client`
- creacion y union a salas
- inicio de partida online
- `match:end_turn` funcionando desde el servidor
- `match:play_card` con varias ramas de juego ya resueltas server-side

Todavia quedan casos complejos por pulir durante pruebas reales, pero el proyecto ya esta en un punto valido para desplegar y empezar a testear comportamiento end-to-end.

## Siguiente paso tecnico

El backend ya puede crear y unir salas, pero la logica completa de la partida sigue en `src/App.jsx`.
El siguiente trabajo es mover las reglas del juego a un motor compartido para que el servidor sea
la fuente de verdad de cada partida online.
