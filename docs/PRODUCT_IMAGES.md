# Bundled product photography

Assets live in `apps/admin/public/food/`.

Product images shipped with FastFood Riza, served by the app itself at `/food/<name>.webp`.
They are referenced from `Product.imageUrl` as root-relative paths so the same stored value
resolves on localhost, on a restaurant's LAN address and on any other deployment without
rewriting rows, and so the POS never depends on an external host being reachable.

## Files

| File                   | Product         |
| ---------------------- | --------------- |
| `riza-burger.webp`     | Riza Burger     |
| `chicken-classic.webp` | Chicken Classic |
| `pepperoni-pizza.webp` | Pepperoni Pizza |
| `french-fries.webp`    | French Fries    |
| `cola.webp`            | Coca-Cola       |
| `chicken-wrap.webp`    | Chicken Wrap    |

Each is WebP, 640×480 (4:3), 20–64 KB. The uniform aspect ratio matches the reserved image
box in `.product-image`, so a lazily-loaded image settles into space the browser already
allocated instead of shifting the grid.

## Provenance and licence

Sourced from [Unsplash](https://unsplash.com) under the
[Unsplash Licence](https://unsplash.com/license), which permits free commercial use without
attribution. They were cropped to 4:3 and re-encoded to WebP with `sharp`. None contains a
third-party logo or a watermark.

## Adding or replacing an image

1. Put a web-optimised file here (WebP, 4:3, ideally under ~100 KB).
2. Set the product's **Image URL or app path** field in the Menu screen to `/food/<file>`.

A full `http(s)` URL still works for a catalogue hosted elsewhere. A product with no image
falls back to its initial on a branded placeholder, so an unset or unreachable image never
breaks the grid.

`scripts/demo-menu.mjs` creates a demo catalogue wired to these files. It is opt-in
(`npm run demo:menu`) and never runs during seeding, migration or deployment, because a real
restaurant's menu is operator data.
