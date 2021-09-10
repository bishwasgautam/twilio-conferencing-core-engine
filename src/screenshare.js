"use strict";

const { canScreenshare, supportsGetDisplayMedia } = require("./browser");
const Video = require("twilio-video");

const notSupported = () => {
  return Promise.reject(new Error("Screen sharing is not supported"));
};

/**
 * Create a LocalVideoTrack for your screen. You can then share it
 * with other Participants in the Room.
 * @param {number} height - Desired vertical resolution in pixels
 * @param {number} width - Desired horizontal resolution in pixels
 * @returns {Promise<LocalVideoTrack>}
 */
const createScreenTrack = (height, width) => {
  if (!canScreenshare()) return notSupported();

  if (supportsGetDisplayMedia()) {
    return navigator.mediaDevices
      .getDisplayMedia({
        video: {
          height: height,
          width: width,
        },
      })
      .then((stream) => new Video.LocalVideoTrack(stream.getVideoTracks()[0]))
      .catch(() => notSupported());
  } else {
    //Firefox v52 - v65
    return navigator.mediaDevices
      .getUserMedia({
        video: {
          mediaSource: "screen",
          height: height,
          width: width,
        },
      })
      .then((stream) => new Video.LocalVideoTrack(stream.getVideoTracks()[0]))
      .catch(() => notSupported());
  }
};

module.exports = { createScreenTrack };
