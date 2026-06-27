// Vercel Edge function: serve the Android APK with the correct content-type.
//
// Why this exists
//   The APK in Supabase storage (apk/untitled-os.apk) is stored with
//   content-type `application/zip` — an APK *is* a zip archive, so storage
//   auto-detected it as zip. Android Chrome renames any `application/zip`
//   download to `.zip`, so the team got `untitled-os.zip`, which won't
//   install as an app. This function streams the same bytes back with
//   `application/vnd.android.package-archive` so Android always treats it as
//   an installable APK — no matter how the file was uploaded or re-uploaded.
//
//   Edge runtime (not Node serverless) so the ~9 MB body streams without
//   hitting the 4.5 MB Node-serverless response cap.
//
//   `/apk` (vercel.json redirect) points here, so the branded
//   app.untitledad.in/apk link the team + the in-app updater use is always
//   correct.
export const config = { runtime: 'edge' };

const APK_URL =
  'https://kompjctmisnitjpbjalh.supabase.co/storage/v1/object/public/apk/untitled-os.apk';

export default async function handler() {
  let upstream;
  try {
    upstream = await fetch(APK_URL, { cache: 'no-store' });
  } catch (e) {
    return new Response('APK temporarily unavailable', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response('APK temporarily unavailable', { status: 502 });
  }
  const headers = new Headers({
    'content-type': 'application/vnd.android.package-archive',
    'content-disposition': 'attachment; filename="untitled-os.apk"',
    'cache-control': 'no-cache',
  });
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  return new Response(upstream.body, { status: 200, headers });
}
