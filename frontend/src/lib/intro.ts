// Landing intro trigger (motion: components/IntroStage, styles: "landing
// intro" in globals.css). Runs inline in <head> from the root layout, so it
// executes only when a document is loaded (a fresh open or a reload), never on
// client-side navigation, and only on the landing page.
//
// Classes on <html>:
//   intro-play     the overlay is shown and the nav mark waits for the hand-off
//   intro-hold     the hero entrance is paused until the overlay opens
//   intro-reduced  prefers-reduced-motion: a short, still version
// It never blocks the page: without JavaScript nothing is added, and the timer
// clears every class even if the motion code never loads. IntroStage replaces
// that timer with its own once it starts.
export const INTRO_SCRIPT = `(function(){try{if(location.pathname!=="/"||document.visibilityState==="hidden")return;var d=document.documentElement;var r=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;d.classList.add("intro-play",r?"intro-reduced":"intro-hold");window.__sonovateIntro=setTimeout(function(){d.classList.remove("intro-play","intro-hold","intro-reduced")},4500)}catch(e){}})()`;
