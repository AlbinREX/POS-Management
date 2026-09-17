/**
 * Pure floor-plan geometry for the layout editor.
 *
 * Every rule here mirrors a rule the layout API already enforces, so the editor can
 * never compose a draft the server would reject: minimum and maximum side length,
 * square/circle sides matching, and fitting inside the area canvas. Overlap is checked
 * the same way `LayoutService.fit` checks it. The server remains authoritative; this
 * module exists so the pointer interaction gives honest feedback while dragging rather
 * than failing on release.
 *
 * Nothing here touches status rules, permissions or branch scope.
 */
import type { TableShape } from '@restaurant/shared-types';

/** Visible grid pitch of the floor plan, matching the rendered grid pattern. */
export const GRID = 20;
/** Mirrors `geometryFields` in the validation package. */
export const MIN_SIDE = 44;
export const MAX_SIDE = 1000;

export type Rect = { positionX: number; positionY: number; width: number; height: number };
export type Canvas = { canvasWidth: number; canvasHeight: number };
/** The eight resize affordances: four corners and four sides. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'top left',
  n: 'top',
  ne: 'top right',
  e: 'right',
  se: 'bottom right',
  s: 'bottom',
  sw: 'bottom left',
  w: 'left',
};
export const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

export const snap = (value: number, grid = GRID) => Math.round(value / grid) * grid;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Shapes other than RECTANGLE are drawn and resized as squares, as the API requires. */
export const isUniform = (shape: TableShape) => shape !== 'RECTANGLE';

/** The largest side a uniform shape may take inside the canvas from a given origin. */
const uniformLimit = (canvas: Canvas) =>
  Math.min(MAX_SIDE, canvas.canvasWidth, canvas.canvasHeight);

/**
 * Snap a rectangle to the grid and force it inside the canvas without ever shrinking it
 * below the minimum side. Position is clamped first, then size, so a table dragged past
 * an edge slides along it instead of silently resizing.
 */
export function normalizeRect(rect: Rect, canvas: Canvas, shape: TableShape): Rect {
  const maxWidth = Math.min(MAX_SIDE, canvas.canvasWidth);
  const maxHeight = Math.min(MAX_SIDE, canvas.canvasHeight);
  let width = clamp(snap(rect.width), MIN_SIDE, maxWidth);
  let height = clamp(snap(rect.height), MIN_SIDE, maxHeight);
  if (isUniform(shape)) {
    const side = clamp(Math.max(width, height), MIN_SIDE, uniformLimit(canvas));
    width = side;
    height = side;
  }
  return {
    width,
    height,
    positionX: clamp(snap(rect.positionX), 0, canvas.canvasWidth - width),
    positionY: clamp(snap(rect.positionY), 0, canvas.canvasHeight - height),
  };
}

/** Move a table by a pointer delta, snapped to the grid and clamped to the canvas. */
export function moveRect(origin: Rect, deltaX: number, deltaY: number, canvas: Canvas): Rect {
  return {
    width: origin.width,
    height: origin.height,
    positionX: clamp(snap(origin.positionX + deltaX), 0, canvas.canvasWidth - origin.width),
    positionY: clamp(snap(origin.positionY + deltaY), 0, canvas.canvasHeight - origin.height),
  };
}

/**
 * The rectangle produced by dragging from `anchor` to `pointer`, used while drawing a
 * new table. Both corners snap to the grid, and the result obeys the same size rules as
 * any other geometry so a tiny drag still yields a valid, minimum-sized table.
 */
export function drawRect(
  anchor: { x: number; y: number },
  pointer: { x: number; y: number },
  canvas: Canvas,
  shape: TableShape,
): Rect {
  const ax = clamp(snap(anchor.x), 0, canvas.canvasWidth);
  const ay = clamp(snap(anchor.y), 0, canvas.canvasHeight);
  const px = clamp(snap(pointer.x), 0, canvas.canvasWidth);
  const py = clamp(snap(pointer.y), 0, canvas.canvasHeight);
  let width = Math.abs(px - ax);
  let height = Math.abs(py - ay);
  if (isUniform(shape)) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  // Grow away from the anchor, so the rectangle stays under the pointer when dragging
  // up or left, then let normalizeRect pull it back inside the canvas.
  const positionX = px < ax ? ax - width : ax;
  const positionY = py < ay ? ay - height : ay;
  return normalizeRect({ positionX, positionY, width, height }, canvas, shape);
}

/**
 * Resize from one handle. The opposite edge stays fixed, which is what makes a corner
 * drag feel anchored. Sides that the handle does not control are left untouched, except
 * for uniform shapes where both sides follow the dominant change.
 */
export function resizeRect(
  origin: Rect,
  handle: Handle,
  deltaX: number,
  deltaY: number,
  canvas: Canvas,
  shape: TableShape,
): Rect {
  const right = origin.positionX + origin.width;
  const bottom = origin.positionY + origin.height;
  let { positionX, positionY, width, height } = origin;
  if (handle.includes('w')) {
    positionX = clamp(snap(origin.positionX + deltaX), 0, right - MIN_SIDE);
    width = right - positionX;
  } else if (handle.includes('e')) {
    width = clamp(snap(origin.width + deltaX), MIN_SIDE, canvas.canvasWidth - origin.positionX);
  }
  if (handle.includes('n')) {
    positionY = clamp(snap(origin.positionY + deltaY), 0, bottom - MIN_SIDE);
    height = bottom - positionY;
  } else if (handle.includes('s')) {
    height = clamp(snap(origin.height + deltaY), MIN_SIDE, canvas.canvasHeight - origin.positionY);
  }
  if (isUniform(shape)) {
    // Follow whichever axis the handle actually drives, so a side handle on a circle
    // still resizes it evenly rather than refusing to move.
    const drivesX = handle.includes('e') || handle.includes('w');
    const drivesY = handle.includes('n') || handle.includes('s');
    const side = clamp(
      drivesX && drivesY ? Math.max(width, height) : drivesX ? width : height,
      MIN_SIDE,
      uniformLimit(canvas),
    );
    if (handle.includes('w')) positionX = right - side;
    if (handle.includes('n')) positionY = bottom - side;
    width = side;
    height = side;
  }
  width = clamp(width, MIN_SIDE, MAX_SIDE);
  height = clamp(height, MIN_SIDE, MAX_SIDE);
  return normalizeRect({ positionX, positionY, width, height }, canvas, shape);
}

/** Same overlap test the layout service applies before writing geometry. */
export const overlaps = (a: Rect, b: Rect) =>
  a.positionX < b.positionX + b.width &&
  a.positionX + a.width > b.positionX &&
  a.positionY < b.positionY + b.height &&
  a.positionY + a.height > b.positionY;

export const collides = (rect: Rect, others: readonly Rect[]) =>
  others.some((other) => overlaps(rect, other));

export const sameRect = (a: Rect, b: Rect) =>
  a.positionX === b.positionX &&
  a.positionY === b.positionY &&
  a.width === b.width &&
  a.height === b.height;

/** Default geometry for a table added without drawing, placed in the first free slot. */
export function defaultRect(canvas: Canvas, others: readonly Rect[], shape: TableShape): Rect {
  const base = normalizeRect(
    { positionX: 0, positionY: 0, width: 120, height: isUniform(shape) ? 120 : 80 },
    canvas,
    shape,
  );
  for (let y = 0; y + base.height <= canvas.canvasHeight; y += GRID)
    for (let x = 0; x + base.width <= canvas.canvasWidth; x += GRID) {
      const candidate = { ...base, positionX: x, positionY: y };
      if (!collides(candidate, others)) return candidate;
    }
  return base;
}
