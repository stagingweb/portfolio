const runtime = {
  initialized: false,
  matchMedia: null,
  context: null,
  splits: [],
  lenis: null,
  lenisTicker: null,
  scrollLifecycleReady: false,
  contextTask: 0,
  refreshTimer: 0,
  resizeTimer: 0,
  listeners: [],
  isMobile: false,
  motionDistance: 24,
  parallaxScale: 1,
};

const gsapInstance = () => window.gsap;
const scrollTrigger = () => window.ScrollTrigger;
const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function listen(target, eventName, handler, options) {
  target.addEventListener(eventName, handler, options);
  runtime.listeners.push(() => target.removeEventListener(eventName, handler, options));
}

function hasScrollableContent() {
  const bodyHeight = document.body?.scrollHeight ?? 0;
  return Math.max(document.documentElement.scrollHeight, bodyHeight) > window.innerHeight + 1;
}

function destroySmoothScroll() {
  if (!runtime.lenis) return;

  if (runtime.lenisTicker) gsapInstance().ticker.remove(runtime.lenisTicker);
  runtime.lenis.destroy();
  runtime.lenis = null;
  runtime.lenisTicker = null;
  gsapInstance().ticker.lagSmoothing(500, 33);
}

function syncSmoothScroll() {
  if (
    prefersReducedMotion()
    || document.documentElement.classList.contains("motion-pending")
    || !window.Lenis
    || !hasScrollableContent()
  ) {
    destroySmoothScroll();
    return;
  }

  if (runtime.lenis) return;

  const gsap = gsapInstance();
  const ScrollTrigger = scrollTrigger();
  runtime.lenis = new window.Lenis({
    autoRaf: false,
    lerp: 0.1,
    smoothWheel: true,
    syncTouch: false,
  });
  runtime.lenis.on("scroll", ScrollTrigger.update);
  runtime.lenisTicker = (time) => runtime.lenis?.raf(time * 1000);
  gsap.ticker.add(runtime.lenisTicker);
  gsap.ticker.lagSmoothing(0);
}

function refreshMotion() {
  window.clearTimeout(runtime.refreshTimer);
  runtime.refreshTimer = window.setTimeout(() => {
    runtime.refreshTimer = 0;
    if (!runtime.initialized) return;
    syncSmoothScroll();
    scrollTrigger()?.refresh();
  }, 120);
}

function initScrollTrigger() {
  const ScrollTrigger = scrollTrigger();
  if (!ScrollTrigger || runtime.scrollLifecycleReady) return;
  runtime.scrollLifecycleReady = true;

  listen(window, "resize", () => {
    window.clearTimeout(runtime.resizeTimer);
    runtime.resizeTimer = window.setTimeout(refreshMotion, 120);
  }, { passive: true });
  listen(window, "orientationchange", refreshMotion, { passive: true });
  listen(window, "load", refreshMotion, { once: true });
  listen(document, "load", (event) => {
    if (event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement) {
      refreshMotion();
    }
  }, true);
  listen(document, "loadedmetadata", refreshMotion, true);

  if (document.fonts?.ready) document.fonts.ready.then(refreshMotion);
}

function initSmoothScroll() {
  syncSmoothScroll();
}

function revealTrigger(element) {
  return {
    trigger: element,
    start: element.dataset.motionStart || "top 88%",
    once: true,
  };
}

function trackMotion(name, callback) {
  if (prefersReducedMotion()) return;
  if (!runtime.context) return callback();

  const taskName = `motion_${name}_${++runtime.contextTask}`;
  runtime.context.add(taskName, callback);
  return runtime.context[taskName]();
}

function initFadeReveal(scope = document) {
  return trackMotion("fade", () => {
    const gsap = gsapInstance();
    scope.querySelectorAll("[data-motion-fade]").forEach((element) => {
      const direction = element.dataset.motionFade;
      const distance = direction === "up"
        ? runtime.motionDistance
        : direction === "down"
          ? -runtime.motionDistance
          : 0;
      gsap.fromTo(element,
        { autoAlpha: 0, y: distance },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.75,
          ease: "power2.out",
          clearProps: "opacity,visibility,transform",
          scrollTrigger: revealTrigger(element),
        },
      );
    });
  });
}

function splitReveal(element, type) {
  const SplitText = window.SplitText;
  const gsap = gsapInstance();
  if (!SplitText) return false;

  const isLines = type === "lines";
  const split = SplitText.create(element, {
    type,
    mask: type,
    autoSplit: isLines,
    aria: "auto",
    onSplit(self) {
      const targets = isLines ? self.lines : type === "words" ? self.words : self.chars;
      return gsap.from(targets, {
        yPercent: 110,
        autoAlpha: 0,
        duration: runtime.isMobile ? 0.68 : 0.8,
        ease: "power3.out",
        stagger: isLines
          ? runtime.isMobile ? 0.065 : 0.09
          : type === "words"
            ? runtime.isMobile ? 0.035 : 0.045
            : runtime.isMobile ? 0.008 : 0.012,
        clearProps: "opacity,visibility,transform",
        scrollTrigger: revealTrigger(element),
      });
    },
  });
  runtime.splits.push(split);
  return true;
}

function initTextReveal(scope = document) {
  return trackMotion("text", () => {
    scope.querySelectorAll("[data-motion-text]").forEach((element) => {
      const type = ["lines", "words", "chars"].includes(element.dataset.motionText)
        ? element.dataset.motionText
        : "words";
      if (!splitReveal(element, type)) {
        gsapInstance().fromTo(element,
          { autoAlpha: 0, y: 18 },
          { autoAlpha: 1, y: 0, duration: 0.7, ease: "power2.out", scrollTrigger: revealTrigger(element) },
        );
      }
    });
  });
}

function initLineReveal(scope = document) {
  return trackMotion("lines", () => {
    scope.querySelectorAll("[data-motion-lines]").forEach((element) => {
      if (!splitReveal(element, "lines")) {
        gsapInstance().fromTo(element,
          { autoAlpha: 0, y: 18 },
          { autoAlpha: 1, y: 0, duration: 0.7, ease: "power2.out", scrollTrigger: revealTrigger(element) },
        );
      }
    });
  });
}

function initMediaReveal(scope = document) {
  return trackMotion("media", () => {
    const gsap = gsapInstance();
    scope.querySelectorAll("[data-motion-media]").forEach((element) => {
      const media = element.matches("img,video") ? element : element.querySelector("img,video");
      const reveal = gsap.timeline({ scrollTrigger: revealTrigger(element) });
      reveal.fromTo(element,
        { clipPath: "inset(0 0 100% 0)" },
        {
          clipPath: "inset(0 0 0% 0)",
          duration: 0.9,
          ease: "power3.inOut",
        },
      );
      if (media) {
        reveal.fromTo(media,
          { scale: 1.08 },
          { scale: 1, duration: 1.1, ease: "power2.out" },
          0,
        );
      }
    });
  });
}

function initParallax(scope = document) {
  return trackMotion("parallax", () => {
    const gsap = gsapInstance();
    scope.querySelectorAll("[data-motion-parallax]").forEach((element) => {
      const amount = Number.parseFloat(element.dataset.motionParallax) * runtime.parallaxScale;
      if (!Number.isFinite(amount) || amount === 0) return;

      gsap.fromTo(element,
        { yPercent: amount * -50 },
        {
          yPercent: amount * 50,
          ease: "none",
          scrollTrigger: {
            trigger: element,
            start: "top bottom",
            end: "bottom top",
            scrub: true,
          },
        },
      );
    });
  });
}

function clearAnimationContext() {
  runtime.context?.revert();
  runtime.context = null;
  runtime.splits.forEach((split) => split.revert());
  runtime.splits = [];
  destroySmoothScroll();
}

function initMotion() {
  if (runtime.initialized || !gsapInstance() || !scrollTrigger()) return false;

  const gsap = gsapInstance();
  gsap.registerPlugin(window.ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(window.SplitText);
  runtime.initialized = true;
  initScrollTrigger();

  runtime.matchMedia = gsap.matchMedia();
  runtime.matchMedia.add({
    reduce: "(prefers-reduced-motion: reduce)",
    mobile: "(max-width: 600px)",
    tablet: "(min-width: 601px) and (max-width: 1024px)",
  }, ({ conditions }) => {
    if (conditions.reduce) return;
    runtime.isMobile = conditions.mobile;
    runtime.motionDistance = conditions.mobile ? 12 : conditions.tablet ? 18 : 24;
    runtime.parallaxScale = conditions.mobile ? 0.45 : conditions.tablet ? 0.75 : 1;
    runtime.context = gsap.context(() => {
      initTextReveal();
      initLineReveal();
      initFadeReveal();
      initMediaReveal();
      initParallax();
    }, document.body);
    syncSmoothScroll();
    return () => {
      clearAnimationContext();
      runtime.isMobile = false;
      runtime.motionDistance = 24;
      runtime.parallaxScale = 1;
    };
  });

  refreshMotion();
  return true;
}

function destroyMotion() {
  if (!runtime.initialized) return;
  runtime.matchMedia?.revert();
  runtime.matchMedia = null;
  clearAnimationContext();
  runtime.listeners.splice(0).forEach((remove) => remove());
  runtime.scrollLifecycleReady = false;
  window.clearTimeout(runtime.refreshTimer);
  window.clearTimeout(runtime.resizeTimer);
  runtime.refreshTimer = 0;
  runtime.resizeTimer = 0;
  runtime.initialized = false;
}

export {
  destroyMotion,
  initFadeReveal,
  initLineReveal,
  initMediaReveal,
  initMotion,
  initParallax,
  initScrollTrigger,
  initSmoothScroll,
  initTextReveal,
  refreshMotion,
};
