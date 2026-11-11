"use client";

import { useEffect } from "react";

// Motion for the public landing page, attached after hydration:
// - scroll reveals for [data-reveal]: shown when they enter the viewport and
//   reset when they drop back below it, so scrolling up and down replays them
//   (content is visible without JS; the hidden state needs .fx-ready),
// - count-up for [data-countup] figures (the final text is the real value),
// - the pinned model story: the active step follows scroll position, and its
//   step buttons scroll to that step,
// - a pointer spotlight on .spot cards and the hero grid, a light tilt on
//   .tilt elements, a scroll progress bar and a "scrolled" state.
// Reduced motion: reveals are shown at once and nothing follows the pointer;
// the story still follows scroll position, without transitions.

const CELL = 56; // must match .hero-grid-bg background-size

function countUp(el: HTMLElement) {
  const final = el.dataset.countup ?? el.textContent ?? "";
  const numbers = [...final.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  if (numbers.length === 0) return;
  const start = performance.now();
  const duration = 1100;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const k = 1 - (1 - t) ** 3;
    let i = 0;
    el.textContent = final.replace(/\d+(?:\.\d+)?/g, (m) => {
      const decimals = m.split(".")[1]?.length ?? 0;
      return (Number(numbers[i++]) * k).toFixed(decimals);
    });
    if (t < 1 && el.isConnected) requestAnimationFrame(tick);
    else el.textContent = final;
  };
  requestAnimationFrame(tick);
}

export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".landing");
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;

    // --- reload: always open on the hero ----------------------------------------
    // A reload used to restore the old scroll position (or jump to a #section
    // from the address bar); now it starts at the top so the hero and its
    // entrance play every time. Ordinary in-page links are unaffected.
    const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const previousRestoration = history.scrollRestoration;
    if (navEntry?.type === "reload") {
      history.scrollRestoration = "manual";
      if (location.hash) history.replaceState(history.state, "", location.pathname + location.search);
      // "instant": the page uses smooth scrolling, which would animate this.
      // Repeated next frame in case the browser restores scroll after us.
      const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      toTop();
      requestAnimationFrame(toTop);
    }

    root.classList.add("fx-ready");

    // --- reveals (replayable) ------------------------------------------------
    const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
    let observer: IntersectionObserver | null = null;
    if (reduce || !("IntersectionObserver" in window)) {
      targets.forEach((el) => el.classList.add("is-visible"));
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            if (entry.isIntersecting) {
              if (!el.classList.contains("is-visible")) {
                el.classList.add("is-visible");
                el.querySelectorAll<HTMLElement>("[data-countup]").forEach(countUp);
              }
            } else if (entry.boundingClientRect.top > 0) {
              // Back below the viewport (the visitor scrolled up): reset so it
              // plays again on the way down. Items scrolled past stay shown.
              el.classList.remove("is-visible");
            }
          }
        },
        { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
      );
      targets.forEach((el) => observer?.observe(el));
    }

    // --- mobile section menu: close it once a section is chosen ----------------
    const mobileNav = root.querySelector<HTMLDetailsElement>(".l-mobile-nav");
    const onMobileNavClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a")) mobileNav?.removeAttribute("open");
    };
    mobileNav?.addEventListener("click", onMobileNavClick);

    // --- model story ---------------------------------------------------------
    const story = root.querySelector<HTMLElement>(".story");
    const storySteps = story ? [...story.querySelectorAll<HTMLElement>("[data-story-step]")] : [];
    const scenes = story ? [...story.querySelectorAll<HTMLElement>("[data-scene]")] : [];
    const dots = story ? [...story.querySelectorAll<HTMLElement>("[data-story-dot]")] : [];
    const stageNumber = story?.querySelector<HTMLElement>(".story-stage-n");
    const count = storySteps.length;
    let active = 0;

    const setActive = (index: number) => {
      if (index === active) return;
      active = index;
      storySteps.forEach((el, i) => {
        el.classList.toggle("is-active", i === index);
        el.classList.toggle("is-past", i < index);
      });
      scenes.forEach((el, i) => el.classList.toggle("is-active", i === index));
      dots.forEach((el, i) => el.classList.toggle("is-active", i <= index));
      if (stageNumber) stageNumber.textContent = String(index + 1);
    };

    const updateStory = () => {
      if (!story || count === 0) return;
      const rect = story.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const progress = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      story.style.setProperty("--story", progress.toFixed(4));
      setActive(Math.min(count - 1, Math.floor(progress * count)));
    };

    const onStoryClick = (e: MouseEvent) => {
      const button = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-story-goto]") : null;
      if (!button || !story) return;
      const index = Number(button.dataset.storyGoto);
      const travel = story.offsetHeight - window.innerHeight;
      const top = story.getBoundingClientRect().top + window.scrollY + ((index + 0.5) / count) * travel;
      window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
    };
    story?.addEventListener("click", onStoryClick);

    // --- pointer: spotlight, grid cell + trail, tilt ---------------------------
    let pointerFrame = 0;
    let lastEvent: PointerEvent | null = null;
    let lastCell = "";
    const applyPointer = () => {
      pointerFrame = 0;
      const e = lastEvent;
      if (!e) return;
      const target = e.target instanceof Element ? e.target : null;

      const hero = target?.closest<HTMLElement>(".hero");
      if (hero) {
        const r = hero.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const cx = Math.floor(x / CELL) * CELL;
        const cy = Math.floor(y / CELL) * CELL;
        hero.style.setProperty("--mx", `${x}px`);
        hero.style.setProperty("--my", `${y}px`);
        hero.style.setProperty("--cx", `${cx}px`);
        hero.style.setProperty("--cy", `${cy}px`);
        hero.classList.add("is-pointing");
        const key = `${cx},${cy}`;
        if (key !== lastCell) {
          if (lastCell) {
            const [px, py] = lastCell.split(",");
            const trail = document.createElement("span");
            trail.className = "hero-trail";
            trail.setAttribute("aria-hidden", "true");
            trail.style.left = `${px}px`;
            trail.style.top = `${py}px`;
            trail.addEventListener("animationend", () => trail.remove(), { once: true });
            hero.appendChild(trail);
          }
          lastCell = key;
        }
      }

      const spot = target?.closest<HTMLElement>(".spot");
      if (spot) {
        const r = spot.getBoundingClientRect();
        spot.style.setProperty("--sx", `${e.clientX - r.left}px`);
        spot.style.setProperty("--sy", `${e.clientY - r.top}px`);
      }

      const tilt = target?.closest<HTMLElement>(".tilt");
      if (tilt) {
        const r = tilt.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        tilt.style.setProperty("--ry", `${(px * 6).toFixed(2)}deg`);
        tilt.style.setProperty("--rx", `${(-py * 6).toFixed(2)}deg`);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      lastEvent = e;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(applyPointer);
    };
    const onPointerOut = (e: PointerEvent) => {
      const from = e.target instanceof Element ? e.target : null;
      const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      const hero = from?.closest<HTMLElement>(".hero");
      if (hero && !hero.contains(to)) {
        hero.classList.remove("is-pointing");
        lastCell = "";
      }
      const tilt = from?.closest<HTMLElement>(".tilt");
      if (tilt && !tilt.contains(to)) {
        tilt.style.setProperty("--rx", "0deg");
        tilt.style.setProperty("--ry", "0deg");
      }
    };
    if (!reduce && fine) {
      root.addEventListener("pointermove", onPointerMove, { passive: true });
      root.addEventListener("pointerout", onPointerOut, { passive: true });
    }

    // --- scroll: progress bar, nav state, story --------------------------------
    let scrollFrame = 0;
    const onScrollFrame = () => {
      scrollFrame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      root.style.setProperty("--progress", max > 0 ? (doc.scrollTop / max).toFixed(4) : "0");
      root.classList.toggle("is-scrolled", doc.scrollTop > 40);
      updateStory();
    };
    const onScroll = () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(onScrollFrame);
    };
    onScrollFrame();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      observer?.disconnect();
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      story?.removeEventListener("click", onStoryClick);
      mobileNav?.removeEventListener("click", onMobileNavClick);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      history.scrollRestoration = previousRestoration;
    };
  }, []);

  return null;
}
