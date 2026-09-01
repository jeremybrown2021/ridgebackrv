(function () {
  "use strict";

  document.querySelectorAll("[data-year]").forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  function requestJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.message || "The request could not be completed.");
          error.code = body.error;
          error.fields = body.fields || {};
          error.status = response.status;
          throw error;
        }
        return body;
      });
    });
  }

  function showMessage(node, message, success) {
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
    node.classList.toggle("is-success", Boolean(success));
  }

  function showFieldErrors(form, fields) {
    var names = Object.keys(fields || {});
    if (!names.length) return;
    var firstControl;
    names.forEach(function (name) {
      var control = form.elements[name];
      if (!control || typeof control.setCustomValidity !== "function") return;
      control.setCustomValidity(fields[name]);
      if (!firstControl) firstControl = control;
      control.addEventListener("input", function clearFieldError() {
        control.setCustomValidity("");
        control.removeEventListener("input", clearFieldError);
      });
    });
    if (firstControl) firstControl.reportValidity();
  }

  var sessionRequest = requestJson("/api/auth/session", { headers: { accept: "application/json" } })
    .catch(function () { return { authenticated: false }; });

  sessionRequest.then(function (session) {
    document.querySelectorAll(".account-link").forEach(function (link) {
      if (session.authenticated) {
        link.textContent = "My Account";
        link.href = "/account/";
      } else {
        link.textContent = "Sign In";
        link.href = "/login/?back=my-account";
      }
    });

    if (!session.authenticated) return;
    var orderForm = document.querySelector("[data-order-form]");
    if (orderForm) {
      if (!orderForm.elements.fullName.value) orderForm.elements.fullName.value = session.user.fullName || "";
      if (!orderForm.elements.email.value) orderForm.elements.email.value = session.user.email || "";
      if (!orderForm.elements.phone.value) orderForm.elements.phone.value = session.user.phone || "";
    }
  });

  var menuButton = document.querySelector("[data-menu-toggle]");
  var mobileNav = document.querySelector("[data-mobile-nav]");
  var siteHeader = document.querySelector(".site-header");

  if (siteHeader && siteHeader.classList.contains("site-header--overlay")) {
    var updateHeader = function () {
      siteHeader.classList.toggle("is-scrolled", window.scrollY > 24);
    };

    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  if (menuButton && mobileNav) {
    var closeMenu = function () {
      menuButton.setAttribute("aria-expanded", "false");
      mobileNav.classList.remove("is-open");
      document.body.classList.remove("menu-open");
      if (siteHeader) siteHeader.classList.remove("is-menu-open");
    };

    menuButton.addEventListener("click", function () {
      var open = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", String(!open));
      mobileNav.classList.toggle("is-open", !open);
      document.body.classList.toggle("menu-open", !open);
      if (siteHeader) siteHeader.classList.toggle("is-menu-open", !open);
    });

    mobileNav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 980) closeMenu();
    });
  }

  var bookingHero = document.querySelector("[data-background-slider]");
  if (bookingHero) {
    var heroMedia = bookingHero.querySelector("[data-hero-media]");
    var originalHeroImage = heroMedia ? heroMedia.querySelector(".hero-image") : null;
    var heroImageSources = [
      "/media/front.png",
      "/media/site.png",
      "/media/clubhouse.png",
      "/media/dog.park.png",
      "/media/showers.jpg"
    ];

    if (originalHeroImage) {
      var uniqueHeroSources = [originalHeroImage.getAttribute("src")].concat(heroImageSources).filter(function (source, index, items) {
        return source && items.indexOf(source) === index;
      });
      originalHeroImage.classList.add("hero-slide", "is-active");
      var heroSlides = [originalHeroImage];

      uniqueHeroSources.slice(1).forEach(function (source) {
        var image = document.createElement("img");
        image.className = "hero-image hero-slide";
        image.src = source;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.setAttribute("decoding", "async");
        heroMedia.appendChild(image);
        heroSlides.push(image);
      });

      var activeHeroSlide = 0;
      var heroSliderTimer;
      var showNextHeroSlide = function () {
        activeHeroSlide = (activeHeroSlide + 1) % heroSlides.length;
        heroSlides.forEach(function (slide, index) {
          slide.classList.toggle("is-active", index === activeHeroSlide);
        });
      };
      var stopHeroSlider = function () {
        window.clearInterval(heroSliderTimer);
      };
      var startHeroSlider = function () {
        stopHeroSlider();
        if (!document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          heroSliderTimer = window.setInterval(showNextHeroSlide, 5500);
        }
      };

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stopHeroSlider();
        else startHeroSlider();
      });
      startHeroSlider();
    }
  }

  document.querySelectorAll("[data-occupancy-picker]").forEach(function (picker) {
    var trigger = picker.querySelector("[data-occupancy-trigger]");
    var panel = picker.querySelector("[data-occupancy-panel]");
    var summary = picker.querySelector("[data-occupancy-summary]");
    var siteList = picker.querySelector("[data-occupancy-site-list]");
    var addButton = picker.querySelector("[data-occupancy-add]");
    var doneButton = picker.querySelector("[data-occupancy-done]");
    var adultsInput = picker.querySelector("[data-occupancy-adults]");
    var childrenInput = picker.querySelector("[data-occupancy-children]");
    var childAgesInput = picker.querySelector("[data-occupancy-child-ages]");
    var sitesInput = picker.querySelector("[data-occupancy-sites]");
    var ageError = picker.querySelector("[data-occupancy-age-error]");
    var params = new URLSearchParams(window.location.search);
    var maxSites = 5;
    var maxGuestsPerSite = 6;

    var positiveInteger = function (value, fallback) {
      var parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };

    var initialSiteCount = Math.min(maxSites, Math.max(1, positiveInteger(params.get("sites"), 1)));
    var initialAdultCount = Math.min(
      initialSiteCount * maxGuestsPerSite,
      Math.max(initialSiteCount, positiveInteger(params.get("adults"), 1))
    );
    var initialChildCount = Math.min(
      initialSiteCount * maxGuestsPerSite - initialAdultCount,
      positiveInteger(params.get("children"), 0)
    );
    var initialChildAges = (params.get("childAges") || "").split(",").map(function (value) {
      var age = Number(value);
      return value !== "" && Number.isInteger(age) && age >= 0 && age <= 14 ? age : "";
    });
    var siteGuests = Array.from({ length: initialSiteCount }, function () {
      return { adults: 1, children: 0, childAges: [] };
    });
    var remainingAdults = initialAdultCount - initialSiteCount;
    siteGuests.forEach(function (site) {
      var additionalAdults = Math.min(remainingAdults, maxGuestsPerSite - site.adults);
      site.adults += additionalAdults;
      remainingAdults -= additionalAdults;
    });
    var remainingChildren = initialChildCount;
    var childAgeIndex = 0;
    siteGuests.forEach(function (site) {
      var additionalChildren = Math.min(remainingChildren, maxGuestsPerSite - site.adults);
      site.children += additionalChildren;
      site.childAges = Array.from({ length: additionalChildren }, function () {
        var age = initialChildAges[childAgeIndex];
        childAgeIndex += 1;
        return age === undefined ? "" : age;
      });
      remainingChildren -= additionalChildren;
    });

    var plural = function (count, singular) {
      return count + " " + singular + (count === 1 ? "" : "s");
    };

    var totals = function () {
      return siteGuests.reduce(function (result, site) {
        result.adults += site.adults;
        result.children += site.children;
        return result;
      }, { adults: 0, children: 0 });
    };

    var updateSummary = function () {
      var guestTotals = totals();
      var childAges = siteGuests.reduce(function (ages, site) {
        return ages.concat(site.childAges);
      }, []);
      var parts = [plural(guestTotals.adults, "Adult")];
      if (guestTotals.children > 0) parts.push(plural(guestTotals.children, "Child"));
      parts.push(plural(siteGuests.length, "Site"));
      summary.textContent = parts.join(", ");
      adultsInput.value = String(guestTotals.adults);
      childrenInput.value = String(guestTotals.children);
      childAgesInput.value = childAges.map(function (age) { return String(age); }).join(",");
      sitesInput.value = String(siteGuests.length);
      if (childAges.every(function (age) { return Number.isInteger(age); })) ageError.hidden = true;
      addButton.hidden = siteGuests.length >= maxSites;
      picker.dispatchEvent(new CustomEvent("occupancychange", {
        bubbles: true,
        detail: {
          adults: guestTotals.adults,
          children: guestTotals.children,
          sites: siteGuests.length
        }
      }));
    };

    var ageOptions = function (selectedAge) {
      var options = ['<option value="">Select age</option>'];
      for (var age = 0; age <= 14; age += 1) {
        var label = age === 0 ? "Under 1 year" : age + " year" + (age === 1 ? "" : "s");
        options.push('<option value="' + age + '"' + (selectedAge === age ? ' selected' : '') + '>' + label + '</option>');
      }
      return options.join("");
    };

    var childAgeFields = function (site, siteIndex) {
      if (!site.children) return "";
      return [
        '<div class="occupancy-child-ages">',
        '  <span>All children</span>',
        '  <div class="occupancy-age-grid">',
        site.childAges.map(function (age, childIndex) {
          return '<select class="occupancy-age-select" aria-label="Age of child ' + (childIndex + 1) + ' at site ' + (siteIndex + 1) + '" data-occupancy-age data-site-index="' + siteIndex + '" data-child-index="' + childIndex + '">' + ageOptions(age) + '</select>';
        }).join(""),
        '  </div>',
        '</div>'
      ].join("");
    };

    var renderSites = function () {
      siteList.innerHTML = siteGuests.map(function (site, index) {
        var siteNumber = index + 1;
        var atCapacity = site.adults + site.children >= maxGuestsPerSite;
        return [
          '<section class="occupancy-site">',
          '  <div class="occupancy-site-heading">',
          '    <strong>Site - ' + siteNumber + '</strong>',
          index > 0
            ? '    <button type="button" class="occupancy-remove" data-occupancy-action="remove" data-site-index="' + index + '">Remove</button>'
            : '',
          '  </div>',
          '  <div class="occupancy-count-grid">',
          '    <div class="occupancy-group">',
          '      <span>Adults</span>',
          '      <div class="occupancy-stepper">',
          '        <output>' + site.adults + '</output>',
          '        <span class="occupancy-stepper-buttons">',
          '          <button type="button" aria-label="Add an adult to site ' + siteNumber + '" data-occupancy-action="increase" data-guest-type="adults" data-site-index="' + index + '"' + (atCapacity ? ' disabled' : '') + '>+</button>',
          '          <button type="button" aria-label="Remove an adult from site ' + siteNumber + '" data-occupancy-action="decrease" data-guest-type="adults" data-site-index="' + index + '"' + (site.adults <= 1 ? ' disabled' : '') + '>&minus;</button>',
          '        </span>',
          '      </div>',
          '    </div>',
          '    <div class="occupancy-group">',
          '      <span>Children</span>',
          '      <div class="occupancy-stepper">',
          '        <output>' + site.children + '</output>',
          '        <span class="occupancy-stepper-buttons">',
          '          <button type="button" aria-label="Add a child to site ' + siteNumber + '" data-occupancy-action="increase" data-guest-type="children" data-site-index="' + index + '"' + (atCapacity ? ' disabled' : '') + '>+</button>',
          '          <button type="button" aria-label="Remove a child from site ' + siteNumber + '" data-occupancy-action="decrease" data-guest-type="children" data-site-index="' + index + '"' + (site.children <= 0 ? ' disabled' : '') + '>&minus;</button>',
          '        </span>',
          '      </div>',
          '      <small>Below 15 years</small>',
          '    </div>',
          '  </div>',
          childAgeFields(site, index),
          '</section>'
        ].join("");
      }).join("");
      updateSummary();
    };

    var setOpen = function (open) {
      panel.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      picker.classList.toggle("is-open", open);
    };

    trigger.addEventListener("click", function () {
      setOpen(panel.hidden);
    });

    doneButton.addEventListener("click", function () {
      var firstMissingAge = siteList.querySelector("[data-occupancy-age] option:checked[value='']");
      if (firstMissingAge) {
        ageError.hidden = false;
        firstMissingAge.parentElement.focus();
        return;
      }
      setOpen(false);
      trigger.focus();
    });

    addButton.addEventListener("click", function () {
      if (siteGuests.length >= maxSites) return;
      siteGuests.push({ adults: 1, children: 0, childAges: [] });
      renderSites();
    });

    siteList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-occupancy-action]");
      if (!button) return;
      var index = Number(button.getAttribute("data-site-index"));
      var action = button.getAttribute("data-occupancy-action");
      var guestType = button.getAttribute("data-guest-type");
      if (!siteGuests[index]) return;

      if (action === "remove" && index > 0) {
        siteGuests.splice(index, 1);
      } else if (action === "increase" && guestType) {
        if (siteGuests[index].adults + siteGuests[index].children < maxGuestsPerSite) {
          siteGuests[index][guestType] += 1;
          if (guestType === "children") siteGuests[index].childAges.push("");
        }
      } else if (action === "decrease" && guestType) {
        var minimum = guestType === "adults" ? 1 : 0;
        siteGuests[index][guestType] = Math.max(minimum, siteGuests[index][guestType] - 1);
        if (guestType === "children") siteGuests[index].childAges.length = siteGuests[index].children;
      }
      renderSites();
    });

    siteList.addEventListener("change", function (event) {
      var select = event.target.closest("[data-occupancy-age]");
      if (!select) return;
      var siteIndex = Number(select.getAttribute("data-site-index"));
      var childIndex = Number(select.getAttribute("data-child-index"));
      if (!siteGuests[siteIndex] || childIndex >= siteGuests[siteIndex].children) return;
      siteGuests[siteIndex].childAges[childIndex] = select.value === "" ? "" : Number(select.value);
      updateSummary();
    });

    var occupancyForm = picker.closest("form");
    if (occupancyForm) {
      occupancyForm.addEventListener("submit", function (event) {
        var firstMissingAge = siteList.querySelector("[data-occupancy-age] option:checked[value='']");
        if (!firstMissingAge) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setOpen(true);
        ageError.hidden = false;
        firstMissingAge.parentElement.focus();
      });
    }

    document.addEventListener("click", function (event) {
      var eventPath = typeof event.composedPath === "function" ? event.composedPath() : [];
      var clickedInside = eventPath.includes(picker) || picker.contains(event.target);
      if (!panel.hidden && !clickedInside) setOpen(false);
    });

    picker.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !panel.hidden) {
        setOpen(false);
        trigger.focus();
      }
    });

    renderSites();
  });

  var orderForm = document.querySelector("[data-order-form]");
  if (orderForm) {
    var nightlyRate = 65;
    var extras = { vehicle: 5, pet: 3, early: 15 };
    var nightsInput = orderForm.querySelector("[data-nights]");
    var arrivalInput = orderForm.querySelector("[data-arrival]");
    var departureInput = orderForm.querySelector("[data-departure]");
    var occupancySitesInput = orderForm.querySelector("[data-occupancy-sites]");
    var extraInputs = Array.from(orderForm.querySelectorAll("input[data-extra]"));
    var millisecondsPerDay = 86400000;

    var parseDateInput = function (value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
      var date = new Date(value + "T00:00:00Z");
      return Number.isNaN(date.getTime()) ? null : date;
    };

    var dateInputValue = function (date) {
      return date.toISOString().slice(0, 10);
    };

    var normalizedNights = function () {
      var nights = Math.min(365, Math.max(1, Number(nightsInput.value) || 1));
      if (Number(nightsInput.value) !== nights) nightsInput.value = String(nights);
      return nights;
    };

    var syncDepartureFromNights = function () {
      var arrival = parseDateInput(arrivalInput.value);
      departureInput.setCustomValidity("");
      if (!arrival) {
        departureInput.value = "";
        departureInput.removeAttribute("min");
        departureInput.removeAttribute("max");
        return;
      }
      var minimumDeparture = new Date(arrival.getTime() + millisecondsPerDay);
      var maximumDeparture = new Date(arrival.getTime() + (365 * millisecondsPerDay));
      departureInput.min = dateInputValue(minimumDeparture);
      departureInput.max = dateInputValue(maximumDeparture);
      departureInput.value = dateInputValue(
        new Date(arrival.getTime() + (normalizedNights() * millisecondsPerDay))
      );
    };

    var syncNightsFromDeparture = function () {
      var arrival = parseDateInput(arrivalInput.value);
      var departure = parseDateInput(departureInput.value);
      departureInput.setCustomValidity("");
      if (!arrival || !departure) return false;
      var duration = Math.round((departure.getTime() - arrival.getTime()) / millisecondsPerDay);
      if (duration < 1 || duration > 365) {
        departureInput.setCustomValidity("Departure must be 1 to 365 nights after arrival.");
        return false;
      }
      nightsInput.value = String(duration);
      return true;
    };

    var money = function (value) {
      return "$" + value.toFixed(2);
    };

    var updateSelectedCards = function () {
      extraInputs.forEach(function (input) {
        input.closest(".extra-card").classList.toggle("is-selected", input.checked);
      });
    };

    var updateTotals = function () {
      var nights = normalizedNights();
      var siteCount = Math.max(1, Number(occupancySitesInput.value) || 1);
      var base = nightlyRate * nights * siteCount;
      var addOns = extraInputs.reduce(function (sum, input) {
        return input.checked ? sum + extras[input.value] * nights : sum;
      }, 0);
      var tax = Math.round((base + addOns) * 0.17 * 100) / 100;
      var total = base + addOns + tax;

      document.querySelector("[data-summary-nightly]").textContent = money(nightlyRate) + " / night";
      document.querySelector("[data-summary-base]").textContent = money(base);
      var addOnSummary = document.querySelector("[data-summary-addons]");
      if (addOnSummary) addOnSummary.textContent = money(addOns);
      document.querySelector("[data-summary-tax]").textContent = money(tax);
      document.querySelector("[data-summary-total]").textContent = money(total);
      updateSelectedCards();
    };

    extraInputs.forEach(function (input) {
      input.addEventListener("change", updateTotals);
    });
    nightsInput.addEventListener("input", function () {
      syncDepartureFromNights();
      updateTotals();
    });
    arrivalInput.addEventListener("change", function () {
      syncDepartureFromNights();
      updateTotals();
    });
    departureInput.addEventListener("change", function () {
      if (syncNightsFromDeparture()) updateTotals();
    });
    orderForm.addEventListener("occupancychange", updateTotals);

    var params = new URLSearchParams(window.location.search);
    var checkIn = params.get("check_in");
    var checkOut = params.get("check_out");
    if (checkIn && arrivalInput) arrivalInput.value = checkIn;
    if (checkIn && checkOut) {
      var start = parseDateInput(checkIn);
      var end = parseDateInput(checkOut);
      var duration = start && end ? Math.round((end.getTime() - start.getTime()) / millisecondsPerDay) : 0;
      if (duration > 0) nightsInput.value = String(duration);
    }

    syncDepartureFromNights();
    updateTotals();
  }

  var authCard = document.querySelector("[data-auth-card]");
  if (authCard) {
    var portalEyebrow = document.querySelector("[data-portal-eyebrow]");
    if (portalEyebrow) {
      portalEyebrow.textContent = new URLSearchParams(window.location.search).get("back") === "my-account"
        ? "My Account"
        : "Guest Portal";
    }
    var tabs = Array.from(authCard.querySelectorAll("[data-auth-mode]"));
    var authForm = authCard.querySelector("[data-auth-form]");
    var fullName = authCard.querySelector("[data-register-field]");
    var password = authCard.querySelector("[data-password-field]");
    var confirmPassword = authCard.querySelector("[data-register-password-confirm]");
    var signInOptions = authCard.querySelector("[data-signin-options]");
    var submitText = authCard.querySelector("[data-auth-submit]");
    var tabsContainer = authCard.querySelector("[data-auth-tabs]");
    var modeCopy = authCard.querySelector("[data-auth-mode-copy]");
    var authMessage = authCard.querySelector("[data-auth-message]");
    var resetLink = authCard.querySelector("[data-auth-reset-link]");
    var forgotButton = authCard.querySelector("[data-auth-forgot]");
    var backButton = authCard.querySelector("[data-auth-back]");
    var currentMode = "signin";

    var setMode = function (mode) {
      currentMode = mode;
      tabs.forEach(function (tab) {
        var active = tab.getAttribute("data-auth-mode") === mode;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      fullName.hidden = mode !== "register";
      fullName.required = mode === "register";
      password.hidden = mode === "forgot";
      password.required = mode !== "forgot";
      password.autocomplete = mode === "register" ? "new-password" : "current-password";
      confirmPassword.hidden = mode !== "register";
      confirmPassword.required = mode === "register";
      signInOptions.hidden = mode !== "signin";
      tabsContainer.hidden = mode === "forgot";
      backButton.hidden = mode !== "forgot";
      modeCopy.hidden = mode !== "forgot";
      modeCopy.textContent = mode === "forgot"
        ? "Enter your account email and we’ll prepare a time-limited reset link."
        : "";
      submitText.textContent = mode === "signin"
        ? "Sign In"
        : mode === "register"
          ? "Create Account"
          : "Request Reset Link";
      authForm.reset();
      showMessage(authMessage, "");
      resetLink.hidden = true;
      resetLink.textContent = "";
    };

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        setMode(tab.getAttribute("data-auth-mode"));
      });
    });

    forgotButton.addEventListener("click", function () { setMode("forgot"); });
    backButton.addEventListener("click", function () { setMode("signin"); });

    authForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!authForm.reportValidity()) return;
      showMessage(authMessage, "");
      submitText.disabled = true;
      submitText.textContent = currentMode === "forgot" ? "Preparing link…" : "Signing in…";
      var endpoint = currentMode === "register"
        ? "/api/auth/register"
        : currentMode === "forgot"
          ? "/api/auth/forgot-password"
          : "/api/auth/login";
      var body = currentMode === "forgot"
        ? { email: authForm.elements.email.value }
        : {
            email: authForm.elements.email.value,
            password: authForm.elements.password.value,
            ...(currentMode === "register" ? { confirmPassword: authForm.elements.confirmPassword.value } : {}),
            remember: Boolean(authForm.elements.remember && authForm.elements.remember.checked),
            ...(currentMode === "register" ? { fullName: authForm.elements.fullName.value } : {})
          };

      requestJson(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (result) {
        if (currentMode === "forgot") {
          showMessage(authMessage, result.message, true);
          if (result.resetUrl) {
            var link = document.createElement("a");
            link.className = "text-link";
            link.href = result.resetUrl;
            link.textContent = "Open the local password reset page";
            resetLink.textContent = "Local development: ";
            resetLink.appendChild(link);
            resetLink.hidden = false;
          }
          return;
        }
        var back = new URLSearchParams(window.location.search).get("back");
        window.location.assign(back === "quick-order" ? "/quick-order/" : "/account/");
      }).catch(function (error) {
        showFieldErrors(authForm, error.fields);
        showMessage(authMessage, error.message);
      }).finally(function () {
        submitText.disabled = false;
        submitText.textContent = currentMode === "signin"
          ? "Sign In"
          : currentMode === "register"
            ? "Create Account"
            : "Request Reset Link";
      });
    });

    var requestedMode = new URLSearchParams(window.location.search).get("mode");
    setMode(requestedMode === "register" || requestedMode === "forgot" ? requestedMode : "signin");
    sessionRequest.then(function (session) {
      if (session.authenticated) window.location.replace("/account/");
    });
  }

  var resetPasswordForm = document.querySelector("[data-reset-password-form]");
  if (resetPasswordForm) {
    var resetMessage = document.querySelector("[data-reset-message]");
    var resetSubmit = document.querySelector("[data-reset-submit]");
    var resetToken = new URLSearchParams(window.location.search).get("token") || "";
    if (!resetToken) showMessage(resetMessage, "This reset link is invalid or incomplete.");

    resetPasswordForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!resetToken || !resetPasswordForm.reportValidity()) return;
      if (resetPasswordForm.elements.password.value !== resetPasswordForm.elements.confirmPassword.value) {
        resetPasswordForm.elements.confirmPassword.setCustomValidity("Passwords do not match.");
        resetPasswordForm.elements.confirmPassword.reportValidity();
        resetPasswordForm.elements.confirmPassword.addEventListener("input", function clearMismatch() {
          resetPasswordForm.elements.confirmPassword.setCustomValidity("");
        }, { once: true });
        return;
      }
      resetSubmit.disabled = true;
      resetSubmit.textContent = "Resetting…";
      showMessage(resetMessage, "");
      requestJson("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: resetToken,
          password: resetPasswordForm.elements.password.value,
          confirmPassword: resetPasswordForm.elements.confirmPassword.value
        })
      }).then(function () {
        showMessage(resetMessage, "Password updated. Opening your account…", true);
        window.setTimeout(function () { window.location.replace("/account/"); }, 500);
      }).catch(function (error) {
        showFieldErrors(resetPasswordForm, error.fields);
        showMessage(resetMessage, error.message);
      }).finally(function () {
        resetSubmit.disabled = false;
        resetSubmit.textContent = "Reset Password";
      });
    });
  }

  var accountPage = document.querySelector("[data-account-page]");
  if (accountPage) {
    var accountMessage = accountPage.querySelector("[data-account-message]");
    var profileForm = accountPage.querySelector("[data-profile-form]");
    var passwordForm = accountPage.querySelector("[data-change-password-form]");
    var reservationList = accountPage.querySelector("[data-reservation-list]");

    function formatMoney(cents, currency) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "usd").toUpperCase() }).format(cents / 100);
    }

    function formatDate(value) {
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value + "T00:00:00Z"));
    }

    function appendText(parent, tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      node.textContent = text;
      parent.appendChild(node);
      return node;
    }

    function renderReservations(reservations) {
      reservationList.textContent = "";
      if (!reservations.length) {
        appendText(reservationList, "p", "reservation-empty", "No account-linked reservations yet. Your next signed-in checkout will appear here automatically.");
        return;
      }
      reservations.forEach(function (reservation) {
        var card = document.createElement("article");
        card.className = "reservation-card";
        var details = document.createElement("div");
        appendText(details, "h3", "", reservation.siteType);
        var meta = document.createElement("div");
        meta.className = "reservation-meta";
        appendText(meta, "span", "", formatDate(reservation.arrival) + " – " + formatDate(reservation.departure));
        appendText(meta, "span", "", reservation.nights + " night" + (reservation.nights === 1 ? "" : "s"));
        appendText(meta, "span", "", reservation.reservationNumber);
        details.appendChild(meta);
        var status = appendText(details, "span", "reservation-status is-" + reservation.status, reservation.status.replaceAll("_", " "));
        status.setAttribute("aria-label", "Reservation status: " + reservation.status.replaceAll("_", " "));
        var total = document.createElement("div");
        total.className = "reservation-total";
        appendText(total, "strong", "", formatMoney(reservation.totalCents, reservation.currency));
        if (reservation.payment) appendText(total, "span", "reservation-meta", reservation.payment.cardLast4 ? reservation.payment.cardBrand + " •••• " + reservation.payment.cardLast4 : reservation.payment.reference);
        card.appendChild(details);
        card.appendChild(total);
        reservationList.appendChild(card);
      });
    }

    function loadReservations() {
      return requestJson("/api/account/reservations", { headers: { accept: "application/json" } })
        .then(function (result) { renderReservations(result.reservations || []); })
        .catch(function (error) { reservationList.textContent = ""; showMessage(accountMessage, error.message); });
    }

    sessionRequest.then(function (session) {
      if (!session.authenticated) {
        window.location.replace("/login/?back=my-account");
        return;
      }
      accountPage.querySelector("[data-account-name]").textContent = session.user.fullName.split(" ")[0];
      accountPage.querySelector("[data-account-email]").textContent = session.user.email;
      profileForm.elements.fullName.value = session.user.fullName;
      profileForm.elements.email.value = session.user.email;
      profileForm.elements.phone.value = session.user.phone || "";
      profileForm.elements.rvDetails.value = session.user.rvDetails || "";
      loadReservations();
    });

    accountPage.querySelector("[data-account-logout]").addEventListener("click", function () {
      requestJson("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
        .then(function () { window.location.replace("/login/"); })
        .catch(function (error) { showMessage(accountMessage, error.message); });
    });

    profileForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!profileForm.reportValidity()) return;
      var message = profileForm.querySelector("[data-profile-message]");
      showMessage(message, "");
      requestJson("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: profileForm.elements.fullName.value,
          phone: profileForm.elements.phone.value,
          rvDetails: profileForm.elements.rvDetails.value
        })
      }).then(function (result) {
        accountPage.querySelector("[data-account-name]").textContent = result.user.fullName.split(" ")[0];
        showMessage(message, "Profile saved.", true);
      }).catch(function (error) {
        showFieldErrors(profileForm, error.fields);
        showMessage(message, error.message);
      });
    });

    passwordForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!passwordForm.reportValidity()) return;
      var message = passwordForm.querySelector("[data-password-message]");
      showMessage(message, "");
      requestJson("/api/account/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordForm.elements.currentPassword.value,
          newPassword: passwordForm.elements.newPassword.value,
          confirmPassword: passwordForm.elements.confirmPassword.value
        })
      }).then(function () {
        passwordForm.reset();
        showMessage(message, "Password updated and other sessions signed out.", true);
      }).catch(function (error) {
        showFieldErrors(passwordForm, error.fields);
        showMessage(message, error.message);
      });
    });
  }
})();
