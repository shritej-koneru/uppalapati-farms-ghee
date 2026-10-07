// Supabase client for storing orders
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your actual values

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export async function supabaseRequest(method, path, body = null) {
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, options);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${response.status} ${error}`);
  }
  return response.json();
}

export async function saveOrderToSupabase(orderData) {
  return supabaseRequest('POST', 'orders', [orderData]);
}

export async function getOrdersFromSupabase() {
  return supabaseRequest('GET', 'orders?select=*');
}