'use strict';

const { createLocalTracks } = require('twilio-video');

const localTracks = {
    audio: null,
    video: null
};

/**
 * Start capturing media from the given input device.
 * @param kind - 'audio' or 'video'
 * @param deviceId - the input device ID
 * @param render - the render callback
 * @returns {Promise<void>} Promise that is resolved if successful
 */
async function applyInputDevice(kind, deviceId, render) {
    // Create a new LocalTrack from the given Device ID.
    const [track] = await createLocalTracks({ [kind]: { deviceId } });

    // Stop the previous LocalTrack, if present.
    if (localTracks[kind]) {
        localTracks[kind].stop();
    }

    // Render the current LocalTrack.
    localTracks[kind] = track;
    render(new MediaStream([track.mediaStreamTrack]));
}

//safari requires getUserMedia to be called before devices are enumerated with deviceId and label
//otherwise it only returns the default
async function ensureGetMediaCalled() {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
}

/**
 * Get the list of input devices of a given kind.
 * @param kind - 'audio' | 'video'
 * @returns {Promise<MediaDeviceInfo[]>} the list of media devices
 */
async function getInputDevices(kind) {
   return ensureGetMediaCalled().then(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(device => device.kind === `${kind}input`);
    }).catch(() => null);
}


/**
 * Select the default input for the given media kind.
 * @param kind - 'audio' or 'video' 
 * @param render - the media render function
 * @returns {Promise<string>} the device ID of the selected media input
 */
async function selectDefaultMedia(kind, render) {
    // Get the list of available media input devices.
    let devices = await getInputDevices(kind);

    // Apply the default media input device.
    await applyInputDevice(kind, devices[0].deviceId, render);

    // If all device IDs and/or labels are empty, that means they were
    // enumerated before the user granted media permissions. So, enumerate
    // the devices again.
    if (devices.every(({ deviceId, label }) => !deviceId || !label)) {
        devices = await getInputDevices(kind);
    }

    return new Promise(resolve => {
           
        localStorage.setItem(`${kind}DeviceId`, devices[0].deviceId);
        resolve(devices[0].deviceId);

    });
}

module.exports = { getInputDevices, selectDefaultMedia, applyInputDevice}