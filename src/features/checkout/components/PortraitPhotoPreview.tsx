"use client";

import { useEffect, useState } from "react";
import type { PortraitPhoto } from "../portraitCartClient";

// Private blob previews must not pass through the public Next.js image optimizer.
/* eslint-disable @next/next/no-img-element */

export function PortraitPhotoPreview({
  photo,
  names,
}: {
  photo: PortraitPhoto;
  names: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(photo.previewUrl, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (
          !response.ok ||
          response.headers.get("content-type") !== photo.mimeType
        )
          throw new Error("PREVIEW_UNAVAILABLE");
        const blob = await response.blob();
        if (
          blob.size !== photo.sizeBytes ||
          blob.size > 15 * 1024 * 1024 ||
          blob.type !== photo.mimeType
        )
          throw new Error("PREVIEW_UNAVAILABLE");
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.mimeType, photo.previewUrl, photo.sizeBytes, retry]);
  return (
    <div className="portrait-photo-image">
      {url ? (
        <img alt={`Private reference for ${names}`} src={url} />
      ) : (
        <div role="status">
          {failed ? "Preview unavailable" : "Loading private photo…"}
        </div>
      )}
      {failed && (
        <button
          type="button"
          onClick={() => {
            setUrl(null);
            setFailed(false);
            setRetry((n) => n + 1);
          }}
        >
          Retry preview
        </button>
      )}
    </div>
  );
}
