/**
 * Create a realistic demo menu with the bundled product photography.
 *
 * This is opt-in and never runs as part of seeding, migration or deployment: a real
 * restaurant's catalogue is operator data and must not be overwritten by a fixture.
 * Everything goes through the normal authenticated menu API, so branch scope,
 * permissions, validation, versioning and audit apply exactly as they would to an
 * operator typing the same values in the Menu screen.
 *
 * Re-running is safe: existing categories and products are matched by name and SKU
 * and updated in place rather than duplicated.
 *
 * Usage: node scripts/demo-menu.mjs [--base http://localhost:8080]
 */
import { config } from 'dotenv';
config({ quiet: true });

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://localhost:8080').replace(/\/$/, '');

/**
 * The demo catalogue. Images are the WebP assets bundled under apps/admin/public,
 * referenced by app-relative path so they resolve on localhost, a LAN address or any
 * other deployment without rewriting stored rows.
 */
const CATEGORIES = ['Burgers', 'Pizza', 'Sides', 'Drinks', 'Wraps'];
const PRODUCTS = [
  {
    name: 'Riza Burger',
    category: 'Burgers',
    description: 'Beef patty, cheddar cheese, lettuce, tomato, special sauce',
    sku: 'RIZA-BURGER',
    sellingPrice: '6.00',
    imageUrl: '/food/riza-burger.webp',
  },
  {
    name: 'Chicken Classic',
    category: 'Burgers',
    description: 'Crispy chicken, lettuce, mayo, pickles',
    sku: 'RIZA-CHICKEN',
    sellingPrice: '5.50',
    imageUrl: '/food/chicken-classic.webp',
  },
  {
    name: 'Pepperoni Pizza',
    category: 'Pizza',
    description: 'Tomato sauce, mozzarella, pepperoni',
    sku: 'RIZA-PIZZA',
    sellingPrice: '7.50',
    imageUrl: '/food/pepperoni-pizza.webp',
  },
  {
    name: 'French Fries',
    category: 'Sides',
    description: 'Crispy golden fries with sea salt',
    sku: 'RIZA-FRIES',
    sellingPrice: '3.00',
    imageUrl: '/food/french-fries.webp',
  },
  {
    name: 'Coca-Cola',
    category: 'Drinks',
    description: 'Chilled classic taste',
    sku: 'RIZA-COLA',
    sellingPrice: '2.50',
    imageUrl: '/food/cola.webp',
  },
  {
    name: 'Chicken Wrap',
    category: 'Wraps',
    description: 'Grilled chicken, fresh vegetables, special sauce',
    sku: 'RIZA-WRAP',
    sellingPrice: '5.00',
    imageUrl: '/food/chicken-wrap.webp',
  },
];

let token = '';
async function call(method, path, body) {
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
/** Every page of one menu kind, so matching never misses an existing row. */
async function all(kind) {
  const rows = [];
  for (let page = 1; ; page++) {
    const result = await call('GET', `menu/${kind}?limit=100&page=${page}`);
    rows.push(...result.items);
    if (!result.hasMore) return rows;
  }
}

try {
  const missing = [
    'SEED_ORGANIZATION_SLUG',
    'SEED_BRANCH_CODE',
    'SEED_OWNER_EMAIL',
    'SEED_OWNER_PASSWORD',
  ].filter((key) => !process.env[key]);
  if (missing.length) throw new Error('Missing configuration: ' + missing.join(', '));

  const login = await call('POST', 'auth/login', {
    organization: process.env.SEED_ORGANIZATION_SLUG,
    branch: process.env.SEED_BRANCH_CODE,
    email: process.env.SEED_OWNER_EMAIL,
    password: process.env.SEED_OWNER_PASSWORD,
  });
  token = login.accessToken;
  console.log(`Signed in to ${base} as ${login.user.email}`);

  const existingCategories = await all('categories');
  const categoryId = {};
  for (const name of CATEGORIES) {
    const found = existingCategories.find((c) => c.name === name && !c.deletedAt);
    if (found) {
      categoryId[name] = found.id;
      console.log(`  category kept    ${name}`);
    } else {
      const created = await call('POST', 'menu/categories', { kind: 'categories', name });
      categoryId[name] = created.id;
      console.log(`  category created ${name}`);
    }
  }

  const existingProducts = await all('products');
  for (const product of PRODUCTS) {
    const payload = {
      kind: 'products',
      name: product.name,
      description: product.description,
      sku: product.sku,
      barcode: null,
      categoryId: categoryId[product.category],
      sellingPrice: product.sellingPrice,
      taxRate: '20.00',
      taxMode: 'INCLUSIVE',
      imageUrl: product.imageUrl,
      modifierGroupIds: [],
      kitchenStationIds: [],
    };
    // Match on SKU, which is unique per branch, so a re-run updates rather than
    // colliding with the branch-unique constraint.
    const found = existingProducts.find((p) => p.sku === product.sku);
    if (found) {
      await call('PUT', `menu/products/${found.id}`, { version: found.version, data: payload });
      console.log(`  product updated  ${product.name.padEnd(16)} ${product.imageUrl}`);
    } else {
      await call('POST', 'menu/products', payload);
      console.log(`  product created  ${product.name.padEnd(16)} ${product.imageUrl}`);
    }
  }
  console.log(`\nDemo menu ready: ${PRODUCTS.length} products in ${CATEGORIES.length} categories.`);
} catch (error) {
  console.error('Demo menu failed:', error?.message ?? error);
  process.exitCode = 1;
}
