/* ==========================================================================
   FLEX RENTALS — Landing Page Behavior
   Vanilla JS, no dependencies. Safe to paste into a GoHighLevel custom
   JS / footer code block.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* Sticky header: transparent on hero, solid after scrolling         */
  /* ---------------------------------------------------------------- */
  var header = document.getElementById('siteHeader');
  var SCROLL_THRESHOLD = 40;

  function updateHeaderState() {
    if (!header) return;
    if (window.scrollY > SCROLL_THRESHOLD) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
  }
  updateHeaderState();
  window.addEventListener('scroll', updateHeaderState, { passive: true });

  /* ---------------------------------------------------------------- */
  /* Mobile navigation drawer                                          */
  /* ---------------------------------------------------------------- */
  var navToggle = document.getElementById('navToggle');
  var mainNav = document.getElementById('mainNav');

  function closeMobileNav() {
    if (!navToggle || !mainNav) return;
    navToggle.setAttribute('aria-expanded', 'false');
    mainNav.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function toggleMobileNav() {
    if (!navToggle || !mainNav) return;
    var isOpen = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!isOpen));
    mainNav.classList.toggle('is-open', !isOpen);
    document.body.style.overflow = isOpen ? '' : 'hidden';
  }

  if (navToggle) {
    navToggle.addEventListener('click', toggleMobileNav);
  }

  if (mainNav) {
    mainNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMobileNav);
    });
  }

  window.addEventListener('resize', function () {
    if (window.innerWidth >= 900) closeMobileNav();
  });

  /* ---------------------------------------------------------------- */
  /* FAQ accordion — single-open, accessible                           */
  /* ---------------------------------------------------------------- */
  var accordionItems = document.querySelectorAll('.accordion__item');

  accordionItems.forEach(function (item) {
    var trigger = item.querySelector('.accordion__trigger');
    if (!trigger) return;

    trigger.addEventListener('click', function () {
      var isExpanded = trigger.getAttribute('aria-expanded') === 'true';

      accordionItems.forEach(function (other) {
        var otherTrigger = other.querySelector('.accordion__trigger');
        if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
      });

      trigger.setAttribute('aria-expanded', String(!isExpanded));
    });
  });

  /* ---------------------------------------------------------------- */
  /* Scroll-triggered fade-up animations                               */
  /* ---------------------------------------------------------------- */
  var fadeEls = document.querySelectorAll('.fade-up');

  if ('IntersectionObserver' in window) {
    var fadeObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            fadeObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    fadeEls.forEach(function (el) { fadeObserver.observe(el); });

    // "How it works" connecting line animates once the step row is visible
    var stepsRow = document.querySelector('.steps');
    if (stepsRow) {
      var stepsObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              stepsObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.3 }
      );
      stepsObserver.observe(stepsRow);
    }
  } else {
    // Fallback: no IntersectionObserver support — show everything immediately
    fadeEls.forEach(function (el) { el.classList.add('is-visible'); });
    var stepsFallback = document.querySelector('.steps');
    if (stepsFallback) stepsFallback.classList.add('is-visible');
  }

  /* ---------------------------------------------------------------- */
  /* Application form (placeholder — will be replaced by a GHL embed)  */
  /* ---------------------------------------------------------------- */
  var applyForm = document.getElementById('applyForm');
  var applyStatus = document.getElementById('applyFormStatus');

  if (applyForm) {
    applyForm.addEventListener('submit', function (event) {
      event.preventDefault();

      if (!applyForm.checkValidity()) {
        applyForm.reportValidity();
        return;
      }

      // TODO: Replace this block with the GoHighLevel form submission
      // (or remove this entire <form> and drop in the GHL embed snippet).
      if (applyStatus) {
        applyStatus.textContent = "Thanks! Your application has been received — we'll be in touch shortly.";
      }
      applyForm.reset();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Footer year                                                       */
  /* ---------------------------------------------------------------- */
  var footerYear = document.getElementById('footerYear');
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
})();
