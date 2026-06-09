import { toPng } from "html-to-image";

/**
 * The Gantt timeline is laid out as four nested scroll containers (a horizontal
 * header strip, a vertical sidebar, and a body that scrolls both ways). A naive
 * screenshot of the visible viewport would clip everything outside the current
 * scroll position, so before capturing we temporarily expand each container to
 * its full content size, snapshot, then restore the original inline styles.
 */
export interface PngCaptureRefs {
  /** Wrapper that holds the header strip + body (this is the node we screenshot). */
  container: HTMLElement;
  /** Horizontally-clipped header scroll region. */
  headerScroll: HTMLElement;
  /** Body row that lays the sidebar and chart side by side. */
  bodyWrapper: HTMLElement;
  /** Vertically-clipped member/task sidebar. */
  sidebar: HTMLElement;
  /** Both-axis chart scroll region. */
  chart: HTMLElement;
  sidebarWidth: number;
  totalWidth: number;
  totalBodyHeight: number;
}

export async function exportTimelineToPng(refs: PngCaptureRefs): Promise<void> {
  const { container, headerScroll, bodyWrapper, sidebar, chart, sidebarWidth, totalWidth, totalBodyHeight } = refs;

  // Snapshot inline styles so we can restore the live layout afterwards.
  const originals = [container, headerScroll, bodyWrapper, sidebar, chart].map((el) => ({
    el,
    cssText: el.style.cssText,
  }));

  const fullWidth = sidebarWidth + totalWidth;

  // Expand every clipping container to its full content size.
  container.style.overflow = "visible";
  container.style.width = `${fullWidth}px`;
  container.style.height = "auto";

  headerScroll.style.overflow = "visible";
  headerScroll.style.flex = "0 0 auto";
  headerScroll.style.width = `${totalWidth}px`;

  bodyWrapper.style.overflow = "visible";
  bodyWrapper.style.flex = "0 0 auto";
  bodyWrapper.style.height = `${totalBodyHeight}px`;

  sidebar.style.overflow = "visible";
  sidebar.style.height = `${totalBodyHeight}px`;

  chart.style.overflow = "visible";
  chart.style.flex = "0 0 auto";
  chart.style.width = `${totalWidth}px`;
  chart.style.height = `${totalBodyHeight}px`;

  try {
    // Force a reflow so the expanded dimensions are measurable.
    const captureWidth = container.scrollWidth;
    const captureHeight = container.scrollHeight;

    const dataUrl = await toPng(container, {
      width: captureWidth,
      height: captureHeight,
      backgroundColor: "#ffffff",
      pixelRatio: 2,
      cacheBust: true,
      // The page's web fonts are already loaded and render correctly in the
      // clone, so skip html-to-image's font-inlining step — it can't read the
      // cross-origin Google Fonts stylesheet and only logs SecurityErrors.
      skipFonts: true,
    });

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "timeline.png";
    a.click();
  } finally {
    // Restore the live, scrollable layout regardless of success/failure.
    for (const { el, cssText } of originals) {
      el.style.cssText = cssText;
    }
  }
}
