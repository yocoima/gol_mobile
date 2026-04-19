# Integración de cartas premium en GOL

## Archivos creados
- `src/card-premium.css` → estilos nuevos (no toca nada existente)
- `src/CardItem-premium.jsx` → componente CardItem modificado (referencia)

---

## Paso 1 — Importar el CSS

En `src/index.css`, agrega al inicio (después del @import de Google Fonts):

```css
@import './card-premium.css';
```

---

## Paso 2 — Reemplazar CardItem en App.jsx

Abre `src/App.jsx`.

**Busca** (línea ~317):
```js
const CardItem = ({
```

**Selecciona** todo el componente hasta el cierre `};` (línea ~410 aprox).

**Reemplázalo** con el contenido completo de `src/CardItem-premium.jsx`.

> ⚠️ El archivo tiene un bloque de comentario de instrucciones al inicio —
> ese bloque NO va en App.jsx, solo el código JS/JSX desde
> `const CARD_RARITY_MAP = {` hasta el final.

---

## Paso 3 — Verificar que useRef y useCallback estén importados

Al inicio de App.jsx ya tienes:
```js
import React, { useCallback, useEffect, useRef, useState } from 'react';
```
✅ No necesitas cambiar nada — `useRef` y `useCallback` ya están.

---

## Paso 4 — Penalti Legendario (visual)

El CSS ya tiene el soporte para `card-golden`. Cuando agregues
la carta `pel` al `BASE_DECK_DEFINITION`, automáticamente
tendrá el tratamiento dorado sin ningún cambio adicional.

---

## Resultado esperado

| Elemento              | Cambio                                        |
|-----------------------|-----------------------------------------------|
| Borde por rareza      | Plateado / Azul / Púrpura / Dorado animado    |
| Tinte de tipo         | Gradiente de color en esquina superior        |
| Hover 3D tilt         | Inclinación suave (10°) con escala            |
| Holográfico           | Gradiente arcoíris que sigue el cursor        |
| Gems de rareza        | 1-4 diamantes en esquina inferior derecha     |
| Sparkles legendarios  | 4 partículas doradas animadas (Chilena)       |
| Card badge color      | Badge de tipo usa el color de la categoría    |

## Nada se rompe
- Todos los estados existentes funcionan igual: active, near, dragging, disabled, selected, discard-mode.
- El tilt solo aplica en desktop (mouse), no en touch.
- Las cartas ocultas del rival no reciben efectos.
