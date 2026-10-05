/* The herd carousel in the farm page hero.

   Four photographs of the cows, one at a time, and it has to be swipeable on a
   phone and draggable on a laptop. Those are two different native behaviours:
   overflow scrolling gives you the swipe for free but no mouse drag at all,
   and pointer events give you both from a single code path. So the track is
   moved with a transform and the gesture is read from pointer events.

   It loops. The last cow leads round to the first by the short way - one
   slide's worth of movement - whether you asked for it with the arrow, the
   autoplay, a swipe, a dot or the keyboard. A finite track cannot do that on
   its own: there is nothing to stand to the right of the last photograph, so
   slide 0 arriving would mean sliding the whole strip back across the other
   three. Hence a copy of the last slide at the front and a copy of the first
   at the back, and the loop is those two doing the turning.

   The copies are transient and nothing downstream knows they exist. The
   animation runs onto a copy, and the moment it lands the track is moved back
   onto the real slide with the transition off - invisible, because a copy and
   its original are the same picture in the same box. Every position, dot and
   screen-reader update is written in terms of the real slides, so the state is
   always the state a visitor would expect even in the half second the loop is
   technically parked on the spare.

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
/* The fraction of a drag that survives beyond a whole slide. The loop itself
   provides a full slide of movement in each direction, so this only governs the
   overshoot past that, where the track would otherwise run off into nothing. */
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

  /* Spare copies, one at each end, so the turn has somewhere to happen. Made
     eager because a copy is about to be on screen the moment the loop uses it
     and a lazy image would put a frame of empty background there; the URLs are
     the ones already being asked for, so this is not extra weight, only
     earlier. fetchpriority drops to low so neither of them competes with the
     photograph that decides how quickly this page paints. render() keeps them
     out of the accessibility tree except while one is the visible cell. */
  const spares = [slides[count - 1], slides[0]].map((slide) => {
    const copy = slide.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    /* It arrives carrying every attribute the original had, including the one
       that says it is a slide. It is not one: it is a spare, and leaving the
       attribute on would quietly double the answer to any later
       querySelectorAll('[data-herd-slide]') — including this file's own if it
       were ever run twice. data-name is kept, because that is how a spare knows
       which photograph it is standing in for. */
    copy.removeAttribute('data-herd-slide');
    const image = copy.querySelector('img');
    if (image) {
      image.loading = 'eager';
      image.fetchPriority = 'low';
    }
    return copy;
  });
  track.insertBefore(spares[0], slides[0]);
  track.append(spares[1]);

  /* Every cell in the track, copies included. Positions 1 to count are the real
     photographs; 0 and count + 1 are the spares that turn the loop. */
  const cells = Array.from(track.children);

  /* Where the track is sitting, and which photograph that means. The two are
     separate because the loop spends half a second at each end parked on a copy
     while the photograph on show is already the one the visitor asked for. */
  let pos = 1;
  let index = 0;
  let dragging = false;
  let dragPointer = null;
  let dragStartX = 0;
  let dragX = 0;
  let hovering = false;
  let focused = false;
  let timer = null;
  /* The silent jump the loop still owes, if it is currently sitting on a spare. */
  let owed = null;
  let owedTimer = null;

  /* Which photograph a track position shows. The spares are the far ends of the
     loop, so the first and last slides are each reachable from two positions. */
  const slideAt = (position) => ((position - 1) % count + count) % count;

  /* How long to give a movement to land before the loop stops waiting and jumps
     anyway. Read out of the stylesheet rather than kept as a number here, and
     that is not tidiness: the wait is a backstop for the transition's own end
     event, so a constant that drifts out of step with the CSS does not fail
     safely — a longer move than the code expects gets its jump part-way
     through and is visibly cut short. The margin absorbs a frame or two of
     rounding between the two. */
  const settleAfter = (() => {
    const seconds = parseFloat(getComputedStyle(track).transitionDuration);
    return Number.isFinite(seconds) ? seconds * 1000 + 140 : 700;
  })();

  const dots = names.map((name, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'herd-carousel__dot';
    dot.setAttribute('aria-label', name);
    dot.addEventListener('click', () => {
      go(nearest(i));
    });
    dotsBox.append(dot);
    return dot;
  });

  /* The offset is a percentage of the track's own width, so it survives a
     resize without recomputing anything - one cell is always exactly 100% of
     the viewport because the cells are flex children at flex-basis 100%. */
  function place(px, animate) {
    track.style.transition = animate ? '' : 'none';
    track.style.transform = px
      ? `translate3d(calc(${-pos * 100}% + ${px}px), 0, 0)`
      : `translate3d(${-pos * 100}%, 0, 0)`;
  }

  function render() {
    dots.forEach((dot, i) => {
      if (i === index) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    /* Exactly one cell is out of the tree at a time, counted by which cell is
       showing rather than by which photograph it holds - during the turn that
       is the spare, and that is the honest answer. aria-hidden alone would
       still leave a screen reader free to read the other three cows' alt text
       out of order while the visitor is looking at one of them. */
    cells.forEach((cell, i) => {
      if (i === pos) cell.removeAttribute('aria-hidden');
      else cell.setAttribute('aria-hidden', 'true');
    });
  }

  /* Pay the loop's debt immediately: land on the real slide, transition off. */
  function payOwed() {
    if (!owed) return;
    const target = owed.to;
    track.removeEventListener('transitionend', owed.onEnd);
    if (owedTimer !== null) clearTimeout(owedTimer);
    owed = null;
    owedTimer = null;
    pos = target;
    index = slideAt(target);
    place(0, false);
    render();
    /* Measured before the transition goes back on, so the browser commits the
       jump rather than animating onto the real slide from the spare. */
    track.getBoundingClientRect();
    track.style.transition = '';
  }

  /* Called on every move. Only a move that lands on a spare owes anything. */
  function oweOwed() {
    const target = pos === 0 ? count : pos === count + 1 ? 1 : null;
    if (target === null) return;
    owed = {
      to: target,
      onEnd: (event) => {
        if (event.target === track && event.propertyName === 'transform') payOwed();
      },
    };
    /* Under reduced motion nothing animates, so there is no end event to wait
       for and no movement for the jump to hide behind. */
    if (reducedMotion.matches) {
      payOwed();
      return;
    }
    track.addEventListener('transitionend', owed.onEnd);
    /* A tab that was hidden for the length of the movement may never deliver
       the end event, and its timer is throttled while hidden. Both copies look
       exactly like the originals, so a late jump costs nothing visible. */
    owedTimer = setTimeout(payOwed, settleAfter);
  }

  /* Move to a track position. Everything that changes slide comes through here,
     so the dots, the announcement, the autoplay and the loop cannot disagree. */
  function go(target, { announce = true } = {}) {
    /* A press that lands while the loop is parked on a spare pays the debt
       first, so the step is taken from the real slide and the next move is
       measured from the same place a reader would count from. */
    payOwed();
    const wanted = Math.min(count + 1, Math.max(0, target));
    const changed = wanted !== pos;
    pos = wanted;
    index = slideAt(pos);
    place(0, true);
    render();
    oweOwed();
    if (changed && announce && status) {
      status.textContent = `${names[index]}, ${index + 1} of ${count}`;
    }
    syncAuto();
  }

  /* Every photograph has a spare a whole turn away at each end. Take whichever
     of the three positions is nearest, so a dot is a short move rather than
     the long way round the loop. */
  function nearest(target) {
    const home = target + 1;
    let best = home;
    let bestGap = Math.abs(home - pos);
    /* Only the three positions the track actually has. */
    for (const candidate of [home - count, home + count]) {
      if (candidate < 0 || candidate > count + 1) continue;
      const gap = Math.abs(candidate - pos);
      if (gap >= bestGap) continue;
      best = candidate;
      bestGap = gap;
    }
    return best;
  }

  prev.addEventListener('click', () => {
    go(pos - 1);
  });

  next.addEventListener('click', () => {
    go(pos + 1);
  });

  /* The arrow keys are the same gesture without a hand on the mouse, and on a
     touch screen they are often the only way past the first slide. Home and End
     come along because they are free once the keys are being read, and on a loop
     they mean the first and last photographs rather than the two ends. */
  viewport.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') go(pos - 1);
    else if (event.key === 'ArrowRight') go(pos + 1);
    else if (event.key === 'Home') go(nearest(0));
    else if (event.key === 'End') go(nearest(count - 1));
    else return;
    event.preventDefault();
  });

  /* ---- dragging ---- */

  viewport.addEventListener('pointerdown', (event) => {
    /* Primary button only. A right-click opens a menu, not a carousel. */
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    /* A grab while the loop is on a spare settles it first, so the finger never
       pulls a picture that is about to vanish underneath it. */
    payOwed();
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
    /* A whole slide's worth of movement in either direction is real: a spare
       copy stands at each end precisely so that the last cow leads round to the
       first and the first back round to the last. Past that there is nothing
       left to bring into view, so the movement is damped — a track that runs off
       into empty space reads as a bug. */
    const width = viewport.getBoundingClientRect().width || 1;
    let move = dx;
    if (dx > width) move = width + (dx - width) * DRAG_RESIST;
    else if (dx < -width) move = -width - (-width - dx) * DRAG_RESIST;
    place(move, false);
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
       threshold means the same thing at the edges as in the middle. */
    const width = viewport.getBoundingClientRect().width || 1;
    const from = pos;
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
     syncAuto, which re-reads all of them. There is no "reached the end" here
     any more: the loop has no end to stop at. */
  function shouldRun() {
    return (
      !reducedMotion.matches &&
      !hovering &&
      !focused &&
      !dragging &&
      !document.hidden
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
      go(pos + 1, { announce: false });
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

  /* A tab in the background has nobody looking at it, and may have missed the
     end of an animation while it was there. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) payOwed();
    syncAuto();
  });

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