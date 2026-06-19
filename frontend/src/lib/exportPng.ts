import { toPng } from "html-to-image";

/**
 * The timeline is now a single scroll container with a sticky header and sticky
 * sidebar. To screenshot the whole thing we reset its scroll to 0,0 (so the
 * sticky chrome sits at its natural top-left position), un-clip the scroller,
 * snapshot the full-size inner content wrapper, then restore the live layout.
 */
export interface PngCaptureRefs {
  /** Inner content wrapper sized to (sidebar + chart) — the node we screenshot. */
  container: HTMLElement;
  /** The single scroll container that clips the timeline on screen. */
  scroller: HTMLElement;
}

export async function exportTimelineToPng(refs: PngCaptureRefs): Promise<void> {
  const { container, scroller } = refs;

  const originalCss = scroller.style.cssText;
  const prevLeft = scroller.scrollLeft;
  const prevTop = scroller.scrollTop;

  scroller.scrollLeft = 0;
  scroller.scrollTop = 0;
  scroller.style.overflow = "visible";

  try {
    // Force reflow so the expanded dimensions are measurable.
    const captureWidth = container.scrollWidth;
    const captureHeight = container.scrollHeight;

    const dataUrl = await toPng(container, {
      width: captureWidth,
      height: captureHeight,
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
      // Web fonts already render in the clone; skip html-to-image's font
      // inlining, which only logs cross-origin SecurityErrors.
      skipFonts: true,
    });

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "timeline.png";
    a.click();
  } finally {
    scroller.style.cssText = originalCss;
    scroller.scrollLeft = prevLeft;
    scroller.scrollTop = prevTop;
  }
}
