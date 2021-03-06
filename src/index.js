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
      audio: localStorage.getItem("audioDeviceId"),
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
      track.on("enabled", () =>
        trackSubscribed({ track: publication.track, participant })
      );
    }

    notifyOfEvent(conferenceEvents.ParticipantUnsubscribedTrack, track);
  };

  /**
   *
   * @param {any} track - media track
   */
  const setupTrackMuteEvents = (track) => {
    if (track && track.on) {
      track.on("disabled", () => {
        trackUnsubscribed({ track: publication.track, participant });
      });
      track.on("enabled", () => {
        trackSubscribed({ track: publication.track, participant });
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
          setupTrackMuteEvents(publication.track);
        }
        trackSubscribed({ track: publication.track, participant });
      }

      publication.on("subscribed", (track) => {
        if (isRemote) {
          setupTrackMuteEvents(track);
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
        setupTrackMuteEvents(track);
      }
      trackSubscribed({ track, participant });
    });

    participant.on("trackUnsubscribed", (track) =>
      trackUnsubscribed({ track, participant })
    );

    // Handle the TrackPublications that will be published by the Participant later.
    participant.on("trackPublished", (publication) => {
      trackSubscribed({ track: publication.track, participant });
    });

    participant.on("trackUnpublished", (publication) => {
      trackUnsubscribed({ track: publication.track, participant });
    });
  };
  /**
   *
   * @param {string} accessToken user identity jwt object generated by twilio token generator
   * @param {string} roomName
   * @param {object} connectOptions
   */
  async function joinRoom(accessToken, roomName, connectOptions) {
    if (typeof accessToken === "undefined")
      throw new Error("User access token not supplied");

    if (typeof roomName === "undefined")
      throw new Error("Room name is not supplied");

    if (typeof eventCallbacks === "undefined")
      throw new Error(
        "Event callbacks not registered, please register and initialize event callbacks"
      );

    connectOptions = connectOptions || defaultConnectOptions;
    connectOptions.name = roomName;

    if (typeof deviceIds === "undefined") fetchDeviceIds();

    // Add the specified audio device ID to ConnectOptions.
    if (connectOptions.audio)
      connectOptions.audio.deviceId = { exact: deviceIds.audio };

    // Add the specified video device ID to ConnectOptions.
    if (connectOptions.video)
      connectOptions.video.deviceId = { exact: deviceIds.video };

    currentConnectOptions = connectOptions;

    //async
    return new Promise((resolve, reject) => {
      Video.connect(accessToken, connectOptions)
        .then((room) => {
          notifyOfEvent(conferenceEvents.RoomConnected, room);

          currentRoom = room;

          localStorage.setItem("userName", accessToken);

          //Local participant
          participantConnected(room.localParticipant, false);

          //Remote participants already connected
          room.participants.forEach(participantConnected);

          room.on("participantConnected", participantConnected);

          room.on("participantDisconnected", participantDisconnected);

          room.on("trackSubscribed", (track) => {
            setupTrackMuteEvents(track);
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
  }

  /**
   * @param {string} token
   * @param {object} event_callbacks
   */
  var init = (event_callbacks) => {
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
    onErrorOccured
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
    };
  };

  const turnOffMyVideo = () => {
    if (
      !currentRoom ||
      !currentRoom.localParticipant ||
      !currentRoom.localParticipant.videoTracks
    )
      return;

    var localVideoTracks = Array.from(
      currentRoom.localParticipant.videoTracks.values()
    );

    if (localVideoTracks.length) {
      var localVideoTrack = localVideoTracks[0].track;
      if (localVideoTrack) {
        currentRoom.localParticipant.unpublishTrack(localVideoTrack);
        localVideoTrack.stop();

        //https://github.com/twilio/twilio-video.js/issues/656#issuecomment-499207086
        //This event is not fired by default for a local participant
        //Force fire
        trackUnsubscribed({
          track: { kind: MediaType.Video },
          participant: currentRoom.localParticipant,
        });
      }
    }
  };

  const turnOffMyAudio = () => {
    if (
      !currentRoom ||
      !currentRoom.localParticipant ||
      !currentRoom.localParticipant.audioTracks
    )
      return;

    var localAudioTracks = Array.from(
      currentRoom.localParticipant.audioTracks.values()
    );

    if (localAudioTracks.length) {
      var localAudioTrack = localAudioTracks[0].track;
      if (localAudioTrack) {
        currentRoom.localParticipant.unpublishTrack(localAudioTrack);
        localAudioTrack.stop();

        //https://github.com/twilio/twilio-video.js/issues/656#issuecomment-499207086
        //This event is not fired by default for a local participant
        //Force fire
        trackUnsubscribed({
          track: { kind: MediaType.Audio },
          participant: currentRoom.localParticipant,
        });
      }
    }
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
      currentRoom.localParticipant
    );

    //call participant disconnected callback for all remote participants
    currentRoom.participants.forEach((participant) => {
      notifyOfEvent(conferenceEvents.ParticipantDisconnected, participant);
    });

    var identity = localStorage.getItem("userName");

    //TODO remove this in prod
    console.log(`${identity} disconnected from room ${roomName}`);

    localStorage.removeItem("userName");

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

  async function turnOnMyVideo() {
    if (typeof currentRoom === "undefined") return;

    if (currentConnectOptions.video && currentConnectOptions.video.deviceId) {
      var localVideoTrack = await Video.createLocalVideoTrack(
        currentConnectOptions.video
      );
      await currentRoom.localParticipant.publishTrack(localVideoTrack);
    }
  }

  /**
   *
   * @param {function} render - the function to call with the audio media stream
   */
  const selectDefaultAudioSource = (render) => {
    Media.selectDefaultMedia(MediaType.Audio, render);
  };

  async function turnOnMyAudio() {
    if (typeof currentRoom === "undefined") return;

    if (currentConnectOptions.audio && currentConnectOptions.audio.deviceId) {
      var localAudioTrack = await Video.createLocalAudioTrack(
        currentConnectOptions.audio
      );
      await currentRoom.localParticipant.publishTrack(localAudioTrack);
    }
  }

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
   * @param {string} audioDeviceId - the id of the audio device
   * @param {function} render -  - the function to call with the audio media stream
   */
  const changeAudioSource = (audioDeviceId, render) => {
    Media.applyInputDevice(MediaType.Audio, audioDeviceId, render);
  };

  /**
   * @returns {Promise<MediaDeviceInfo[]>} the list of video media devices
   */
  async function listAllVideoDevices() {
    return await Media.getInputDevices(MediaType.Video);
  }

  /**
   * @returns {Promise<MediaDeviceInfo[]>} the list of audio media devices
   */
  async function listAllAudioDevices() {
    return await Media.getInputDevices(MediaType.Audio);
  }

  /**
   * Create a LocalVideoTrack for your screen. You can then share it
   * with other Participants in the Room.
   * @param {number} height - Desired vertical resolution in pixels
   * @param {number} width - Desired horizontal resolution in pixels
   * @returns {Promise<LocalVideoTrack>}
   */
  const startScreenShare = async (height, width) => {
    width = width || currentConnectOptions.video.width;
    height = height || currentConnectOptions.video.height;
    createScreenTrack(height, width)
      .then((track) => {
        turnOffMyVideo();
        currentScreenTrack = track;
        currentRoom.localParticipant.publishTrack(track);
      })
      .catch((e) => {
        return Promise.reject(e);
      });
  };

  const stopScreenShare = () => {
    if (currentScreenTrack) {
      currentScreenTrack.stop();
      currentScreenTrack = null;
      turnOnMyVideo();
    }
  };

  const isBrowserSupported = () => {
    return Video.isSupported;
  };

  const assignDefaultAudioInputDeviceId = (audioDeviceId) => {
    if (localStorage) localStorage.setItem("audioDeviceId", audioDeviceId);
  };

  const assignDefaultVideoInputDeviceId = (videoDeviceId) => {
    if (localStorage) localStorage.setItem("videoDeviceId", videoDeviceId);
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
    startScreenShare,
    stopScreenShare,
    getRoomCredentials,
    attachMicVolumeListener,
    selectDefaultVideoSource,
    selectDefaultAudioSource,
    assignDefaultAudioInputDeviceId,
    assignDefaultVideoInputDeviceId,
    isMobile: isMobile,
    getUrlParams,
    addUrlParams,
    isBrowserSupported,
    canScreenshare,
  };
};

module.exports = { CoreConferenceEngine: new TwilioVideoConferenceEngine() };
