/**
 * Public-only browser configuration for future Supabase client capabilities.
 * Authentication currently runs through same-origin server endpoints so no
 * privileged credentials or bearer tokens are exposed to browser JavaScript.
 */
export function getPublicSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return { url: parsed.origin, anonKey }
  } catch {
    return null
  }
}