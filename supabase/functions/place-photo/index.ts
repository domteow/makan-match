// place-photo: read-through cache for Google Place Photos.
// GET ?ref=<photo resource name>&w=<width>. The cache key is derived from
// Google's photo resource name (stable per photo, not per session), so a
// cached photo is shared across all sessions and users.
// Runs with verify_jwt=false: it is loaded via plain <img> tags.
//
// Cached bytes expire after 30 days. This is a compliance rule, not a
// performance one: Google Maps Platform terms let us store `place_id`
// indefinitely and most other Places content not at all, so a permanent photo
// cache — which is what this was originally — is not defensible. A photo that
// falls out of the window is re-fetched from Google and overwritten. Practical
// cost is tiny (a place's photos change slowly, so it is at most one Place
// Photos call per photo per month) and the cache still absorbs essentially
// every repeat view. The same TTL applies to place_summaries; see
// 0008_summaries.sql.

import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "place-photos";
const DEFAULT_WIDTH = 640;
const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 86_400_000;
// Must not outlive the server-side cache: an `immutable` year (what this used
// to send) would leave browsers and the CDN holding bytes long after the copy
// we are allowed to keep has expired.
const MAX_AGE_SECONDS = TTL_DAYS * 86_400;
const CACHE_CONTROL = `public, max-age=${MAX_AGE_SECONDS}`;

// e.g. places/ChIJxxx/photos/ATplxxx. This function is publicly invokable
// (verify_jwt = false, it's loaded via <img>), so ref is strictly validated
// before anything is spent on a Google call: allowlisted charset only, no
// path tricks.
const REF_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Is there a cached object for this key, and is it younger than the TTL?
// Storage has no expiry of its own, so the age comes from the object's own
// created_at — `list` with an exact-name search is the cheapest way to read it.
// Every failure answers "no": a needless Google call is a far better outcome
// than serving bytes we are no longer allowed to hold.
async function isFresh(admin: any, key: string): Promise<boolean> {
  const { data, error } = await admin.storage
    .from(BUCKET)
    .list("", { limit: 1, search: key });
  if (error) {
    console.error("Photo cache lookup failed", error);
    return false;
  }
  // `search` is a prefix/substring match, so confirm we got this exact object.
  const object = data?.find((o: any) => o.name === key);
  if (!object) return false;
  // updated_at moves when a stale object is overwritten; created_at does not,
  // so the newer of the two is the age of the bytes actually being served.
  const stamp = object.updated_at ?? object.created_at;
  const age = Date.now() - new Date(stamp ?? 0).getTime();
  return Number.isFinite(age) && age < TTL_MS;
}

const redirect = (location: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": CACHE_CONTROL },
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  if (!ref || !REF_PATTERN.test(ref)) {
    // Client falls back to its emoji placeholder on any error status.
    return new Response("Bad request", { status: 400 });
  }
  const w = Math.min(
    Math.max(parseInt(url.searchParams.get("w") ?? "", 10) || DEFAULT_WIDTH, 200),
    1200
  );

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const key = `${await sha256Hex(ref)}-${w}.jpg`;
  const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(key);

  // Cache hit *and* inside the 30-day window: redirect without touching Google.
  // An object older than that is treated as a miss and refetched below.
  if (await isFresh(admin, key)) return redirect(publicUrl);

  // Miss: resolve the photo URI (skipHttpRedirect returns JSON instead of
  // bouncing us straight to the image bytes).
  const mediaRes = await fetch(
    `https://places.googleapis.com/v1/${ref}/media` +
      `?maxWidthPx=${w}&skipHttpRedirect=true` +
      `&key=${Deno.env.get("GOOGLE_PLACES_API_KEY")!}`
  );
  if (!mediaRes.ok) {
    console.error("Place photo resolve failed", mediaRes.status, await mediaRes.text());
    return new Response("Not found", { status: 404 });
  }
  const { photoUri } = await mediaRes.json();
  if (!photoUri) return new Response("Not found", { status: 404 });

  const imgRes = await fetch(photoUri);
  if (!imgRes.ok) return new Response("Not found", { status: 404 });
  const bytes = new Uint8Array(await imgRes.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(key, bytes, {
      contentType: imgRes.headers.get("Content-Type") ?? "image/jpeg",
      cacheControl: `${MAX_AGE_SECONDS}`,
      // upsert also resets the object's updated_at, which is what makes a
      // refreshed photo count as fresh again.
      upsert: true,
    });
  if (uploadError) {
    // Serve the image anyway; the photoUri is a plain googleusercontent URL.
    console.error("Photo cache upload failed", uploadError);
    return redirect(photoUri);
  }

  return redirect(publicUrl);
});
