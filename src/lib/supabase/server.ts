import { createClient } from "@supabase/supabase-js";

export function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return null;
    }
  } catch {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false
    }
  });
}
