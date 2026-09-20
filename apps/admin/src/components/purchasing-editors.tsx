'use client';
import { useI18n, serverMessage } from '../lib/i18n';
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
  const { t, locale } = useI18n();
  return (
    <dialog
      className="riza-dialog inventory-dialog purchase-dialog"
      aria-label={t('operations.purchasingEditor')}
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
              supplier: t('operations.supplierDetails'),
              draft: t('operations.purchaseOrderDraft'),
              receive: t('operations.receiveGoods'),
              payment: t('operations.recordSupplierPayment'),
              cancel: t('operations.cancelPurchase'),
              reverse: t('operations.reversePaymentRecord'),
              archive: t('operations.archiveSupplier'),
            }[editor.kind]
          }
        </h2>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {t('operations.closeEditor')}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive mb-4">
          {serverMessage(error, locale)}
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
                    t('operations.supplierName'),
                    t('operations.businessNumber'),
                    t('operations.taxNumber'),
                    t('operations.contactPerson'),
                    t('operations.phone'),
                    t('operations.email'),
                    t('operations.address'),
                    t('operations.notes'),
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
                {t('operations.activeSupplier')}
              </label>
            ) : null}
            <Button type="submit">{t('operations.saveSupplier')}</Button>
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
              {t('operations.postOnlyQuantitiesDeliveredNowThisAddsStockAndASupplierChargeUseZeroToSkipAnItem')}
            </p>
            {editor.value.items
              .filter((i) => i.remainingQuantity !== '0.000000')
              .map((i) => (
                <Field key={i.id} name={t('operations.receiveItem', { name: i.itemName, unit: i.unitCode })}>
                  <Input
                    name={i.id}
                    aria-label={t('operations.receiveItem', { name: i.itemName, unit: i.unitCode })}
                    inputMode="decimal"
                    required
                    defaultValue={quantityLabel(i.remainingQuantity)}
                  />
                  <small>
                    {t('operations.remaining2')} {quantityLabel(i.remainingQuantity)} {i.unitCode}
                  </small>
                </Field>
              ))}
            <Field name={t('operations.deliveryReference')}>
              <Input name="reference" required maxLength={120} />
            </Field>
            <div className="purchase-form-grid">
              <Field name={t('operations.invoiceNumber')}>
                <Input name="invoiceNumber" maxLength={120} />
              </Field>
              <Field name={t('operations.invoiceDate')}>
                <Input name="invoiceDate" type="date" />
              </Field>
              <Field name={t('operations.dueDate2')}>
                <Input name="dueDate" type="date" />
              </Field>
              <Field name={t('operations.documentReferenceHttps')}>
                <Input name="documentReference" type="url" placeholder="https://" />
              </Field>
            </div>
            <Field name={t('operations.receivingNotes')}>
              <Input name="notes" maxLength={2000} />
            </Field>
            <Button type="submit">{t('operations.postGoodsReceipt')}</Button>
          </fieldset>
        </form>
      ) : null}
      {editor.kind === 'payment' ? (
        <form onSubmit={(e) => submit('payments', { ...form(e), receiptId: editor.value.id })}>
          <fieldset disabled={locked} className="space-y-4">
            <p className="purchase-notice">
              {t('operations.confirmThePaymentOutsideThisPosFirstThisRecordsItsReferenceAgainstReceipt')}{' '}
              {editor.value.reference}.
            </p>
            <Field name={t('operations.supplierPaymentAmount')}>
              <Input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={editor.value.outstanding}
              />
            </Field>
            <Field name={t('operations.supplierPaymentMethod')}>
              <select name="method">
                <option value="BANK_TRANSFER">{t('operations.bankTransfer')}</option>
                <option value="CASH">{t('operations.cashPaidExternally')}</option>
                <option value="CARD">{t('operations.cardPaidExternally')}</option>
                <option value="OTHER">{t('operations.other')}</option>
              </select>
            </Field>
            <Field name={t('operations.paymentReference')}>
              <Input name="reference" required maxLength={120} />
            </Field>
            <Field name={t('operations.paymentReason')}>
              <Input name="reason" required maxLength={500} />
            </Field>
            <Button type="submit">{t('operations.saveSupplierPayment')}</Button>
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
                ? t('operations.thisReversesTheRecordedSupplierPaymentInTheBalanceItDoesNotReverseAnExternalBankOrCardTransaction')
                : t('operations.cancelThisUnreceivedPurchaseAndKeepItsHistory')}
            </p>
            <Field name={t('operations.reason')}>
              <Input name="reason" required maxLength={500} />
            </Field>
            <Button type="submit">
              {editor.kind === 'cancel' ? t('operations.confirmCancellation') : t('operations.confirmPaymentReversal')}
            </Button>
          </fieldset>
        </form>
      ) : null}
      {editor.kind === 'archive' ? (
        <div className="space-y-4">
          <p>
            {t('operations.archive')} {editor.value.name}{t('operations.itsPurchaseAndAccountHistoryWillRemainAvailable')}
          </p>
          <Button
            disabled={locked}
            onClick={() =>
              submit(`suppliers/${editor.value.id}/archive`, { version: editor.value.version })
            }
          >
            {t('operations.confirmSupplierArchive')}
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
  const { t } = useI18n();
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
          <Field name={t('operations.supplier')}>
            <select name="supplierId" required defaultValue={value?.supplierId ?? ''}>
              <option value="">{t('operations.chooseASupplier')}</option>
              {suppliers
                .filter((s) => s.active !== false && !s.deletedAt)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field name={t('operations.receivingWarehouse')}>
            <select name="warehouseId" required defaultValue={value?.warehouseId ?? ''}>
              <option value="">{t('operations.chooseAWarehouse')}</option>
              {warehouses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field name={t('operations.purchaseReference')}>
            <Input name="reference" defaultValue={value?.reference ?? ''} />
          </Field>
          <Field name={t('operations.expectedDelivery')}>
            <Input name="expectedDate" type="date" defaultValue={value?.expectedDate ?? ''} />
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('operations.enterNetUnitPricesBeforeTaxSaveTheDraftToCalculateExactTotalsConfigureStockItemsAndWarehousesInInventory')}
        </p>
        {lines.map((l, index) => (
          <div key={l.key} className="purchase-line-editor">
            <Field name={t('operations.purchaseItemNumber', { number: index + 1 })}>
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
                <option value="">{t('operations.chooseAnItem')}</option>
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
                  name={`${[t('operations.quantity'), t('operations.netUnitPrice'), t('operations.taxRate')][i]} ${index + 1}`}
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
              <Field name={t('operations.purchaseUnitNumber', { number: index + 1 })}>
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
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Button
              variant="ghost"
              disabled={lines.length === 1}
              onClick={() => setLines((rows) => rows.filter((r) => r.key !== l.key))}
            >
              {t('operations.removePurchaseItem')} {index + 1}
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
          {t('operations.addPurchaseItem')}
        </Button>
        <Field name={t('operations.purchaseNotes')}>
          <Input name="notes" defaultValue={value?.notes ?? ''} />
        </Field>
        <Button type="submit">{t('operations.savePurchaseDraft')}</Button>
      </fieldset>
    </form>
  );
}
