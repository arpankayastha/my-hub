/**
 * Horizontal swipe gestures on a scrollable panel (e.g. month navigation).
 * Vertical scrolling is preserved by locking axis after the first meaningful move.
 */

export function wireHorizontalSwipe(element, {
  onSwipeLeft,
  onSwipeRight,
  isEnabled = () => true,
  threshold = 56,
} = {}) {
  if (!element) return () => {};

  let startX = 0;
  let startY = 0;
  let locked = false; // false | 'horizontal' | 'vertical'

  const reset = () => {
    locked = false;
  };

  const onTouchStart = (e) => {
    if (!isEnabled()) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    locked = false;
  };

  const onTouchMove = (e) => {
    if (!isEnabled()) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (!locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      locked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
  };

  const onTouchEnd = (e) => {
    if (!isEnabled() || locked !== 'horizontal') {
      reset();
      return;
    }
    const touch = e.changedTouches[0];
    if (!touch) {
      reset();
      return;
    }
    const dx = touch.clientX - startX;
    if (dx <= -threshold) onSwipeLeft?.();
    else if (dx >= threshold) onSwipeRight?.();
    reset();
  };

  element.addEventListener('touchstart', onTouchStart, { passive: true });
  element.addEventListener('touchmove', onTouchMove, { passive: true });
  element.addEventListener('touchend', onTouchEnd, { passive: true });
  element.addEventListener('touchcancel', reset, { passive: true });

  return () => {
    element.removeEventListener('touchstart', onTouchStart);
    element.removeEventListener('touchmove', onTouchMove);
    element.removeEventListener('touchend', onTouchEnd);
    element.removeEventListener('touchcancel', reset);
  };
}
