(function () {
  "use strict";

  var form = document.querySelector("[data-order-form]");
  var submitButton = document.querySelector("[data-payment-submit]");
  if (!form || !submitButton) return;

  var setupMessage = form.querySelector("[data-payment-setup]");
  var paymentFields = form.querySelector("[data-clover-fields]");
  var paymentMessage = form.querySelector("[data-payment-message]");
  var clover;
  var paymentAttempt = null;
  var paymentComplete = false;

  var fieldDefinitions = [
    { type: "CARD_NUMBER", selector: "#card-number", error: "#card-number-errors" },
    { type: "CARD_NAME", selector: "#card-name", error: "#card-name-errors" },
    { type: "CARD_DATE", selector: "#card-date", error: "#card-date-errors" },
    { type: "CARD_CVV", selector: "#card-cvv", error: "#card-cvv-errors" },
    { type: "CARD_POSTAL_CODE", selector: "#card-postal-code", error: "#card-postal-code-errors" },
    { type: "CARD_STREET_ADDRESS", selector: "#card-street-address", error: "#card-street-address-errors" }
  ];

  var allowedSdkUrls = [
    "https://checkout.sandbox.dev.clover.com/sdk.js",
    "https://checkout.clover.com/sdk.js"
  ];

  function setMessage(message, success) {
    paymentMessage.textContent = message || "";
    paymentMessage.hidden = !message;
    paymentMessage.classList.toggle("is-success", Boolean(success));
  }

  function setSetup(message, isError) {
    setupMessage.textContent = message;
    setupMessage.classList.toggle("is-error", Boolean(isError));
  }

  function setNativeFieldsLocked(locked) {
    Array.from(form.querySelectorAll("input, button, select, textarea")).forEach(function (control) {
      control.disabled = locked;
    });
  }

  function setSubmitting(submitting, retrying) {
    submitButton.disabled = submitting || paymentComplete || !clover;
    submitButton.textContent = submitting
      ? "Processing securely…"
      : retrying
        ? "Retry same payment"
        : "Pay securely with Clover";
  }

  function requestJson(url, options) {
    return fetch(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.message || "The request could not be completed.");
          error.code = body.error;
          error.fields = body.fields;
          error.retrySameAttempt = body.retrySameAttempt === true;
          error.responseReceived = true;
          throw error;
        }
        return body;
      });
    });
  }

  function loadScript(url) {
    if (!allowedSdkUrls.includes(url)) return Promise.reject(new Error("The Clover SDK URL is not trusted."));
    if (window.Clover) return Promise.resolve();

    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () { reject(new Error("Clover's secure payment fields could not be loaded.")); };
      document.head.appendChild(script);
    });
  }

  function fieldError(event, type) {
    if (event && typeof event.error === "string") return event.error;
    if (event && event[type] && typeof event[type].error === "string") return event[type].error;
    return "";
  }

  function mountCloverFields(config) {
    var disclosureTarget = form.querySelector("[data-clover-disclosure]");
    var disclosureObserver;
    var placeCloverDisclosure = function () {
      var disclosure = document.querySelector(".clover-footer");
      if (!disclosureTarget || !disclosure) return false;
      if (disclosure.parentElement !== disclosureTarget) disclosureTarget.appendChild(disclosure);
      return true;
    };

    if (disclosureTarget && window.MutationObserver) {
      disclosureObserver = new MutationObserver(function () {
        if (placeCloverDisclosure()) disclosureObserver.disconnect();
      });
      disclosureObserver.observe(document.body, { childList: true });
    }

    clover = new window.Clover(config.publicToken, {
      merchantId: config.merchantId,
      locale: "en-US"
    });
    var elements = clover.elements();
    var styles = {
      body: {
        margin: "0",
        height: "42px",
        overflow: "hidden",
        backgroundColor: "#fcfaf6"
      },
      input: {
        width: "100%",
        height: "42px",
        margin: "0",
        border: "0",
        borderRadius: "0",
        outline: "0",
        boxShadow: "none",
        boxSizing: "border-box",
        backgroundColor: "#fcfaf6",
        padding: "0 12px",
        color: "#302c28",
        fontFamily: "Manrope, Arial, sans-serif",
        fontSize: "14px",
        fontWeight: "400",
        lineHeight: "42px"
      },
      "input::placeholder": {
        color: "#746d64",
        opacity: "1"
      }
    };

    fieldDefinitions.forEach(function (definition) {
      var element = elements.create(definition.type, styles);
      var errorElement = form.querySelector(definition.error);
      element.mount(definition.selector);
      element.addEventListener("change", function (event) {
        errorElement.textContent = fieldError(event, definition.type);
      });
    });

    if (placeCloverDisclosure() && disclosureObserver) disclosureObserver.disconnect();

    setupMessage.hidden = true;
    paymentFields.hidden = false;
    setSubmitting(false, false);
  }

  function bookingPayload() {
    var selectedSite = form.querySelector("input[name='site']:checked") || form.querySelector("input[name='site']");
    var childCount = Number(form.elements.children.value);
    var childAgeValues = form.elements.childAges.value;
    return {
      arrival: form.elements.arrival.value,
      nights: Number(form.elements.nights.value),
      sites: Number(form.elements.sites.value),
      adults: Number(form.elements.adults.value),
      children: childCount,
      childAges: childCount > 0
        ? childAgeValues.split(",").map(function (value) { return value === "" ? null : Number(value); })
        : [],
      siteType: selectedSite ? selectedSite.value : "",
      extras: Array.from(form.querySelectorAll("input[data-extra]:checked")).map(function (input) {
        return input.value;
      })
    };
  }

  function guestPayload() {
    return {
      fullName: form.elements.fullName.value,
      email: form.elements.email.value,
      phone: form.elements.phone.value
    };
  }

  function updateSummaryFromQuote(pricing) {
    function money(cents) { return "$" + (cents / 100).toFixed(2); }
    document.querySelector("[data-summary-base]").textContent = money(pricing.baseCents);
    var addOnSummary = document.querySelector("[data-summary-addons]");
    if (addOnSummary) addOnSummary.textContent = money(pricing.addOnCents);
    document.querySelector("[data-summary-tax]").textContent = money(pricing.taxCents);
    document.querySelector("[data-summary-total]").textContent = money(pricing.totalCents);
  }

  function showFieldErrors(fields) {
    if (!fields) return;
    var firstField = Object.keys(fields)[0];
    var control = form.elements[firstField];
    if (control && typeof control.setCustomValidity === "function") {
      control.setCustomValidity(fields[firstField]);
      control.reportValidity();
      control.addEventListener("input", function clearError() {
        control.setCustomValidity("");
        control.removeEventListener("input", clearError);
      });
    }
  }

  function tokenizeCard() {
    fieldDefinitions.forEach(function (definition) {
      form.querySelector(definition.error).textContent = "";
    });
    return clover.createToken().then(function (result) {
      if (result.errors) {
        Object.keys(result.errors).forEach(function (type) {
          var definition = fieldDefinitions.find(function (item) { return item.type === type; });
          if (definition) form.querySelector(definition.error).textContent = result.errors[type];
        });
        throw new Error("Review the card details highlighted above.");
      }
      if (!result.token || result.token.indexOf("clv_") !== 0) {
        throw new Error("Clover could not securely tokenize this card. Please try again.");
      }
      return result.token;
    });
  }

  function newIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.from(bytes).map(function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
  }

  function createPaymentAttempt() {
    return requestJson("/api/checkout/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ booking: bookingPayload() })
    }).then(function (quote) {
      updateSummaryFromQuote(quote.pricing);
      return tokenizeCard().then(function (source) {
        return {
          idempotencyKey: newIdempotencyKey(),
          body: {
            source: source,
            quoteToken: quote.quoteToken,
            guest: guestPayload(),
            acceptedTerms: form.elements.acceptedTerms.checked
          }
        };
      });
    });
  }

  function charge(attempt) {
    return requestJson("/api/payments/clover/charge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": attempt.idempotencyKey
      },
      body: JSON.stringify(attempt.body)
    }).catch(function (error) {
      if (!error.responseReceived) error.retrySameAttempt = true;
      throw error;
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!clover || paymentComplete) return;
    if (!form.reportValidity()) return;

    setMessage("");
    setSubmitting(true, false);

    var attemptPromise = paymentAttempt ? Promise.resolve(paymentAttempt) : createPaymentAttempt();
    attemptPromise
      .then(function (attempt) {
        paymentAttempt = attempt;
        setNativeFieldsLocked(true);
        return charge(attempt);
      })
      .then(function (result) {
        paymentComplete = true;
        setMessage(
          "Payment approved. Clover reference " + result.reference +
          (result.card && result.card.last4 ? " · " + result.card.brand + " ending in " + result.card.last4 : "") + ".",
          true
        );
        submitButton.classList.add("is-payment-approved");
        submitButton.textContent = "Payment approved";
        submitButton.disabled = true;
      })
      .catch(function (error) {
        showFieldErrors(error.fields);
        setMessage(error.message || "Payment could not be completed.");
        if (error.retrySameAttempt && paymentAttempt) {
          setNativeFieldsLocked(true);
          setSubmitting(false, true);
        } else {
          paymentAttempt = null;
          setNativeFieldsLocked(false);
          setSubmitting(false, false);
        }
      });
  });

  requestJson("/api/payments/clover/config", { headers: { accept: "application/json" } })
    .then(function (config) {
      if (!config.enabled) {
        setSetup("Clover payments are disabled until the merchant sandbox credentials are configured.", true);
        return;
      }
      return loadScript(config.sdkUrl).then(function () { mountCloverFields(config); });
    })
    .catch(function (error) {
      setSetup(error.message || "Clover could not be initialized.", true);
    });
})();
