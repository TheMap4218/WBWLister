// WBW server API. No database/service-role credential belongs in this app.
import { sellerContext } from './access';
import { HttpError } from './http';
import { isOn } from './intake';
import { displayWidth } from './vocab';
import { altText } from './seo';

const BASE = 'https://westernbootworld.com';
export function wbwClient(env = process.env, request = fetch) {
  const key = env.WBW_API_KEY;
  if (!/^wbw_bl_[A-Za-z0-9_-]{43}$/.test(key || '')) throw new HttpError('The WBW connection has not been configured on this server.', 503);
  return async (payload, externalSellerId) => {
    const url = payload ? `${BASE}/api/bootlister` : `${BASE}/api/bootlister?externalSellerId=${encodeURIComponent(externalSellerId)}`;
    let response;
    try {
      response = await request(url, { method: payload ? 'POST' : 'GET', redirect: 'error', cache: 'no-store',
        headers: { Authorization: `Bearer ${key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(110000),
      });
    } catch { throw new HttpError('WBW did not confirm the request. Retry the same listing to check safely.', 502); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new HttpError(data.error || 'WBW could not finish the request.', response.status);
    if (data.ok !== true) throw new HttpError('WBW did not confirm the request.', 502);
    return data;
  };
}

export function wbwListing(item, account, shipping = {}) {
  const amount = String(item.wbw_price ?? item.price ?? "");
  return {
    title: item.title, price: /^\d+(?:\.\d+)?$/.test(amount) ? `$${amount}` : amount, brand: item.brand, size: item.size,
    size_type: ({ Men: "Men's", Women: "Women's", Kids: 'Kids' })[item.sized_for] || item.sized_for,
    width: displayWidth(item.width), condition: item.condition, size_estimated: item.size_estimated === true || item.size_estimated === 'Yes',
    description: [item.description, item.material_cut ? `Material specifics (cut): ${item.material_cut}` : '', item.id_text ? `Model / date codes: ${item.id_text}` : ''].filter(Boolean).join('\n\n'),
    skin: item.material, material_type: item.material_type, custom_made: /custom.?made/i.test(item.condition || ''),
    where_made: item.made_in, color: item.color, sole_type: item.sole, heel_type: item.heel, toe_shape: item.toe,
    outsole: item.sole_length, sole_width: item.sole_width, heel_height: item.heel_height,
    shaft_height: item.shaft_height, shaft_circumference: item.shaft_circ,
    keywords: Array.isArray(item.keywords) ? item.keywords : String(item.keywords || '').split(/[,|]/).map(s => s.trim()).filter(Boolean),
    source_url: item.source_url || '', item_type: item.boot === 'belt' ? 'belt' : 'boots',
    shipping_type: shipping.type || '', shipping_cost: String(account.ship_price ?? ''),
    photo_urls: item.photos || [], photo_alts: (item.photos || []).map((_, at) => altText(item, at + 1, item.photos.length)),
  };
}

export async function wbwConnectionApi(req, db, env = process.env, remote) {
  const { who, seller } = await sellerContext(req, env);
  if (who.role !== 'admin') throw new HttpError('Only an admin can connect sellers and send inventory to WBW.', 403);
  const accounts = await db.getSellers(seller);
  const account = accounts.find(row => row.name === seller);
  if (!account?.wbw_external_id) throw new HttpError('Save this seller’s details before connecting to WBW.');
  const send = remote || wbwClient(env);
  if (req.method === 'GET') {
    const result = await send(null, account.wbw_external_id);
    await db.saveWbwSellerStatus(seller, account.wbw_external_id, result);
    return result;
  }
  if (req.method !== 'POST') throw new HttpError('Method not allowed.', 405);
  const body = await req.json();
  if (body.action === 'connect') {
    if (!account.email || !account.display_name || !account.location) throw new HttpError('Add the seller’s login email, display name and location in Seller settings.');
    if (!isOn(account.import_ok) || !isOn(account.photo_ok)) throw new HttpError('Record the seller’s import and photo permission in Seller intake before connecting.');
    const result = await send({ action: 'seller', externalSellerId: account.wbw_external_id,
      seller: { email: account.email, displayName: account.display_name, location: account.location, authorized: true } });
    await db.saveWbwSellerStatus(seller, account.wbw_external_id, result);
    return result;
  }
  if (body.action !== 'send') throw new HttpError('Choose connect or send.');
  if (!isOn(account.import_ok) || !isOn(account.photo_ok)) throw new HttpError('Record the seller’s import and photo permission before sending listings.');
  if (!Array.isArray(body.ids) || body.ids.length !== 1 || !/^[1-9]\d{0,15}$/.test(String(body.ids[0]))) throw new HttpError('Send one listing per request.');
  const [item] = await db.getWbwItemsByIds(seller, body.ids);
  if (!item || item.seller !== seller) throw new HttpError('You can only send items belonging to the selected seller.', 403);
  if (!['review', 'published'].includes(item.status)) throw new HttpError('Sold, removed, archived or pending-sold items cannot be uploaded as current inventory.');
  const publish = body.publish === true;
  if (publish && !item.approved_at) throw new HttpError('Approve this listing before sending it live to WBW.');
  if (publish && !['conus', 'usa', 'global', 'pickup'].includes(body.shipping?.type)) throw new HttpError('Choose a shipping destination before listing on WBW.');
  const result = await send({ action: 'import', externalSellerId: account.wbw_external_id,
    externalItemId: String(item.id), listing: wbwListing(item, account, body.shipping), publish });
  if (!/^\d+$/.test(String(result.listingId)) || !['draft', 'published', 'sold', 'collection'].includes(result.status)) throw new HttpError('WBW returned an unconfirmed listing result.', 502);
  // Persist only a confirmed receipt, conditional on the imported snapshot.
  const acknowledged = await db.saveWbwItemReceipt(seller, item, result);
  return { ...result, ...(acknowledged ? {} : { warning: 'This item changed during upload. The WBW copy is saved; review both versions before sending again.' }) };
}
