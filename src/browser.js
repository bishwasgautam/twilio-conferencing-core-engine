"use strict";

/**
 * Add URL parameters to the web app URL.
 * @param params - the parameters to add
 */
function addUrlParams(params) {
  const combinedParams = Object.assign(getUrlParams(), params);
  const serializedParams = Object.entries(combinedParams)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&");
  history.pushState(null, "", `${location.pathname}?${serializedParams}`);
}

/**
 * Generate an object map of URL parameters.
 * @returns {*}
 */
function getUrlParams() {
  const serializedParams = location.search.split("?")[1];
  const nvpairs = serializedParams ? serializedParams.split("&") : [];
  return nvpairs.reduce((params, nvpair) => {
    const [name, value] = nvpair.split("=");
    params[name] = decodeURIComponent(value);
    return params;
  }, {});
}

/**
 * Whether the web app is running on a mobile browser.
 * @type {boolean}
 */
const isMobile = (() => {
  //ref: https://developer.mozilla.org/en-US/docs/Web/HTTP/Browser_detection_using_the_user_agent
  var hasTouchScreen = false;
  if ("maxTouchPoints" in navigator) {
    hasTouchScreen = navigator.maxTouchPoints > 0;
  } else if ("msMaxTouchPoints" in navigator) {
    hasTouchScreen = navigator.msMaxTouchPoints > 0;
  } else {
    var mQ = window.matchMedia && matchMedia("(pointer:coarse)");
    if (mQ && mQ.media === "(pointer:coarse)") {
      hasTouchScreen = !!mQ.matches;
    } else if ("orientation" in window) {
      hasTouchScreen = true; // deprecated, but good fallback
    } else {
      // Only as a last resort, fall back to user agent sniffing
      var UA = navigator.userAgent;
      hasTouchScreen =
        /\b(BlackBerry|webOS|iPhone|IEMobile)\b/i.test(UA) ||
        /\b(Android|Windows Phone|iPad|iPod)\b/i.test(UA);
    }
  }
  return hasTouchScreen;
})();

const isValidFirefoxForScreenshare = () => {
  var supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
  var mediaSourceSupport =
    supportedConstraints && !!supportedConstraints.mediaSource;
  var matchData = navigator.userAgent.match(/Firefox\/(\d+)/);
  var firefoxVersion = 0;
  if (matchData && matchData[1]) {
    firefoxVersion = parseInt(matchData[1], 10);
  }
  return mediaSourceSupport && firefoxVersion >= 52;
};

const getFirefoxVersion = () => {
  var matchData = navigator.userAgent.match(/Firefox\/(\d+)/);
  return matchData && parseInt(matchData[1], 10);
};

/**
 * Will return true for Chrome, and Chromium based browsers (ex Edge v42+)
 */
const isValidChromeForScreenshare = () => {
  var matchData = navigator.userAgent.match(/Chrome\/(\d+)/);
  var chromeVersion = 0;
  if (matchData && matchData[1]) {
    chromeVersion = parseInt(matchData[1], 10);
  }
  return chromeVersion >= 71;
};

const isValidSafariForScreenshare = () => {
  if (navigator.userAgent.includes("Safari")) {
    var matchData = navigator.userAgent.match(/Version\/(\d+)/);
    var safariVersion = 0;
    if (matchData && matchData[1]) {
      safariVersion = parseFloat(matchData[1]);
    }
    return safariVersion >= 12.2;
  }

  return false;
};

/**
 * Supported browsers: Chrome (72+), Firefox (52+), Safari (12.2+), Edge (42+)
 */
const canScreenshare = () => {
  return (
    !isMobile &&
    (isValidChromeForScreenshare() ||
      isValidFirefoxForScreenshare() ||
      isValidSafariForScreenshare())
  );
};

/**
 * Will return true for all screen cast supported browsers except for Firefox (v52 - v65)
 */
const supportsGetDisplayMedia = () => {
  var firefoxVersion = getFirefoxVersion();
  return (
    canScreenshare() &&
    (firefoxVersion === null || firefoxVersion >= 66) &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getDisplayMedia
  );
};

module.exports = {
  addUrlParams,
  getUrlParams,
  isMobile,
  canScreenshare,
  supportsGetDisplayMedia,
};
