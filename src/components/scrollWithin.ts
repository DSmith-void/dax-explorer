/**
 * Scrolls `container` (only it, never the page) so `element` is in view. Nothing moves while it is
 * already fully visible; otherwise it is brought to the middle, so the code or steps around it show too.
 * (An element taller than the box is shown from its top.)
 */
export function scrollWithin(container: HTMLElement | null, element: Element | null | undefined, margin = 8): void {
  if (!container || !element) return;
  const box = container.getBoundingClientRect();
  const target = element.getBoundingClientRect();
  const top = box.top + margin;
  const bottom = box.bottom - margin;
  if (target.top >= top && target.bottom <= bottom) return;
  const offset = target.height > bottom - top ? target.top - top : target.top + target.height / 2 - (box.top + box.height / 2);
  container.scrollTop += offset;
}
