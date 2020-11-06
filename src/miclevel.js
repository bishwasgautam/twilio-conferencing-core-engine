"use strict";

/**
 * Calculate the root mean square (RMS) of the given array.
 * @param samples
 * @returns {number} the RMS value
 */
function rootMeanSquare(samples) {
  const sumSq = samples.reduce((sumSq, sample) => sumSq + sample * sample, 0);
  return Math.sqrt(sumSq / samples.length);
}

let audioContext;
const getAudioContext = () => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioContext = audioContext || AudioContext ? new AudioContext() : null;
  return audioContext;
};

/**
 * Poll the microphone's input level.
 * @param stream - the MediaStream representing the microphone
 * @param maxLevel - the calculated level should be in the range [0 - maxLevel]
 * @param onLevel - called when the input level changes
 */
function micLevel(stream, maxLevel, onLevel) {
  var audioContext = getAudioContext();

  if (typeof audioContext !== "undefined" && audioContext !== null)
    audioContext.resume().then(() => {
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);

      const track = stream.getTracks()[0];
      let level = null;

      requestAnimationFrame(function checkLevel() {
        analyser.getByteFrequencyData(samples);
        const rms = rootMeanSquare(samples);
        const log2Rms = rms && Math.log2(rms);
        const newLevel = Math.ceil((maxLevel * log2Rms) / 8);

        if (level !== newLevel) {
          level = newLevel;
          onLevel(level);
        }

        requestAnimationFrame(
          track.readyState === "ended" ? () => onLevel(0) : checkLevel
        );
      });
    });
}

module.exports = micLevel;
