import type { MediaRef } from "../generated/ipc";

/**
 * WebView2 may retain native byte ranges when two projects reuse a UUID for
 * distinct source files, despite the Rust protocol's Cache-Control: no-store.
 * The extra query keys the decoder by SOURCE identity, not project revision.
 *
 * The server still validates only the opaque UUID in the URL path and resolves
 * it against the currently open project. This is not an auth token and never
 * exposes a private filesystem path to the WebView.
 */
export function previewMediaUrl(media: MediaRef): string {
  const identity = (media.absolute_path ?? "").toLowerCase() + "\0" + (media.file_size ?? 0);
  let digest = 0xcbf29ce484222325n;
  for (let i = 0; i < identity.length; i++) {
    digest = BigInt.asUintN(64,
      (digest ^ BigInt(identity.charCodeAt(i))) * 0x100000001b3n);
  }
  return "http://zeter-media.localhost/" + encodeURIComponent(media.id) +
    "?source=" + digest.toString(16);
}