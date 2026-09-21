"use client";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import "yet-another-react-lightbox/plugins/counter.css";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Shirt, ChevronRight } from "lucide-react";
import { useLightbox } from "@/lib/lightbox-context";

export function ImageLightbox() {
  const t = useTranslations("imageLightbox");
  const tc = useTranslations("common");
  const { visible, images, index, currentItemId, close, setIndex } = useLightbox();

  const slides = images.map((img) => ({
    src: img.uri,
    alt: img.itemName ?? "",
    title: img.itemName,
    description: img.itemCategory,
  }));

  const safeIndex = Math.max(0, Math.min(index, images.length - 1));
  const current = images[safeIndex];
  const showChip = !!current?.itemId && current.itemId !== currentItemId;

  return (
    <Lightbox
      open={visible}
      close={close}
      index={safeIndex}
      slides={slides}
      on={{
        view: ({ index: newIndex }: { index: number }) => setIndex(newIndex),
      }}
      plugins={[Zoom, Captions, Counter]}
      zoom={{ maxZoomPixelRatio: 4, doubleTapDelay: 250, doubleClickDelay: 250 }}
      counter={{ container: { style: { top: 16 } } }}
      labels={{
        Previous: tc("aria.previousImage"),
        Next: tc("aria.nextImage"),
        Close: tc("close"),
        "Zoom in": t("zoomIn"),
        "Zoom out": t("zoomOut"),
      }}
      styles={{
        root: { pointerEvents: "auto", fontFamily: "var(--font-sans), Figtree, system-ui, sans-serif" },
        container: { backgroundColor: "rgba(17, 17, 17, 0.96)" },
      }}
      toolbar={{
        buttons: [
          showChip && current?.itemId ? (
            <Link
              key="open-in-wardrobe"
              href={`/dashboard/wardrobe?item=${current.itemId}`}
              onClick={close}
              className="yarl__button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              // Inline styles so yarl's own .yarl__button rules can't override the pill.
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 44,
                padding: "0 16px",
                marginRight: 8,
                backgroundColor: "var(--signature)",
                color: "var(--signature-foreground)",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 700,
                textDecoration: "none",
                filter: "none",
              }}
            >
              <Shirt size={16} strokeWidth={1.75} />
              {t("openInWardrobe")}
              <ChevronRight size={16} strokeWidth={1.75} />
            </Link>
          ) : null,
          "close",
        ].filter(Boolean) as React.ReactNode[],
      }}
    />
  );
}
