/**
 * The FastFood Riza menu structure: roughly 80% fast food and 20% Kosovo gjelltore.
 *
 * Opt-in, and additive only. It never runs during seeding, migration or deployment, and it
 * never updates, renames, reprices or archives anything that already exists: a live
 * restaurant's menu is operator data. It only adds what is missing, through the normal
 * authenticated menu API, so branch scope, permissions, validation and audit apply exactly
 * as they would to someone typing the same values into the Menu screen.
 *
 * Categories are matched by name and products by SKU. Prices are the owner's decision, so
 * none are invented here: a product is created only when its price is supplied in a JSON
 * file mapping SKU to a two-decimal price, and every other product is reported as waiting
 * for one. New products are created inactive unless --activate is given, so nothing
 * appears on the POS before it has a photo, routing and a final check.
 *
 * Usage:
 *   node scripts/riza-menu.mjs                          # dry run: show what would change
 *   node scripts/riza-menu.mjs --apply                  # add missing categories
 *   node scripts/riza-menu.mjs --apply --prices prices.json [--station "Kuzhina"] [--activate]
 *
 * Credentials come from SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD (or --email / --password).
 */
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
config({ quiet: true });

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes('--' + name);
const base = arg('base', 'http://localhost:8080').replace(/\/$/, '');
const apply = flag('apply');

export const MENU = [
  ['Oferta', [
    ['RIZA-MENU', 'Riza Burger Menu'],
    ['DONER-MENU', 'Doner Menu'],
    ['CHICKEN-MENU', 'Chicken Menu'],
    ['PIZZA-DRINK', 'Pizza + Drink'],
  ]],
  ['Burger', [
    ['RIZA-BURGER', 'Riza Burger'],
    ['CLASSIC-BURGER', 'Classic Burger'],
    ['CHEESEBURGER', 'Cheeseburger'],
    ['EGG-BURGER', 'Egg Burger'],
    ['DOUBLE-BURGER', 'Double Burger'],
    ['CHICKEN-BURGER', 'Chicken Burger'],
  ]],
  ['Doner & Wrap', [
    ['DONER-BUKE', 'Doner në Bukë'],
    ['DONER-PETE', 'Doner në Petë'],
    ['DONER-PJATE', 'Doner në Pjatë'],
    ['CHICKEN-WRAP', 'Chicken Wrap'],
    ['RIZA-DONER', 'Riza Doner'],
  ]],
  ['Chicken', [
    ['FILETO-PULE', 'Fileto Pule'],
    ['CRISPY-CHICKEN', 'Crispy Chicken'],
    ['CHICKEN-FINGERS', 'Chicken Fingers'],
    ['CHICKEN-SCHNITZEL', 'Chicken Schnitzel'],
    ['PULE-ORIZ', 'Pulë me Oriz'],
  ]],
  ['Pizza', [
    ['PIZZA-MARGARITA', 'Margarita'],
    ['PIZZA-PEPPERONI', 'Pepperoni'],
    ['PIZZA-PROSHUTE', 'Proshutë'],
    ['PIZZA-TUNA', 'Tuna'],
    ['PIZZA-RIZA', 'Pizza Riza'],
  ]],
  ['Skara', [
    ['QEBAPA', 'Qebapa'],
    ['PLESKAVICE', 'Pleskavicë'],
    ['QOFTE', 'Qofte'],
    ['SUXHUK', 'Suxhuk'],
    ['MIX-SKARA', 'Mix Skara'],
  ]],
  ['Sandwich & Samun', [
    ['SANDWICH-PULE', 'Sandwich Pule'],
    ['SAMUN-SUXHUK', 'Samun Suxhuk'],
    ['SAMUN-PROSHUTE', 'Samun Proshutë'],
    ['SAMUN-MIX', 'Samun Mix'],
  ]],
  ['Gjellë', [
    ['PASUL', 'Pasul'],
    ['PASUL-MISH', 'Pasul me Mish'],
    ['GULLASH-PURE', 'Gullash me Pure'],
    ['MUSAKA', 'Musaka'],
    ['SPECA-MBUSHUR', 'Speca të Mbushur'],
    ['PILAF-MISH', 'Pilaf me Mish'],
  ]],
  ['Sides & Sallata', [
    ['POMFRIT-MINI', 'Pomfrit Mini'],
    ['POMFRIT-LARGE', 'Pomfrit Large'],
    ['ORIZ', 'Oriz'],
    ['SALLATE-SHOPE', 'Sallatë Shope'],
    ['SALLATE-PULE', 'Sallatë Pule'],
  ]],
  ['Pije', [
    ['COCA-COLA', 'Coca-Cola'],
    ['FANTA', 'Fanta'],
    ['SPRITE', 'Sprite'],
    ['UJE', 'Ujë'],
    ['AJRAN', 'Ajran'],
    ['JOGURT', 'Jogurt'],
  ]],
];

async function main() {
  const prices = arg('prices') ? JSON.parse(readFileSync(arg('prices'), 'utf8')) : {};
  for (const [sku, price] of Object.entries(prices))
    if (!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(String(price))) throw new Error(`Price for ${sku} must look like 3.50`);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      organization: arg('organization', process.env.SEED_ORGANIZATION_SLUG),
      branch: arg('branch', process.env.SEED_BRANCH_CODE),
      email: arg('email', process.env.SEED_OWNER_EMAIL),
      password: arg('password', process.env.SEED_OWNER_PASSWORD),
    }),
  });
  if (!login.ok) throw new Error(`Sign-in failed (${login.status})`);
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}`, Origin: base, 'Content-Type': 'application/json' };
  const all = async (kind) => {
    const rows = [];
    for (let page = 1; ; page++) {
      const response = await fetch(`${base}/api/menu/${kind}?limit=100&page=${page}`, { headers });
      if (!response.ok) throw new Error(`Could not read ${kind} (${response.status})`);
      const body = await response.json();
      rows.push(...body.items);
      if (!body.hasMore) return rows;
    }
  };
  const post = async (kind, data) => {
    const response = await fetch(`${base}/api/menu/${kind}`, { method: 'POST', headers, body: JSON.stringify({ kind, ...data }) });
    if (!response.ok) throw new Error(`${kind} "${data.name}": ${(await response.json()).message}`);
    return response.json();
  };
  const categories = await all('categories');
  const products = await all('products');
  const stationName = arg('station');
  const station = stationName && (await all('kitchen-stations')).find((s) => s.name === stationName);
  if (stationName && !station) throw new Error(`No kitchen station named "${stationName}"`);
  const byName = new Map(categories.map((c) => [c.name.toLocaleLowerCase('sq'), c]));
  const skus = new Set(products.map((p) => p.sku));
  const report = { categoriesAdded: [], productsAdded: [], alreadyPresent: 0, needsPrice: [] };
  for (const [index, [categoryName, items]] of MENU.entries()) {
    let category = byName.get(categoryName.toLocaleLowerCase('sq'));
    if (!category) {
      report.categoriesAdded.push(categoryName);
      if (apply) category = await post('categories', { name: categoryName, sortOrder: (index + 1) * 10 });
    }
    for (const [position, [sku, name]] of items.entries()) {
      if (skus.has(sku)) {
        report.alreadyPresent++;
        continue;
      }
      if (!prices[sku]) {
        report.needsPrice.push(`${sku} (${name})`);
        continue;
      }
      report.productsAdded.push(`${sku} ${name} ${prices[sku]}`);
      if (apply && category)
        await post('products', {
          name,
          sku,
          categoryId: category.id,
          sellingPrice: String(prices[sku]),
          taxRate: arg('tax', '0.00'),
          taxMode: 'INCLUSIVE',
          sortOrder: (position + 1) * 10,
          active: flag('activate'),
          kitchenStationIds: station ? [station.id] : [],
        });
    }
  }
  console.log(apply ? 'Applied.' : 'Dry run: nothing was changed. Add --apply to create what is missing.');
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('riza-menu.mjs'))
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
