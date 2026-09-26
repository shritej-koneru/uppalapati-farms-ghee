const journeyStage = document.querySelector('[data-journey]');
const processVideo = document.querySelector('[data-process-video]');
const processCaptions = [...document.querySelectorAll('[data-process-caption]')];
const processProgress = document.querySelector('[data-process-progress]');
const productStage = document.querySelector('[data-product-stage]');
const jarVideo = document.querySelector('[data-jar-360]');
const jarFallback = document.querySelector('[data-jar-fallback]');
const revealLabel = document.querySelector('[data-reveal-label]');
const revealLabelEnd = document.querySelector('[data-reveal-label-end]');
const cartTrigger = document.querySelector('[data-cart-trigger]');
const cartCount = document.querySelector('[data-cart-count]');
const cartDialog = document.querySelector('[data-cart-dialog]');
const cartItems = document.querySelector('[data-cart-items]');
const cartEmpty = document.querySelector('[data-cart-empty]');
const cartTotal = document.querySelector('[data-cart-total]');
const closeCartButton = document.querySelector('[data-close-cart]');
const checkoutButton = document.querySelector('[data-checkout]');
const addProductButtons = [...document.querySelectorAll('[data-add-product]')];
const loadingScreen = document.querySelector('[data-loading-screen]');
const loadingBar = document.querySelector('[data-loading-bar]');
const loadingProgress = document.querySelector('[data-loading-progress]');
const loadingPercent = document.querySelector('[data-loading-percent]');

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const videoSources = ['/media/ghee-process-scrub.mp4', '/media/ghee-process-mobile.mp4', '/media/ghee-process.mp4'];
const cartStorageKey = 'uppalapati-farms-cart';
const captionWindows = [
  [0.08, 0.24],
  [0.32, 0.47],
  [0.55, 0.7],
  [0.77, 0.9],
];
const products = {
  'half-litre': {
    name: 'Half-litre ghee',
    size: '500 ml',
    price: 699,
    image: '/media/ghee-jar-100ml.jpg',
  },
  'one-litre': {
    name: 'One-litre ghee',
    size: '1 L',
    price: 1299,
    image: '/media/ghee-jar-500ml.jpg',
  },
};
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

let scrollFrame = 0;
let resizeTimer = 0;
let activeCaption = -1;
let videoDuration = 0;
let videoReady = false;
let activeVideoSource = '';
let seekTarget = -1;
let displayTime = 0;
let jarDuration = 0;
let jarReady = false;
let jarFailed = false;
let jarShouldPlay = false;
let lastJarPlayAttempt = 0;
let isReducedMotion = motionQuery.matches;
let assetsDone = false;
let loadDone = false;
let cart = loadCart();

// Failsafe: never let a boot error trap the visitor behind the loading screen.
window.setTimeout(() => {
  document.body.classList.add('is-ready');
  document.body.classList.remove('is-loading');
}, 6000);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
}

function getSectionProgress(section) {
  const rect = section.getBoundingClientRect();
  const travel = section.offsetHeight - window.innerHeight;
  if (travel <= 0) return 0;
  return clamp(-rect.top / travel, 0, 1);
}

/* ---------- Loading ---------- */

function renderLoadingProgress(value) {
  const percent = Math.round(clamp(value, 0, 1) * 100);
  if (loadingBar) loadingBar.style.transform = `scaleX(${(percent / 100).toFixed(4)})`;
  if (loadingProgress) loadingProgress.setAttribute('aria-valuenow', String(percent));
  if (loadingPercent) loadingPercent.textContent = `${percent}%`;
}

function revealSite() {
  document.body.classList.remove('is-loading');
  document.body.classList.add('is-ready');
  if (loadingScreen) loadingScreen.setAttribute('aria-hidden', 'true');
  renderLoadingProgress(1);
  syncScroll();
}

function finishLoading() {
  if (loadDone) return;
  loadDone = true;
  renderLoadingProgress(1);
  window.setTimeout(revealSite, 420);
}

function startLoadingScreen() {
  if (!loadingScreen) {
    finishLoading();
    return;
  }
  const startedAt = performance.now();
  let simulated = 0;
  const tick = () => {
    if (loadDone) return;
    const eased = 1 - Math.exp(-(performance.now() - startedAt) / 1600);
    simulated = Math.max(simulated, eased * 0.86);
    const shown = assetsDone ? Math.max(simulated, 0.92) : simulated;
    renderLoadingProgress(shown);
    window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
  window.setTimeout(finishLoading, 9000);
}

function preloadAssets() {
  const images = ['/media/ghee-poster.jpg', '/media/ghee-jar-500ml.jpg', '/media/ghee-jar-100ml.jpg'];
  let pending = images.length + 1;

  const settle = () => {
    pending -= 1;
    if (pending <= 0 && document.readyState !== 'loading') assetsDone = true;
  };

  images.forEach((src) => {
    const image = new Image();
    image.onload = settle;
    image.onerror = settle;
    image.src = src;
  });

  const probe = document.createElement('video');
  probe.muted = true;
  probe.preload = 'auto';
  probe.src = activeVideoSource || videoSources[0];
  const settleVideo = () => {
    if (probe.currentTime < 2) {
      try {
        probe.currentTime = Math.min(2, (probe.duration || 4) - 0.1);
        return;
      } catch {
        /* fall through to settle */
      }
    }
    settleVideo.done = true;
    settle();
  };
  probe.addEventListener('loadeddata', settleVideo, { once: true });
  probe.addEventListener('error', settle, { once: true });
  window.setTimeout(() => {
    if (!settleVideo.done) {
      settleVideo.done = true;
      settle();
    }
  }, 7000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (pending <= 0) assetsDone = true;
    });
  } else if (pending <= 0) {
    assetsDone = true;
  }
  window.setTimeout(() => {
    assetsDone = true;
  }, 8000);
}

/* ---------- Journey: intro overlay + scrubbed film ---------- */

function updateJourney() {
  const rect = journeyStage.getBoundingClientRect();
  const isNearViewport = rect.bottom > 0 && rect.top < window.innerHeight;
  if (!isNearViewport || isReducedMotion) {
    return;
  }
  const progress = getSectionProgress(journeyStage);
  const introFade = 1 - easeInOut(clamp(progress / 0.07, 0, 1));
  journeyStage.style.setProperty('--intro-opacity', introFade.toFixed(4));
  journeyStage.style.setProperty('--intro-lift', `${(-32 * easeInOut(clamp(progress / 0.07, 0, 1))).toFixed(1)}px`);
  journeyStage.classList.toggle('intro-gone', introFade < 0.02);
  const exitWash = easeInOut(clamp((progress - 0.93) / 0.07, 0, 1));
  journeyStage.style.setProperty('--process-exit', exitWash.toFixed(4));
  const nextCaption = captionWindows.findIndex(([start, end]) => progress >= start && progress <= end);
  processProgress.style.transform = `scaleX(${progress.toFixed(4)})`;
  setCaption(nextCaption);
  requestVideoSeek(progress);
}

function setCaption(index) {
  if (index === activeCaption) return;
  activeCaption = index;
  processCaptions.forEach((caption, captionIndex) => {
    caption.classList.toggle('is-active', captionIndex === index);
  });
}

function requestVideoSeek(progress) {
  if (!videoReady || isReducedMotion || videoDuration <= 0) return;
  seekTarget = clamp(progress, 0, 0.999) * videoDuration;
}

/* ---------- Rotating jar (scrubbed 360 video) ---------- */

function updateProductStage() {
  const progress = getSectionProgress(productStage);
  const revealProgress = easeInOut(clamp((progress - 0.1) / 0.5, 0, 1));
  const optionsProgress = easeInOut(clamp((progress - 0.32) / 0.3, 0, 1));
  productStage.style.setProperty('--reveal-y', `${(-26 * revealProgress).toFixed(2)}vh`);
  productStage.style.setProperty('--reveal-scale', (1 - revealProgress * 0.3).toFixed(4));
  productStage.style.setProperty('--halo-opacity', (0.72 - revealProgress * 0.5).toFixed(4));
  productStage.style.setProperty('--options-y', `${((1 - optionsProgress) * 42).toFixed(2)}px`);
  productStage.style.setProperty('--options-opacity', optionsProgress.toFixed(4));
  productStage.classList.toggle('options-visible', optionsProgress > 0.001);
  const rect = productStage.getBoundingClientRect();
  const stageNear = rect.bottom > -window.innerHeight * 0.5 && rect.top < window.innerHeight * 1.5;
  jarShouldPlay = jarReady && !isReducedMotion && revealProgress > 0.001 && stageNear;
}

/* ---------- Jar playback helpers ---------- */

function syncJarPlayback() {
  if (!jarReady) return;
  if (jarShouldPlay) {
    if (jarVideo.paused && !document.hidden && performance.now() - lastJarPlayAttempt > 800) {
      lastJarPlayAttempt = performance.now();
      const attempt = jarVideo.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    }
  } else if (!jarVideo.paused) {
    jarVideo.pause();
  }
}

function updateRevealLabels() {
  if (!revealLabel || !revealLabelEnd || jarDuration <= 0) return;
  const fraction = (jarVideo.currentTime % jarDuration) / jarDuration;
  const facingFront = fraction < 0.22 || fraction > 0.78;
  revealLabel.style.opacity = facingFront ? '0.85' : '0';
  revealLabelEnd.style.opacity = facingFront ? '0' : '0.85';
}

/* ---------- Frame loop: butter-smooth video seeking ---------- */

function syncScroll() {
  updateJourney();
  updateProductStage();
}

function frame() {
  if (seekTarget >= 0 && videoDuration > 0) {
    const target = seekTarget;
    displayTime += (target - displayTime) * 0.18;
    if (Math.abs(target - displayTime) < 0.0012) {
      displayTime = target;
      seekTarget = -1;
    }
    try {
      processVideo.currentTime = clamp(displayTime, 0, videoDuration - 0.001);
    } catch {
      seekTarget = -1;
    }
  }
  syncJarPlayback();
  updateRevealLabels();
  window.requestAnimationFrame(frame);
}

function scheduleScrollSync() {
  if (scrollFrame) return;
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = 0;
    syncScroll();
  });
}

/* ---------- Video sources ---------- */

function setVideoSource(source) {
  if (source === activeVideoSource) return;
  activeVideoSource = source;
  videoReady = false;
  processVideo.classList.remove('is-unavailable');
  processVideo.src = source;
  processVideo.load();
}

function selectVideoSource() {
  const source = window.innerWidth <= 768 ? videoSources[1] : videoSources[0];
  setVideoSource(source);
}

function handleVideoMetadata() {
  if (Number.isFinite(processVideo.duration) && processVideo.duration > 0) {
    videoDuration = processVideo.duration;
    videoReady = true;
    displayTime = clamp(displayTime, 0, videoDuration - 0.001);
    processVideo.pause();
    syncScroll();
  }
}

function handleVideoError() {
  const next = videoSources.find((source) => source !== activeVideoSource);
  if (next) {
    setVideoSource(next);
    return;
  }
  processVideo.classList.add('is-unavailable');
}

function handleJarMetadata() {
  if (Number.isFinite(jarVideo.duration) && jarVideo.duration > 0) {
    jarDuration = jarVideo.duration;
    jarReady = true;
    try {
      jarVideo.currentTime = 0;
    } catch {
      /* not seekable yet; playback starts from the current frame */
    }
    syncJarPlayback();
    syncScroll();
  }
}

function handleJarError() {
  jarFailed = true;
  jarReady = false;
  jarVideo.hidden = true;
  if (jarFallback) jarFallback.hidden = false;
}

function setReducedMotion() {
  isReducedMotion = motionQuery.matches;
  document.documentElement.classList.toggle('reduced-motion', isReducedMotion);
  if (isReducedMotion) {
    processVideo.pause();
    jarVideo.pause();
    journeyStage.style.setProperty('--intro-opacity', '1');
  }
  if (jarFallback && !jarFailed) {
    jarVideo.hidden = isReducedMotion;
    jarFallback.hidden = !isReducedMotion;
  }
  jarShouldPlay = false;
  scheduleScrollSync();
}

/* ---------- Cart ---------- */

function loadCart() {
  const emptyCart = { 'half-litre': 0, 'one-litre': 0 };
  try {
    const savedCart = JSON.parse(window.localStorage.getItem(cartStorageKey));
    if (!savedCart || typeof savedCart !== 'object') return emptyCart;
    return {
      'half-litre': clamp(Math.trunc(Number(savedCart['half-litre'])) || 0, 0, 9),
      'one-litre': clamp(Math.trunc(Number(savedCart['one-litre'])) || 0, 0, 9),
    };
  } catch {
    return emptyCart;
  }
}

function saveCart() {
  try {
    window.localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  } catch {
    cart = loadCart();
  }
}

function getCartCount() {
  return cart['half-litre'] + cart['one-litre'];
}

function getCartTotal() {
  return cart['half-litre'] * products['half-litre'].price + cart['one-litre'] * products['one-litre'].price;
}

function renderCart() {
  const entries = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  const count = getCartCount();
  cartItems.innerHTML = entries.map(([key, quantity]) => {
    const product = products[key];
    return `<div class="cart-item">
      <img src="${product.image}" alt="" />
      <div class="cart-item__details">
        <p>${product.size}</p>
        <span>${currency.format(product.price)} each</span>
      </div>
      <div class="quantity-control" aria-label="Quantity for ${product.size}">
        <button type="button" data-cart-key="${key}" data-cart-action="decrease" aria-label="Decrease ${product.size}" ${quantity === 1 ? 'disabled' : ''}>−</button>
        <output aria-label="Quantity">${quantity}</output>
        <button type="button" data-cart-key="${key}" data-cart-action="increase" aria-label="Increase ${product.size}" ${quantity === 9 ? 'disabled' : ''}>+</button>
      </div>
      <button class="cart-item__remove" type="button" data-cart-key="${key}" data-cart-action="remove">Remove</button>
    </div>`;
  }).join('');
  const bothInCart = cart['half-litre'] > 0 && cart['one-litre'] > 0;
  addProductButtons.forEach((button) => {
    const key = button.dataset.addProduct;
    if (bothInCart && key in cart && cart[key] > 0) {
      button.textContent = 'In cart ✓';
      button.classList.add('is-in-cart');
    } else {
      button.textContent = 'Add to cart';
      button.classList.remove('is-in-cart');
    }
  });
  cartEmpty.hidden = entries.length > 0;
  cartTotal.textContent = currency.format(getCartTotal());
  cartCount.textContent = String(count);
  cartTrigger.hidden = count === 0;
  cartTrigger.setAttribute('aria-label', `Open cart with ${count} ${count === 1 ? 'item' : 'items'}`);
  checkoutButton.disabled = count === 0;
}

function openCart() {
  renderCart();
  if (typeof cartDialog.showModal === 'function') {
    if (!cartDialog.open) cartDialog.showModal();
  } else {
    cartDialog.setAttribute('open', '');
  }
}

function closeCart() {
  if (typeof cartDialog.close === 'function' && cartDialog.open) {
    cartDialog.close();
  } else {
    cartDialog.removeAttribute('open');
  }
}

function addToCart(productKey) {
  if (!(productKey in products)) return;
  cart[productKey] = clamp(cart[productKey] + 1, 1, 9);
  saveCart();
  renderCart();
}

function updateCart(event) {
  const button = event.target.closest('[data-cart-action]');
  if (!button) return;
  const productKey = button.dataset.cartKey;
  if (!(productKey in cart)) return;
  const action = button.dataset.cartAction;
  if (action === 'increase') cart[productKey] = clamp(cart[productKey] + 1, 0, 9);
  if (action === 'decrease') cart[productKey] = clamp(cart[productKey] - 1, 0, 9);
  if (action === 'remove') cart[productKey] = 0;
  saveCart();
  renderCart();
}

function continueToCheckout() {
  if (getCartCount() === 0) return;
  window.location.assign('/checkout.html');
}

function handleResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    selectVideoSource();
    scheduleScrollSync();
  }, 100);
}

/* ---------- Wiring ---------- */

processVideo.addEventListener('loadedmetadata', handleVideoMetadata);
processVideo.addEventListener('error', handleVideoError);
jarVideo.addEventListener('loadedmetadata', handleJarMetadata);
jarVideo.addEventListener('error', handleJarError);
window.addEventListener('scroll', scheduleScrollSync, { passive: true });
window.addEventListener('resize', handleResize, { passive: true });
window.addEventListener('pagehide', () => window.cancelAnimationFrame(scrollFrame));
window.addEventListener('storage', (event) => {
  if (event.key !== cartStorageKey) return;
  cart = loadCart();
  renderCart();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    processVideo.pause();
    jarVideo.pause();
  } else {
    scheduleScrollSync();
  }
});
if (typeof motionQuery.addEventListener === 'function') {
  motionQuery.addEventListener('change', setReducedMotion);
}
addProductButtons.forEach((button) => {
  button.addEventListener('click', () => addToCart(button.dataset.addProduct));
});
cartTrigger.addEventListener('click', openCart);
closeCartButton.addEventListener('click', closeCart);
cartItems.addEventListener('click', updateCart);
checkoutButton.addEventListener('click', continueToCheckout);
cartDialog.addEventListener('click', (event) => {
  if (event.target === cartDialog) closeCart();
});

/* ---------- Boot ---------- */

jarVideo.loop = true;
if (!jarVideo.querySelector('source')) {
  jarVideo.src = '/media/jar-360.webm';
  jarVideo.load();
}
selectVideoSource();
setReducedMotion();
renderCart();
startLoadingScreen();
preloadAssets();
window.addEventListener('load', finishLoading);
document.addEventListener('DOMContentLoaded', () => {
  if (assetsDone) finishLoading();
});
if (document.readyState !== 'loading' && assetsDone) finishLoading();
if (isReducedMotion) finishLoading();
syncScroll();
window.requestAnimationFrame(frame);
