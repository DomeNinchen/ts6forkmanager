import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageOff } from 'lucide-react';
import { isBuiltinIconId } from '@ts6/common';
import { iconsApi } from '@/api/icons.api';
import { useServerStore } from '@/stores/server.store';
import { cn } from '@/lib/utils';
import { createConcurrencyLimiter } from '@/lib/concurrency-limiter';

// Shared across every IconImage instance on the page, so a grid of thumbnails
// never opens more than this many `ftinitdownload` transfers at once - see
// concurrency-limiter.ts for why that matters on a real TeamSpeak server.
const limitIconFetch = createConcurrencyLimiter(4);

// Renders a single icon from the active server's icon pool. Kept deliberately
// standalone so anything that shows an icon ID - the icon browser, and later
// group/channel listings - can drop it in without repeating the fetch, cache
// and object-URL handling.

/** Fetches an icon's bytes. Icon IDs are CRC32 content hashes, so the same ID
 * always maps to the same image and the result never needs revalidating. */
export function useIconBlob(iconId: number) {
  const { selectedConfigId: configId, selectedSid: sid } = useServerStore();
  return useQuery({
    queryKey: ['icon-image', configId, sid, iconId],
    queryFn: () => limitIconFetch(() => iconsApi.image(configId!, sid!, iconId)),
    enabled: !!configId && !!sid && iconId > 0 && !isBuiltinIconId(iconId),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    // One retry: a server's pending-transfer slots are shared with everything
    // else using file transfer at that moment (other admins, avatars, ...),
    // so a single "limit reached" response is expected to clear on its own
    // shortly rather than mean this icon is actually broken.
    retry: 1,
    retryDelay: 800,
  });
}

interface IconImageProps {
  iconId: number;
  /** Rendered edge length in pixels. */
  size?: number;
  className?: string;
  /** Shown instead of the fallback glyph when the icon cannot be loaded. */
  alt?: string;
}

export function IconImage({ iconId, size = 16, className, alt }: IconImageProps) {
  const { data: blob, isLoading, isError } = useIconBlob(iconId);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  const box = { width: size, height: size };

  // Icon IDs below 1000 are the TeamSpeak client's own built-in icons - they
  // are not files on the server, so there is nothing to fetch for them.
  if (iconId > 0 && isBuiltinIconId(iconId)) {
    return (
      <span
        style={box}
        title={`Built-in client icon #${iconId}`}
        className={cn('inline-flex items-center justify-center rounded-sm bg-muted/60 text-[8px] font-mono-data text-muted-foreground', className)}
      >
        {iconId}
      </span>
    );
  }

  if (isLoading) {
    return <span style={box} className={cn('inline-block rounded-sm bg-muted/60 animate-pulse', className)} />;
  }

  if (isError || !url) {
    return (
      <span
        style={box}
        title={alt || `Icon ${iconId} could not be loaded`}
        className={cn('inline-flex items-center justify-center rounded-sm bg-muted/40 text-muted-foreground', className)}
      >
        <ImageOff style={{ width: size * 0.7, height: size * 0.7 }} />
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={alt || `Icon ${iconId}`}
      style={box}
      className={cn('object-contain', className)}
    />
  );
}
