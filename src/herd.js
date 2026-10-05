/* The herd carousel in the farm page hero.

   Four photographs of the cows, one at a time, and it has to be swipeable on a
   phone and draggable on a laptop. Those are two different native behaviours:
   overflow scrolling gives you the swipe for free but no mouse drag at all,
   and pointer events give you both from a single code path. So the track is
   moved with a transform and the gesture is read from pointer events.

   It does not wrap. A hero that silently jumps from the last cow back to the
   first is disorienting, and the ends are where a visitor is most likely to be
   poking. So the ends are real: the arrows disable there, the autoplay stops
   there, and a drag past the end meets resistance instead of moving. This also
   means `count - 1` is a genuine stopping place rather than a special case,
   which is why there is no modulo anywhere in this file.

   The dots are built here rather than written into the HTML because their
   number, labels and current state all come from the slides. Until this runs,
   the markup on its own is a scrollable strip of all four photographs with no
   controls at all - the controls are hidden in CSS until data-herd-ready
   appears, so a visitor without JavaScript never meets a dead arrow.
*/

const AUTO_MS = 5200;
/* Movement needed before a press counts as a drag rather than a stray tap. */
const DRAG_SLOP = 6;
/* How much of the slide's width the gesture must cover to commit to the next
   one. Low enough that a short flick works, high enough that a nudge does not
   throw the visitor a whole cow away. */
const DRAG_COMMIT = 0.18;
/* The fraction of a drag that survives past either end. A track that stops dead
   reads as broken; one that runs off into empty space reads as a bug. */
const DRAG_RESIST = 0.35;

function setUpCarousel(root) {
  const viewport = root.querySelector('[data-herd-viewport]');
  const track = root.querySelector('[data-herd-track]');
  const dotsBox = root.querySelector('[data-herd-dots]');
  const prev = root.querySelector('[data-herd-prev]');
  const next = root.querySelector('[data-herd-next]');
  const status = root.querySelector('[data-herd-status]');
  const slides = Array.from(root.querySelectorAll('[data-herd-slide]'));

  /* One slide is not a carousel. Leave it as the plain image it already is
     rather than wiring up arrows that can only ever do nothing. */
  if (!viewport || !track || !dotsBox || !prev || !next || slides.length < 2) return;

  const count = slides.length;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const names = slides.map((slide, i) => slide.dataset.name || `Cow ${i + 1}`);

  let index = 0;
  let dragging = false;
  let dragPointer = null;
  let dragStartX = 0;
  let dragX = 0;
  let hovering = false;
  let focused = false;
  let timer = null;

  const dots = names.map((name, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'herd-carousel__dot';
    dot.setAttribute('aria-label', name);
    dot.addEventListener('click', () => {
      go(i);
    });
    dotsBox.append(dot);
    return dot;
  });

  /* The offset is a percentage of the track's own width, so it survives a
     resize without recomputing anything - one slide is always exactly 100% of
     the viewport because the slides are flex children at flex-basis 100%. */
  function place(px, animate) {
    track.style.transition = animate ? '' : 'none';
    track.style.transform = px
      ? `translate3d(calc(${-index * 100}% + ${px}px), 0, 0)`
      : `translate3d(${-index * 100}%, 0, 0)`;
  }

  function render() {
    dots.forEach((dot, i) => {
      if (i === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    /* The slides that are not showing are removed from the tree as well as
       from the screen. aria-hidden alone would still leave a screen reader free
       to read the other three cows' alt text out of order while the visitor is
       looking at one of them. */
    slides.forEach((slide, i) => {
      if (i === index) slide.removeAttribute('aria-hidden');
      else slide.setAttribute('aria-hidden', 'true');
    });
    prev.disabled = index === 0;
    next.disabled = index === count - 1;
  }

  function go(target, { announce = true } = {}) {
    const wanted = Math.min(count - 1, Math.max(0, target));
    const changed = wanted !== index;
    index = wanted;
    place(0, true);
    render();
    if (changed && announce && status) {
      status.textContent = `${names[index]}, ${index + 1} of ${count}`;
    }
    syncAuto();
  }

  prev.addEventListener('click', () => {
    go(index - 1);
  });

  next.addEventListener('click', () => {
    go(index + 1);
  });

  /* The arrow keys are the same gesture without a hand on the mouse, and on a
     touch screen they are often the only way past the first slide. Home and End
     come along because they are free once the keys are being read. */
  viewport.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'ArrowRight') go(index + 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(count - 1);
    else return;
    event.preventDefault();
  });

  /* ---- dragging ---- */

  viewport.addEventListener('pointerdown', (event) => {
    /* Primary button only. A right-click opens a menu, not a carousel. */
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    /* user-select: none on the viewport already stops this carousel's own text
       being selected. This covers the other direction: a range made somewhere
       else on the page that happens to reach in here would still turn the next
       drag into a text drag-and-drop, and Chromium answers that with
       pointercancel rather than a pointerup. Clearing on press keeps the
       gesture ours whatever else is going on. */
    const selection = document.getSelection();
    if (selection) selection.removeAllRanges();
    dragging = true;
    dragPointer = event.pointerId;
    dragStartX = event.clientX;
    dragX = 0;
    /* Capture so the drag survives the pointer leaving the photograph, and so
       the matching pointerup arrives even if it is released elsewhere. */
    viewport.setPointerCapture(event.pointerId);
    root.setAttribute('data-herd-dragging', '');
    syncAuto();
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!dragging || event.pointerId !== dragPointer) return;
    const dx = event.clientX - dragStartX;
    if (!dragX && Math.abs(dx) < DRAG_SLOP) return;
    dragX = dx;
    const pastStart = index === 0 && dx > 0;
    const pastEnd = index === count - 1 && dx < 0;
    place(pastStart || pastEnd ? dx * DRAG_RESIST : dx, false);
  });

  /* pointercancel is the touch path out of a drag: the browser has taken the
     gesture for a vertical pan and cancelled ours. */
  function endDrag(event) {
    if (!dragging || event.pointerId !== dragPointer) return;
    dragging = false;
    dragPointer = null;
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    root.removeAttribute('data-herd-dragging');
    /* Measured against the real movement, not the resisted one, so the
       threshold means the same thing at the ends as in the middle. */
    const width = viewport.getBoundingClientRect().width || 1;
    const from = index;
    const travelled = dragX;
    dragX = 0;
    if (travelled <= -width * DRAG_COMMIT) go(from + 1);
    else if (travelled >= width * DRAG_COMMIT) go(from - 1);
    /* Anything shorter springs back to where it started. */
    else go(from);
  }

  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  /* ---- moving on by itself ---- */

  /* Every reason to stop, in one place, so that pausing and resuming cannot
     disagree with each other. Anything that sets one of these true calls
     syncAuto, which re-reads all of them. */
  function shouldRun() {
    return (
      !reducedMotion.matches &&
      !hovering &&
      !focused &&
      !dragging &&
      !document.hidden &&
      /* Stops at the last slide rather than looping. */
      index < count - 1
    );
  }

  function syncAuto() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!shouldRun()) return;
    timer = setTimeout(() => {
      timer = null;
      /* Announced changes are for changes somebody asked for. */
      go(index + 1, { announce: false });
    }, AUTO_MS);
  }

  /* Hovering parks it, but only where hovering is a real gesture: a finger
     fires pointerenter on touch-down and pointerleave on lift, which would
     otherwise stop the carousel the instant anyone swiped it. */
  root.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    hovering = true;
    syncAuto();
  });

  root.addEventListener('pointerleave', () => {
    hovering = false;
    syncAuto();
  });

  root.addEventListener('focusin', () => {
    focused = true;
    syncAuto();
  });

  root.addEventListener('focusout', () => {
    focused = false;
    syncAuto();
  });

  /* A tab in the background has nobody looking at it. */
  document.addEventListener('visibilitychange', syncAuto);

  if (reducedMotion.addEventListener) {
    reducedMotion.addEventListener('change', syncAuto);
  }

  /* Marked last, once there is something to show: this is what reveals the
     controls, so they cannot appear before the script that drives them. */
  root.setAttribute('data-herd-ready', '');
  render();
  syncAuto();
}

Array.from(document.querySelectorAll('[data-herd-carousel]')).forEach(setUpCarousel);
