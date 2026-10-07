# Supabase Setup Instructions

1. Go to https://app.supabase.com and sign in with your Gmail account (uppalapatifarms@gmail.com)
2. Create a new project
3. Once project is created, go to Settings > API to get your Project URL and anon public key
4. Create an `orders` table in the Database with the following schema (you can use Table Editor):

## Orders table schema
```sql
create table orders (
  id uuid default gen_random_uuid() primary key,
  reference text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  full_name text not null,
  mobile text not null,
  email text,
  address text not null,
  city text not null,
  state text not null,
  pincode text not null,
  delivery_date date not null,
  items jsonb not null,
  item_summary text not null,
  total integer not null,
  has_preorder integer not null,
  flagged integer default 0,
  status text default 'received',
  notified integer default 0
);
```

5. Add RLS policies if needed for your use case (for public submissions, allow INSERT; for admin read, restrict appropriately)
6. Copy Project URL and anon key to `.env.local`:
```
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

# Vercel Deployment

1. Go to https://vercel.com and sign in
2. Click "Add New Project" > "Import Git Repository"
3. Select `shritej-koneru/uppalapati-farms-ghee`
4. Configure environment variables (same as above)
5. Deploy

Note: The current app uses Cloudflare Pages Functions (in `/functions/`). For Vercel, you'll need to adapt to Vercel Functions if migrating, or continue with Cloudflare Pages. The codebase is configured for Cloudflare Pages (see wrangler.jsonc).
