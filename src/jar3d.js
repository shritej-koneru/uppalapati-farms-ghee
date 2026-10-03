/* ---------- The rotating jar, rendered live ----------

   This used to be jar-360.webm: a 2160x3840 pre-rendered loop of the jar
   turning on a turntable, 8.033s per revolution. It is now the real model,
   lit and turned at runtime, and it can be turned by hand.

   three.js and the GLB are both fetched from separate chunks, so the jar costs
   nothing until the page asks for it. The fetch is kicked off as soon as the
   browser goes idle after first paint, not when the stage scrolls into view:
   the stage sits three viewports below the fold, so deferring the load until
   then meant anyone who reached it had already been staring at a still frame
   of a jar that was downloading behind them, and the swap landed after the
   section had been framed. Fetching early does compete for bandwidth with the
   21 MiB film above it, which is the price of being ready when they arrive.

   Rendering stays gated on the stage being near the viewport, so a jar loaded
   off screen costs one download and no frames at all. */

const MODEL_SRC = '/media/jar-3d.glb';

const TWO_PI = Math.PI * 2;

// Matches the turntable the 360 video was shot on. The speed is part of the
// look - it is a lazy revolution, not a spin.
const REVOLUTION_MS = 8033;

// A backgrounded tab, or a frame that hitched, must not be made up for. Without
// this the jar jumps forward by however long the gap was on the first frame
// after it. 100ms is 4.5 degrees, so dropping the remainder is invisible.
const MAX_FRAME_DELTA_MS = 100;

// Half a degree of turn per pixel dragged: a full turn every 720px. Fast enough
// to feel like the jar is on the end of your finger, slow enough that a drag
// across the frame does not whip it around.
const DRAG_RADIANS_PER_PIXEL = (Math.PI / 180) * 0.5;

// Arrow keys step a quarter turn in eight presses, which is about one flick of
// a scroll wheel and is the nearest keyboard equivalent of a small drag.
const KEY_STEP_RADIANS = TWO_PI / 32;

// Reduced motion still gets the model, but parked at a three-quarter turn. A
// dead-on view of a symmetric jar is the flattest possible read of it.
const STILL_ANGLE = 0.055 * TWO_PI;

// The environment map lights the jar from every side, so nothing in the render
// grounds it on a surface. This is the same framing the 360 video used: the
// object fills the frame, the labels sit below it.
const FRAME_PADDING = 1.14;

// Above this the extra device pixels cost real milliseconds on a canvas this
// small and are not visible.
const MAX_PIXEL_RATIO = 2;

function wrapAngle(value) {
  return ((value % TWO_PI) + TWO_PI) % TWO_PI;
}

export function createJar3d({ canvas, onReady, onFail, onFraction }) {
  let renderer = null;
  let scene = null;
  let camera = null;
  let pivot = null;

  let started = false;
  let ready = false;
  let failed = false;
  let wantsActive = false;
  let reducedMotion = false;
  // The measured size of the loaded model, kept so the camera can be re-fitted
  // whenever the box changes shape. Null until the GLB lands.
  let modelSize = null;

  // One number is the jar's orientation, and everything that can turn it - the
  // clock and the pointer - moves this one number. The turn is deliberately not
  // derived from elapsed time: a fraction of now would snap the jar back to a
  // fixed position whenever a hover or a drag interrupted it.
  let angle = STILL_ANGLE;
  let lastTickTime = 0;
  // A parked or hovered jar should cost nothing. Only redraw when something
  // has actually changed, rather than re-rendering an identical frame 60 times
  // a second.
  let needsRender = true;

  let hovering = false;
  let dragging = false;
  let dragPointerId = null;
  let lastDragX = 0;

  function fail(error) {
    if (failed) return;
    failed = true;
    ready = false;
    wantsActive = false;
    onFail?.(error);
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    // updateStyle false: .jar-frame owns the box, and three must not also write
    // inline width/height that would fight the CSS on every resize.
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Re-fit the camera on every resize, not only on load. The load can finish
    // while the stage is still off screen, where this call has to give up on a
    // zero-sized box; the camera distance is derived from the aspect ratio, so a
    // frame fitted against the wrong aspect would otherwise keep that wrong
    // distance for the life of the page.
    if (modelSize) frameToBounds(modelSize);
    needsRender = true;
  }

  // Frame the model from its own bounds rather than from hard-coded numbers,
  // so the camera survives an edit to the GLB. Height and width are fitted
  // separately and the larger wins, which is what keeps a tall jar framed in a
  // short-and-wide window instead of overflowing the sides.
  function frameToBounds(size) {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const halfHeight = size.y / 2;
    const halfWidth = Math.max(size.x, size.z) / 2;
    const distance = Math.max(halfHeight / Math.tan(vFov / 2), halfWidth / Math.tan(hFov / 2)) * FRAME_PADDING;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
  }

  function turnBy(delta) {
    angle = wrapAngle(angle + delta);
    needsRender = true;
  }

  function wireInteraction() {
    // Hovering parks the turntable. Only for devices that can actually hover:
    // a finger fires pointerenter on touch-down and pointerleave on lift, which
    // would otherwise read as the jar being grabbed the moment it was tapped.
    canvas.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      hovering = true;
    });

    canvas.addEventListener('pointerleave', () => {
      hovering = false;
    });

    canvas.addEventListener('pointerdown', (event) => {
      // Primary button only. A right-click opens a menu, not a turntable.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      dragging = true;
      dragPointerId = event.pointerId;
      lastDragX = event.clientX;
      // Capture so the drag survives the pointer leaving the canvas, and so the
      // matching pointerup arrives even if the cursor is released off the jar.
      canvas.setPointerCapture(event.pointerId);
      needsRender = true;
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || event.pointerId !== dragPointerId) return;
      const dx = event.clientX - lastDragX;
      if (!dx) return;
      lastDragX = event.clientX;
      turnBy(dx * DRAG_RADIANS_PER_PIXEL);
    });

    // pointercancel is the touch path out of a drag: the browser takes the
    // gesture for a vertical pan and cancels ours.
    const endDrag = (event) => {
      if (!dragging || event.pointerId !== dragPointerId) return;
      dragging = false;
      dragPointerId = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // The pointer cannot turn the jar, but the keyboard should still be able
    // to: an arrow key is the same gesture without a hand on the mouse.
    canvas.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? KEY_STEP_RADIANS * 4 : KEY_STEP_RADIANS;
      if (event.key === 'ArrowLeft') turnBy(-step);
      else if (event.key === 'ArrowRight') turnBy(step);
      else if (event.key === 'ArrowUp') turnBy(-step);
      else if (event.key === 'ArrowDown') turnBy(step);
      else return;
      event.preventDefault();
    });
  }

  function build(THREE, GLTFLoader, RoomEnvironment) {
    renderer = new THREE.WebGLRenderer({
      canvas,
      // The page paints its own warm paper background and gold halo behind the
      // jar; a clear colour would cover both.
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES rolls the highlights off instead of clipping them. A glazed jar is
    // mostly specular, so without it every highlight is a flat white patch.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

    // RoomEnvironment is a small procedural studio - soft boxes on a neutral
    // room - turned into an environment map. It is what makes the glass and
    // the metal cap read as those materials instead of as flat shaded plastic,
    // and it costs no download.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose?.();
    pmrem.dispose();

    // Two hard lights on top of the environment: one for the single bright
    // highlight the soft room cannot give, one raking the far edge so the
    // silhouette separates from the paper background.
    const key = new THREE.DirectionalLight(0xfff3dd, 2.1);
    key.position.set(-1.7, 2.5, 2.3);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xffe6bd, 1.35);
    rim.position.set(2.5, 0.9, -2.2);
    scene.add(rim);

    wireInteraction();

    const loader = new GLTFLoader();
    loader.load(
      MODEL_SRC,
      (gltf) => {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // Turn about the jar's own vertical axis. The GLB happens to be centred
        // on the origin already, but subtracting the measured centre means an
        // off-origin export still spins in place instead of orbiting.
        pivot = new THREE.Group();
        gltf.scene.position.sub(center);
        pivot.add(gltf.scene);
        scene.add(pivot);

        // Kept for every later resize to re-fit the camera against; see resize().
        modelSize = size;

        // The backing store has to be sized off layout, and the only reliable
        // moment for that is when layout exists. A ResizeObserver covers the
        // first size, a late reflow, and every later window size, instead of a
        // one-shot measurement that can land before the box has a height and
        // silently leave the canvas at its 300x150 default. The canvas lives as
        // long as the page, so the observer is never torn down.
        new ResizeObserver(resize).observe(canvas);
        resize();

        // The markup label describes what the jar is, and stays true with no JS
        // at all. Only now that it can be turned by hand does it promise how.
        const base = canvas.getAttribute('aria-label') || '';
        canvas.setAttribute('aria-label', `${base.trim()} Drag, or use the arrow keys, to turn it.`);

        ready = true;
        needsRender = true;
        onReady?.();
      },
      undefined,
      (error) => fail(error),
    );
  }

  async function start() {
    if (started || failed) return;
    started = true;
    try {
      const [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/environments/RoomEnvironment.js'),
      ]);
      build(THREE, GLTFLoader, RoomEnvironment);
    } catch (error) {
      fail(error);
    }
  }

  // Called from the page's single animation frame rather than from a loop of
  // its own: there is already one requestAnimationFrame chain driving the film
  // seek, and a second one would double the per-frame cost for no gain.
  function tick(now) {
    // wantsActive is latched rather than resolved on the spot. The stage comes
    // near - and so the load starts - long before a 15.6 MiB GLB has finished,
    // and a caller that asked for "active" before the model existed still wants
    // it once the model is there.
    if (!ready || !wantsActive) return;
    const delta = lastTickTime ? Math.min(now - lastTickTime, MAX_FRAME_DELTA_MS) : 0;
    lastTickTime = now;
    // Reduced motion stops the clock but not the hand: turning the jar
    // yourself is direct manipulation, not the page moving it for you.
    if (!reducedMotion && !hovering && !dragging) {
      turnBy((delta / REVOLUTION_MS) * TWO_PI);
    }
    if (!needsRender) return;
    needsRender = false;
    pivot.rotation.y = angle;
    renderer.render(scene, camera);
    // The labels follow the angle rather than the clock, so a jar dragged round
    // to its back swaps them exactly as a turntable arriving there would.
    onFraction?.(angle / TWO_PI);
  }

  function setReducedMotion(value) {
    reducedMotion = value;
    if (value) angle = STILL_ANGLE;
    needsRender = true;
  }

  return {
    start,
    tick,
    resize,
    setReducedMotion,
    setActive(value) {
      wantsActive = value;
    },
  };
}