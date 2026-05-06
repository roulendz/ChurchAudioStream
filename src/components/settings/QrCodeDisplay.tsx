import { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { Share2, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { AppConfig } from "../../hooks/useServerStatus";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface QrCodeDisplayProps {
  config: AppConfig | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the listener URL from the server config.
 * Uses the configured domain (preferred) or host IP -- never window.location
 * or 127.0.0.1, since phones on the LAN cannot reach loopback.
 */
function buildListenerUrl(config: AppConfig): string {
  const hostname = config.network.domain || config.server.host;
  return `https://${hostname}:${config.server.port}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QrCodeDisplay({ config }: QrCodeDisplayProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const listenerUrl = config ? buildListenerUrl(config) : null;

  // Generate QR code when URL changes
  useEffect(() => {
    if (!listenerUrl) {
      setQrDataUrl(null);
      return;
    }

    let cancelled = false;

    QRCode.toDataURL(listenerUrl, {
      width: 200,
      margin: 2,
      color: {
        dark: "#e0e0e0",
        light: "#1a1a2e",
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [listenerUrl]);

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleOpenUrl = useCallback(() => {
    if (!listenerUrl) return;
    open(listenerUrl);
  }, [listenerUrl]);

  const handleCopyUrl = useCallback(() => {
    if (!listenerUrl) return;

    navigator.clipboard.writeText(listenerUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [listenerUrl]);

  const handleShare = useCallback(() => {
    if (!listenerUrl) return;

    if (canShare) {
      navigator.share({
        title: "Church Audio Stream",
        text: "Listen to live translations on your phone",
        url: listenerUrl,
      }).catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        open(listenerUrl);
      });
      return;
    }

    open(listenerUrl);
  }, [listenerUrl, canShare]);

  if (!config) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 bg-card border border-border rounded-md">
        <div className="text-xs text-muted-foreground mb-1">Listener QR Code</div>
        <div className="text-muted-foreground italic">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-card border border-border rounded-md">
      <div className="text-xs text-muted-foreground mb-1">Listener QR Code</div>

      {qrDataUrl ? (
        <img
          className="rounded-md"
          src={qrDataUrl}
          alt={`QR code for ${listenerUrl}`}
          width={200}
          height={200}
        />
      ) : (
        <div className="text-muted-foreground italic">Generating...</div>
      )}

      {listenerUrl && (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenUrl}
              className="font-mono text-sm text-primary break-all hover:underline text-left inline-flex items-center gap-1.5 cursor-pointer"
            >
              {listenerUrl}
              <ExternalLink className="size-3.5 shrink-0" />
            </button>
            <button
              type="button"
              className="p-1.5 rounded-md text-muted-foreground transition-colors hover:text-primary hover:bg-accent"
              onClick={handleShare}
              aria-label="Share listener URL"
            >
              <Share2 className="size-4" />
            </button>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 bg-input border border-border rounded-md text-muted-foreground text-sm cursor-pointer transition-all duration-150 hover:border-primary hover:text-primary"
            onClick={handleCopyUrl}
          >
            {copied ? "Copied!" : "Copy URL"}
          </button>
        </>
      )}

      <p className="text-xs text-muted-foreground text-center max-w-[300px]">
        Scan this QR code or visit the URL on your phone (must be on the same
        WiFi network).
      </p>
    </div>
  );
}
