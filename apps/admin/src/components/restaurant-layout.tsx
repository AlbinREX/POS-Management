'use client';

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import type {
  AreaMap,
  AreaRecord,
  LayoutChanges,
  LayoutPage,
  TableRecord,
  TableStatus,
} from '@restaurant/shared-types';
import { areaInputSchema, tableInputSchema } from '@restaurant/validation';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
import { Label } from '@restaurant/ui/label';
import { api, ApiFailure } from '../lib/api';

const statusLabels: Record<TableStatus, string> = {
  FREE: 'Free',
  RESERVED: 'Reserved',
  DISABLED: 'Disabled',
  OCCUPIED: 'Occupied',
  ORDER_SENT: 'Order sent',
  WAITING_PAYMENT: 'Waiting payment',
};
const colors: Record<TableStatus, string> = {
  FREE: '#193d32',
  RESERVED: '#4a3b20',
  DISABLED: '#2b2d32',
  OCCUPIED: '#233c56',
  ORDER_SENT: '#3d3157',
  WAITING_PAYMENT: '#503823',
};
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

export function RestaurantLayout({
  canManage,
  canStatus,
}: {
  canManage: boolean;
  canStatus: boolean;
}) {
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
  const [tableEditor, setTableEditor] = useState<TableRecord | 'new' | null>(null);
  const [arrange, setArrange] = useState(false);
  const cursor = useRef('0');
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
  const table = map?.tables.find((t) => t.id === selected);
  const area = map?.area;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 space-y-2 sm:w-auto sm:flex-1">
          <Label htmlFor="layout-area">Area</Label>
          <select
            id="layout-area"
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setSelected('');
              setAreaEditor(null);
              setTableEditor(null);
              setError('');
              setArrange(false);
            }}
          >
            <option value="" disabled>
              Select an area
            </option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setReload((v) => v + 1);
            setTableEditor(null);
            setAreaEditor(null);
            setError('');
          }}
        >
          Reload layout
        </Button>
        {canManage ? (
          <Button
            disabled={busy}
            onClick={() => {
              setAreaEditor('new');
              setTableEditor(null);
            }}
          >
            Add area
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
            setTableEditor(null);
          }}
        />
        Show archived areas
      </label>
      <p role="status" className="text-sm text-muted-foreground">
        {connected
          ? 'Connected · Changes checked every 5 seconds'
          : connectionError
            ? 'Connection unavailable · Map may be out of date · Editing paused'
            : 'Loading layout…'}
      </p>
      {connectionError ? (
        <p role="alert" className="text-destructive">
          {connectionError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
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
      {tableEditor && area ? (
        <TableEditor
          key={
            tableEditor === 'new' ? 'new-' + area.id : tableEditor.id + '-' + tableEditor.version
          }
          row={tableEditor === 'new' ? undefined : tableEditor}
          area={area}
          areas={areas}
          busy={busy}
          operate={operate}
          onClose={() => setTableEditor(null)}
          onSaved={(id) => {
            setTableEditor(null);
            setSelected(id);
          }}
        />
      ) : null}
      {area ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{area.name}</h2>
              <p className="text-sm text-muted-foreground">
                {area.description || 'Floor plan'} · {area.canvasWidth} × {area.canvasHeight}
                {!area.active ? ' · Inactive' : ''}
              </p>
            </div>
            {canManage && !area.deletedAt ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAreaEditor(area);
                    setTableEditor(null);
                  }}
                >
                  Edit area
                </Button>
                <Button
                  disabled={busy || !area.active}
                  onClick={() => {
                    setTableEditor('new');
                    setAreaEditor(null);
                  }}
                >
                  Add table
                </Button>
                <Button
                  variant={arrange ? 'secondary' : 'outline'}
                  aria-pressed={arrange}
                  disabled={busy}
                  onClick={() => setArrange((v) => !v)}
                >
                  Arrange tables
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4" aria-label="Table status legend">
            {(['FREE', 'RESERVED', 'DISABLED'] as const).map((status) => (
              <span key={status} className="flex items-center gap-2 text-sm">
                <span className="h-4 w-4 rounded border" style={{ background: colors[status] }} />
                {statusLabels[status]}
              </span>
            ))}
          </div>
          <FloorMap
            map={map!}
            selected={selected}
            onSelect={setSelected}
            arrange={arrange && canManage && !busy && !area.deletedAt}
            onMove={(row, positionX, positionY) =>
              void operate(() =>
                api(`layout/tables/${row.id}/geometry`, 'PATCH', {
                  version: row.version,
                  positionX,
                  positionY,
                  width: row.width,
                  height: row.height,
                  shape: row.shape,
                }),
              )
            }
          />
          {table ? (
            <TableDetails
              key={table.id + '-' + table.version}
              row={table}
              area={area}
              canManage={canManage}
              canStatus={canStatus}
              busy={busy}
              operate={operate}
              onEdit={() => {
                setTableEditor(table);
                setAreaEditor(null);
              }}
              onArchived={() => setSelected('')}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {map!.tables.length
                ? 'Select a table on the map or in the list.'
                : 'No tables in this area yet.'}
            </p>
          )}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Tables in area">
            {map!.tables.map((t) => (
              <li key={t.id}>
                <Button
                  variant={selected === t.id ? 'secondary' : 'outline'}
                  className="h-auto min-h-14 w-full justify-start whitespace-normal text-left"
                  onClick={() => setSelected(t.id)}
                >
                  {t.number} · {t.name} · {t.capacity} seats · {statusLabels[t.status]}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : connected ? (
        <p className="rounded-md border p-6 text-muted-foreground">
          No {archived ? 'archived ' : ''}areas. Create an area with a name such as Indoor, Terrace
          or Garden.
        </p>
      ) : null}
    </section>
  );
}

type Drag = {
  row: TableRecord;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
};
function FloorMap({
  map,
  selected,
  onSelect,
  arrange,
  onMove,
}: {
  map: AreaMap;
  selected: string;
  onSelect: (id: string) => void;
  arrange: boolean;
  onMove: (row: TableRecord, x: number, y: number) => void;
}) {
  const [zoom, setZoom] = useState(0.75);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragging = useRef<Drag | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  function point(e: PointerEvent<SVGElement>) {
    const element = svg.current!,
      p = element.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(element.getScreenCTM()!.inverse());
  }
  function start(e: PointerEvent<SVGGElement>, row: TableRecord) {
    onSelect(row.id);
    if (!arrange || !['FREE', 'DISABLED'].includes(row.status) || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    dragging.current = {
      row,
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      x: row.positionX,
      y: row.positionY,
    };
    setDrag(dragging.current);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = dragging.current;
    if (!d || d.pointerId !== e.pointerId || !arrange) return;
    const p = point(e);
    const x = Math.max(
      0,
      Math.min(
        map.area.canvasWidth - d.row.width,
        Math.round((d.row.positionX + p.x - d.startX) / 10) * 10,
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        map.area.canvasHeight - d.row.height,
        Math.round((d.row.positionY + p.y - d.startY) / 10) * 10,
      ),
    );
    dragging.current = { ...d, x, y };
    setDrag(dragging.current);
  }
  function finish(e: PointerEvent<SVGSVGElement>, cancel = false) {
    const d = dragging.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragging.current = null;
    setDrag(null);
    if (!cancel && arrange && (d.x !== d.row.positionX || d.y !== d.row.positionY))
      onMove(d.row, d.x, d.y);
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          aria-label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((v) => v - 0.25)}
        >
          −
        </Button>
        <span className="text-sm">{Math.round(zoom * 100)}%</span>
        <Button
          variant="outline"
          aria-label="Zoom in"
          disabled={zoom >= 2}
          onClick={() => setZoom((v) => v + 0.25)}
        >
          +
        </Button>
        <p className="text-sm text-muted-foreground">
          {arrange
            ? 'Drag free or disabled tables; release to save. Use Edit table for exact dimensions.'
            : 'Select a table. Scroll the map to see more.'}
        </p>
      </div>
      <div
        className="max-h-[600px] overflow-auto rounded-lg border bg-card"
        tabIndex={0}
        aria-label="Scrollable floor plan"
      >
        <svg
          ref={svg}
          role="group"
          aria-label={'Floor plan for ' + map.area.name}
          viewBox={`0 0 ${map.area.canvasWidth} ${map.area.canvasHeight}`}
          style={{
            width: map.area.canvasWidth * zoom,
            height: map.area.canvasHeight * zoom,
            maxWidth: 'none',
            touchAction: arrange ? 'none' : 'auto',
          }}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
        >
          <defs>
            <pattern id="layout-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#2b2d32" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#layout-grid)" />
          {map.tables.map((row) => {
            const x = drag?.row.id === row.id ? drag.x : row.positionX,
              y = drag?.row.id === row.id ? drag.y : row.positionY;
            const stroke = selected === row.id ? '#f4c451' : '#747984';
            return (
              <g
                key={row.id}
                role="button"
                tabIndex={0}
                aria-label={`Table ${row.number}: ${row.name}, ${statusLabels[row.status]}, ${row.capacity} seats`}
                aria-pressed={selected === row.id}
                transform={`translate(${x} ${y})`}
                style={{ cursor: arrange ? 'grab' : 'pointer' }}
                onPointerDown={(e) => start(e, row)}
                onClick={() => onSelect(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(row.id);
                  }
                }}
              >
                <title>
                  {row.name} · {statusLabels[row.status]} · {row.capacity} seats
                </title>
                {row.shape === 'CIRCLE' ? (
                  <ellipse
                    cx={row.width / 2}
                    cy={row.height / 2}
                    rx={row.width / 2 - 3}
                    ry={row.height / 2 - 3}
                    fill={colors[row.status]}
                    stroke={stroke}
                    strokeWidth={selected === row.id ? 4 : 2}
                  />
                ) : (
                  <rect
                    x="3"
                    y="3"
                    width={row.width - 6}
                    height={row.height - 6}
                    rx={row.shape === 'SQUARE' ? 4 : 10}
                    fill={colors[row.status]}
                    stroke={stroke}
                    strokeWidth={selected === row.id ? 4 : 2}
                  />
                )}
                <text
                  x={row.width / 2}
                  y={row.height / 2 - 4}
                  textAnchor="middle"
                  fontSize={Math.min(20, row.width / 4)}
                  fontWeight="600"
                  fill="#fafaf8"
                  pointerEvents="none"
                >
                  {row.number}
                </text>
                <text
                  x={row.width / 2}
                  y={row.height / 2 + 14}
                  textAnchor="middle"
                  fontSize={Math.min(12, row.width / 8)}
                  fill="#d2d4da"
                  pointerEvents="none"
                >
                  {statusLabels[row.status]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
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
      setError(parsed.error.issues.map((i) => i.message).join('; '));
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
      aria-label="Area editor"
      className="space-y-4 rounded-lg border bg-card p-5"
      onSubmit={submit}
    >
      <h2 className="text-lg font-semibold">{row ? 'Edit area' : 'New area'}</h2>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <fieldset disabled={busy} className="space-y-4">
        {!row ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Start with a name:</span>
            {['Indoor', 'Terrace'].map((value) => (
              <Button key={value} type="button" variant="outline" onClick={() => setName(value)}>
                {value}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="layout-areaName">Area name</Label>
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
          label="Area description"
          value={row?.description}
          required={false}
          maxLength={2000}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            name="sortOrder"
            label="Area sort order"
            value={row?.sortOrder ?? 0}
            type="number"
          />
          <Field
            name="canvasWidth"
            label="Canvas width"
            value={row?.canvasWidth ?? 1200}
            type="number"
          />
          <Field
            name="canvasHeight"
            label="Canvas height"
            value={row?.canvasHeight ?? 800}
            type="number"
          />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={row?.active ?? true} />
          Area active
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Save area</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {row ? (
            <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>
              Archive area
            </Button>
          ) : null}
        </div>
        {confirm && row ? (
          <div className="space-y-2">
            <p>Archive this area? All tables must be moved or archived first.</p>
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
              Confirm area archive
            </Button>
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}
function TableEditor({
  row,
  area,
  areas,
  busy,
  operate,
  onClose,
  onSaved,
}: {
  row?: TableRecord;
  area: AreaRecord;
  areas: AreaRecord[];
  busy: boolean;
  operate: Operation;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const numeric = (key: string) => Number(form.get(key));
    const parsed = tableInputSchema.safeParse({
      name: form.get('name'),
      areaId: form.get('areaId'),
      number: numeric('number'),
      capacity: numeric('capacity'),
      positionX: numeric('positionX'),
      positionY: numeric('positionY'),
      width: numeric('width'),
      height: numeric('height'),
      shape: form.get('shape'),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
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
      aria-label="Table editor"
      onSubmit={submit}
      className="space-y-4 rounded-lg border bg-card p-5"
    >
      <h2 className="text-lg font-semibold">{row ? 'Edit table' : 'New table'}</h2>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" label="Table name" value={row?.name} maxLength={100} />
          <div className="space-y-2">
            <Label htmlFor="layout-tableArea">Table area</Label>
            <select id="layout-tableArea" name="areaId" defaultValue={row?.areaId ?? area.id}>
              {areas
                .filter((a) => !a.deletedAt)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
          <Field
            name="number"
            label="Table number (unique in branch)"
            value={row?.number}
            type="number"
          />
          <Field name="capacity" label="Capacity" value={row?.capacity ?? 4} type="number" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="positionX" label="Position X" value={row?.positionX ?? 20} type="number" />
          <Field name="positionY" label="Position Y" value={row?.positionY ?? 20} type="number" />
          <Field name="width" label="Table width" value={row?.width ?? 120} type="number" />
          <Field name="height" label="Table height" value={row?.height ?? 80} type="number" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="layout-shape">Shape</Label>
          <select id="layout-shape" name="shape" defaultValue={row?.shape ?? 'RECTANGLE'}>
            <option value="RECTANGLE">Rectangle</option>
            <option value="SQUARE">Square</option>
            <option value="CIRCLE">Circle</option>
          </select>
        </div>
        <p className="text-sm text-muted-foreground">
          Dimensions use floor-plan units. Circles and squares need matching width and height.
          Tables must fit without overlapping.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Save table</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
function TableDetails({
  row,
  area,
  canManage,
  canStatus,
  busy,
  operate,
  onEdit,
  onArchived,
}: {
  row: TableRecord;
  area: AreaRecord;
  canManage: boolean;
  canStatus: boolean;
  busy: boolean;
  operate: Operation;
  onEdit: () => void;
  onArchived: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const movable = ['FREE', 'DISABLED'].includes(row.status);
  const choices: Partial<Record<TableStatus, ('FREE' | 'RESERVED' | 'DISABLED')[]>> = {
    FREE: ['RESERVED', 'DISABLED'],
    RESERVED: ['FREE'],
    DISABLED: ['FREE'],
  };
  return (
    <section aria-label="Selected table" className="space-y-3 rounded-lg border bg-card p-5">
      <h3 className="text-lg font-semibold">
        {row.number} · {row.name}
      </h3>
      <p>
        {statusLabels[row.status]} · {row.capacity} seats · {row.shape.toLowerCase()} · {row.width}{' '}
        × {row.height} · Position {row.positionX}, {row.positionY}
      </p>
      <div className="flex flex-wrap gap-2">
        {canManage ? (
          <Button variant="outline" disabled={busy || !movable} onClick={onEdit}>
            Edit table
          </Button>
        ) : null}
        {canStatus
          ? choices[row.status]?.map((status) => (
              <Button
                key={status}
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
                Mark {statusLabels[status].toLowerCase()}
              </Button>
            ))
          : null}
        {canManage ? (
          <Button
            variant="destructive"
            disabled={busy || !movable}
            onClick={() => setConfirm(true)}
          >
            Archive table
          </Button>
        ) : null}
      </div>
      {confirm ? (
        <div className="space-y-2">
          <p>Archive this table? Its number and change history will be retained.</p>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void operate(
                () => api('layout/tables/' + row.id + '/archive', 'POST', { version: row.version }),
                onArchived,
              )
            }
          >
            Confirm table archive
          </Button>
        </div>
      ) : null}
    </section>
  );
}
