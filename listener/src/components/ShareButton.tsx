/**
 * Share button with Web Share API and QR code fallback.
 *
 * On tap: uses navigator.share() if available (native share sheet),
 * otherwise shows a QR code modal with the listener URL and a close
 * button. The QR code is generated via the qrcode library.
 *
 * Links to the general listener URL (not a specific channel).
 */

import { useState, useCallback, useEffect, useRef } from "react";
import QRCode from "qrcode";

interface ShareButtonProps {
  listenerUrl: string;
}

export function ShareButton({ listenerUrl }: ShareButtonProps) {
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Church Audio Stream",
          text: "Listen to live audio translations",
          url: listenerUrl,
        });
        return;
      } catch (error) {
        // User cancelled or share failed -- fall through to QR modal
        if (error instanceof Error && error.name === "AbortError") {
          return; // User explicitly cancelled
        }
      }
    }

    // Fallback: show QR code modal
    try {
      const dataUrl = await QRCode.toDataURL(listenerUrl, {
        width: 200,
        margin: 2,
        color: { dark: "#1a1a2e", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
      setShowQrModal(true);
    } catch {
      // QR generation failed -- silently ignore
    }
  }, [listenerUrl]);

  const closeModal = useCallback(() => {
    setShowQrModal(false);
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    if (!showQrModal) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setShowQrModal(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showQrModal]);

  // Close modal on backdrop click
  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === modalRef.current) {
        closeModal();
      }
    },
    [closeModal],
  );

  return (
    <>
      <button
        className="share-button"
        onClick={handleShare}
        aria-label="Share listener link"
        title="Share"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>

      {showQrModal && qrDataUrl && (
        <div
          className="share-modal"
          ref={modalRef}
          onClick={handleBackdropClick}
          role="dialog"
          aria-label="Share QR Code"
        >
          <div className="share-modal__content">
            <h2 className="share-modal__title">Scan to listen</h2>
            <img
              className="share-modal__qr"
              src={qrDataUrl}
              alt="QR code for listener URL"
              width={200}
              height={200}
            />
            <p className="share-modal__url">{listenerUrl}</p>
            <button className="share-modal__close-btn" onClick={closeModal}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
