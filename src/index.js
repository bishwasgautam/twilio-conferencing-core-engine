"use strict";

const Video = require("twilio-video");
const {
  isMobile,
  canScreenshare,
  getUrlParams,
  addUrlParams,
} = require("./browser");
const Media = require("./selectmedia");
const attachMicVolumeListener = require("./miclevel");
const { createScreenTrack } = require("./screenshare");
const getRoomCredentials = require("./Util/getRoomCredentials");
const defaultConnectOptions = require("./defaultConnectOptions");

const conferenceEvents = {
  RoomConnected: "RoomConnected",
  RoomCompleted: "RoomCompleted",
  ParticipantConnected: "ParticipantConnected",
  ParticipantDisconnected: "ParticipantDisconnected",
  ParticipantSubscribedTrack: "ParticipantSubscribedTrack",
  ParticipantUnsubscribedTrack: "ParticipantUnsubscribedTrack",
  DominantSpeakerChanged: "DominantSpeakerChanged",
  ExistingParticipantsReportingComplete:
    "ExistingParticipantsReportingComplete",
  ErrorOccured: "ErrorOccured",
  Debug: "Debug",
};

const MediaType = { Video: "video", Audio: "audio" };

const TwilioVideoConferenceEngine = function () {
  var eventCallbacks, currentRoom, currentConnectOptions, currentScreenTrack;

  // For mobile browsers, limit the maximum incoming video bitrate to 2.5 Mbps.
  if (isMobile) {
    defaultConnectOptions.bandwidthProfile.video.maxSubscriptionBitrate = 2500000;
  }

  // On mobile browsers, there is the possibility of not getting any media even
  // after the user has given permission, most likely due to some other app reserving
  // the media device. So, we make sure users always test their media devices before
  // joining the Room. For more best practices, please refer to the following guide:
  // https://www.twilio.com/docs/video/build-js-video-application-recommendations-and-best-practices
  let deviceIds;

  const fetchDeviceIds = () => {
    deviceIds = {
      audio: localStorage.getItem("audioInputDeviceId"),
      video: localStorage.getItem("videoDeviceId"),
    };
  };

  /**
   *
   * @param {string} eventType - the type of event to report
   * @param {any} args - the info associated with the event
   */
  const notifyOfEvent = (eventType, args) => {
    //Invoke
    var callback = eventCallbacks[`on${eventType}`];
    if (callback) callback(args);
  };

  /**
   *
   * @param {any} participant - the user who disconnected
   */
  const participantDisconnected = (participant) => {
    notifyOfEvent(conferenceEvents.ParticipantDisconnected, participant);
  };

  const dominantSpeakerChanged = (participant) => {
    notifyOfEvent(conferenceEvents.DominantSpeakerChanged, participant);
  };

  /**
   *
   * @param {any} track - the media track that was subscribed
   */
  const trackSubscribed = (track) => {
    notifyOfEvent(conferenceEvents.ParticipantSubscribedTrack, track);
  };

  /**
   *
   * @param {any} track - the media track that was unsubscribed
   */
  const trackUnsubscribed = (track) => {
    //Setup track unmute event
    if (track.on) {
      track.on("enabled", ({ publication, participant }) =>
        trackSubscribed({ track: publication.track, participant })
      );
    }

    notifyOfEvent(conferenceEvents.ParticipantUnsubscribedTrack, track);
  };

  /**
   *
   * @param {any} track - media track
   */
  const setupTrackMuteEvents = (track, participant) => {
    if (track && track.on) {
      track.on("disabled", () => {
        trackUnsubscribed({ track, participant });
      });
      track.on("enabled", () => {
        trackSubscribed({ track, participant });
      });
    }
  };

  /**
   *
   * @param {any} participant - the user who connected
   */
  const participantConnected = (participant, isRemote = true) => {
    //Fire callback
    notifyOfEvent(conferenceEvents.ParticipantConnected, participant);

    //subscribe to tracks already published by participant
    participant.tracks.forEach((publication) => {
      if (publication.isSubscribed || publication.track) {
        if (isRemote && publication.track) {
          setupTrackMuteEvents(publication.track, participant);
        }
        trackSubscribed({
          track: { ...publication.track, sid: publication.trackSid },
          participant,
        });
      }

      publication.on("subscribed", (track) => {
        if (isRemote) {
          setupTrackMuteEvents(track, participant);
        }
        trackSubscribed({ track, participant });
      });

      // Once the TrackPublication is unsubscribed from, detach the Track from the DOM.
      publication.on("unsubscribed", (track) => {
        trackUnsubscribed({ track, participant });
      });
    });

    //listen to any future track subscribe/unsubscribe events by the participant - LOCAL
    participant.on("trackSubscribed", (track) => {
      if (isRemote) {
        setupTrackMuteEvents(track, participant);
      }
      trackSubscribed({ track, participant });
    });

    participant.on("trackUnsubscribed", (track) =>
      trackUnsubscribed({ track, participant })
    );

    // Handle the TrackPublications that will be published by the Participant later.
    participant.on("trackPublished", (publication) => {
      trackSubscribed({
        track: { ...publication.track, sid: publication.trackSid },
        participant,
      });
    });

    participant.on("trackUnpublished", (publication) => {
      trackUnsubscribed({
        track: { ...publication.track, sid: publication.trackSid },
        participant,
      });
    });
  };
  /**
   *
   * @param {string} accessToken user identity jwt object generated by twilio token generator
   * @param {string} roomName
   * @param {object} connectOptions
   */
  const joinRoom = async (accessToken, roomName, connectOptions) => {
    if (typeof accessToken === "undefined" || !accessToken)
      throw new Error("User access token not supplied");

    if (typeof roomName === "undefined" || !roomName)
      throw new Error("Room name is not supplied");

    if (typeof eventCallbacks === "undefined" || !eventCallbacks)
      throw new Error(
        "Event callbacks not registered, please register and initialize event callbacks"
      );

    connectOptions = connectOptions || defaultConnectOptions;
    connectOptions.name = roomName;

    if (typeof deviceIds === "undefined") {
      fetchDeviceIds();
    }

    // Add the specified audio device ID to ConnectOptions.
    if (connectOptions.audio && !connectOptions.audio.deviceId) {
      connectOptions.audio.deviceId = { exact: deviceIds.audio };
    } else if (!connectOptions.audio) {
      throw new Error("Sorry no audio info found");
    }

    // Add the specified video device ID to ConnectOptions.
    if (connectOptions.video && !connectOptions.video.deviceId) {
      connectOptions.video.deviceId = { exact: deviceIds.video };
    } else if (!connectOptions.video) {
      throw new Error("Sorry no video info found");
    }

    if (
      typeof connectOptions.audio.deviceId === "undefined" ||
      !connectOptions.audio.deviceId
    ) {
      throw new Error("Sorry, can't access audio - no device id found");
    }

    if (
      typeof connectOptions.video.deviceId === "undefined" ||
      !connectOptions.video.deviceId
    ) {
      throw new Error("Sorry, can't access video - no device id found");
    }

    currentConnectOptions = connectOptions;

    //async
    return new Promise((resolve, reject) => {
      Video.connect(accessToken, connectOptions)
        .then((room) => {
          notifyOfEvent(conferenceEvents.RoomConnected, room);

          currentRoom = room;

          //Local participant
          participantConnected(room.localParticipant, false);

          //Remote participants already connected
          room.participants.forEach(participantConnected);

          room.on("participantConnected", participantConnected);

          room.on("participantDisconnected", participantDisconnected);

          room.on("trackSubscribed", (track, publication, participant) => {
            setupTrackMuteEvents(track, participant);
          });
          //Let the client know that all participants events have been initialized
          notifyOfEvent(
            conferenceEvents.ExistingParticipantsReportingComplete,
            room
          );

          room.on("dominantSpeakerChanged", dominantSpeakerChanged);

          room.once("disconnected", (error) => {
            participantDisconnected(room.localParticipant);
            room.participants.forEach(participantDisconnected);
            if (!error) notifyOfEvent(conferenceEvents.RoomCompleted, room);
            else notifyOfEvent(conferenceEvents.ErrorOccured, error);
          });

          resolve(room);
        })
        .catch((error) => {
          reject(error);
        });
    });
  };

  /**
   * @param {string} token
   * @param {object} event_callbacks
   */
  const init = (event_callbacks) => {
    if (typeof event_callbacks === "undefined")
      throw new Error("Init without Event callbacks");

    eventCallbacks = event_callbacks;

    //Return an error if video is not supported
    if (!Video.isSupported)
      return new Error("Sorry, this browser is not supported by Twilio Video");
  };

  /**
   *
   * @param {function} onRoomConnected
   * @param {function} onRoomDisconnected
   * @param {function} onParticipantConnected
   * @param {function} onParticipantDisconnected
   * @param {function} onParticipantTrackSubscribed
   * @param {function} onParticipantTrackUnsubscribed
   * @param {function} onDominantSpeakerChanged
   * @param {function} onExistingParticipantsReportingComplete
   * @param {function} onErrorOccured
   * @return {object}
   */
  const registerCallbacks = (
    onRoomConnected,
    onRoomDisconnected,
    onParticipantConnected,
    onParticipantDisconnected,
    onParticipantSubscribedTrack,
    onParticipantUnsubscribedTrack,
    onDominantSpeakerChanged,
    onExistingParticipantsReportingComplete,
    onErrorOccured,
    onDebug
  ) => {
    return {
      onRoomConnected: (room) => {
        if (typeof onRoomConnected !== "undefined") onRoomConnected(room);
      },
      onRoomDisconnected: (room) => {
        if (typeof onRoomDisconnected !== "undefined") onRoomDisconnected(room);
      },
      onParticipantConnected: (participant) => {
        if (typeof onParticipantConnected !== "undefined")
          onParticipantConnected(participant);
      },
      onParticipantDisconnected: (participant) => {
        if (typeof onParticipantDisconnected !== "undefined")
          onParticipantDisconnected(participant);
      },
      onParticipantSubscribedTrack: (track) => {
        if (typeof onParticipantSubscribedTrack !== "undefined")
          onParticipantSubscribedTrack(track);
      },
      onParticipantUnsubscribedTrack: (track) => {
        if (typeof onParticipantUnsubscribedTrack !== "undefined")
          onParticipantUnsubscribedTrack(track);
      },
      onDominantSpeakerChanged: (participant) => {
        if (typeof onDominantSpeakerChanged !== "undefined")
          onDominantSpeakerChanged(participant);
      },
      onExistingParticipantsReportingComplete: (room) => {
        if (typeof onExistingParticipantsReportingComplete !== "undefined")
          onExistingParticipantsReportingComplete(room);
      },
      onErrorOccured: (error) => {
        if (typeof onErrorOccured !== "undefined") onErrorOccured(error);
      },
      onDebug: (msg) => {
        if (typeof onDebug !== "undefined") onDebug(msg);
      },
    };
  };

  /**
   * Turn on audio track
   * @returns {Promise<void>}
   */
  const turnOnMyAudio = async (deviceId) => {
    return new Promise((resolve, reject) => {
      if (typeof currentRoom === "undefined") {
        reject("Can't turn on audio - room is null");
      }

      if (deviceId && currentConnectOptions.audio) {
        currentConnectOptions.audio.deviceId = deviceId;
      }
      if (currentConnectOptions.audio && currentConnectOptions.audio.deviceId) {
        Video.createLocalAudioTrack(currentConnectOptions.audio)
          .then((track) => {
            currentRoom.localParticipant
              .publishTrack(track)
              .then(() => resolve())
              .catch((e) => {
                reject(`Could not publish audio track ${e.message}`);
              });
          })
          .catch((e) =>
            reject(
              `Can't turn on audio - an issue occured when creating local audio track - ${e.message}`
            )
          );
      } else {
        reject("Can't turn on audio - Audio device id not found");
      }
    });
  };

  /**
   * Turn on video track
   * @returns {Promise<void>}
   */
  const turnOnMyVideo = async (deviceId) => {
    return new Promise((resolve, reject) => {
      if (typeof currentRoom === "undefined") {
        reject("Can't turn on video - room is null");
      }

      if (deviceId && currentConnectOptions.video) {
        currentConnectOptions.video.deviceId = deviceId;
      }

      if (currentConnectOptions.video && currentConnectOptions.video.deviceId) {
        Video.createLocalVideoTrack(currentConnectOptions.video)
          .then((track) => {
            currentRoom.localParticipant
              .publishTrack(track)
              .then(() => resolve())
              .catch((e) => {
                reject(`Could not publish video track - ${e.message}`);
              });
          })
          .catch((e) =>
            reject(
              `Can't turn on video - an issue occured when creating local video track - ${e.message}`
            )
          );
      } else {
        reject("Can't turn on video - Video device id not found");
      }
    });
  };

  /**
   * Turn off current video track
   * @returns {Promise<void>}
   */
  const turnOffMyVideo = async () => {
    return new Promise((resolve, reject) => {
      if (
        !currentRoom ||
        !currentRoom.localParticipant ||
        !currentRoom.localParticipant.videoTracks
      ) {
        reject("Room, local participant or video track info is missing");
      }

      var localVideoTracks = Array.from(
        currentRoom.localParticipant.videoTracks.values()
      );

      if (localVideoTracks.length) {
        var localVideoTrack = localVideoTracks[0].track;
        if (localVideoTrack) {
          try {
            currentRoom.localParticipant.unpublishTrack(localVideoTrack);
            localVideoTrack.stop();

            //https://github.com/twilio/twilio-video.js/issues/656#issuecomment-499207086
            //This event is not fired by default for a local participant
            //Force fire
            trackUnsubscribed({
              track: { kind: MediaType.Video },
              participant: currentRoom.localParticipant,
            });

            resolve();
          } catch (e) {
            reject(
              `An error occured while stopping video track - ${e.message}`
            );
          }
        } else {
          reject("No video track info found to unpublish");
        }
      } else {
        reject("No video tracks found to unpublish");
      }
    });
  };

  /**
   * Turn off current audio track
   * @returns {Promise<void>}
   */
  const turnOffMyAudio = async () => {
    return new Promise((resolve, reject) => {
      if (
        !currentRoom ||
        !currentRoom.localParticipant ||
        !currentRoom.localParticipant.audioTracks
      ) {
        reject("Room, local participant or audio track info is missing");
      }

      var localAudioTracks = Array.from(
        currentRoom.localParticipant.audioTracks.values()
      );

      if (localAudioTracks.length) {
        var localAudioTrack = localAudioTracks[0].track;
        if (localAudioTrack) {
          try {
            currentRoom.localParticipant.unpublishTrack(localAudioTrack);
            localAudioTrack.stop();

            //https://github.com/twilio/twilio-video.js/issues/656#issuecomment-499207086
            //This event is not fired by default for a local participant
            //Force fire
            trackUnsubscribed({
              track: { kind: MediaType.Audio },
              participant: currentRoom.localParticipant,
            });
            resolve();
          } catch (e) {
            reject(
              `An error occured while stopping audio track - ${e.message}`
            );
          }
        } else {
          reject("No audio track info found to unpublish");
        }
      } else {
        reject("No audio track found to unpublish");
      }
    });
  };

  /**
   * Create a LocalVideoTrack for your screen. You can then share it
   * with other Participants in the Room.
   * @param {number} height - Desired vertical resolution in pixels
   * @param {number} width - Desired horizontal resolution in pixels
   * @returns {Promise<void>}
   */
  const startScreenShare = async (height, width) => {
    width = width || currentConnectOptions.video.width;
    height = height || currentConnectOptions.video.height;

    return new Promise((resolve, reject) => {
      createScreenTrack(height, width)
        .then((track) => {
          if (track) {
            currentScreenTrack = track;

            if (currentRoom.localParticipant.videoTracks) {
              currentRoom.localParticipant.videoTracks.forEach((track) =>
                track.setPriority("low")
              );
            }

            currentRoom.localParticipant
              .publishTrack(track, {
                priority: "high", //choose among 'high', 'standard' or 'low'
              })
              .then(() => resolve())
              .catch((e) => {
                reject(`Could not publish video track ${e.message}`);
              });
          }
        })
        .catch((e) => {
          reject(`An error occured while starting screen share - ${e.message}`);
        });
    });
  };

  /**
   * Stop screen sharing
   * @returns {Promise<void>}
   */
  const stopScreenShare = async () => {
    return new Promise((resolve, reject) => {
      try {
        if (currentScreenTrack) {
          currentScreenTrack.stop();
          currentScreenTrack = null;

          if (currentRoom.localParticipant.videoTracks) {
            currentRoom.localParticipant.videoTracks.forEach((track) =>
              track.setPriority("high")
            );
          }

          resolve();
        }
      } catch (e) {
        reject(`Error when stopping screen track: ${e.message}`);
      }
    });
  };

  /**
   *
   * @param {string} roomName - the room being quit
   */
  const leaveRoom = (roomName) => {
    //turn off local tracks
    turnOffMyVideo();
    turnOffMyAudio();

    //call participant disconnected callback for local participant
    notifyOfEvent(
      conferenceEvents.ParticipantDisconnected,
      currentRoom ? currentRoom.localParticipant : null
    );

    if (!currentRoom) return;

    //call participant disconnected callback for all remote participants
    currentRoom.participants.forEach((participant) => {
      notifyOfEvent(conferenceEvents.ParticipantDisconnected, participant);
    });

    notifyOfEvent(conferenceEvents.Debug, `Disconnected from room ${roomName}`);

    if (currentRoom) currentRoom.disconnect();

    currentRoom = null;
  };

  /**
   *
   * @param {function} render - the function to call with the video media stream
   */
  const selectDefaultVideoSource = (render) => {
    Media.selectDefaultMedia(MediaType.Video, render);
  };

  /**
   *
   * @param {function} render - the function to call with the audio media stream
   */
  const selectDefaultAudioSource = (render) => {
    Media.selectDefaultMedia(MediaType.Audio, render);
  };

  /**
   *
   * @param {string} videoDeviceId - the id of the video device
   * @param {function} render -  - the function to call with the video media stream
   */
  const changeVideoSource = (videoDeviceId, render) => {
    Media.applyInputDevice(MediaType.Video, videoDeviceId, render);
  };

  /**
   *
   * @param {string} audioInputDeviceId - the id of the audio device
   * @param {function} render -  - the function to call with the audio media stream
   */
  const changeAudioSource = (audioInputDeviceId, render) => {
    Media.applyInputDevice(MediaType.Audio, audioInputDeviceId, render);
  };

  /**
   * @returns {Promise<MediaDeviceInfo[]>} the list of video media devices
   */
  const listAllVideoDevices = async () => {
    return await Media.getInputDevices(MediaType.Video);
  };

  /**
   * @deprecated Please use listAllAudioInputDevices and listAllAudioOutputDevices
   * @returns {Promise<MediaDeviceInfo[]>} the list of audio media devices
   */
  const listAllAudioDevices = async () => {
    return await Media.getInputDevices(MediaType.Audio);
  };

  /**
   * @returns {Promise<MediaDeviceInfo[]>} the list of audio media devices
   */
  const listAllAudioInputDevices = async () => {
    return await Media.getInputDevices(MediaType.Audio);
  };

  /*
   * @returns {Promise<MediaDeviceInfo[]>} the list of audio media devices
   */
  const listAllAudioOutputDevices = async () => {
    return await Media.getOutputDevices(MediaType.Audio);
  };

  /**
   * @param {function} callback the function to execute when a device is added or removed, callback must handle argument MediaDeviceInfo[]
   */
  const onMediaDevicesListChange = async (callback) => {
    if (!callback) {
      notifyOfEvent(
        conferenceEvents.ErrorOccured,
        `onMediaDevicesListChange - callback was not supplied, no change handler will be registered`
      );
    }

    return await Media.registerOnMediaDevicesListChangeHandler(callback);
  };

  const isBrowserSupported = () => {
    return Video.isSupported;
  };

  const assignDefaultAudioInputDeviceId = (audioInputDeviceId) => {
    if (localStorage)
      localStorage.setItem("audioInputDeviceId", audioInputDeviceId);
  };

  const assignDefaultAudioOutputDeviceId = (audioOutputDeviceId) => {
    if (localStorage)
      localStorage.setItem("audioOutputDeviceId", audioOutputDeviceId);
  };

  const assignDefaultVideoInputDeviceId = (videoDeviceId) => {
    if (localStorage) localStorage.setItem("videoDeviceId", videoDeviceId);
  };

  const clearDefaultAudioInputDeviceId = () => {
    if (localStorage) localStorage.removeItem("audioInputDeviceId");
  };

  const clearDefaultAudioOutputDeviceId = () => {
    if (localStorage) localStorage.removeItem("audioOutputDeviceId");
  };

  const clearDefaultVideoInputDeviceId = () => {
    if (localStorage) localStorage.removeItem("videoDeviceId");
  };

  const clearAllDefaultMediaDeviceIds = () => {
    clearDefaultAudioInputDeviceId();
    clearDefaultAudioOutputDeviceId();
    clearDefaultVideoInputDeviceId();
  };

  //Public API
  return {
    registerCallbacks,
    init,
    joinRoom,
    leaveRoom,
    turnOnMyVideo,
    turnOnMyAudio,
    turnOffMyVideo,
    turnOffMyAudio,
    changeVideoSource,
    changeAudioSource,
    listAllVideoDevices,
    listAllAudioDevices,
    listAllAudioInputDevices,
    listAllAudioOutputDevices,
    onMediaDevicesListChange,
    startScreenShare,
    stopScreenShare,
    getRoomCredentials,
    attachMicVolumeListener,
    selectDefaultVideoSource,
    selectDefaultAudioSource,
    assignDefaultAudioInputDeviceId,
    assignDefaultAudioOutputDeviceId,
    assignDefaultVideoInputDeviceId,
    clearDefaultAudioInputDeviceId,
    clearDefaultAudioOutputDeviceId,
    clearDefaultVideoInputDeviceId,
    clearAllDefaultMediaDeviceIds,
    isMobile: isMobile,
    getUrlParams,
    addUrlParams,
    isBrowserSupported,
    canScreenshare,
  };
};

module.exports = { CoreConferenceEngine: new TwilioVideoConferenceEngine() };
