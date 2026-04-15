/**
 * Client-side PDF export for a business case.
 *
 * Approach (deliberate):
 *
 *   1. We do NOT rasterize the live page. The page uses Tailwind v4,
 *      which emits oklch() colors, and html2canvas 1.x can't parse
 *      oklch — the resulting PDF comes out black-and-white or throws.
 *      We also don't want to screenshot a sticky-slider sidebar on
 *      8.5×11 paper.
 *
 *   2. Instead, the PDF template is a separate hidden DOM subtree
 *      (see BusinessCasePdfTemplate.tsx) built with INLINE hex colors
 *      and px-based widths sized for US Letter. The client calls
 *      exportToPdf() which mounts the template off-screen, rasterizes
 *      it with html2canvas, embeds the bitmap in a jsPDF page, and
 *      tears the DOM back down.
 *
 *   3. The template is a single wide element. If the content ever
 *      overflows one page, jsPDF's .addImage with per-page slicing
 *      handles it — but the v1 template is designed to fit on one
 *      8.5×11 page in portrait.
 */
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/**
 * Rasterize the element with the given id and save the result as a
 * US-Letter portrait PDF. The element should be mounted in the DOM
 * (possibly off-screen) at its natural width — we scale to fit.
 */
export async function exportElementToPdf(
  elementId: string,
  filename: string
): Promise<void> {
  const el = document.getElementById(elementId);
  if (!el) {
    throw new Error(`PDF export: element #${elementId} not found`);
  }

  // Render at 2x for a sharper output on retina-quality printers.
  const canvas = await html2canvas(el, {
    scale: 2,
    backgroundColor: "#FFFFFF",
    useCORS: true,
    logging: false,
    // Important: render the element at its natural size, not the
    // viewport's. This lets us mount the template off-screen at the
    // width we want without the browser clipping it.
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  });

  const imgData = canvas.toDataURL("image/png");

  // US Letter in points: 612 × 792. Portrait.
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  // Scale the bitmap to fit within 0.5" margins on all sides.
  const margin = 36; // 0.5 inch
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;

  const imgRatio = canvas.width / canvas.height;
  const fitRatio = maxWidth / maxHeight;

  let drawWidth: number;
  let drawHeight: number;
  if (imgRatio > fitRatio) {
    // image is relatively wider — bound by width
    drawWidth = maxWidth;
    drawHeight = maxWidth / imgRatio;
  } else {
    // image is relatively taller — bound by height
    drawHeight = maxHeight;
    drawWidth = maxHeight * imgRatio;
  }

  const offsetX = (pageWidth - drawWidth) / 2;
  const offsetY = margin;

  pdf.addImage(imgData, "PNG", offsetX, offsetY, drawWidth, drawHeight);
  pdf.save(filename);
}
