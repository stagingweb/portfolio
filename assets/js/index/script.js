"use strict";
import {
  customDropdown,
  createFilterTab,
  getDateLightPick,
} from "../../main/js/global.min.js";
import {
  destroyMotion,
  initMotion,
  refreshMotion,
} from "../../main/js/motion.min.js";
import {
  destroyHomeHero,
  startHomeExperience,
} from "../../main/js/home.min.js";

let projectSwiper = null;
let sectionVisibilityObserver = null;

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
  ].filter((section) => section.element && section.link);
  if (!sections.length || !window.IntersectionObserver) return;

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
  }, { threshold: [0, 0.2, 0.5] });

  sections.forEach(({ element }) => sectionVisibilityObserver.observe(element));
}

function destroyProjects() {
  sectionVisibilityObserver?.disconnect();
  sectionVisibilityObserver = null;
  projectSwiper?.destroy(true, true);
  projectSwiper = null;
  document.body.classList.remove("is-work-visible");
}

function init() {
  customDropdown();
  createFilterTab();
  if (document.getElementById("datepicker")) getDateLightPick();
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
  },
});
window.addEventListener("pagehide", () => {
  destroyHomeHero();
  destroyMotion();
  destroyProjects();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    initMotion();
    startHomeExperience();
    initSwiper();
    initSectionNavigation();
  }
});
