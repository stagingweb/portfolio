import { refreshMotion } from "../../main/js/motion.min.js";

const heroMotion = {
  initialized: false,
  loading: false,
  sphereReady: false,
  matchMedia: null,
  pointerMedia: null,
  context: null,
  split: null,
  loaderTimeline: null,
  loaderTimeout: 0,
  loadToken: 0,
};

function createHeroTimeline(targets, lines, conditions) {
  const gsap = window.gsap;
  const mobile = conditions.mobile;
  const travel = mobile ? 102 : conditions.tablet ? 108 : 115;
  const introItems = targets.intro
    ? Array.from(targets.intro.children).filter((element) =>
        element.matches("p, .hero-cta"),
      )
    : [];
  const timeline = gsap.timeline();

  if (targets.header) {
    timeline.fromTo(targets.header,
      { autoAlpha: 0, y: -6 },
      {
        autoAlpha: 1,
        y: 0,
        duration: mobile ? 0.55 : 0.68,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
      },
      0,
    );
  }

  if (targets.floor) {
    timeline.fromTo(targets.floor,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: mobile ? 0.8 : 1.15, ease: "power2.out" },
      0,
    );
  }

  if (targets.sphere && !heroMotion.sphereReady) {
    timeline.fromTo(targets.sphere,
      { autoAlpha: 0, scale: mobile ? 0.96 : 0.92, y: mobile ? 8 : 14 },
      { autoAlpha: 1, scale: 1, y: 0, duration: mobile ? 1.05 : 1.35, ease: "expo.out" },
      0.04,
    );
  }

  if (targets.reflection) {
    timeline.fromTo(targets.reflection,
      { autoAlpha: 0, y: -6 },
      { autoAlpha: 0.55, y: 0, duration: mobile ? 0.7 : 0.95, ease: "power2.out" },
      0.32,
    );
  }

  timeline.from(lines,
    {
      yPercent: travel,
      autoAlpha: 0,
      duration: mobile ? 0.82 : 1,
      stagger: mobile ? 0.075 : 0.11,
      ease: "power4.out",
      clearProps: "opacity,visibility,transform",
    },
    0.22,
  );

  if (introItems.length) {
    timeline.fromTo(introItems,
      {
        y: mobile ? 10 : 16,
        autoAlpha: 0,
      },
      {
        y: 0,
        autoAlpha: 1,
        duration: mobile ? 0.55 : 0.68,
        stagger: mobile ? 0.055 : 0.09,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
      },
      mobile ? 0.88 : 1.02,
    );
  }

  return timeline;
}

function initHeroPointer(root, sphere, isTablet) {
  if (!sphere) return undefined;

  const gsap = window.gsap;
  const xTo = gsap.quickTo(sphere, "x", { duration: 0.7, ease: "power2.out" });
  const yTo = gsap.quickTo(sphere, "y", { duration: 0.7, ease: "power2.out" });
  const handleMove = (event) => {
    const bounds = root.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    const intensity = isTablet ? 5 : 9;
    xTo(x * intensity);
    yTo(y * intensity * 0.65);
  };
  const handleLeave = () => {
    xTo(0);
    yTo(0);
  };

  document.body.classList.add("has-pointer-motion");
  root.addEventListener("pointermove", handleMove, { passive: true });
  root.addEventListener("pointerleave", handleLeave, { passive: true });

  return () => {
    root.removeEventListener("pointermove", handleMove);
    root.removeEventListener("pointerleave", handleLeave);
    xTo.tween.kill();
    yTo.tween.kill();
    gsap.set(sphere, { x: 0, y: 0 });
    document.body.classList.remove("has-pointer-motion");
  };
}

function clearHeroMotion() {
  heroMotion.pointerMedia?.revert();
  heroMotion.pointerMedia = null;
  heroMotion.context?.revert();
  heroMotion.context = null;
  heroMotion.split?.revert();
  heroMotion.split = null;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function clearPreloaderInlineStyles() {
  const sphere = document.querySelector(".scene-sphere");
  ["opacity", "visibility", "transform", "filter", "box-shadow", "--sphere-fill-opacity", "--sphere-surface-opacity"]
    .forEach((property) => sphere?.style.removeProperty(property));
  document.querySelector(".site-loader__progress")?.style.removeProperty("transform");
}

function startHomeExperience() {
  const loader = document.querySelector(".site-loader");
  if (heroMotion.initialized || heroMotion.loading) return false;
  const loadToken = ++heroMotion.loadToken;
  heroMotion.loading = true;

  const beginHero = () => {
    if (loadToken !== heroMotion.loadToken) return;
    heroMotion.loading = false;
    window.clearTimeout(window.__homeLoaderFallback);
    document.querySelector(".scene")?.classList.remove("is-preloading");
    loader?.remove();
    document.documentElement.classList.remove("motion-pending");
    initHomeHero();
    refreshMotion();
  };

  if (!loader || !window.gsap || prefersReducedMotion() || window.__skipHomePreloader) {
    window.__skipHomePreloader = false;
    beginHero();
    return true;
  }

  const gsap = window.gsap;
  const scene = document.querySelector(".scene");
  const sphere = scene?.querySelector(".scene-sphere");
  const track = loader.querySelector(".site-loader__ring");
  const progress = loader.querySelector(".site-loader__progress");
  scene?.classList.add("is-preloading");
  const criticalAssetsReady = Promise.allSettled([
    window.siteComponentsReady || Promise.resolve(),
    document.fonts?.ready || Promise.resolve(),
  ]);
  const maximumWait = new Promise((resolve) => {
    heroMotion.loaderTimeout = window.setTimeout(resolve, 1400);
  });
  let criticalAssetsReadyState = false;
  heroMotion.loaderTimeline = gsap.timeline({
    paused: true,
    onComplete() {
      heroMotion.loaderTimeline = null;
      beginHero();
    },
  });

  if (sphere) {
    gsap.set(sphere, {
      autoAlpha: 0,
      scale: 0.9,
      filter: "brightness(0.12) saturate(0)",
      "--sphere-fill-opacity": 0,
      "--sphere-surface-opacity": 0,
    });
  }

  if (track && progress) {
    heroMotion.loaderTimeline
      .to(progress, {
        attr: { "stroke-dashoffset": 0 },
        duration: 0.9,
        ease: "power2.inOut",
      })
      .addPause(undefined, () => {
        if (criticalAssetsReadyState) heroMotion.loaderTimeline?.resume();
      })
      .to(track, {
        autoAlpha: 0,
        scale: 0.76,
        duration: 0.2,
        ease: "power2.in",
      })
  } else {
    heroMotion.loaderTimeline.addPause(undefined, () => {
      if (criticalAssetsReadyState) heroMotion.loaderTimeline?.resume();
    });
  }

  if (sphere) {
    heroMotion.loaderTimeline
      .to(sphere, {
        autoAlpha: 0.62,
        scale: 0.96,
        filter: "brightness(0.24) saturate(0)",
        boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.28), 0 0 34px 6px rgba(205, 231, 242, 0.18), 0 0 88px 18px rgba(205, 231, 242, 0.08)",
        duration: 0.34,
        ease: "power2.out",
      })
      .to(loader, { autoAlpha: 0, duration: 0.24, ease: "power1.inOut" }, "<+=0.08")
      .to(sphere, {
        autoAlpha: 1,
        scale: 1,
        filter: "brightness(1) saturate(1)",
        "--sphere-fill-opacity": 1,
        "--sphere-surface-opacity": 1,
        boxShadow: "inset -24px -26px 42px rgba(13, 16, 45, 0.3), inset 18px 16px 30px rgba(255, 255, 255, 0.34), 0 0 6px rgba(255, 255, 255, 0.92), 0 0 32px rgba(201, 240, 255, 0.18)",
        duration: 0.62,
        ease: "power3.out",
        onComplete() {
          if (loadToken === heroMotion.loadToken) {
            clearPreloaderInlineStyles();
            heroMotion.sphereReady = true;
          }
        },
      }, ">+=0.14");
  } else {
    heroMotion.loaderTimeline.to(loader, { autoAlpha: 0, duration: 0.2, ease: "power1.inOut" });
  }

  /*
   * The loader owns the reveal until it reaches 100%; the scene is lowered only
   * in beginHero(), after the sphere has finished morphing into its home state.
   */
  heroMotion.loaderTimeline.play(0);

  Promise.race([criticalAssetsReady, maximumWait]).then(() => {
    window.clearTimeout(heroMotion.loaderTimeout);
    heroMotion.loaderTimeout = 0;
    if (loadToken !== heroMotion.loadToken) return;
    if (!loader.isConnected) {
      heroMotion.loaderTimeline?.kill();
      heroMotion.loaderTimeline = null;
      beginHero();
      return;
    }
    criticalAssetsReadyState = true;
    if (heroMotion.loaderTimeline?.paused()) heroMotion.loaderTimeline.resume();
  });

  return true;
}

function initHomeHero() {
  if (heroMotion.initialized) return false;
  if (!window.gsap) {
    document.documentElement.classList.remove("motion-pending");
    return false;
  }

  heroMotion.initialized = true;
  const gsap = window.gsap;
  const SplitText = window.SplitText;
  if (SplitText) gsap.registerPlugin(SplitText);

  heroMotion.matchMedia = gsap.matchMedia();
  heroMotion.matchMedia.add({
    reduce: "(prefers-reduced-motion: reduce)",
    mobile: "(max-width: 600px)",
    tablet: "(min-width: 601px) and (max-width: 1024px)",
    pointer: "(hover: hover) and (pointer: fine)",
  }, ({ conditions }) => {
    const root = document.querySelector(".hero");
    if (conditions.reduce || !root) {
      document.documentElement.classList.remove("motion-pending");
      return;
    }

    const targets = {
      header: document.querySelector(".site-header"),
      floor: document.querySelector(".scene-floor"),
      sphere: document.querySelector(".scene-sphere"),
      reflection: document.querySelector(".scene-reflection"),
      title: root.querySelector(".hero-title"),
      intro: root.querySelector(".hero-intro"),
    };

    heroMotion.context = gsap.context(() => {
      if (targets.title && SplitText) {
        heroMotion.split = SplitText.create(targets.title, {
          type: "lines",
          mask: "lines",
          deepSlice: true,
          autoSplit: true,
          aria: "auto",
          onSplit(self) {
            return createHeroTimeline(targets, self.lines, conditions);
          },
        });
      } else {
        const lines = targets.title ? [targets.title] : [];
        createHeroTimeline(targets, lines, conditions);
      }
    }, root);

    if (conditions.pointer) {
      heroMotion.pointerMedia = gsap.matchMedia();
      heroMotion.pointerMedia.add("(hover: hover) and (pointer: fine)", () =>
        initHeroPointer(root, targets.sphere, conditions.tablet),
      );
    }

    document.documentElement.classList.remove("motion-pending");
    return clearHeroMotion;
  });

  return true;
}

function destroyHomeHero() {
  heroMotion.loadToken += 1;
  heroMotion.loading = false;
  heroMotion.sphereReady = false;
  window.clearTimeout(heroMotion.loaderTimeout);
  heroMotion.loaderTimeout = 0;
  window.clearTimeout(window.__homeLoaderFallback);
  document.querySelector(".scene")?.classList.remove("is-preloading");
  heroMotion.loaderTimeline?.kill();
  heroMotion.loaderTimeline = null;
  document.querySelector(".site-loader")?.remove();
  document.documentElement.classList.remove("motion-pending");
  if (heroMotion.initialized) {
    heroMotion.matchMedia?.revert();
    heroMotion.matchMedia = null;
    clearHeroMotion();
    heroMotion.initialized = false;
  }
  clearPreloaderInlineStyles();
}

export { destroyHomeHero, initHomeHero, startHomeExperience };
