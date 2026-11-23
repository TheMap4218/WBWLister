import test from 'node:test';
import assert from 'node:assert/strict';
import { wbwClient, wbwConnectionApi, wbwListing } from '../lib/wbw-connection';
import { sessionToken } from '../lib/session';
const ENV = { NODE_ENV: 'production', ADMIN_PASSWORD: 'staff-secret', APP_PASSWORD: 'signing-secret', sessionVersions: { ada: 0 } };
const ID = '33333333-3333-4333-8333-333333333333';
const account = { name: 'ada', seller: 'ada', display_name: 'Ada Boots', email: 'ada@example.com', location: 'Austin, TX',
  wbw_external_id: ID, import_ok: 'on', photo_ok: 'on', ship_price: '20' };
const item = { id: 41, seller: 'ada', status: 'published', approved_at: '2026-11-01', title: 'Lucchese boots', price: 200, wbw_price: 180,
  size: '10', width: 'D', material: 'Ostrich', material_cut: 'Full quill', id_text: 'L1234', description: 'Clean boots.',
  photos: ['https://example.public.blob.vercel-storage.com/a.jpg'], sized_for: 'Men', brand: 'Lucchese' };
const status = { ok: true, seller: { id: '22222222-2222-4222-8222-222222222222', display_name: 'Ada Boots' },
  wbwStatus: { signed_up: true, accepted: true, phone_verified: false, source: 'westernbootworld.com', checked_at: '2026-11-23T12:00:00Z' } };
async function setup({ who = 'admin', seller = account, row = item, receipt = true } = {}) {
  const token = await sessionToken(who, ENV.APP_PASSWORD);
  const calls = [], receipts = [], statuses = [];
  const db = { getSellers: async () => [seller], getWbwItemsByIds: async () => row ? [row] : [],
    saveWbwSellerStatus: async (...args) => { statuses.push(args); },
    saveWbwItemReceipt: async (...args) => { receipts.push(args); return receipt; } };
  const remote = async body => { calls.push(body); return body?.action === 'import' ? { ok: true, listingId: 77, status: body.publish ? 'published' : 'draft' } : status; };
  const run = (body, tokenOverride = token) => wbwConnectionApi(new Request('https://bootlister.vercel.app/api/wbw', { method: 'POST',
    headers: { 'x-auth': tokenOverride, authorization: 'Bearer ada', 'content-type': 'application/json' }, body: JSON.stringify(body) }), db, ENV, remote);
  return { run, calls, receipts, statuses };
}

test('only a signed admin may create/connect a WBW seller; ordinary sellers and anonymous callers cannot', async () => {
  for (const who of ['seller:ada', '']) {
    const h = await setup({ who: who || 'admin' });
    await assert.rejects(h.run({ action: 'connect' }, who ? undefined : ''), /admin|log in/);
    assert.equal(h.calls.length, 0);
  }
});
test('connect uses stored seller identity and permissions, never an email or seller ID from the browser', async () => {
  const h = await setup();
  const result = await h.run({ action: 'connect', externalSellerId: 'spoof', email: 'attacker@example.com' });
  assert.equal(result.seller.display_name, 'Ada Boots');
  assert.deepEqual(h.calls[0], { action: 'seller', externalSellerId: ID, seller: { email: account.email, displayName: account.display_name, location: account.location, authorized: true } });
  assert.equal(h.statuses.length, 1); assert.equal(h.statuses[0][1], ID);
});
for (const patch of [{ email: '' }, { location: '' }, { import_ok: 'off' }, { photo_ok: 'off' }]) test(`seller connection rejects incomplete setup: ${JSON.stringify(patch)}`, async () => {
  const h = await setup({ seller: { ...account, ...patch } });
  await assert.rejects(h.run({ action: 'connect' })); assert.equal(h.calls.length, 0);
});
test('current listings go to the selected seller, stable item IDs and WBW prices are preserved', async () => {
  const h = await setup();
  const result = await h.run({ action: 'send', ids: [41] });
  assert.equal(result.status, 'draft'); assert.equal(h.calls[0].externalItemId, '41');
  assert.equal(h.calls[0].externalSellerId, ID); assert.equal(h.calls[0].listing.price, '$180');
  assert.deepEqual(h.calls[0].listing.photo_urls, item.photos);
  assert.equal(h.receipts.length, 1); assert.equal(h.receipts[0][0], 'ada');
});
test('public send requires approval and an explicit shipping choice', async () => {
  let h = await setup({ row: { ...item, approved_at: null } });
  await assert.rejects(h.run({ action: 'send', ids: [41], publish: true, shipping: { type: 'conus' } }), /Approve/);
  h = await setup();
  await assert.rejects(h.run({ action: 'send', ids: [41], publish: true }), /shipping/);
  const result = await h.run({ action: 'send', ids: [41], publish: true, shipping: { type: 'conus' } });
  assert.equal(result.status, 'published'); assert.equal(h.calls[0].listing.shipping_type, 'conus');
});
for (const patch of [{ seller: 'bea' }, { status: 'sold' }, { status: 'pending' }, { status: 'removed' }]) test(`other sellers and inactive inventory are never uploaded: ${JSON.stringify(patch)}`, async () => {
  const h = await setup({ row: { ...item, ...patch } });
  await assert.rejects(h.run({ action: 'send', ids: [41] })); assert.equal(h.calls.length, 0);
});
test('a changed item is reported after remote success instead of claiming its current version was synced', async () => {
  const h = await setup({ receipt: false });
  const result = await h.run({ action: 'send', ids: [41] });
  assert.match(result.warning, /changed during upload/); assert.equal(result.listingId, 77);
});
test('the adapter retains measurements, material details, model codes and factual photo alts', () => {
  const mapped = wbwListing({ ...item, sole_width: '4', shaft_circ: '15', sole_length: '12' }, account);
  assert.equal(mapped.sole_width, '4'); assert.equal(mapped.shaft_circumference, '15'); assert.equal(mapped.outsole, '12');
  assert.match(mapped.description, /Full quill/); assert.match(mapped.description, /L1234/);
  assert.equal(Object.hasOwn(mapped, 'skin_family'), false);
  assert.equal(mapped.photo_alts.length, 1); assert.equal(mapped.size_type, "Men's");
});
test('the key is server-only, goes only to WBW, refuses redirects, and never appears in returned data', async () => {
  const key = `wbw_bl_${'x'.repeat(43)}`; const calls = [];
  const client = wbwClient({ WBW_API_KEY: key }, async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => status }; });
  assert.deepEqual(await client({ action: 'seller' }), status);
  assert.equal(calls[0].url, 'https://westernbootworld.com/api/bootlister');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`); assert.equal(calls[0].options.redirect, 'error');
  assert.throws(() => wbwClient({}), /not been configured/);
  assert.equal(JSON.stringify(status).includes(key), false);
});
