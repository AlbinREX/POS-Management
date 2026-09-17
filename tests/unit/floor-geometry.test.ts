import { describe, expect, it } from 'vitest';
import { tableInputSchema } from '@restaurant/validation';
import {
  GRID,
  MIN_SIDE,
  collides,
  defaultRect,
  drawRect,
  moveRect,
  normalizeRect,
  overlaps,
  resizeRect,
  sameRect,
  snap,
  type Rect,
} from '../../apps/admin/src/lib/floor-geometry';

const canvas = { canvasWidth: 1200, canvasHeight: 800 };
const rect = (positionX: number, positionY: number, width: number, height: number): Rect => ({
  positionX,
  positionY,
  width,
  height,
});
const areaId = '77c7f4a3-067d-4ce4-a898-8a28d7b1d171';
/** Every rect the editor can produce must be accepted by the API's own schema. */
const acceptedByApi = (r: Rect, shape: 'RECTANGLE' | 'SQUARE' | 'CIRCLE') =>
  tableInputSchema.safeParse({
    areaId,
    name: 'Table',
    number: 1,
    capacity: 4,
    shape,
    ...r,
  }).success;

describe('Floor plan grid snapping', () => {
  it.each([
    [0, 0],
    [9, 0],
    [10, 20],
    [11, 20],
    [29, 20],
    [31, 40],
    [-9, -0],
  ])('snaps %i to %i', (value, expected) => {
    expect(snap(value)).toBe(expected);
  });
  it('keeps every snapped coordinate on the visible grid', () => {
    for (let v = 0; v < 400; v += 7) expect(snap(v) % GRID).toBe(0);
  });
  it('snaps a moved table to the grid', () => {
    const moved = moveRect(rect(100, 100, 120, 80), 33, 47, canvas);
    expect(moved.positionX % GRID).toBe(0);
    expect(moved.positionY % GRID).toBe(0);
    expect(moved).toMatchObject({ positionX: 140, positionY: 140 });
  });
  it('preserves size while moving', () => {
    const moved = moveRect(rect(100, 100, 120, 80), 55, -25, canvas);
    expect(moved.width).toBe(120);
    expect(moved.height).toBe(80);
  });
});

describe('Floor plan boundary clamping', () => {
  it('clamps a table dragged past the right and bottom edges', () => {
    const moved = moveRect(rect(1000, 700, 120, 80), 900, 900, canvas);
    expect(moved.positionX).toBe(canvas.canvasWidth - 120);
    expect(moved.positionY).toBe(canvas.canvasHeight - 80);
  });
  it('clamps a table dragged past the top and left edges', () => {
    const moved = moveRect(rect(100, 100, 120, 80), -900, -900, canvas);
    expect(moved).toMatchObject({ positionX: 0, positionY: 0 });
  });
  it('never lets geometry leave the canvas, whatever is thrown at it', () => {
    for (const candidate of [
      rect(-500, -500, 4000, 4000),
      rect(5000, 5000, 10, 10),
      rect(1190, 790, 44, 44),
      rect(0, 0, 0, 0),
    ]) {
      const fixed = normalizeRect(candidate, canvas, 'RECTANGLE');
      expect(fixed.positionX).toBeGreaterThanOrEqual(0);
      expect(fixed.positionY).toBeGreaterThanOrEqual(0);
      expect(fixed.positionX + fixed.width).toBeLessThanOrEqual(canvas.canvasWidth);
      expect(fixed.positionY + fixed.height).toBeLessThanOrEqual(canvas.canvasHeight);
      expect(acceptedByApi(fixed, 'RECTANGLE')).toBe(true);
    }
  });
  it('enforces the minimum side the API requires', () => {
    const tiny = normalizeRect(rect(0, 0, 2, 2), canvas, 'RECTANGLE');
    expect(tiny.width).toBe(MIN_SIDE);
    expect(tiny.height).toBe(MIN_SIDE);
  });
});

describe('Drawing a new table', () => {
  it('builds a rectangle from a downward-right drag', () => {
    const drawn = drawRect({ x: 100, y: 100 }, { x: 300, y: 240 }, canvas, 'RECTANGLE');
    expect(drawn).toEqual(rect(100, 100, 200, 140));
  });
  it('builds the same rectangle when dragging up and left', () => {
    const drawn = drawRect({ x: 300, y: 240 }, { x: 100, y: 100 }, canvas, 'RECTANGLE');
    expect(drawn).toEqual(rect(100, 100, 200, 140));
  });
  it('snaps both corners of the drawn rectangle', () => {
    const drawn = drawRect({ x: 103, y: 97 }, { x: 287, y: 233 }, canvas, 'RECTANGLE');
    expect(drawn.positionX % GRID).toBe(0);
    expect(drawn.width % GRID).toBe(0);
    expect(drawn.height % GRID).toBe(0);
  });
  it('gives a tiny drag a usable minimum-sized table instead of nothing', () => {
    const drawn = drawRect({ x: 200, y: 200 }, { x: 203, y: 201 }, canvas, 'RECTANGLE');
    expect(drawn.width).toBe(MIN_SIDE);
    expect(drawn.height).toBe(MIN_SIDE);
    expect(acceptedByApi(drawn, 'RECTANGLE')).toBe(true);
  });
  it('keeps circles and squares uniform while drawing', () => {
    for (const shape of ['CIRCLE', 'SQUARE'] as const) {
      const drawn = drawRect({ x: 100, y: 100 }, { x: 400, y: 200 }, canvas, shape);
      expect(drawn.width).toBe(drawn.height);
      expect(acceptedByApi(drawn, shape)).toBe(true);
    }
  });
  it('clamps a drag that runs off the canvas', () => {
    const drawn = drawRect({ x: 1150, y: 760 }, { x: 4000, y: 4000 }, canvas, 'RECTANGLE');
    expect(drawn.positionX + drawn.width).toBeLessThanOrEqual(canvas.canvasWidth);
    expect(drawn.positionY + drawn.height).toBeLessThanOrEqual(canvas.canvasHeight);
  });
});

describe('Resizing from handles', () => {
  const origin = rect(200, 200, 200, 160);
  it('grows from the south-east corner without moving the origin', () => {
    const next = resizeRect(origin, 'se', 100, 60, canvas, 'RECTANGLE');
    expect(next).toEqual(rect(200, 200, 300, 220));
  });
  it('keeps the opposite corner fixed when dragging north-west', () => {
    const next = resizeRect(origin, 'nw', -100, -60, canvas, 'RECTANGLE');
    expect(next.positionX).toBe(100);
    expect(next.positionY).toBe(140);
    expect(next.positionX + next.width).toBe(400);
    expect(next.positionY + next.height).toBe(360);
  });
  it('changes only one axis from a side handle', () => {
    const east = resizeRect(origin, 'e', 80, 500, canvas, 'RECTANGLE');
    expect(east.height).toBe(origin.height);
    expect(east.width).toBe(280);
    const south = resizeRect(origin, 's', 500, 40, canvas, 'RECTANGLE');
    expect(south.width).toBe(origin.width);
    expect(south.height).toBe(200);
  });
  it('snaps resized geometry to the grid', () => {
    const next = resizeRect(origin, 'se', 37, 53, canvas, 'RECTANGLE');
    expect(next.width % GRID).toBe(0);
    expect(next.height % GRID).toBe(0);
  });
  it('refuses to shrink below the minimum side from any handle', () => {
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const next = resizeRect(origin, handle, -5000, -5000, canvas, 'RECTANGLE');
      expect(next.width).toBeGreaterThanOrEqual(MIN_SIDE);
      expect(next.height).toBeGreaterThanOrEqual(MIN_SIDE);
      expect(acceptedByApi(next, 'RECTANGLE')).toBe(true);
    }
  });
  it('keeps resized geometry inside the canvas from any handle', () => {
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const next = resizeRect(origin, handle, 5000, 5000, canvas, 'RECTANGLE');
      expect(next.positionX).toBeGreaterThanOrEqual(0);
      expect(next.positionY).toBeGreaterThanOrEqual(0);
      expect(next.positionX + next.width).toBeLessThanOrEqual(canvas.canvasWidth);
      expect(next.positionY + next.height).toBeLessThanOrEqual(canvas.canvasHeight);
    }
  });
  it('keeps a circle uniform from a side handle and from a corner', () => {
    const circle = rect(200, 200, 160, 160);
    for (const handle of ['e', 's', 'se', 'nw', 'n', 'w'] as const) {
      const next = resizeRect(circle, handle, 60, 20, canvas, 'CIRCLE');
      expect(next.width).toBe(next.height);
      expect(acceptedByApi(next, 'CIRCLE')).toBe(true);
    }
  });
  it('anchors a uniform shape to the fixed edge when resizing north-west', () => {
    const square = rect(200, 200, 160, 160);
    const next = resizeRect(square, 'nw', -40, -40, canvas, 'SQUARE');
    expect(next.width).toBe(next.height);
    expect(next.positionX + next.width).toBe(360);
    expect(next.positionY + next.height).toBe(360);
  });
});

describe('Overlap detection matches the layout service', () => {
  it('detects overlap the same way the API does', () => {
    expect(overlaps(rect(0, 0, 100, 100), rect(50, 50, 100, 100))).toBe(true);
    expect(overlaps(rect(0, 0, 100, 100), rect(100, 0, 100, 100))).toBe(false);
    expect(overlaps(rect(0, 0, 100, 100), rect(0, 100, 100, 100))).toBe(false);
  });
  it('treats edge-to-edge tables as valid neighbours', () => {
    expect(collides(rect(100, 0, 100, 100), [rect(0, 0, 100, 100)])).toBe(false);
  });
  it('finds a free slot for a table added without drawing', () => {
    const taken = [rect(0, 0, 200, 200)];
    const placed = defaultRect(canvas, taken, 'RECTANGLE');
    expect(collides(placed, taken)).toBe(false);
    expect(acceptedByApi(placed, 'RECTANGLE')).toBe(true);
  });
});

describe('Draft change detection', () => {
  it('recognises identical and differing geometry', () => {
    expect(sameRect(rect(1, 2, 3, 4), rect(1, 2, 3, 4))).toBe(true);
    expect(sameRect(rect(1, 2, 3, 4), rect(1, 2, 3, 5))).toBe(false);
  });
});
