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
  /* Reviews carousel — native scroll-snap track, buttons + dots        */
  /* ---------------------------------------------------------------- */
  var reviewsTrack = document.getElementById('reviewsTrack');
  var reviewsPrev = document.getElementById('reviewsPrev');
  var reviewsNext = document.getElementById('reviewsNext');
  var reviewsDots = document.getElementById('reviewsDots');

  if (reviewsTrack && reviewsDots) {
    var reviewCards = Array.prototype.slice.call(reviewsTrack.children);
    var dotEls = [];

    reviewCards.forEach(function (card, i) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'reviews__dot';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', 'Go to review ' + (i + 1));
      dot.addEventListener('click', function () {
        card.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
      });
      reviewsDots.appendChild(dot);
      dotEls.push(dot);
    });

    function setActiveDot() {
      var trackLeft = reviewsTrack.scrollLeft;
      var closestIndex = 0;
      var closestDist = Infinity;
      reviewCards.forEach(function (card, i) {
        var dist = Math.abs(card.offsetLeft - reviewsTrack.offsetLeft - trackLeft);
        if (dist < closestDist) {
          closestDist = dist;
          closestIndex = i;
        }
      });
      dotEls.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === closestIndex);
      });
    }
    setActiveDot();

    var scrollTimer;
    reviewsTrack.addEventListener('scroll', function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(setActiveDot, 100);
    }, { passive: true });

    function scrollByCard(direction) {
      var card = reviewCards[0];
      var amount = card ? card.getBoundingClientRect().width + 16 : 300;
      reviewsTrack.scrollBy({ left: amount * direction, behavior: 'smooth' });
    }
    if (reviewsPrev) reviewsPrev.addEventListener('click', function () { scrollByCard(-1); });
    if (reviewsNext) reviewsNext.addEventListener('click', function () { scrollByCard(1); });
  }

  /* ---------------------------------------------------------------- */
  /* Scroll-triggered fade-up animations                               */
  /* ---------------------------------------------------------------- */
  var fadeEls = document.querySelectorAll('.fade-up');

  // Stagger siblings within card/list groups so they cascade in one after
  // another instead of popping in all at once — same fade, just sequenced.
  var staggerGroups = document.querySelectorAll(
    '.hero__inner, .trust-bar__grid, .requirements__grid, .fleet__grid, .steps'
  );
  staggerGroups.forEach(function (group) {
    var items = Array.prototype.filter.call(group.children, function (el) {
      return el.classList.contains('fade-up');
    });
    items.forEach(function (el, i) {
      el.style.transitionDelay = Math.min(i * 70, 350) + 'ms';
    });
  });

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

  /* ==================================================================
     APPLICATION FORM — five-step intake with progress indicator,
     per-step validation, file uploads, and a documented GHL
     integration point.
     ================================================================== */
  (function () {
    var form = document.getElementById('applyForm');
    if (!form) return;

    var TOTAL_STEPS = 5;
    var currentStep = 1;

    var steps = Array.prototype.slice.call(form.querySelectorAll('.apply-step'));
    var progressItems = Array.prototype.slice.call(document.querySelectorAll('.apply-progress__item'));
    var progressFill = document.getElementById('applyProgressFill');
    var progressRoot = document.getElementById('applyProgress');
    var introEl = document.getElementById('applyIntro');
    var backBtn = document.getElementById('applyBack');
    var nextBtn = document.getElementById('applyNext');
    var submitBtn = document.getElementById('applySubmit');
    var statusEl = document.getElementById('applyFormStatus');
    var reviewEl = document.getElementById('applyReview');
    var successEl = document.getElementById('applySuccess');
    var applyCard = form; // the .apply-card element itself

    /* ---- File upload dropzones: show selected filename, style state --- */
    form.querySelectorAll('.upload-input').forEach(function (input) {
      input.addEventListener('change', function () {
        var wrapper = input.closest('.form-field--upload');
        var filenameEl = wrapper ? wrapper.querySelector('.upload-dropzone__filename') : null;
        var hasFile = input.files && input.files.length > 0;
        if (wrapper) wrapper.classList.toggle('has-file', hasFile);
        if (filenameEl) filenameEl.textContent = hasFile ? input.files[0].name : '';
        if (hasFile && wrapper) wrapper.classList.remove('has-error');
      });
    });

    /* ---- Per-step validation ------------------------------------------ */
    function clearStepErrors(stepEl) {
      stepEl.classList.remove('has-error');
      stepEl.querySelectorAll('.form-field.has-error').forEach(function (f) {
        f.classList.remove('has-error');
      });
    }

    function validateStep(stepEl) {
      var valid = true;
      clearStepErrors(stepEl);

      // Standard required text/date/select/file inputs (not checkbox/radio group inputs)
      var fields = stepEl.querySelectorAll(
        'input[required]:not([type="checkbox"]):not([type="radio"]), select[required], textarea[required]'
      );
      fields.forEach(function (field) {
        var wrapper = field.closest('.form-field');
        var ok = field.type === 'file' ? field.files && field.files.length > 0 : field.checkValidity();
        if (!ok) {
          valid = false;
          if (wrapper) wrapper.classList.add('has-error');
        }
      });

      // Gig platform checkboxes — at least one must be checked
      var platformGrid = stepEl.querySelector('.platform-grid');
      if (platformGrid) {
        var anyPlatform = platformGrid.querySelectorAll('input[name="platforms"]:checked').length > 0;
        if (!anyPlatform) {
          valid = false;
          var platformWrapper = platformGrid.closest('.form-field');
          if (platformWrapper) platformWrapper.classList.add('has-error');
        }
      }

      // Rental option radios — one must be selected
      var rentalGroup = stepEl.querySelector('.rental-options');
      if (rentalGroup) {
        var anyRental = rentalGroup.querySelectorAll('input[name="rentalOption"]:checked').length > 0;
        if (!anyRental) {
          valid = false;
          stepEl.classList.add('has-error');
        }
      }

      // Consent checkbox
      var consent = stepEl.querySelector('#consent');
      if (consent && !consent.checked) {
        valid = false;
        stepEl.classList.add('has-error');
      }

      return valid;
    }

    /* ---- Step navigation ------------------------------------------------ */
    function goToStep(n, shouldScroll) {
      currentStep = n;

      steps.forEach(function (stepEl) {
        stepEl.classList.toggle('is-active', Number(stepEl.dataset.step) === n);
      });

      progressItems.forEach(function (item) {
        var itemStep = Number(item.dataset.step);
        item.classList.toggle('is-active', itemStep === n);
        item.classList.toggle('is-complete', itemStep < n);
      });

      if (progressFill) progressFill.style.width = (n / TOTAL_STEPS * 100) + '%';
      if (progressRoot) progressRoot.setAttribute('aria-valuenow', String(n));

      if (backBtn) backBtn.hidden = n === 1;
      if (nextBtn) nextBtn.hidden = n === TOTAL_STEPS;
      if (submitBtn) submitBtn.hidden = n !== TOTAL_STEPS;

      if (n === TOTAL_STEPS) populateReview();

      if (shouldScroll) applyCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function currentStepEl() {
      return steps[currentStep - 1];
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (!validateStep(currentStepEl())) return;
        if (currentStep < TOTAL_STEPS) goToStep(currentStep + 1, true);
      });
    }
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (currentStep > 1) goToStep(currentStep - 1, true);
      });
    }

    /* ---- Step 5: build a human-readable review summary ------------------ */
    function fieldValue(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }
    function fieldLabelForSelect(id) {
      var el = document.getElementById(id);
      if (!el || !el.selectedOptions || !el.selectedOptions.length) return '';
      return el.selectedOptions[0].textContent.trim();
    }
    function fileName(id) {
      var el = document.getElementById(id);
      return el && el.files && el.files[0] ? el.files[0].name : 'Not uploaded';
    }

    function populateReview() {
      if (!reviewEl) return;

      var platforms = Array.prototype.slice
        .call(form.querySelectorAll('input[name="platforms"]:checked'))
        .map(function (cb) { return cb.value; })
        .join(', ') || '—';

      var rentalOptionEl = form.querySelector('input[name="rentalOption"]:checked');
      var rentalOption = rentalOptionEl ? rentalOptionEl.value : '—';

      var smsConsentEl = document.getElementById('smsConsent');

      var rows = [
        ['Name', (fieldValue('firstName') + ' ' + fieldValue('lastName')).trim() || '—'],
        ['Phone', fieldValue('phone') || '—'],
        ['Email', fieldValue('email') || '—'],
        ['SMS Updates', smsConsentEl && smsConsentEl.checked ? 'Opted in' : 'Not opted in'],
        ['Date of Birth', fieldValue('dob') || '—'],
        ['License Number', fieldValue('licenseNumber') || '—'],
        ['License State', fieldLabelForSelect('licenseState') || '—'],
        ['License — Front', fileName('licenseFront')],
        ['License — Back', fileName('licenseBack')],
        ['Platforms', platforms],
        ['Platform Screenshot', fileName('platformScreenshot')],
        ['Rental Option', rentalOption],
        ['Notes', fieldValue('notes') || '—']
      ];

      reviewEl.innerHTML = rows.map(function (row) {
        return '<div class="apply-review__row"><span class="apply-review__label">' + row[0] +
          '</span><span class="apply-review__value">' + escapeHtml(row[1]) + '</span></div>';
      }).join('');
    }

    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    /* ---- Final submit ---------------------------------------------------- */
    form.addEventListener('submit', function (event) {
      event.preventDefault();

      if (!validateStep(currentStepEl())) return;

      var payload = {
        firstName: fieldValue('firstName'),
        lastName: fieldValue('lastName'),
        phone: fieldValue('phone'),
        email: fieldValue('email'),
        smsConsent: !!document.getElementById('smsConsent').checked,
        dob: fieldValue('dob'),
        licenseNumber: fieldValue('licenseNumber'),
        licenseState: fieldValue('licenseState'),
        licenseFrontFileName: fileName('licenseFront'),
        licenseBackFileName: fileName('licenseBack'),
        platforms: Array.prototype.slice
          .call(form.querySelectorAll('input[name="platforms"]:checked'))
          .map(function (cb) { return cb.value; }),
        platformScreenshotFileName: fileName('platformScreenshot'),
        rentalOption: (function () {
          var el = form.querySelector('input[name="rentalOption"]:checked');
          return el ? el.value : '';
        })(),
        notes: fieldValue('notes')
      };

      submitApplicationToGHL(payload, form)
        .then(function () {
          form.hidden = true;
          if (progressRoot) progressRoot.hidden = true;
          if (introEl) introEl.hidden = true;
          if (successEl) {
            successEl.hidden = false;
            successEl.focus();
            successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        })
        .catch(function (err) {
          if (statusEl) {
            statusEl.textContent = 'Something went wrong submitting your application. Please try again or contact us directly.';
          }
          console.error('Flex Rentals application submission failed:', err);
        });
    });

    goToStep(1);
  })();

  /* ==================================================================
     GHL INTEGRATION POINT
     ==================================================================
     This site was built without GoHighLevel account credentials or a
     form embed code, so the application above cannot reach a real CRM
     yet. submitApplicationToGHL() is the single place that needs to
     change to go live. Two ways to finish this:

     OPTION A — Native GHL form embed (recommended for Phase 1):
       1. Build a form in GHL with fields matching the payload shape
          below (Funnels/Websites > Forms, or a Survey/Form builder).
       2. Copy its embed snippet ("</> Add to Website").
       3. Delete the <form id="applyForm"> markup in index.html
          (the #apply section wrapper and progress indicator can stay)
          and paste the GHL embed in its place.
       4. Delete the JS block above this comment — GHL's embed handles
          its own submission, validation and success state.

     OPTION B — Keep this custom UI, POST to a GHL webhook/API:
       1. In GHL, create an inbound webhook (Automation > Workflows >
          "Inbound Webhook" trigger) or use the GHL API v2 "Create
          Contact" / "Create Opportunity" endpoints with a private
          integration token.
       2. Replace the body of submitApplicationToGHL() below with a
          fetch() POST to that webhook/API URL, sending `payload`.
       3. File uploads (license front/back, platform screenshot) are
          NOT sent anywhere yet — this build only validates that a
          file was chosen and reports its filename. To actually
          collect the files, either (a) point the file inputs at a
          GHL file-upload-enabled form field, or (b) upload files to
          your own storage first and send the resulting URLs in
          `payload` instead of filenames.
       4. Map `payload.rentalOption` and `payload.platforms` to
          whatever custom fields/tags you use to drive the CRM
          pipeline (New Application -> Under Review -> Approved ->
          Pickup Scheduled -> Active Rental -> Maintenance -> Vehicle
          Returned -> Repeat Customer / Do Not Rent).

     Until either option is wired up, this function only simulates a
     successful submission so the UI/UX can be reviewed end-to-end.
  */
  function submitApplicationToGHL(payload, formEl) {
    // TODO: replace with a real GHL webhook/API call, e.g.:
    //
    // return fetch('https://YOUR-GHL-WEBHOOK-URL', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(payload)
    // }).then(function (res) {
    //   if (!res.ok) throw new Error('GHL submission failed: ' + res.status);
    // });

    console.log('[Flex Rentals] Application payload ready for GHL integration:', payload);
    return Promise.resolve();
  }

  /* ==================================================================
     CONTACT PAGE FORM — single-step, same GHL integration pattern as
     the application form. See submitApplicationToGHL() above for the
     full integration write-up; submitContactToGHL() below is the
     equivalent hook for contact.html.
     ================================================================== */
  (function () {
    var form = document.getElementById('contactForm');
    if (!form) return;

    var statusEl = document.getElementById('contactFormStatus');

    function fieldValue(id) {
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      var valid = true;
      form.querySelectorAll('input[required], textarea[required]').forEach(function (field) {
        var wrapper = field.closest('.form-field');
        var ok = field.checkValidity();
        if (wrapper) wrapper.classList.toggle('has-error', !ok);
        if (!ok) valid = false;
      });
      if (!valid) return;

      var payload = {
        name: fieldValue('contactName'),
        phone: fieldValue('contactPhone'),
        email: fieldValue('contactEmail'),
        message: fieldValue('contactMessage'),
        smsConsent: !!document.getElementById('contactSmsConsent').checked
      };

      submitContactToGHL(payload)
        .then(function () {
          if (statusEl) {
            statusEl.style.color = 'var(--color-accent)';
            statusEl.textContent = "Thanks! We've received your message and will get back to you shortly.";
          }
          form.reset();
          form.querySelectorAll('.form-field.has-error').forEach(function (f) {
            f.classList.remove('has-error');
          });
        })
        .catch(function (err) {
          if (statusEl) {
            statusEl.style.color = '#ff8a8a';
            statusEl.textContent = 'Something went wrong sending your message. Please call or text us instead.';
          }
          console.error('Flex Rentals contact form submission failed:', err);
        });
    });
  })();

  // TODO: replace with a real GHL webhook/API call — same pattern as
  // submitApplicationToGHL() above.
  function submitContactToGHL(payload) {
    console.log('[Flex Rentals] Contact payload ready for GHL integration:', payload);
    return Promise.resolve();
  }

  /* ---------------------------------------------------------------- */
  /* Footer year                                                       */
  /* ---------------------------------------------------------------- */
  var footerYear = document.getElementById('footerYear');
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
})();
