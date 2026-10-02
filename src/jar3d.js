/* ---------- The rotating jar, rendered live ----------

   This used to be jar-360.webm: a 2160x3840 pre-rendered loop of the jar
   turning on a turntable, 8.033s per revolution. It is now the real model,
   lit and turned at runtime.

   three.js and the GLB are both fetched on demand. The product stage sits
   three viewports below the fold and the film above it is 21 MiB, so pulling
   ~16 MiB of jar eagerly would put it in front of the first paint for a scene
   most visitors only reach after scrolling past the whole film. */

const MODEL_SRC = '/media/jar-3d.glb';

// Matches the turntable the 360 video was shot on. The speed is part of the
// look - it is a lazy revolution, not a spin.
const REVOLUTION_MS = 8033;

// Reduced motion still gets the model, but parked at a three-quarter turn and
// rendered once. A dead-on view of a symmetric jar is the flattest possible
// read of it, and one frame costs nothing.
const STILL_FRACTION = 0.055;

// The environment map lights the jar from every side, so nothing in the render
// grounds it on a surface. This is the same framing the 360 video used: the
// object fills the frame, the labels sit below it.
const FRAME_PADDING = 1.14;

// Above this the extra device pixels cost real milliseconds on a canvas this
// small and are not visible.
const MAX_PIXEL_RATIO = 2;

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
  let turnStart = 0;
  let turnFraction = STILL_FRACTION;

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

        // The backing store has to be sized off layout, and the only reliable
        // moment for that is when layout exists. A ResizeObserver covers the
        // first size, a late reflow, and every later window size, instead of a
        // one-shot measurement that can land before the box has a height and
        // silently leave the canvas at its 300x150 default. The canvas lives as
        // long as the page, so the observer is never torn down.
        new ResizeObserver(resize).observe(canvas);
        resize();
        frameToBounds(size);

        ready = true;
        turnStart = 0;
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
    if (reducedMotion) {
      // Parked. Render once, on the frame the mode was switched on.
      if (turnFraction !== STILL_FRACTION) {
        turnFraction = STILL_FRACTION;
        pivot.rotation.y = STILL_FRACTION * Math.PI * 2;
        renderer.render(scene, camera);
        onFraction?.(STILL_FRACTION);
      }
      return;
    }
    if (!turnStart) turnStart = now;
    turnFraction = ((now - turnStart) % REVOLUTION_MS) / REVOLUTION_MS;
    pivot.rotation.y = turnFraction * Math.PI * 2;
    renderer.render(scene, camera);
    onFraction?.(turnFraction);
  }

  function setReducedMotion(value) {
    reducedMotion = value;
    if (value) turnFraction = -1;
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
