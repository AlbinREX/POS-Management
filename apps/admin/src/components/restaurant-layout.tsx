'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import type {
  AreaMap,
  AreaRecord,
  LayoutChanges,
  LayoutPage,
  TableRecord,
  TableShape,
  TableStatus,
} from '@restaurant/shared-types';
import { areaInputSchema, tableInputSchema } from '@restaurant/validation';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import { api, ApiFailure } from '../lib/api';
import { serverMessage, useI18n } from '../lib/i18n';
import {
  collides,
  drawRect,
  GRID,
  HANDLE_CURSORS,
  HANDLES,
  isUniform,
  MIN_SIDE,
  moveRect,
  normalizeRect,
  resizeRect,
  sameRect,
  type Canvas,
  type Handle,
  type Rect,
} from '../lib/floor-geometry';

const statusLabels = {
  FREE: 'catalog.layout.status.FREE',
  RESERVED: 'catalog.layout.status.RESERVED',
  DISABLED: 'catalog.layout.status.DISABLED',
  OCCUPIED: 'catalog.layout.status.OCCUPIED',
  ORDER_SENT: 'catalog.layout.status.orderSent',
  WAITING_PAYMENT: 'catalog.layout.status.waitingPayment',
} as const;
const colors: Record<TableStatus, string> = {
  FREE: '#193d32',
  RESERVED: '#4a3b20',
  DISABLED: '#2b2d32',
  OCCUPIED: '#233c56',
  ORDER_SENT: '#3d3157',
  WAITING_PAYMENT: '#503823',
};
const shapeLabels = {
  RECTANGLE: 'catalog.layout.shape.RECTANGLE',
  SQUARE: 'catalog.layout.shape.SQUARE',
  CIRCLE: 'catalog.layout.shape.CIRCLE',
} as const;
const handleLabels = {
  nw: 'catalog.layout.handle.nw',
  n: 'catalog.layout.handle.n',
  ne: 'catalog.layout.handle.ne',
  e: 'catalog.layout.handle.e',
  se: 'catalog.layout.handle.se',
  s: 'catalog.layout.handle.s',
  sw: 'catalog.layout.handle.sw',
  w: 'catalog.layout.handle.w',
} as const;
/** Geometry may only change while a table is free or disabled, exactly as the API requires. */
const isMovable = (status: TableStatus) => status === 'FREE' || status === 'DISABLED';
const errorMessage = (e: unknown) =>
  e instanceof ApiFailure
    ? e.message
    : 'Cannot reach the local server. Check your restaurant connection.';
async function allAreas(archived: boolean) {
  const rows: AreaRecord[] = [];
  for (let page = 1; ; page++) {
    const result = await api<LayoutPage<AreaRecord>>(
      `layout/areas?archived=${archived}&limit=100&page=${page}`,
    );
    rows.push(...result.items);
    if (!result.hasMore) return rows;
  }
}
type Operation = (request: () => Promise<unknown>, done?: () => void) => Promise<void>;

/**
 * The editor's working copy of one table.
 *
 * Geometry is edited visually and metadata in the panel, but both live here until Save,
 * so a drag never writes to the server on its own and a half-configured new table is
 * never persisted. `row` is absent for a table being drawn.
 */
type Draft = {
  row?: TableRecord;
  areaId: string;
  name: string;
  number: string;
  capacity: string;
  shape: TableShape;
  rect: Rect;
};
const draftFrom = (row: TableRecord): Draft => ({
  row,
  areaId: row.areaId,
  name: row.name,
  number: String(row.number),
  capacity: String(row.capacity),
  shape: row.shape,
  rect: {
    positionX: row.positionX,
    positionY: row.positionY,
    width: row.width,
    height: row.height,
  },
});
const draftDirty = (draft: Draft) =>
  !draft.row ||
  !sameRect(draft.rect, draftFrom(draft.row).rect) ||
  draft.areaId !== draft.row.areaId ||
  draft.name !== draft.row.name ||
  draft.number !== String(draft.row.number) ||
  draft.capacity !== String(draft.row.capacity) ||
  draft.shape !== draft.row.shape;

export function RestaurantLayout({
  canManage,
  canStatus,
}: {
  canManage: boolean;
  canStatus: boolean;
}) {
  const { t, locale } = useI18n();
  const [areas, setAreas] = useState<AreaRecord[]>([]);
  const [areaId, setAreaId] = useState('');
  const [archived, setArchived] = useState(false);
  const [map, setMap] = useState<AreaMap | null>(null);
  const [reload, setReload] = useState(0);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState('');
  const [areaEditor, setAreaEditor] = useState<AreaRecord | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drawing, setDrawing] = useState(false);
  const cursor = useRef('0');
  // Polling refreshes the map every few seconds. An in-progress draft must survive that,
  // so the draft is keyed by id and only reconciled when the underlying row is gone.
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  useEffect(() => {
    let current = true,
      healthy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setConnected(false);
    async function snapshot() {
      // Read the map revision before the independently paginated area list.
      // Changes racing with the area-list reads then remain beyond our cursor
      // and trigger another refresh instead of being silently skipped.
      const next = areaId ? await api<AreaMap>(`layout/areas/${areaId}/map`) : null;
      const rows = await allAreas(archived);
      const nextId = rows.find((a) => a.id === areaId)?.id ?? rows[0]?.id ?? '';
      if (!current) return;
      setAreas(rows);
      if (nextId !== areaId) {
        setAreaId(nextId);
        return;
      }
      if (!current) return;
      if (next) cursor.current = next.revision;
      setMap(next);
      // Reconcile an open draft with what the server now reports. A table that vanished
      // closes the panel; otherwise the draft keeps the operator's unsaved edits but
      // adopts the current row, so a remote status change is reflected immediately
      // rather than leaving the panel offering edits the server would refuse.
      const open = draftRef.current;
      if (open?.row && next) {
        const current = next.tables.find((t) => t.id === open.row!.id);
        if (!current) setDraft(null);
        else if (current.version !== open.row.version)
          setDraft({ ...open, row: current });
      }
      setConnectionError('');
      setConnected(true);
      healthy = true;
    }
    async function cycle(initial = false) {
      try {
        if (initial || !healthy) await snapshot();
        else {
          const changes = await api<LayoutChanges>(`layout/changes?after=${cursor.current}`);
          if (!current) return;
          if (changes.events.length) {
            // A repeatable-read snapshot covers all changes up to its revision.
            // With no selected area, continue draining the paginated event feed.
            cursor.current = changes.cursor;
            await snapshot();
          }
        }
      } catch (e) {
        if (current) {
          healthy = false;
          setConnected(false);
          setConnectionError(errorMessage(e));
        }
      } finally {
        if (current) timer = setTimeout(() => void cycle(), 5000);
      }
    }
    void cycle(true);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [areaId, archived, reload]);

  const operate: Operation = async (request, done) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await request();
      done?.();
      setNotice('Layout saved.');
      setReload((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };
  const busy = pending || !connected;
  const area = map?.area;
  const editable = canManage && !!area && !area.deletedAt && !busy;
  const table = map?.tables.find((t) => t.id === selected);
  // Other tables the draft must not overlap, which is the same set the API compares against.
  const obstacles = useMemo(
    () => (map?.tables ?? []).filter((t) => t.id !== draft?.row?.id).map(rectOf),
    [map, draft],
  );

  const select = useCallback(
    (id: string) => {
      setSelected(id);
      setError('');
      const row = map?.tables.find((t) => t.id === id);
      setDraft((open) => {
        // Selecting the table already open keeps its draft: re-deriving it here would
        // wipe unsaved edits every time the operator grabs the table to drag it.
        if (open?.row?.id === id) return open;
        // Clicking elsewhere never discards unsaved work either.
        if (open && draftDirty(open)) return open;
        return row ? draftFrom(row) : null;
      });
    },
    [map],
  );
  const beginDraw = () => {
    setDrawing(true);
    setAreaEditor(null);
    setDraft(null);
    setSelected('');
    setError('');
    setNotice('');
  };
  const cancelDraw = useCallback(() => setDrawing(false), []);
  const drawn = (rect: Rect, shape: TableShape) => {
    if (!area) return;
    setDrawing(false);
    setDraft({
      areaId: area.id,
      name: '',
      number: '',
      capacity: '4',
      shape,
      rect: normalizeRect(rect, area, shape),
    });
    setSelected('');
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1">
          <Label htmlFor="layout-area">{t('catalog.layout.area')}</Label>
          <select
            id="layout-area"
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setSelected('');
              setAreaEditor(null);
              setDraft(null);
              setDrawing(false);
              setError('');
            }}
          >
            <option value="" disabled>
              {t('catalog.layout.selectArea')}
            </option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.active ? '' : ` (${t('common.inactive')})`}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setReload((v) => v + 1);
            setDraft(null);
            setDrawing(false);
            setAreaEditor(null);
            setError('');
          }}
        >
          {t('catalog.layout.reload')}
        </Button>
        {canManage ? (
          <Button
            disabled={busy}
            onClick={() => {
              setAreaEditor('new');
              setDraft(null);
              setDrawing(false);
            }}
          >
            {t('catalog.layout.addArea')}
          </Button>
        ) : null}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => {
            setArchived(e.target.checked);
            setAreaId('');
            setSelected('');
            setAreaEditor(null);
            setDraft(null);
            setDrawing(false);
          }}
        />
        {t('catalog.layout.showArchived')}
      </label>
      <p role="status" className="text-sm text-muted-foreground">
        {connected
          ? t('catalog.layout.connected')
          : connectionError
            ? t('catalog.layout.disconnected')
            : t('catalog.layout.loading')}
      </p>
      {connectionError ? (
        <p role="alert" className="text-destructive">
          {serverMessage(connectionError, locale)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {t('catalog.layout.saved')}
        </p>
      ) : null}
      {areaEditor ? (
        <AreaEditor
          key={areaEditor === 'new' ? 'new' : areaEditor.id + '-' + areaEditor.version}
          row={areaEditor === 'new' ? undefined : areaEditor}
          busy={busy}
          operate={operate}
          onClose={() => setAreaEditor(null)}
          onSaved={(id) => {
            setAreaEditor(null);
            setArchived(false);
            setAreaId(id);
          }}
        />
      ) : null}
      {area ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{area.name}</h2>
              <p className="text-sm text-muted-foreground">
                {area.description || t('catalog.layout.floorPlan')} · {area.canvasWidth} × {area.canvasHeight}
                {!area.active ? ` · ${t('common.inactive')}` : ''}
              </p>
            </div>
            {canManage && !area.deletedAt ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAreaEditor(area);
                    setDraft(null);
                    setDrawing(false);
                  }}
                >
                  {t('catalog.layout.editArea')}
                </Button>
                <Button
                  variant={drawing ? 'secondary' : 'default'}
                  aria-pressed={drawing}
                  disabled={busy || !area.active}
                  onClick={() => (drawing ? cancelDraw() : beginDraw())}
                >
                  {drawing ? t('catalog.layout.cancelDrawing') : t('catalog.layout.addTable')}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4" aria-label={t('catalog.layout.legend')}>
            {(['FREE', 'RESERVED', 'DISABLED'] as const).map((status) => (
              <span key={status} className="flex items-center gap-2 text-sm">
                <span className="h-4 w-4 rounded border" style={{ background: colors[status] }} />
                {t(statusLabels[status])}
              </span>
            ))}
          </div>
          <FloorMap
            map={map!}
            selected={selected}
            draft={draft}
            drawing={drawing}
            editable={editable}
            obstacles={obstacles}
            onSelect={select}
            onDraw={drawn}
            onCancelDraw={cancelDraw}
            onGeometry={(rect) => setDraft((open) => (open ? { ...open, rect } : open))}
          />
          {draft ? (
            <TableDraftPanel
              key={draft.row ? draft.row.id + '-' + draft.row.version : 'new-table'}
              draft={draft}
              area={area}
              areas={areas}
              busy={busy}
              canManage={canManage}
              canStatus={canStatus}
              obstacles={obstacles}
              operate={operate}
              onChange={setDraft}
              onClose={() => setDraft(null)}
              onSaved={(id) => {
                setDraft(null);
                setSelected(id);
              }}
              onArchived={() => {
                setDraft(null);
                setSelected('');
              }}
            />
          ) : table ? (
            <TableSummary row={table} onEdit={() => select(table.id)} canManage={canManage} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {drawing
                ? t('catalog.layout.drawHint')
                : map!.tables.length
                  ? t('catalog.layout.selectHint')
                  : t('catalog.layout.noTables')}
            </p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('catalog.layout.tablesInArea')}>
            {map!.tables.map((tableItem) => (
              <li key={tableItem.id}>
                <Button
                  variant={selected === tableItem.id ? 'secondary' : 'outline'}
                  className="h-auto min-h-14 w-full justify-start whitespace-normal text-left"
                  onClick={() => select(tableItem.id)}
                >
                  {tableItem.number} · {tableItem.name} · {t('catalog.layout.seatCount', { count: tableItem.capacity })} · {t(statusLabels[tableItem.status])}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : connected ? (
        <p className="rounded-md border p-6 text-muted-foreground">
          {archived ? t('catalog.layout.noArchivedAreas') : t('catalog.layout.noAreas')}
        </p>
      ) : null}
    </section>
  );
}

const rectOf = (row: TableRecord): Rect => ({
  positionX: row.positionX,
  positionY: row.positionY,
  width: row.width,
  height: row.height,
});

/** An in-flight pointer gesture on the map. Only one can be active at a time. */
type Gesture =
  | { kind: 'draw'; pointerId: number; anchor: { x: number; y: number } }
  | { kind: 'move'; pointerId: number; origin: Rect; from: { x: number; y: number } }
  | {
      kind: 'resize';
      pointerId: number;
      handle: Handle;
      origin: Rect;
      from: { x: number; y: number };
    };

function FloorMap({
  map,
  selected,
  draft,
  drawing,
  editable,
  obstacles,
  onSelect,
  onDraw,
  onCancelDraw,
  onGeometry,
}: {
  map: AreaMap;
  selected: string;
  draft: Draft | null;
  drawing: boolean;
  editable: boolean;
  obstacles: Rect[];
  onSelect: (id: string) => void;
  onDraw: (rect: Rect, shape: TableShape) => void;
  onCancelDraw: () => void;
  onGeometry: (rect: Rect) => void;
}) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(0.75);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const canvas: Canvas = map.area;
  // The draft may be a table being drawn, so its shape drives drawing constraints too.
  const shape = draft?.shape ?? 'RECTANGLE';
  const active = gesture !== null;
  const draftRect = draft?.rect ?? null;

  // Esc cancels drawing and abandons an in-flight gesture without writing anything.
  useEffect(() => {
    if (!drawing && !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setGesture(null);
      setPreview(null);
      onCancelDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing, active, onCancelDraw]);

  function point(e: PointerEvent<SVGElement>) {
    const element = svg.current!,
      p = element.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(element.getScreenCTM()!.inverse());
  }
  /** Capture on the svg itself so a fast drag that leaves the shape keeps tracking. */
  function capture(e: PointerEvent<SVGElement>) {
    svg.current?.setPointerCapture(e.pointerId);
  }
  function startDraw(e: PointerEvent<SVGSVGElement>) {
    if (!drawing || !editable || e.button !== 0) return;
    e.preventDefault();
    capture(e);
    const p = point(e);
    setGesture({ kind: 'draw', pointerId: e.pointerId, anchor: { x: p.x, y: p.y } });
    setPreview(drawRect({ x: p.x, y: p.y }, { x: p.x, y: p.y }, canvas, shape));
  }
  function startMove(e: PointerEvent<SVGGElement>, row: TableRecord) {
    onSelect(row.id);
    if (drawing || !editable || !isMovable(row.status) || e.button !== 0) return;
    e.preventDefault();
    capture(e);
    const p = point(e);
    setGesture({
      kind: 'move',
      pointerId: e.pointerId,
      // Move the geometry the operator currently sees. Using the saved row here would
      // silently discard an unsaved resize the moment the table is dragged.
      origin: draft?.row?.id === row.id && draftRect ? draftRect : rectOf(row),
      from: { x: p.x, y: p.y },
    });
  }
  function startResize(e: PointerEvent<SVGRectElement>, handle: Handle, origin: Rect) {
    if (!editable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    capture(e);
    const p = point(e);
    setGesture({ kind: 'resize', pointerId: e.pointerId, handle, origin, from: { x: p.x, y: p.y } });
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const p = point(e);
    if (gesture.kind === 'draw') {
      setPreview(drawRect(gesture.anchor, { x: p.x, y: p.y }, canvas, shape));
      return;
    }
    const next =
      gesture.kind === 'move'
        ? moveRect(gesture.origin, p.x - gesture.from.x, p.y - gesture.from.y, canvas)
        : resizeRect(
            gesture.origin,
            gesture.handle,
            p.x - gesture.from.x,
            p.y - gesture.from.y,
            canvas,
            shape,
          );
    onGeometry(next);
  }
  function finish(e: PointerEvent<SVGSVGElement>, cancel = false) {
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const current = gesture;
    const drawn = preview;
    setGesture(null);
    setPreview(null);
    if (cancel || current.kind !== 'draw' || !drawn) return;
    onDraw(drawn, shape);
  }

  const invalid = draftRect ? collides(draftRect, obstacles) : false;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          aria-label={t('catalog.layout.zoomOut')}
          disabled={zoom <= 0.5}
          onClick={() => setZoom((v) => v - 0.25)}
        >
          −
        </Button>
        <span className="text-sm">{Math.round(zoom * 100)}%</span>
        <Button
          variant="outline"
          aria-label={t('catalog.layout.zoomIn')}
          disabled={zoom >= 2}
          onClick={() => setZoom((v) => v + 0.25)}
        >
          +
        </Button>
        <p className="text-sm text-muted-foreground">
          {drawing
            ? t('catalog.layout.drawGridHint')
            : draft
              ? t('catalog.layout.moveHint')
              : t('catalog.layout.scrollHint')}
        </p>
      </div>
      <div
        className="max-h-[600px] overflow-auto rounded-lg border bg-card"
        tabIndex={0}
        aria-label={t('catalog.layout.scrollable')}
      >
        <svg
          ref={svg}
          role="group"
          aria-label={t('catalog.layout.floorPlanFor', { name: map.area.name })}
          data-drawing={drawing ? 'true' : 'false'}
          data-gesture={gesture?.kind ?? 'none'}
          className="layout-map"
          viewBox={`0 0 ${map.area.canvasWidth} ${map.area.canvasHeight}`}
          style={{
            width: map.area.canvasWidth * zoom,
            height: map.area.canvasHeight * zoom,
            maxWidth: 'none',
            // Only take over touch panning while actually drawing or dragging, so the
            // map keeps its normal scroll and zoom behaviour the rest of the time.
            touchAction: drawing || active ? 'none' : 'auto',
          }}
          onPointerDown={startDraw}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
        >
          <defs>
            <pattern
              id="layout-grid"
              width={GRID}
              height={GRID}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${GRID} 0 L 0 0 0 ${GRID}`}
                fill="none"
                stroke="#2b2d32"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#layout-grid)" />
          {map.tables.map((row) => {
            // The selected table follows the draft while it is being edited.
            const live = draft?.row?.id === row.id && draftRect ? draftRect : rectOf(row);
            const isSelected = selected === row.id || draft?.row?.id === row.id;
            const dragging = gesture?.kind === 'move' && draft?.row?.id === row.id;
            return (
              <g
                key={row.id}
                role="button"
                tabIndex={0}
                aria-label={t('catalog.layout.tableDescription', { number: row.number, name: row.name, status: t(statusLabels[row.status]), count: row.capacity })}
                aria-pressed={isSelected}
                transform={`translate(${live.positionX} ${live.positionY})`}
                className="layout-table"
                data-selected={isSelected ? 'true' : 'false'}
                data-movable={editable && isMovable(row.status) && !drawing ? 'true' : 'false'}
                data-dragging={dragging ? 'true' : 'false'}
                onPointerDown={(e) => startMove(e, row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(row.id);
                  }
                }}
              >
                <title>
                  {row.name} · {t(statusLabels[row.status])} · {t('catalog.layout.seatCount', { count: row.capacity })}
                </title>
                <TableShapeNode
                  shape={draft?.row?.id === row.id ? draft.shape : row.shape}
                  rect={live}
                  fill={colors[row.status]}
                  selected={isSelected}
                  invalid={isSelected && invalid}
                />
                <text
                  x={live.width / 2}
                  y={live.height / 2 - 4}
                  textAnchor="middle"
                  fontSize={Math.min(20, live.width / 4)}
                  fontWeight="600"
                  fill="#fafaf8"
                  pointerEvents="none"
                >
                  {row.number}
                </text>
                <text
                  x={live.width / 2}
                  y={live.height / 2 + 14}
                  textAnchor="middle"
                  fontSize={Math.min(12, live.width / 8)}
                  fill="#d2d4da"
                  pointerEvents="none"
                >
                  {t(statusLabels[row.status])}
                </text>
              </g>
            );
          })}
          {/* A table being drawn has no server row yet, so it renders from the draft. */}
          {draft && !draft.row && draftRect ? (
            <g
              transform={`translate(${draftRect.positionX} ${draftRect.positionY})`}
              className="layout-table"
              data-selected="true"
              aria-label={t('catalog.layout.newPlacement')}
            >
              <TableShapeNode
                shape={draft.shape}
                rect={draftRect}
                fill={colors.FREE}
                selected
                invalid={invalid}
              />
              <text
                x={draftRect.width / 2}
                y={draftRect.height / 2 + 4}
                textAnchor="middle"
                fontSize={Math.min(14, draftRect.width / 6)}
                fill="#fafaf8"
                pointerEvents="none"
              >
                {draft.number || t('catalog.layout.new')}
              </text>
            </g>
          ) : null}
          {/* Resize handles sit above every table so they stay grabbable. */}
          {editable && draftRect && !drawing ? (
            <ResizeHandles rect={draftRect} onStart={startResize} />
          ) : null}
          {preview ? (
            <rect
              className="layout-preview"
              aria-hidden="true"
              x={preview.positionX}
              y={preview.positionY}
              width={preview.width}
              height={preview.height}
              rx={isUniform(shape) ? preview.width / 2 : 10}
            />
          ) : null}
        </svg>
      </div>
      {draftRect ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('catalog.layout.geometrySummary', { x: draftRect.positionX, y: draftRect.positionY, width: draftRect.width, height: draftRect.height })}
          {invalid ? ` · ${t('catalog.layout.overlap')}` : ''}
        </p>
      ) : null}
    </div>
  );
}

function TableShapeNode({
  shape,
  rect,
  fill,
  selected,
  invalid,
}: {
  shape: TableShape;
  rect: Rect;
  fill: string;
  selected: boolean;
  invalid: boolean;
}) {
  const stroke = invalid ? '#e5646b' : selected ? '#f4c451' : '#747984';
  const strokeWidth = selected ? 3 : 2;
  return shape === 'CIRCLE' ? (
    <ellipse
      cx={rect.width / 2}
      cy={rect.height / 2}
      rx={rect.width / 2 - 3}
      ry={rect.height / 2 - 3}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  ) : (
    <rect
      x="3"
      y="3"
      width={rect.width - 6}
      height={rect.height - 6}
      rx={shape === 'SQUARE' ? 4 : 10}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

/** Corner and side handles, drawn in canvas units so they stay aligned at any zoom. */
function ResizeHandles({
  rect,
  onStart,
}: {
  rect: Rect;
  onStart: (e: PointerEvent<SVGRectElement>, handle: Handle, origin: Rect) => void;
}) {
  const { t } = useI18n();
  // The visible handle stays small so the map reads cleanly, while an invisible,
  // larger grab area makes it comfortable to hit with a mouse at any zoom.
  const size = 12;
  const half = size / 2;
  const grab = 28;
  const grabHalf = grab / 2;
  const at: Record<Handle, [number, number]> = {
    nw: [rect.positionX, rect.positionY],
    n: [rect.positionX + rect.width / 2, rect.positionY],
    ne: [rect.positionX + rect.width, rect.positionY],
    e: [rect.positionX + rect.width, rect.positionY + rect.height / 2],
    se: [rect.positionX + rect.width, rect.positionY + rect.height],
    s: [rect.positionX + rect.width / 2, rect.positionY + rect.height],
    sw: [rect.positionX, rect.positionY + rect.height],
    w: [rect.positionX, rect.positionY + rect.height / 2],
  };
  return (
    <g aria-hidden="true">
      {HANDLES.map((handle) => {
        const [x, y] = at[handle];
        return (
          <g key={handle}>
            <rect
              className="layout-handle"
              data-handle={handle}
              x={x - half}
              y={y - half}
              width={size}
              height={size}
              rx={2}
              pointerEvents="none"
            />
            <rect
              className="layout-handle-grab"
              data-handle={handle}
              data-grab="true"
              x={x - grabHalf}
              y={y - grabHalf}
              width={grab}
              height={grab}
              fill="transparent"
              style={{ cursor: HANDLE_CURSORS[handle] }}
              onPointerDown={(e) => onStart(e, handle, rect)}
            >
              <title>{t(handleLabels[handle])}</title>
            </rect>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Details for a table that cannot currently be edited geometrically, such as one that is
 * occupied. It keeps the panel honest rather than offering a Save that would be refused.
 */
function TableSummary({
  row,
  onEdit,
  canManage,
}: {
  row: TableRecord;
  onEdit: () => void;
  canManage: boolean;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={t('catalog.layout.selectedTable')} className="space-y-3 rounded-lg border bg-card p-5">
      <h3 className="text-lg font-semibold">
        {row.number} · {row.name}
      </h3>
      <p>
        {t(statusLabels[row.status])} · {t('catalog.layout.seatCount', { count: row.capacity })} · {t(shapeLabels[row.shape])} · {t('catalog.layout.geometrySummary', { x: row.positionX, y: row.positionY, width: row.width, height: row.height })}
      </p>
      {canManage ? (
        <Button variant="outline" onClick={onEdit}>
          {t('catalog.layout.editTable')}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The details panel. Geometry arrives from the map, metadata is typed here, and Save
 * persists both together through the existing table endpoints, so a drag alone never
 * writes and the version check still guards every write.
 */
function TableDraftPanel({
  draft,
  area,
  areas,
  busy,
  canManage,
  canStatus,
  obstacles,
  operate,
  onChange,
  onClose,
  onSaved,
  onArchived,
}: {
  draft: Draft;
  area: AreaRecord;
  areas: AreaRecord[];
  busy: boolean;
  canManage: boolean;
  canStatus: boolean;
  obstacles: Rect[];
  operate: Operation;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSaved: (id: string) => void;
  onArchived: () => void;
}) {
  const { t, locale } = useI18n();
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const row = draft.row;
  const movable = !row || isMovable(row.status);
  const dirty = draftDirty(draft);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value });
  // Changing shape can force a square, so geometry is renormalized with it.
  const setShape = (shape: TableShape) =>
    onChange({ ...draft, shape, rect: normalizeRect(draft.rect, area, shape) });
  const statusChoices: Partial<Record<TableStatus, ('FREE' | 'RESERVED' | 'DISABLED')[]>> = {
    FREE: ['RESERVED', 'DISABLED'],
    RESERVED: ['FREE'],
    DISABLED: ['FREE'],
  };

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (collides(draft.rect, obstacles)) {
      setError('This table overlaps another table. Move or resize it before saving.');
      return;
    }
    const parsed = tableInputSchema.safeParse({
      areaId: draft.areaId,
      name: draft.name.trim(),
      number: Number(draft.number),
      capacity: Number(draft.capacity),
      positionX: draft.rect.positionX,
      positionY: draft.rect.positionY,
      width: draft.rect.width,
      height: draft.rect.height,
      shape: draft.shape,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i: { message: string }) => i.message).join('; '));
      return;
    }
    setError('');
    void operate(async () => {
      const saved = await api<TableRecord>(
        'layout/tables' + (row ? '/' + row.id : ''),
        row ? 'PUT' : 'POST',
        row ? { version: row.version, data: parsed.data } : parsed.data,
      );
      onSaved(saved.id);
    });
  }

  return (
    <form
      aria-label={t('catalog.layout.tableDetails')}
      onSubmit={submit}
      className="space-y-4 rounded-lg border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{row ? t('catalog.layout.editTable') : t('catalog.layout.newTable')}</h2>
        <p className="text-sm text-muted-foreground" role="status">
          {row ? t(statusLabels[row.status]) : t('catalog.layout.notSaved')}
          {dirty ? ` · ${t('catalog.layout.unsaved')}` : ''}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      {row && !movable ? (
        <p className="text-sm text-muted-foreground">
          {t('catalog.layout.tableInService')}
        </p>
      ) : null}
      <fieldset disabled={busy || !canManage || !movable} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="layout-name">{t('catalog.layout.tableName')}</Label>
            <Input
              id="layout-name"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={100}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="layout-tableArea">{t('catalog.layout.tableArea')}</Label>
            <select
              id="layout-tableArea"
              value={draft.areaId}
              onChange={(e) => set('areaId', e.target.value)}
            >
              {areas
                .filter((a) => !a.deletedAt)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="layout-number">{t('catalog.layout.tableNumber')}</Label>
            <Input
              id="layout-number"
              type="number"
              step={1}
              value={draft.number}
              onChange={(e) => set('number', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="layout-capacity">{t('catalog.layout.seats')}</Label>
            <Input
              id="layout-capacity"
              type="number"
              step={1}
              value={draft.capacity}
              onChange={(e) => set('capacity', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="layout-shape">{t('catalog.layout.shape')}</Label>
            <select
              id="layout-shape"
              value={draft.shape}
              onChange={(e) => setShape(e.target.value as TableShape)}
            >
              {(Object.keys(shapeLabels) as TableShape[]).map((shape) => (
                <option key={shape} value={shape}>
                  {t(shapeLabels[shape])}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="layout-status">{t('catalog.layout.status')}</Label>
            <Input
              id="layout-status"
              value={t(row ? statusLabels[row.status] : statusLabels.FREE)}
              readOnly
              disabled
            />
          </div>
        </div>
        <fieldset className="layout-geometry" aria-label={t('catalog.layout.geometry')}>
          <legend className="text-sm text-muted-foreground">{t('catalog.layout.geometryDrawn')}</legend>
          <GeometryField
            id="layout-positionx"
            label={t('catalog.layout.positionX')}
            value={draft.rect.positionX}
            onChange={(positionX) =>
              onChange({
                ...draft,
                rect: normalizeRect({ ...draft.rect, positionX }, area, draft.shape),
              })
            }
          />
          <GeometryField
            id="layout-positiony"
            label={t('catalog.layout.positionY')}
            value={draft.rect.positionY}
            onChange={(positionY) =>
              onChange({
                ...draft,
                rect: normalizeRect({ ...draft.rect, positionY }, area, draft.shape),
              })
            }
          />
          <GeometryField
            id="layout-tablewidth"
            label={t('catalog.layout.tableWidth')}
            value={draft.rect.width}
            onChange={(width) =>
              onChange({
                ...draft,
                rect: normalizeRect({ ...draft.rect, width }, area, draft.shape),
              })
            }
          />
          <GeometryField
            id="layout-tableheight"
            label={t('catalog.layout.tableHeight')}
            value={draft.rect.height}
            onChange={(height) =>
              onChange({
                ...draft,
                rect: normalizeRect({ ...draft.rect, height }, area, draft.shape),
              })
            }
          />
        </fieldset>
        <p className="text-sm text-muted-foreground">
          {t('catalog.layout.geometryHint', { grid: GRID, min: MIN_SIDE })}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">{t('catalog.layout.saveTable')}</Button>
          <Button type="button" variant="outline" onClick={() => (row ? onChange(draftFrom(row)) : onClose())}>
            {row ? t('catalog.layout.reset') : t('catalog.layout.cancel')}
          </Button>
          {row ? (
            <Button type="button" variant="outline" onClick={onClose}>
              {t('catalog.layout.close')}
            </Button>
          ) : null}
        </div>
      </fieldset>
      {row ? (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {canStatus
            ? statusChoices[row.status]?.map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant="outline"
                  disabled={busy || (!area.active && status !== 'DISABLED')}
                  onClick={() =>
                    void operate(() =>
                      api('layout/tables/' + row.id + '/status', 'PATCH', {
                        version: row.version,
                        status,
                      }),
                    )
                  }
                >
                  {t('catalog.layout.markStatus', { status: t(statusLabels[status]).toLocaleLowerCase(locale) })}
                </Button>
              ))
            : null}
          {canManage ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !movable}
              onClick={() => setConfirm(true)}
            >
              {t('catalog.layout.archiveTable')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {confirm && row ? (
        <div className="space-y-2">
          <p>{t('catalog.layout.archiveTablePrompt')}</p>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void operate(
                () => api('layout/tables/' + row.id + '/archive', 'POST', { version: row.version }),
                onArchived,
              )
            }
          >
            {t('catalog.layout.confirmTableArchive')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** A numeric geometry input that keeps the map and the panel in agreement. */
function GeometryField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        step={GRID}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </div>
  );
}

function Field({
  name,
  label,
  value,
  type = 'text',
  required = true,
  maxLength = 160,
}: {
  name: string;
  label: string;
  value?: string | number | null;
  type?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={'layout-' + name}>{label}</Label>
      <Input
        id={'layout-' + name}
        name={name}
        type={type}
        defaultValue={value ?? ''}
        required={required}
        maxLength={maxLength}
        step={type === 'number' ? 1 : undefined}
      />
    </div>
  );
}
function AreaEditor({
  row,
  busy,
  operate,
  onClose,
  onSaved,
}: {
  row?: AreaRecord;
  busy: boolean;
  operate: Operation;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [name, setName] = useState(row?.name ?? ''),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = areaInputSchema.safeParse({
      name,
      description: String(form.get('description') ?? '') || null,
      sortOrder: Number(form.get('sortOrder')),
      canvasWidth: Number(form.get('canvasWidth')),
      canvasHeight: Number(form.get('canvasHeight')),
      active: form.has('active'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i: { message: string }) => i.message).join('; '));
      return;
    }
    setError('');
    void operate(async () => {
      const saved = await api<AreaRecord>(
        'layout/areas' + (row ? '/' + row.id : ''),
        row ? 'PUT' : 'POST',
        row ? { version: row.version, data: parsed.data } : parsed.data,
      );
      onSaved(saved.id);
    });
  }
  return (
    <form
      aria-label={t('catalog.layout.areaEditor')}
      className="space-y-4 rounded-lg border bg-card p-5"
      onSubmit={submit}
    >
      <h2 className="text-lg font-semibold">{row ? t('catalog.layout.editArea') : t('catalog.layout.newArea')}</h2>
      {error ? (
        <p role="alert" className="text-destructive">
          {serverMessage(error, locale)}
        </p>
      ) : null}
      <fieldset disabled={busy} className="space-y-4">
        {!row ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t('catalog.layout.startName')}</span>
            {(['Indoor', 'Terrace'] as const).map((value) => (
              <Button key={value} type="button" variant="outline" onClick={() => setName(value)}>
                {value === 'Indoor' ? t('catalog.layout.indoor') : t('catalog.layout.terrace')}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="layout-areaName">{t('catalog.layout.areaName')}</Label>
          <Input
            id="layout-areaName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
            required
          />
        </div>
        <Field
          name="description"
          label={t('catalog.layout.areaDescription')}
          value={row?.description}
          required={false}
          maxLength={2000}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            name="sortOrder"
            label={t('catalog.layout.areaSort')}
            value={row?.sortOrder ?? 0}
            type="number"
          />
          <Field
            name="canvasWidth"
            label={t('catalog.layout.canvasWidth')}
            value={row?.canvasWidth ?? 1200}
            type="number"
          />
          <Field
            name="canvasHeight"
            label={t('catalog.layout.canvasHeight')}
            value={row?.canvasHeight ?? 800}
            type="number"
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={row?.active ?? true} />
          {t('catalog.layout.areaActive')}
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">{t('catalog.layout.saveArea')}</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('catalog.layout.cancel')}
          </Button>
          {row ? (
            <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>
              {t('catalog.layout.archiveArea')}
            </Button>
          ) : null}
        </div>
        {confirm && row ? (
          <div className="space-y-2">
            <p>{t('catalog.layout.archiveAreaPrompt')}</p>
            <Button
              type="button"
              variant="destructive"
              onClick={() =>
                void operate(
                  () =>
                    api('layout/areas/' + row.id + '/archive', 'POST', { version: row.version }),
                  onClose,
                )
              }
            >
              {t('catalog.layout.confirmAreaArchive')}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
