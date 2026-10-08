import * as THREE from "three";
import GeoJsonGeometry from "three-geojson-geometry";
import { geoGraticule10 } from "d3-geo";
import { mesh } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";

"use strict";

// One full-bleed WebGL canvas paints the backdrop, floor shadow, and both sides of the globe.
const globeRuntime = {
  container: null,
  renderer: null,
  scene: null,
  camera: null,
  globe: null,
  rim: null,
  background: null,
  strokeMaterials: [],
  visual: null,
  draw: null,
  baseRadius: 0,
  heroCenterX: 0,
  heroCenterY: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  control: null,
  cleanupControl: null,
  scrollHandler: null,
  observer: null,
  resizeObserver: null,
  frame: 0,
  lastTime: 0,
  inView: true,
  visibilityHandler: null,
  dragging: false,
  lastInteraction: 0,
};
function makeGlobeStrokeMaterial(color, frontOpacity, backOpacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uFrontOpacity: { value: frontOpacity },
      uBackOpacity: { value: backOpacity },
      uReveal: { value: 0 },
    },
    vertexShader: `
      varying float vFacing;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vFacing = dot(normalize(normalMatrix * position), normalize(-viewPosition.xyz));
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uFrontOpacity;
      uniform float uBackOpacity;
      uniform float uReveal;
      varying float vFacing;
      void main() {
        float facing = smoothstep(-0.16, 0.22, vFacing);
        float alpha = mix(uBackOpacity, uFrontOpacity, facing) * uReveal;
        gl_FragColor = vec4(uColor, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

function geoToGlobePosition(latitude, longitude, radius) {
  const phi = THREE.MathUtils.degToRad(90 - latitude);
  const theta = THREE.MathUtils.degToRad(90 - longitude);
  return new THREE.Vector3(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function makeHeroBackground() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFloorCenter: { value: new THREE.Vector2(0, 0) },
      uFloorRadius: { value: 1 },
      uGlobeCenter: { value: new THREE.Vector2(0, 0) },
      uGlobeRadius: { value: 1 },
      uReveal: { value: 0 },
    },
    vertexShader: `
      void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec2 uResolution;
      uniform vec2 uFloorCenter;
      uniform float uFloorRadius;
      uniform vec2 uGlobeCenter;
      uniform float uGlobeRadius;
      uniform float uReveal;
      void main() {
        vec2 p = gl_FragCoord.xy;
        float radius = max(uFloorRadius, 1.0);
        float globeBottom = uFloorCenter.y - radius;
        float floorMask = 1.0 - smoothstep(
          globeBottom - radius * 0.08,
          globeBottom + radius * 0.10,
          p.y
        );
        float floorLight = exp(-pow((p.x - uFloorCenter.x) / (radius * 2.0), 2.0) * 1.8)
          * exp(-pow((p.y - (globeBottom - radius * 0.42)) / (radius * 0.95), 2.0) * 1.7);
        float sideLight = exp(-pow((p.x - (uFloorCenter.x - radius * 1.65)) / (radius * 0.86), 2.0) * 1.8)
          + exp(-pow((p.x - (uFloorCenter.x + radius * 1.65)) / (radius * 0.86), 2.0) * 1.8);
        sideLight *= exp(-pow((p.y - (globeBottom - radius * 0.32)) / (radius * 0.75), 2.0));
        vec3 color = vec3(0.001, 0.002, 0.003);
        color += floorMask * (vec3(0.020, 0.030, 0.029) * floorLight
          + vec3(0.010, 0.016, 0.015) * sideLight);

        vec2 shadow = (p - vec2(uFloorCenter.x, uFloorCenter.y - uFloorRadius * 1.08))
          / vec2(uFloorRadius * 1.05, uFloorRadius * 0.22);
        float shadowShape = exp(-dot(shadow, shadow) * 2.3) * uReveal;
        color *= 1.0 - shadowShape * 0.84;

        vec2 reflection = (p - vec2(uGlobeCenter.x, uGlobeCenter.y - uGlobeRadius * 1.12))
          / vec2(uGlobeRadius * 0.48, uGlobeRadius * 0.13);
        float reflectionShape = exp(-dot(reflection, reflection) * 2.3) * uReveal;
        color += vec3(0.012, 0.031, 0.105) * reflectionShape;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  background.frustumCulled = false;
  background.renderOrder = -1;
  return background;
}

function initHeroGlobe() {
  if (globeRuntime.renderer) return true;
  const container = document.querySelector(".scene");
  const control = document.querySelector(".hero-globe-control");
  if (!container) return false;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: "low-power" });
  } catch (error) {
    console.warn("The canvas scene could not start; showing the black fallback instead.", error);
    return false;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
  camera.position.z = 1000;
  const background = makeHeroBackground();
  scene.add(background);

  const globe = new THREE.Group();
  globe.rotation.set(0.08, -1.45, 0);
  const gridMaterial = makeGlobeStrokeMaterial(0x7a84a0, 0.09, 0.04);
  const borderMaterial = makeGlobeStrokeMaterial(0x3859ff, 0.88, 0.36);
  globe.add(new THREE.LineSegments(
    new GeoJsonGeometry(geoGraticule10(), 1.0, 5), gridMaterial,
  ));
  globe.add(new THREE.LineSegments(
    new GeoJsonGeometry(mesh(worldAtlas, worldAtlas.objects.countries), 1.002, 3), borderMaterial,
  ));
  const vietnamMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4050, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
  );
  // Ho Chi Minh City (latitude, longitude).
  vietnamMarker.position.copy(geoToGlobePosition(10.8231, 106.6297, 1.014));
  vietnamMarker.renderOrder = 2;
  globe.add(vietnamMarker);
  scene.add(globe);

  const rimPoints = Array.from({ length: 129 }, (_, index) => {
    const angle = (index / 128) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
  });
  const rim = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(rimPoints),
    new THREE.LineBasicMaterial({ color: 0x2439a0, transparent: true, opacity: 0, depthTest: false }),
  );
  scene.add(rim);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.appendChild(renderer.domElement);
  container.classList.add("is-webgl-ready");
  if (control) control.hidden = false;

  const visual = { reveal: 0, scale: 0.92 };
  const markerFacingPosition = new THREE.Vector3();
  const projectSection = document.querySelector(".work-showcase");
  const serviceSection = document.querySelector(".services-section");
  const easedProgress = (value) => {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };
  const draw = () => {
    const { viewportWidth: width, viewportHeight: height } = globeRuntime;
    if (!width || !height) return;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const sectionTop = (element) => element ? element.getBoundingClientRect().top + scrollY : Infinity;
    const projectTop = sectionTop(projectSection);
    const serviceTop = sectionTop(serviceSection);
    const projectStart = Math.max(0, projectTop - height * 0.75);
    const projectEnd = projectTop + height * 0.05;
    const projectProgress = easedProgress((scrollY - projectStart) / Math.max(projectEnd - projectStart, 1));
    const serviceStart = Math.max(projectEnd, serviceTop - height * 0.65);
    const serviceEnd = Math.max(serviceStart + 1, serviceTop + height * 0.05);
    const serviceProgress = easedProgress((scrollY - serviceStart) / (serviceEnd - serviceStart));

    const heroX = globeRuntime.heroCenterX;
    const heroY = globeRuntime.heroCenterY;
    const projectX = THREE.MathUtils.lerp(heroX, width, projectProgress);
    const projectY = THREE.MathUtils.lerp(heroY, height * 0.42, projectProgress);
    const projectRadius = THREE.MathUtils.lerp(globeRuntime.baseRadius, globeRuntime.baseRadius * 1.5, projectProgress);
    const centerX = THREE.MathUtils.lerp(projectX, 0, serviceProgress);
    const centerY = THREE.MathUtils.lerp(projectY, height * 0.5, serviceProgress);
    const radius = projectRadius * visual.scale;
    globe.position.set(centerX - width / 2, height / 2 - centerY, 0);
    rim.position.copy(globe.position);
    globe.scale.setScalar(radius);
    rim.scale.setScalar(radius);
    gridMaterial.uniforms.uReveal.value = visual.reveal;
    borderMaterial.uniforms.uReveal.value = visual.reveal;
    rim.material.opacity = visual.reveal * 0.18;
    vietnamMarker.material.opacity = visual.reveal;
    markerFacingPosition.copy(vietnamMarker.position).applyEuler(globe.rotation);
    vietnamMarker.visible = markerFacingPosition.z > 0.05;
    background.material.uniforms.uReveal.value = visual.reveal;
    const uniforms = background.material.uniforms;
    const pixelRatio = renderer.getPixelRatio();
    uniforms.uGlobeCenter.value.set(centerX * pixelRatio, (height - centerY) * pixelRatio);
    uniforms.uGlobeRadius.value = radius * pixelRatio;
    renderer.render(scene, camera);
  };

  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();

    const globeBounds = control?.getBoundingClientRect();
    const centerX = globeBounds?.width ? globeBounds.left + globeBounds.width / 2 : width / 2;
    const centerY = globeBounds?.height ? globeBounds.top + globeBounds.height / 2 + window.scrollY : height / 2;
    const radius = globeBounds?.width ? globeBounds.width / 2 : Math.min(width, height) * 0.26;
    globeRuntime.baseRadius = radius;
    globeRuntime.heroCenterX = centerX;
    globeRuntime.heroCenterY = centerY;
    globeRuntime.viewportWidth = width;
    globeRuntime.viewportHeight = height;

    const pixelRatio = renderer.getPixelRatio();
    const uniforms = background.material.uniforms;
    uniforms.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    uniforms.uFloorCenter.value.set(centerX * pixelRatio, (height - centerY) * pixelRatio);
    uniforms.uFloorRadius.value = radius * pixelRatio;
    draw();
  };
  const stop = () => {
    window.cancelAnimationFrame(globeRuntime.frame);
    globeRuntime.frame = 0;
    globeRuntime.lastTime = 0;
  };
  const render = (time) => {
    globeRuntime.frame = window.requestAnimationFrame(render);
    if (globeRuntime.lastTime && !globeRuntime.dragging && time - globeRuntime.lastInteraction > 1800) {
      globe.rotation.y += Math.min(time - globeRuntime.lastTime, 50) * 0.00006;
    }
    globeRuntime.lastTime = time;
    draw();
  };
  const syncAnimation = () => {
    if (document.hidden || !globeRuntime.inView || prefersReducedMotion()) {
      stop();
      return;
    }
    if (!globeRuntime.frame) globeRuntime.frame = window.requestAnimationFrame(render);
  };

  globeRuntime.container = container;
  globeRuntime.renderer = renderer;
  globeRuntime.scene = scene;
  globeRuntime.camera = camera;
  globeRuntime.globe = globe;
  globeRuntime.rim = rim;
  globeRuntime.background = background;
  globeRuntime.strokeMaterials = [gridMaterial, borderMaterial];
  globeRuntime.visual = visual;
  globeRuntime.draw = draw;
  globeRuntime.visibilityHandler = syncAnimation;
  globeRuntime.scrollHandler = draw;
  window.addEventListener("scroll", draw, { passive: true });

  if (control) {
    let activePointer = null;
    let lastX = 0;
    let lastY = 0;
    const endDrag = (event) => {
      if (event?.pointerId != null && event.pointerId !== activePointer) return;
      if (activePointer != null && control.hasPointerCapture(activePointer)) {
        control.releasePointerCapture(activePointer);
      }
      activePointer = null;
      globeRuntime.dragging = false;
      globeRuntime.lastInteraction = window.performance.now();
      control.classList.remove("is-dragging");
    };
    const onPointerDown = (event) => {
      if (activePointer != null) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      activePointer = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      globeRuntime.dragging = true;
      control.classList.add("is-dragging");
      control.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event) => {
      if (event.pointerId !== activePointer) return;
      globe.rotation.y += (event.clientX - lastX) * 0.007;
      globe.rotation.x = THREE.MathUtils.clamp(
        globe.rotation.x + (event.clientY - lastY) * 0.007,
        -1.25,
        1.25,
      );
      lastX = event.clientX;
      lastY = event.clientY;
      globeRuntime.lastInteraction = window.performance.now();
      draw();
    };
    const onKeyDown = (event) => {
      const rotation = {
        ArrowLeft: [0, -0.12], ArrowRight: [0, 0.12],
        ArrowUp: [-0.12, 0], ArrowDown: [0.12, 0],
      }[event.key];
      if (!rotation) return;
      event.preventDefault();
      globe.rotation.x = THREE.MathUtils.clamp(globe.rotation.x + rotation[0], -1.25, 1.25);
      globe.rotation.y += rotation[1];
      globeRuntime.lastInteraction = window.performance.now();
      draw();
    };

    control.addEventListener("pointerdown", onPointerDown);
    control.addEventListener("pointermove", onPointerMove);
    control.addEventListener("pointerup", endDrag);
    control.addEventListener("pointercancel", endDrag);
    control.addEventListener("lostpointercapture", endDrag);
    control.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", endDrag);
    globeRuntime.control = control;
    globeRuntime.cleanupControl = () => {
      control.removeEventListener("pointerdown", onPointerDown);
      control.removeEventListener("pointermove", onPointerMove);
      control.removeEventListener("pointerup", endDrag);
      control.removeEventListener("pointercancel", endDrag);
      control.removeEventListener("lostpointercapture", endDrag);
      control.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", endDrag);
      control.classList.remove("is-dragging");
      control.hidden = true;
    };
  }

  document.addEventListener("visibilitychange", syncAnimation);
  if (window.ResizeObserver) {
    globeRuntime.resizeObserver = new ResizeObserver(resize);
    globeRuntime.resizeObserver.observe(container);
  } else {
    window.addEventListener("resize", resize);
    globeRuntime.resizeObserver = { disconnect: () => window.removeEventListener("resize", resize) };
  }
  if (window.IntersectionObserver) {
    globeRuntime.observer = new IntersectionObserver(([entry]) => {
      globeRuntime.inView = entry.isIntersecting;
      syncAnimation();
    });
    globeRuntime.observer.observe(container);
  }
  resize();
  syncAnimation();
  return true;
}

function destroyHeroGlobe() {
  if (!globeRuntime.renderer) return;
  window.cancelAnimationFrame(globeRuntime.frame);
  globeRuntime.cleanupControl?.();
  globeRuntime.observer?.disconnect();
  globeRuntime.resizeObserver?.disconnect();
  document.removeEventListener("visibilitychange", globeRuntime.visibilityHandler);
  window.removeEventListener("scroll", globeRuntime.scrollHandler);
  globeRuntime.scene.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  globeRuntime.renderer.dispose();
  globeRuntime.renderer.forceContextLoss();
  globeRuntime.renderer.domElement.remove();
  globeRuntime.container.classList.remove("is-webgl-ready");
  Object.assign(globeRuntime, {
    container: null, renderer: null, scene: null, camera: null, globe: null,
    rim: null, background: null, strokeMaterials: [], visual: null, draw: null,
    baseRadius: 0, heroCenterX: 0, heroCenterY: 0, viewportWidth: 0, viewportHeight: 0,
    control: null, cleanupControl: null, scrollHandler: null,
    observer: null, resizeObserver: null, frame: 0, lastTime: 0,
    inView: true, visibilityHandler: null, dragging: false, lastInteraction: 0,
  });
}

// Shared UI
function customDropdown() {
  const dropdowns = document.querySelectorAll(
    ".dropdown-custom, .dropdown-custom-select",
  );
  if (!dropdowns.length) return;
  dropdowns.forEach((dropdown) => {
    const btnDropdown = dropdown.querySelector(".dropdown-custom-btn");
    const dropdownMenu = dropdown.querySelector(".dropdown-custom-menu");
    const dropdownItems = dropdown.querySelectorAll(".dropdown-custom-item");
    const valueSelect = dropdown.querySelector(".value-select");
    const displayText = dropdown.querySelector(".dropdown-custom-text");

    const isSelectType = dropdown.classList.contains("dropdown-custom-select");

    btnDropdown.addEventListener("click", function (e) {
      e.stopPropagation();
      closeAllDropdowns(dropdown);
      dropdownMenu.classList.toggle("dropdown--active");
      btnDropdown.classList.toggle("--active");
    });

    document.addEventListener("click", function () {
      closeAllDropdowns();
    });

    dropdownItems.forEach((item) => {
      item.addEventListener("click", function (e) {
        e.stopPropagation();

        if (isSelectType) {
          const optionText = item.textContent;
          displayText.textContent = optionText;
          dropdown.classList.add("selected");
        } else {
          const currentImgEl = valueSelect.querySelector("img");
          const currentImg = currentImgEl ? currentImgEl.src : "";
          const currentText = valueSelect.querySelector("span").textContent;
          const clickedHtml = item.innerHTML;

          valueSelect.innerHTML = clickedHtml;

          const isSelectTime = currentText.trim() === "Time";

          if (!isSelectTime) {
            if (currentImg) {
              item.innerHTML = `<span>${currentText}</span><img src="${currentImg}" alt="" />`;
            } else {
              item.innerHTML = `<span>${currentText}</span>`;
            }
          }
        }

        closeAllDropdowns();
      });
    });

    window.addEventListener("scroll", function () {
      if (dropdownMenu.closest(".header-lang")) {
        dropdownMenu.classList.remove("dropdown--active");
        btnDropdown.classList.remove("--active");
      }
    });
  });

  function closeAllDropdowns(exception) {
    dropdowns.forEach((dropdown) => {
      const menu = dropdown.querySelector(".dropdown-custom-menu");
      const btn = dropdown.querySelector(".dropdown-custom-btn");

      if (!exception || dropdown !== exception) {
        menu.classList.remove("dropdown--active");
        btn.classList.remove("--active");
      }
    });
  }
}
function headerScroll() {
  const header = document.getElementById("header");
  if (!header) return null;

  let lastScroll = 0;

  const trigger = ScrollTrigger.create({
    start: "top top",
    end: 9999,
    onUpdate: (self) => {
      const currentScroll = self.scroll();

      if (currentScroll <= 0) {
        header.classList.remove("scrolled");
      } else if (currentScroll > lastScroll) {
        // Scroll down
        header.classList.add("scrolled");
      } else {
        // Scroll up
        header.classList.remove("scrolled");
      }

      lastScroll = currentScroll;
    },
  });

  return trigger;
}

/////// thêm class select-tab vào thì vẫn filter theo đúng type đó, không show hết item.
function createFilterTab() {
  document.querySelectorAll(".filter-section").forEach((section) => {
    let result;

    const targetSelector = section.dataset.target;
    if (targetSelector) {
      result = document.querySelector(targetSelector);
    } else {
      result = section.querySelector(".filter-section-result");
      if (!result) {
        result = section.nextElementSibling;
        if (!result?.classList.contains("filter-section-result")) return;
      }
    }

    if (!result) return;
    //check select tab
    const isSelectTab = section.classList.contains("select-tab");
    const buttons = section.querySelectorAll(".filter-button[data-type]");

    const activeBtn = section.querySelector(".filter-button.active");
    if (activeBtn) {
      const activeType = activeBtn.dataset.type;
      if (activeType !== "all") {
        result.querySelectorAll(".filter-item").forEach((item) => {
          item.style.display = item.classList.contains(activeType)
            ? ""
            : "none";
        });
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", function () {
        section
          .querySelectorAll(".filter-button")
          .forEach((b) => b.classList.remove("active"));
        this.classList.add("active");

        const type = this.dataset.type;
        const items = result.querySelectorAll(".filter-item");

        gsap
          .timeline()
          .to(result, { autoAlpha: 0, duration: 0.3 })
          .call(() => {
            items.forEach((item) => {
              // Nếu là select-tab thì không có trường hợp "all" → luôn filter theo type
              if (!isSelectTab && type === "all") {
                item.style.display = "";
              } else {
                item.style.display = item.classList.contains(type)
                  ? ""
                  : "none";
              }
            });
          })
          .to(result, { autoAlpha: 1, duration: 0.3 });
      });
    });
  });
}

function getDateLightPick() {
  var picker = new Lightpick({
    field: document.getElementById("datepicker"),
    minDate: new Date(),
    singleDate: false,
    numberOfMonths: 2,
    // lang: "en-US",
  });
}

// Scroll motion
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
    normal: "(prefers-reduced-motion: no-preference)",
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


// Hero and loader
function reserveLoaderScrollbar() {
  if (!document.documentElement.classList.contains("motion-pending")) return;
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden";
  document.body.appendChild(probe);
  const width = Math.max(0, probe.offsetWidth - probe.clientWidth);
  probe.remove();
  document.documentElement.style.setProperty("--loader-scrollbar-width", `${width}px`);
  document.documentElement.style.setProperty("--loader-scrollbar-half-width", `${width / 2}px`);
}

const heroMotion = {
  initialized: false,
  loading: false,
  matchMedia: null,
  context: null,
  heroTimeline: null,
  revealFrame: 0,
  visibilityHandler: null,
  loaderTimeline: null,
  loaderTimeout: 0,
  loadToken: 0,
  globeRevealedByLoader: false,
};

function createHeroTimeline(targets, creativeStrokes, conditions) {
  const gsap = window.gsap;
  const mobile = conditions.mobile;
  const writeStart = 0.22;
  const writeDuration = 2;
  const strokeLengths = creativeStrokes.map((stroke) => stroke.getTotalLength());
  const totalStrokeLength = strokeLengths.reduce((sum, length) => sum + length, 0);
  const minimumStrokeDuration = strokeLengths.length
    ? Math.min(0.06, writeDuration / strokeLengths.length)
    : 0;
  let developerStart = writeStart;
  const introItems = targets.intro
    ? Array.from(targets.intro.children).filter((element) =>
        element.matches("p, .hero-cta"),
      )
    : [];
  const timeline = gsap.timeline({ paused: true });

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

  if (globeRuntime.visual && !heroMotion.globeRevealedByLoader) {
    timeline.fromTo(globeRuntime.visual,
      { reveal: 0, scale: mobile ? 0.96 : 0.92 },
      {
        reveal: 1,
        scale: 1,
        duration: mobile ? 1.05 : 1.35,
        ease: "expo.out",
        onUpdate: () => globeRuntime.draw?.(),
      },
      0.04,
    );
  }

  creativeStrokes.forEach((stroke, index) => {
    const length = strokeLengths[index];
    const duration = totalStrokeLength
      ? minimumStrokeDuration + (length / totalStrokeLength)
        * (writeDuration - (minimumStrokeDuration * strokeLengths.length))
      : writeDuration / strokeLengths.length;
    gsap.set(stroke, { autoAlpha: 0, strokeDasharray: length, strokeDashoffset: length });
    timeline.set(stroke, { autoAlpha: 1 }, developerStart);
    timeline.to(stroke,
      {
        strokeDashoffset: 0,
        duration,
        ease: "none",
        clearProps: "stroke-dasharray,stroke-dashoffset",
      },
      developerStart,
    );
    developerStart += duration;
  });
  developerStart += mobile ? 0.08 : 0.12;

  if (targets.developer) {
    gsap.set(targets.developer, { autoAlpha: 0 });
    timeline.to(targets.developer,
      {
        autoAlpha: 1,
        duration: mobile ? 0.58 : 0.72,
        ease: "power2.out",
        clearProps: "opacity,visibility",
      },
      developerStart,
    );
  }

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
      developerStart + (mobile ? 0.38 : 0.48),
    );
  }

  return timeline;
}

function clearHeroMotion() {
  window.cancelAnimationFrame(heroMotion.revealFrame);
  heroMotion.revealFrame = 0;
  if (heroMotion.visibilityHandler) {
    document.removeEventListener("visibilitychange", heroMotion.visibilityHandler);
    heroMotion.visibilityHandler = null;
  }
  heroMotion.context?.revert();
  heroMotion.context = null;
  heroMotion.heroTimeline = null;
}

function scheduleHeroReveal() {
  const playWhenVisible = () => {
    if (document.hidden) return;
    document.removeEventListener("visibilitychange", playWhenVisible);
    heroMotion.visibilityHandler = null;
    // Let the loader-free banner paint before drawing the first SVG stroke.
    heroMotion.revealFrame = window.requestAnimationFrame(() => {
      heroMotion.revealFrame = window.requestAnimationFrame(() => {
        heroMotion.revealFrame = 0;
        heroMotion.heroTimeline?.play(0);
      });
    });
  };

  heroMotion.visibilityHandler = playWhenVisible;
  document.addEventListener("visibilitychange", playWhenVisible);
  playWhenVisible();
}

function prefersReducedHeroMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function clearPreloaderInlineStyles() {
  document.querySelector(".site-loader__progress")?.style.removeProperty("transform");
}

function startHomeExperience() {
  const loader = document.querySelector(".site-loader");
  if (heroMotion.initialized || heroMotion.loading) return false;
  const loadToken = ++heroMotion.loadToken;
  heroMotion.loading = true;
  heroMotion.globeRevealedByLoader = false;

  const beginHero = () => {
    if (loadToken !== heroMotion.loadToken) return;
    heroMotion.loading = false;
    window.clearTimeout(window.__homeLoaderFallback);
    loader?.remove();
    initHomeHero();
    if (heroMotion.globeRevealedByLoader && globeRuntime.visual) {
      globeRuntime.visual.reveal = 1;
      globeRuntime.visual.scale = 1;
      globeRuntime.draw?.();
      window.requestAnimationFrame(() => globeRuntime.draw?.());
    }
    refreshMotion();
  };

  if (!loader || !window.gsap || prefersReducedHeroMotion() || window.__skipHomePreloader) {
    window.__skipHomePreloader = false;
    beginHero();
    return true;
  }

  const gsap = window.gsap;
  const ring = loader.querySelector(".site-loader__ring");
  const progress = loader.querySelector(".site-loader__progress");
  const glow = loader.querySelector(".site-loader__glow");
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

  if (ring && progress && glow) {
    // A non-scaling 1px stroke uses rendered pixels for its dash pattern.
    const circumference = ring.getBoundingClientRect().width * Math.PI * 0.99;
    progress.setAttribute("stroke-dasharray", `${circumference} ${circumference}`);
    progress.setAttribute("stroke-dashoffset", `${circumference}`);
    heroMotion.loaderTimeline
      .to(progress, {
        attr: { "stroke-dashoffset": circumference * 0.75 },
        duration: 0.6,
        ease: "none",
      })
      .to(progress, {
        attr: { "stroke-dashoffset": circumference * 0.5 },
        duration: 0.6,
        ease: "none",
      }, "+=0.3")
      .to(progress, {
        attr: { "stroke-dashoffset": 0 },
        duration: 1.2,
        ease: "none",
      }, "+=0.3")
      .addPause(undefined, () => {
        if (criticalAssetsReadyState) heroMotion.loaderTimeline?.resume();
      })
      .addLabel("sphereReveal")
      .call(() => {
        if (!globeRuntime.visual) return;
        globeRuntime.visual.scale = 1;
        globeRuntime.draw?.();
        heroMotion.globeRevealedByLoader = true;
      }, undefined, "sphereReveal")
      .to(progress, {
        stroke: "rgba(210, 215, 220, 0.32)",
        duration: 0.32,
        ease: "power1.out",
      }, "sphereReveal")
      .to(glow, {
        opacity: 1,
        boxShadow: "0 0 42px 16px rgba(230, 233, 236, 0.13), 0 0 100px 34px rgba(216, 221, 226, 0.045), inset 0 0 44px 15px rgba(232, 235, 238, 0.07)",
        duration: 0.42,
        ease: "power2.out",
      }, "sphereReveal")
      .to(loader, {
        backgroundColor: "rgba(0, 0, 0, 0)",
        duration: 0.56,
        ease: "power2.out",
      }, "sphereReveal+=0.42");

    if (globeRuntime.visual) {
      heroMotion.loaderTimeline.to(globeRuntime.visual, {
        reveal: 1,
        duration: 0.68,
        ease: "power2.out",
        onUpdate: () => globeRuntime.draw?.(),
      }, "sphereReveal+=0.42");
    }

    heroMotion.loaderTimeline
      .to(progress, {
        opacity: 0,
        duration: 0.42,
        ease: "power2.inOut",
      }, "sphereReveal+=0.78")
      .to(glow, {
        opacity: 0,
        scale: 1.08,
        boxShadow: "0 0 55px 21px rgba(230, 233, 236, 0.025), 0 0 120px 44px rgba(216, 221, 226, 0.01), inset 0 0 55px 18px rgba(232, 235, 238, 0.015)",
        duration: 0.55,
        ease: "power2.out",
      }, "sphereReveal+=0.82");
  } else {
    heroMotion.loaderTimeline.addPause(undefined, () => {
      if (criticalAssetsReadyState) heroMotion.loaderTimeline?.resume();
    });
  }

  heroMotion.loaderTimeline.to(loader, { autoAlpha: 0, duration: 0.16, ease: "power1.inOut" });

  // The handwriting and canvas globe start after the loader is removed.
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
    if (globeRuntime.visual) {
      globeRuntime.visual.reveal = 1;
      globeRuntime.visual.scale = 1;
      globeRuntime.draw?.();
    }
    document.documentElement.classList.remove("motion-pending");
    return false;
  }

  heroMotion.initialized = true;
  const gsap = window.gsap;
  heroMotion.matchMedia = gsap.matchMedia();
  heroMotion.matchMedia.add({
    reduce: "(prefers-reduced-motion: reduce)",
    normal: "(prefers-reduced-motion: no-preference)",
  }, ({ conditions: { reduce } }) => {
    const conditions = {
      reduce,
      mobile: window.matchMedia("(max-width: 600px)").matches,
    };
    const root = document.querySelector(".hero");
    if (conditions.reduce || !root) {
      if (globeRuntime.visual) {
        globeRuntime.visual.reveal = 1;
        globeRuntime.visual.scale = 1;
        globeRuntime.draw?.();
      }
      document.documentElement.classList.remove("motion-pending");
      return;
    }

    const targets = {
      header: document.querySelector(".site-header"),
      creativeStrokes: Array.from(root.querySelectorAll(".hero-title__ink path")),
      developer: root.querySelector(".hero-title__line--display"),
      intro: root.querySelector(".hero-intro"),
    };

    heroMotion.context = gsap.context(() => {
      heroMotion.heroTimeline = createHeroTimeline(targets, targets.creativeStrokes, conditions);
    }, root);

    document.documentElement.classList.remove("motion-pending");
    scheduleHeroReveal();
    return clearHeroMotion;
  });

  return true;
}

function destroyHomeHero() {
  heroMotion.loadToken += 1;
  heroMotion.loading = false;
  window.clearTimeout(heroMotion.loaderTimeout);
  heroMotion.loaderTimeout = 0;
  window.clearTimeout(window.__homeLoaderFallback);
  heroMotion.loaderTimeline?.kill();
  heroMotion.loaderTimeline = null;
  heroMotion.globeRevealedByLoader = false;
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


// Page setup
let projectSwiper = null;
let sectionVisibilityObserver = null;
let sectionNavigationCleanup = null;

function initParallaxSwiper(swiperEl, options = {}) {
  const interleaveOffset = Number.isFinite(options.interleaveOffset)
    ? options.interleaveOffset
    : 0.85;
  const swiperOptions = { ...options };
  delete swiperOptions.interleaveOffset;

  return new Swiper(swiperEl, {
    slidesPerView: 1,
    loop: false,
    speed: 1000,
    watchSlidesProgress: true,
    grabCursor: true,
    ...swiperOptions,
    on: {
      progress(swiper) {
        swiper.slides.forEach((slide) => {
          const slideProgress = slide.progress || 0;
          const innerOffset = swiper.width * interleaveOffset;
          const innerTranslate = slideProgress * innerOffset;

          if (!isNaN(innerTranslate)) {
            const image = slide.querySelector(".image");
            if (image) {
              image.style.transform = `translate3d(${innerTranslate}px, 0, 0)`;
            }
          }
        });
      },
      touchStart(swiper) {
        swiper.slides.forEach((slide) => {
          slide.style.transition = "";
        });
      },
      setTransition(swiper, speed) {
        const easing = "cubic-bezier(0.25, 0.1, 0.25, 1)";
        swiper.slides.forEach((slide) => {
          slide.style.transition = `${speed}ms ${easing}`;
          const image = slide.querySelector(".image");
          if (image) image.style.transition = `${speed}ms ${easing}`;
        });
      },
      ...(options.on || {}),
    },
  });
}

function initSwiper() {
  const containerSwiperEl = document.querySelector(".container-swiper");
  if (!containerSwiperEl) return;

  const swiperEl = containerSwiperEl.querySelector(".swiper-el-parallax");
  if (!swiperEl || !window.Swiper) return;
  if (swiperEl.swiper) {
    projectSwiper = swiperEl.swiper;
    return projectSwiper;
  }

  projectSwiper = initParallaxSwiper(swiperEl, {
    interleaveOffset: 0.25,
    spaceBetween: 24,
    breakpoints: {
      769: { spaceBetween: 50 },
    },
    navigation: {
      nextEl: containerSwiperEl.querySelector(".swiper-button-next"),
      prevEl: containerSwiperEl.querySelector(".swiper-button-prev"),
    },
    pagination: {
      el: containerSwiperEl.querySelector(".swiper-pagination"),
      clickable: true,
    },
    keyboard: {
      enabled: true,
      onlyInViewport: true,
    },
  });

  return projectSwiper;
}

function initSectionNavigation() {
  const sections = [
    { id: "top", element: document.querySelector(".page-home"), link: document.querySelector('.site-nav__link[href="#top"]') },
    { id: "projects", element: document.querySelector(".work-showcase"), link: document.querySelector('.site-nav__link[href="#projects"]') },
    { id: "services", element: document.querySelector(".services-section"), link: document.querySelector('.site-nav__link[href="#services"]') },
  ].filter((section) => section.element && section.link);
  if (!sections.length) return;

  sectionNavigationCleanup?.();
  const listeners = [];
  const navigateTo = (section) => (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();

    const hash = `#${section.id}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
    if (prefersReducedMotion()) {
      window.scrollTo(0, section.element.getBoundingClientRect().top + window.scrollY);
      return;
    }

    // No timeout: hand the click straight to Lenis for an eased one-second scroll.
    syncSmoothScroll();
    if (runtime.lenis) {
      runtime.lenis.scrollTo(section.element, {
        duration: 1,
        easing: (progress) => 1 - Math.pow(1 - progress, 3),
      });
    } else {
      section.element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  sections.forEach((section) => {
    const handler = navigateTo(section);
    section.link.addEventListener("click", handler);
    listeners.push(() => section.link.removeEventListener("click", handler));
    if (section.id === "top") {
      const brand = document.querySelector('.brand-mark[href="#top"]');
      if (brand) {
        brand.addEventListener("click", handler);
        listeners.push(() => brand.removeEventListener("click", handler));
      }
    }
  });
  sectionNavigationCleanup = () => listeners.forEach((remove) => remove());

  if (!window.IntersectionObserver) return;

  sectionVisibilityObserver?.disconnect();
  const visibility = new Map();

  sectionVisibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => visibility.set(entry.target, entry));
    const current = sections
      .map((section) => ({ ...section, entry: visibility.get(section.element) }))
      .filter(({ entry }) => entry?.isIntersecting)
      .sort((a, b) => b.entry.intersectionRatio - a.entry.intersectionRatio)[0];
    if (!current) return;

    sections.forEach(({ link }) => {
      if (link === current.link) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    document.body.classList.toggle("is-work-visible", current.id === "projects");
    document.body.classList.toggle("is-services-visible", current.id === "services");
  }, { threshold: [0, 0.2, 0.5] });

  sections.forEach(({ element }) => sectionVisibilityObserver.observe(element));
}

function destroyProjects() {
  sectionNavigationCleanup?.();
  sectionNavigationCleanup = null;
  sectionVisibilityObserver?.disconnect();
  sectionVisibilityObserver = null;
  projectSwiper?.destroy(true, true);
  projectSwiper = null;
  document.body.classList.remove("is-work-visible");
  document.body.classList.remove("is-services-visible");
}

function init() {
  reserveLoaderScrollbar();
  customDropdown();
  createFilterTab();
  if (document.getElementById("datepicker")) getDateLightPick();
  initHeroGlobe();
  initMotion();
  startHomeExperience();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
  Promise.resolve(window.siteComponentsReady)
    .then(() => {
      initSwiper();
      initSectionNavigation();
      refreshMotion();
    })
    .catch((error) => console.error(error));
});

window.PortfolioMotion = Object.freeze({
  init: initMotion,
  initHero: startHomeExperience,
  refresh: refreshMotion,
  destroy: () => {
    destroyHomeHero();
    destroyMotion();
    destroyHeroGlobe();
  },
});
window.addEventListener("pagehide", () => {
  destroyHomeHero();
  destroyMotion();
  destroyProjects();
  destroyHeroGlobe();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    initHeroGlobe();
    initMotion();
    startHomeExperience();
    initSwiper();
    initSectionNavigation();
  }
});
