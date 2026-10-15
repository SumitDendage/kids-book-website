import { supabase } from '../lib/supabase.js';

// Explicit public columns verified on the existing products table. No private file paths.
export const PRODUCT_COLUMNS = 'id,title,price_inr,class_id,description,status,pages';
export function productView(row) {
  if (!row || typeof row.id !== 'string' || typeof row.title !== 'string'
      || !Number.isFinite(row.price_inr) || row.price_inr < 0) {
    throw Object.assign(new Error('The catalogue contains an invalid product or price.'), { code: 'invalid_response' });
  }
  return { id: row.id, title: row.title, price: row.price_inr, cls: row.class_id,
    blurb: row.description || '', pages: row.pages, available: row.status === 'active',
    onSale: row.status === 'active' };
}

export async function fetchProducts(client = supabase) {
  const worksheets = [];
  const pageSize = 100;
  // Paginate explicitly so catalogue growth never silently truncates the shelf.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error, status } = await client.from('products').select(PRODUCT_COLUMNS)
      .eq('status', 'active').order('id').range(offset, offset + pageSize - 1);
    if (error) throw Object.assign(new Error(error.message), { code: error.code, status, body: error });
    if (!Array.isArray(data)) throw Object.assign(new Error('The catalogue response is invalid.'), { code: 'invalid_response' });
    worksheets.push(...data.map(productView));
    if (data.length < pageSize) break;
  }
  return { worksheets };
}
