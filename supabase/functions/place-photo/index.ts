// place-photo: read-through cache for Google Place Photos.
// GET ?ref=<photo resource name>&w=<width>. The cache key is derived from
// Google's photo resource name (stable per photo, not per session), so a
// cached photo is shared across all sessions and users — each distinct
// photo costs at most one Place Photos call, ever.
// Runs with verify_jwt=false: it is loaded via plain <img> tags.

import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "place-photos";
const DEFAULT_WIDTH = 640;
const CACHE_CONTROL = "public, max-age=31536000, immutable";

// e.g. places/ChIJxxx/photos/ATplxxx
const REF_PATTERN = /^places\/[^/]+\/photos\/[^/]+$/;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    return new Response("Not found", { status: 404 });
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

  // Cache hit: redirect without touching Google.
  const head = await fetch(publicUrl, { method: "HEAD" });
  if (head.ok) return redirect(publicUrl);

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
      cacheControl: "31536000",
      upsert: true,
    });
  if (uploadError) {
    // Serve the image anyway; the photoUri is a plain googleusercontent URL.
    console.error("Photo cache upload failed", uploadError);
    return redirect(photoUri);
  }

  return redirect(publicUrl);
});
