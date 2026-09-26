# Menu management

Settings → Menu has three main tabs: **Products**, **Categories** and **Offers**. Modifier groups, modifiers and kitchen stations stay available beside them. Everything uses the existing menu API, the `menu.read` / `menu.manage` permissions, optimistic versioning and the audit log. There is no second menu or product system.

## Products

- **Editing** happens in a side drawer. Nothing is written until **Save changes**; Cancel or Escape discards the edit.
- **Sold out** (`Product.soldOut`) means temporarily unavailable. The product stays listed in management and on the POS, marked *Sold out*, but the server refuses to add it to an order.
- **Inactive** (`active = false`) hides the product from the POS menu. Both states keep history; products are archived, never deleted.
- **Featured** (`Product.featured`) is a display preference only. A featured product is shown first within its own category on the POS, then the usual `sortOrder` applies. It never moves a product into another category, and never affects price, offers, order history or reporting. Sold-out and inactive work exactly as they do for any other product.
- **Display order** is explicit (`sortOrder`). Categories, and the products within one category, are reordered by dragging or with Move up / Move down, then **Save order**. The POS shows categories in that order, then products in theirs. Reordering is version-checked, so it never overwrites a newer edit.
- **Audit** records a full before/after on every save. Price, image, category, activation and sold-out changes each also get their own entry (`menu.products.price_changed`, `…image_changed`, `…category_changed`, `…activated` / `…deactivated`, `…sold_out` / `…back_in_stock`, `…featured` / `…unfeatured`). Audit rows hold values and paths, never image data.

## Images

Products keep using the single `imageUrl` field; offers have an optional one of their own.

1. The browser posts the raw file to `POST /api/media/menu` (`menu.manage`).
2. The API identifies PNG, JPEG or WebP from the bytes; the declared type and filename are ignored. It refuses anything over 5 MB, smaller than 200 × 200 or larger than 8000 px per side, and damaged data. Decoding is bounded against decompression bombs.
3. It writes a 1024 × 1024 WebP, cropped to cover, under a random UUID name. Embedded metadata such as camera location is dropped. Nothing in the database changes yet.
4. **Save changes** stores the path (`/api/media/menu/<uuid>.webp`) on the product.
5. Only after that save commits is the previous image deleted, and only if no product or offer anywhere still uses it. A shared Postgres advisory lock orders reference checks against deletion, so a product can never point at a removed file.

Uploads that are never saved (a cancelled edit) are removed after 24 hours. Files are served publicly with `Cache-Control: immutable`: menu photos are not secret, and the POS renders them with plain `<img>` tags.

### Storage, backup and restore

- The API writes to `MEDIA_ROOT`. Production refuses to start unless it is an absolute path. Docker mounts the named volume `menu_media` at `/var/lib/restaurant/media`, so images survive container restarts, image rebuilds and host reboots. Local development defaults to `.local/media`.
- `scripts/backup.ps1` archives the volume beside each database dump as `restaurant-<stamp>.media.tar.gz`. It uses the same partial-file, validation, checksum and retention rules, and records the archive in `backup-status.json`. The database container sees the volume read-only for this purpose only.
- `scripts/restore.ps1 -MediaArchive <name>` verifies the checksum, then **adds** missing images to the live volume without replacing any. Run it at cutover, when the restored database starts referencing them. It can be combined with `-BackupName` / `-NewDatabase`.

## Offers

An offer has a name, optional description and image, one or more products, a window (`startsAt` inclusive, `endsAt` exclusive), and either a **fixed price** or a **percentage off**.

- **`Product.sellingPrice` is never changed.** When the window ends or the offer is switched off, the normal price applies again with no further action.
- **Offers never stack.** An active offer is refused if any of its products already has an active offer at an overlapping moment (Serializable isolation). A fixed offer price must be below each product's normal price.
- **Pricing is exact.** Integer cents; percentages round half up to the cent. `offerUnitPrice` in `@restaurant/validation` is the single implementation, used by the API to charge and by the admin preview.
- **Order lines freeze the price.** When an item is added, the server decides the price at that moment and stores `unitPrice` (charged), `listPrice` (the normal price it replaced), `offerId` and `offerName` on the `OrderItem`. Editing, deactivating, archiving or expiring the offer later never changes an existing order. The database enforces that an offer line always names its offer and base price, and never charges more than the base.
- Offers are archived, never deleted, because order lines reference them.

The POS shows a product on offer with the normal price struck through, the offer price highlighted and an **OFFER** badge.

## Suggested Riza menu

`node scripts/riza-menu.mjs` holds the suggested structure: ten categories from *Oferta* to *Pije*, and the starting products. It is opt-in and additive only.

- It never renames, reprices or removes existing data.
- It is a dry run unless `--apply` is given.
- It creates a product only when its price is supplied with `--prices prices.json` (`{ "RIZA-BURGER": "3.50" }`). New products are inactive unless `--activate` is given.
