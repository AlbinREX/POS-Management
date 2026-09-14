'use client';
import { useState, type ReactNode, type FormEvent } from 'react';
import type {
  SupplierRecord,
  PurchaseRecord,
  ReceiptRecord,
  InventoryUnitCode,
} from '@restaurant/shared-types';
import { Button } from '@restaurant/ui/button';
import { Input } from '@restaurant/ui/input';
export type Choice = { id: string; name: string; active?: boolean; deletedAt?: string | null };
export type PurchaseChoice = Choice & { unitCode: InventoryUnitCode; sku: string };
export type PurchasingEditor =
  | { kind: 'supplier'; value: SupplierRecord | null }
  | { kind: 'draft'; value: PurchaseRecord | null }
  | { kind: 'receive'; value: PurchaseRecord }
  | { kind: 'payment'; value: ReceiptRecord }
  | { kind: 'cancel'; value: PurchaseRecord }
  | { kind: 'reverse'; id: string }
  | { kind: 'archive'; value: SupplierRecord };
export const quantityLabel = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') || '0' : v);
export function PurchaseField({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="text-muted-foreground">{name}</span>
      {children}
    </label>
  );
}
const Field = PurchaseField;
const form = (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
};
export function PurchasingEditorDialog({
  editor,
  items,
  warehouses,
  suppliers,
  locked,
  busy,
  error,
  onClose,
  submit,
}: {
  editor: PurchasingEditor;
  items: PurchaseChoice[];
  warehouses: Choice[];
  suppliers: Choice[];
  locked: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  submit: (path: string, body: Record<string, unknown>, method?: string) => void;
}) {
  return (
    <dialog
      className="riza-dialog inventory-dialog purchase-dialog"
      aria-label="Purchasing editor"
      ref={(el) => {
        if (el && !el.open) el.showModal();
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="flex justify-between items-center mb-5 gap-3">
        <h2 className="text-xl font-semibold">
          {
            {
              supplier: 'Supplier details',
              draft: 'Purchase order draft',
              receive: 'Receive goods',
              payment: 'Record supplier payment',
              cancel: 'Cancel purchase',
              reverse: 'Reverse payment record',
              archive: 'Archive supplier',
            }[editor.kind]
          }
        </h2>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Close editor
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive mb-4">
          {error}
        </p>
      ) : null}
      {editor.kind === 'draft' ? (
        <DraftForm
          key={editor.value?.id ?? 'new'}
          value={editor.value}
          items={items}
          warehouses={warehouses}
          suppliers={suppliers}
          locked={locked}
          onSave={(body) =>
            submit(
              editor.value ? `orders/${editor.value.id}` : 'orders',
              { ...body, ...(editor.value ? { version: editor.value.version } : {}) },
              editor.value ? 'PUT' : 'POST',
            )
          }
        />
      ) : null}
      {editor.kind === 'supplier' ? (
        <form
          onSubmit={(e) => {
            const values = form(e);
            submit(
              editor.value ? `suppliers/${editor.value.id}` : 'suppliers',
              {
                ...values,
                ...(editor.value
                  ? { version: editor.value.version, active: values.active === 'on' }
                  : {}),
              },
              editor.value ? 'PUT' : 'POST',
            );
          }}
        >
          <fieldset disabled={locked} className="space-y-4">
            {(
              [
                'name',
                'businessNumber',
                'taxNumber',
                'contactPerson',
                'phone',
                'email',
                'address',
                'notes',
              ] as const
            ).map((k, index) => (
              <Field
                key={k}
                name={
                  [
                    'Supplier name',
                    'Business number',
                    'Tax number',
                    'Contact person',
                    'Phone',
                    'Email',
                    'Address',
                    'Notes',
                  ][index]!
                }
              >
                <Input
                  name={k}
                  required={k === 'name'}
                  type={k === 'email' ? 'email' : 'text'}
                  defaultValue={editor.value?.[k] ?? ''}
                />
              </Field>
            ))}
            {editor.value ? (
              <label className="flex gap-2 items-center">
                <input name="active" type="checkbox" defaultChecked={editor.value.active} />
                Active supplier
              </label>
            ) : null}
            <Button type="submit">Save supplier</Button>
          </fieldset>
        </form>
      ) : null}
      {editor.kind === 'receive' ? (
        <form
          onSubmit={(e) => {
            const v = form(e);
            submit(`orders/${editor.value.id}/receive`, {
              version: editor.value.version,
              reference: v.reference,
              invoiceNumber: v.invoiceNumber || null,
              invoiceDate: v.invoiceDate || null,
              dueDate: v.dueDate || null,
              documentReference: v.documentReference,
              notes: v.notes,
              items: editor.value.items
                .map((i) => ({ purchaseItemId: i.id, quantity: String(v[i.id] ?? '0') }))
                .filter((i) => /[1-9]/.test(i.quantity)),
            });
          }}
        >
          <fieldset disabled={locked} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Post only quantities delivered now. This adds stock and a supplier charge. Use zero to
              skip an item.
            </p>
            {editor.value.items
              .filter((i) => i.remainingQuantity !== '0.000000')
              .map((i) => (
                <Field key={i.id} name={`Receive ${i.itemName} (${i.unitCode})`}>
                  <Input
                    name={i.id}
                    aria-label={`Receive ${i.itemName} (${i.unitCode})`}
                    inputMode="decimal"
                    required
                    defaultValue={quantityLabel(i.remainingQuantity)}
                  />
                  <small>
                    Remaining: {quantityLabel(i.remainingQuantity)} {i.unitCode}
                  </small>
                </Field>
              ))}
            <Field name="Delivery reference">
              <Input name="reference" required maxLength={120} />
            </Field>
            <div className="purchase-form-grid">
              <Field name="Invoice number">
                <Input name="invoiceNumber" maxLength={120} />
              </Field>
              <Field name="Invoice date">
                <Input name="invoiceDate" type="date" />
              </Field>
              <Field name="Due date">
                <Input name="dueDate" type="date" />
              </Field>
              <Field name="Document reference (HTTPS)">
                <Input name="documentReference" type="url" placeholder="https://" />
              </Field>
            </div>
            <Field name="Receiving notes">
              <Input name="notes" maxLength={2000} />
            </Field>
            <Button type="submit">Post goods receipt</Button>
          </fieldset>
        </form>
      ) : null}
      {editor.kind === 'payment' ? (
        <form onSubmit={(e) => submit('payments', { ...form(e), receiptId: editor.value.id })}>
          <fieldset disabled={locked} className="space-y-4">
            <p className="purchase-notice">
              Confirm the payment outside this POS first. This records its reference against receipt{' '}
              {editor.value.reference}.
            </p>
            <Field name="Supplier payment amount">
              <Input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={editor.value.outstanding}
              />
            </Field>
            <Field name="Supplier payment method">
              <select name="method">
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash paid externally</option>
                <option value="CARD">Card paid externally</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <Field name="Payment reference">
              <Input name="reference" required maxLength={120} />
            </Field>
            <Field name="Payment reason">
              <Input name="reason" required maxLength={500} />
            </Field>
            <Button type="submit">Save supplier payment</Button>
          </fieldset>
        </form>
      ) : null}
      {editor.kind === 'cancel' || editor.kind === 'reverse' ? (
        <form
          onSubmit={(e) => {
            const v = form(e);
            if (editor.kind === 'cancel')
              submit(`orders/${editor.value.id}/cancel`, { ...v, version: editor.value.version });
            else if (editor.kind === 'reverse') submit(`payments/${editor.id}/reverse`, v);
          }}
        >
          <fieldset disabled={locked} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {editor.kind === 'reverse'
                ? 'This reverses the recorded supplier payment in the balance. It does not reverse an external bank or card transaction.'
                : 'Cancel this unreceived purchase and keep its history.'}
            </p>
            <Field name="Reason">
              <Input name="reason" required maxLength={500} />
            </Field>
            <Button type="submit">
              {editor.kind === 'cancel' ? 'Confirm cancellation' : 'Confirm payment reversal'}
            </Button>
          </fieldset>
        </form>
      ) : null}
      {editor.kind === 'archive' ? (
        <div className="space-y-4">
          <p>
            Archive {editor.value.name}? Its purchase and account history will remain available.
          </p>
          <Button
            disabled={locked}
            onClick={() =>
              submit(`suppliers/${editor.value.id}/archive`, { version: editor.value.version })
            }
          >
            Confirm supplier archive
          </Button>
        </div>
      ) : null}
    </dialog>
  );
}
function DraftForm({
  value,
  items,
  warehouses,
  suppliers,
  locked,
  onSave,
}: {
  value: PurchaseRecord | null;
  items: PurchaseChoice[];
  warehouses: Choice[];
  suppliers: Choice[];
  locked: boolean;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const [lines, setLines] = useState(
    () =>
      value?.items.map((i) => ({
        key: i.id,
        itemId: i.itemId,
        quantity: quantityLabel(i.quantity),
        unitCode: i.unitCode,
        unitPrice: i.unitPrice,
        taxRate: i.taxRate,
      })) ?? [
        {
          key: crypto.randomUUID(),
          itemId: '',
          quantity: '1',
          unitCode: 'pcs' as InventoryUnitCode,
          unitPrice: '0.00',
          taxRate: '0.00',
        },
      ],
  );
  return (
    <form
      onSubmit={(e) => {
        const v = form(e);
        onSave({
          supplierId: v.supplierId,
          warehouseId: v.warehouseId,
          reference: v.reference,
          notes: v.notes,
          expectedDate: v.expectedDate || null,
          items: lines.map(({ key: _key, ...line }) => line),
        });
      }}
    >
      <fieldset disabled={locked} className="space-y-5">
        <div className="purchase-form-grid">
          <Field name="Supplier">
            <select name="supplierId" required defaultValue={value?.supplierId ?? ''}>
              <option value="">Choose a supplier</option>
              {suppliers
                .filter((s) => s.active !== false && !s.deletedAt)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field name="Receiving warehouse">
            <select name="warehouseId" required defaultValue={value?.warehouseId ?? ''}>
              <option value="">Choose a warehouse</option>
              {warehouses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field name="Purchase reference">
            <Input name="reference" defaultValue={value?.reference ?? ''} />
          </Field>
          <Field name="Expected delivery">
            <Input name="expectedDate" type="date" defaultValue={value?.expectedDate ?? ''} />
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter net unit prices before tax. Save the draft to calculate exact totals. Configure
          stock items and warehouses in Inventory.
        </p>
        {lines.map((l, index) => (
          <div key={l.key} className="purchase-line-editor">
            <Field name={`Purchase item ${index + 1}`}>
              <select
                required
                value={l.itemId}
                onChange={(e) =>
                  setLines((rows) =>
                    rows.map((r) =>
                      r.key === l.key
                        ? {
                            ...r,
                            itemId: e.target.value,
                            unitCode: items.find((i) => i.id === e.target.value)?.unitCode ?? 'pcs',
                          }
                        : r,
                    ),
                  )
                }
              >
                <option value="">Choose an item</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="purchase-form-grid">
              {(['quantity', 'unitPrice', 'taxRate'] as const).map((k, i) => (
                <Field
                  key={k}
                  name={`${['Quantity', 'Net unit price', 'Tax rate (%)'][i]} ${index + 1}`}
                >
                  <Input
                    required
                    inputMode="decimal"
                    value={l[k]}
                    onChange={(e) =>
                      setLines((rows) =>
                        rows.map((r) => (r.key === l.key ? { ...r, [k]: e.target.value } : r)),
                      )
                    }
                  />
                </Field>
              ))}
              <Field name={`Purchase unit ${index + 1}`}>
                <select
                  value={l.unitCode}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r) =>
                        r.key === l.key
                          ? { ...r, unitCode: e.target.value as InventoryUnitCode }
                          : r,
                      ),
                    )
                  }
                >
                  {(['kg', 'g', 'l', 'ml', 'pcs'] as const).map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Button
              variant="ghost"
              disabled={lines.length === 1}
              onClick={() => setLines((rows) => rows.filter((r) => r.key !== l.key))}
            >
              Remove purchase item {index + 1}
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          disabled={lines.length >= 100}
          onClick={() =>
            setLines((rows) => [
              ...rows,
              {
                key: crypto.randomUUID(),
                itemId: '',
                quantity: '1',
                unitCode: 'pcs',
                unitPrice: '0.00',
                taxRate: '0.00',
              },
            ])
          }
        >
          Add purchase item
        </Button>
        <Field name="Purchase notes">
          <Input name="notes" defaultValue={value?.notes ?? ''} />
        </Field>
        <Button type="submit">Save purchase draft</Button>
      </fieldset>
    </form>
  );
}
