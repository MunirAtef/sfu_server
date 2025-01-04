'use strict'

let DEFINED_PEERS = 0;

const _EVENTS = {
  onLeave: 'onLeave',
  onJoin: 'onJoin',
  onCreate: 'onCreate',
  onStreamStarted: 'onStreamStarted',
  onStreamEnded: 'onStreamEnded',
  onReady: 'onReady',
  onScreenShareStopped: 'onScreenShareStopped',
  exitRoom: 'exitRoom',
  onConnected: 'onConnected',
  onRemoteTrack: 'onRemoteTrack',
  onRemoteSpeaking: 'onRemoteSpeaking',
  onRemoteStoppedSpeaking: 'onRemoteStoppedSpeaking',
  onRemoteVolumeChange: 'onRemoteVolumeChange'
};

class SimpleSFUClient {
  constructor(options) {
    const defaultSettings = {
      port: 5000
    };

    this.settings = Object.assign({}, defaultSettings, options);
    this.eventListeners = new Map();
    this.connection = null;

    this.publishers = new Map();

    this.publishersTemp = [];
    this.localPeer = null;
    this.localUUID = null;
    this.localStream = null;
    Object.keys(_EVENTS).forEach(event => {
      this.eventListeners.set(event, []);
    });
  }

  async initWebSocket() {
    const roomId = roomIdInput.value.trim();
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const hostname = window.location.hostname;
    const port = hostname === 'localhost' ? `:${this.settings.port}` : '';
    const url = `${protocol}://${hostname}${port}?roomId=${roomId}`;
    this.connection = new WebSocket(url);

    this.connection.onmessage = (data) => this.handleMessage(data);
    this.connection.onclose = () => this.handleClose();
    this.connection.onopen = event => {
      this.trigger(_EVENTS.onConnected, event);
    }
    this.trigger(_EVENTS.onReady);

    let tryTimes = 0;
    while (this.connection.readyState !== WebSocket.OPEN) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      tryTimes++;
    }
  }


  on(event, callback) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).push(callback);
    }
  }

  trigger(event, args = null) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(callback => callback.call(this, args));
    }
  }


  createAudioElement(username, stream, pubId) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.id = `remote_${pubId}`
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.muted = (username === username.value);
    return audio;
  }

  createAudioWrapper(audio, username, pubId) {
    // Add audio
    const div = document.createElement('div')
    div.id = `user_${pubId}`;
    div.classList.add('audioWrap')
    div.appendChild(audio);

    // Add username
    const nameContainer = document.createElement('div');
    nameContainer.classList.add('display_name')
    const textNode = document.createTextNode(username);
    nameContainer.appendChild(textNode);
    div.appendChild(nameContainer);
    return div;
  }

  async handleRemoteTrack(stream, username, pubId) {
    const userAudio = document.getElementById(`remote_${pubId}`);
    if (userAudio) {
      // If the track already exists, do not add it again.
      // This can happen when the remote user unmute their mic.
      const tracks = userAudio.srcObject.getTracks();
      const track = stream.getTracks()[0];
      if (tracks.includes(track)) return;

      userAudio.srcObject.addTrack(track)
    } else {
      const audio = this.createAudioElement(username, stream, pubId);

      const hark = this.hark(stream, {smoothing: 0.1});

      hark.on('volume_change', (dBs, threshold) => {
        this.trigger(_EVENTS.onRemoteVolumeChange, { username, stream, pubId, dBs, threshold });
      });

      hark.on('stopped_speaking', () => {
        this.trigger(_EVENTS.onRemoteStoppedSpeaking, { username, stream, pubId });
        audio.classList.remove('speaking');
      });

      hark.on('speaking', () => {
        this.trigger(_EVENTS.onRemoteSpeaking, { username, stream, pubId });
        audio.classList.add('speaking');
      });

      const div = this.createAudioWrapper(audio, username, pubId);
      audioInnerDiv.appendChild(div);

      this.trigger(_EVENTS.onRemoteTrack, stream)
    }
  }

  async handleIceCandidate({ candidate }) {
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: serverMethods.ice,
        ice: candidate,
        uuid: this.localUUID
      }
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleConsumerIceCandidate(e, pubId) {
    const { candidate } = e;
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: serverMethods.consumerIce,
        ice: candidate,
        pubId: pubId
      }
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleSubscriptionAnswer({ sdp, pubId }) {
    const desc = new RTCSessionDescription(sdp);
    this.publishers.get(pubId).peer.setRemoteDescription(desc).catch(e => console.log(e));
  }

  async createConsumeTransport(publisher) {
    const consumerTransport = new RTCPeerConnection(configuration);
    DEFINED_PEERS++;
    this.publishers.get(publisher.id).peer = consumerTransport;
    consumerTransport.addTransceiver('audio', { direction: "recvonly" })
    const offer = await consumerTransport.createOffer();
    await consumerTransport.setLocalDescription(offer);

    consumerTransport.onicecandidate = (e) => this.handleConsumerIceCandidate(e, publisher.id);

    consumerTransport.ontrack = (e) => {
      this.handleRemoteTrack(e.streams[0], publisher.username, publisher.id);
    };

    return consumerTransport;
  }

  async subscribeOnce(publisher) {
    const transport = await this.createConsumeTransport(publisher);
    const payload = {
      type: serverMethods.subscribe,
      pubId: publisher.id,
      sdp: await transport.localDescription
    }

    this.connection.send(JSON.stringify(payload))
  }

  async handlePublishers({ publishers }) {
    if (publishers.length > 0) {
      for (const publisher of publishers) {
        const id = publisher.id;
        if (this.publishersTemp.includes(id)) return;
        this.publishersTemp.push(id);
        this.publishers.set(id, { username: publisher.username });
        await this.subscribeOnce(publisher);
      }
    }
  }

  handleAnswer({ sdp }) {
    const desc = new RTCSessionDescription(sdp);
    this.localPeer.setRemoteDescription(desc).catch(e => console.log(e));
  }
  
  async handleNewPublisher({ id: publisherId, username }) {
    console.log(publisherId);
    console.log(username);
    console.log(this.publishersTemp);
    console.log(".......................................................")

    if (publisherId === this.localUUID || this.publishersTemp.includes(publisherId)) return;
    this.publishersTemp.push(publisherId)
    this.publishers.set(publisherId, { username });
    await this.subscribeOnce({ id: publisherId, username });
  }

  handleMessage({ data }) {
    const message = JSON.parse(data);

    switch (message.type) {
      case clientMethods.welcome:
        this.localUUID = message.id;
        break;
      case clientMethods.answer:
        this.handleAnswer(message);
        break;
      case clientMethods.publishers:
        this.handlePublishers(message).then(_ => {});
        break;
      case clientMethods.subscriptionAnswer:
        this.handleSubscriptionAnswer(message)
        break
      case clientMethods.newPublisher:
        this.handleNewPublisher(message).then(_ => {});
        break;
      case clientMethods.publisherLeft:
        this.removePublisher(message);
        break;
    }
  }

  removePublisher({ id }) {
    if (!this.publishers.has(id) && !this.publishersTemp.includes(id)) return;
    this.publishers.delete(id);
    this.publishersTemp = this.publishersTemp.filter(item => item !== id);
    this.publishers.delete(id);

    document.getElementById(`remote_${id}`).srcObject.getTracks().forEach(track => track.stop());
    document.getElementById(`user_${id}`).remove();
  }

  async connect() { // Produce media
    await this.initWebSocket();
    // await delay(600);

    const role = roleSelect.value;
    if (role === roles.speaker) {
      // TODO: Change stream constrains
      this.localStream = await navigator.mediaDevices.getUserMedia({video: false, audio: true});
      
      this.localPeer = this.createPeer(true);
      this.localStream.getTracks().forEach(track => this.localPeer.addTrack(track, this.localStream));
      return;
    }

    const roomId = roomIdInput.value.trim();
    await this.connection.send(JSON.stringify({
      type: serverMethods.connect,
      role: role,
      username: usernameInput.value,
      roomId
    }));

    await this.getAllPublishers();
  }

  createPeer(isConnect) {
    this.localPeer = new RTCPeerConnection(configuration);
    DEFINED_PEERS++;
    this.localPeer.onicecandidate = (e) => this.handleIceCandidate(e);
    this.localPeer.onnegotiationneeded = () => this.handleNegotiation(isConnect);
    return this.localPeer;
  }

  async setRole() {
    const role = roleSelect.value;
    if (role === roles.listener) {

      if (!this.localStream.stop && this.localStream.getTracks) {
        this.localStream.stop = function () {
          this.getTracks().forEach(function (track) {
            track.stop();
          });
        };
      }

      // this.localStream.stop();
      this.localStream = null;
      this.localPeer = null;

      this.connection.send(JSON.stringify({
        type: serverMethods.setRole,
        role
      }));
    } else {
      if (!this.localStream)
        this.localStream = await navigator.mediaDevices.getUserMedia({video: false, audio: true});
      
      this.localPeer = this.createPeer(false);
      this.localStream.getTracks().forEach(track => this.localPeer.addTrack(track, this.localStream));
    }
  }

  async getAllPublishers() {
    const payload = {
      type: serverMethods.getPublishers,
      uuid: this.localUUID
    }

    this.connection.send(JSON.stringify(payload));
  }

  async handleNegotiation(isConnect) {  // peer, type
    console.log('*** negotiating ***')
    const offer = await this.localPeer.createOffer();
    await this.localPeer.setLocalDescription(offer);

    const role = roleSelect.value;
    if (isConnect) {
      const roomId = roomIdInput.value.trim();

      this.connection.send(JSON.stringify({
        type: serverMethods.connect,
        role,
        sdp: offer,
        uuid: this.localUUID,
        username: usernameInput.value,
        roomId
      }));

      await this.getAllPublishers();
      return;
    }
    this.connection.send(JSON.stringify({
      type: serverMethods.setRole,
      role,
      sdp: offer
    }))
  }

  handleClose() {
    this.connection = null;
    if(this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    this.publishers = null;
    // this.publisherPeerConnections = null;
  }
  

  hark(stream, options) {
    const audioContextType = window.AudioContext; // || window.webkitAudioContext;

    const harker = this;
    harker.events = {};
    harker.on = function (event, callback) {
      harker.events[event] = callback;
    };

    harker.emit = function () {
      if (harker.events[arguments[0]]) {
        harker.events[arguments[0]](arguments[1], arguments[2], arguments[3], arguments[4]);
      }
    };

    // make it not break in non-supported browsers
    if (!audioContextType) return harker;

    options = options || {};
    // Config
    let smoothing = (options.smoothing || 0.1),
      interval = (options.interval || 50),
      threshold = options.threshold,
      play = options.play,
      history = options.history || 10,
      running = true;

    // Setup Audio Context
    if (!window.audioContext00) {
      window.audioContext00 = new audioContextType();
    }

    const gainNode = audioContext00.createGain();
    gainNode.connect(audioContext00.destination);
    // don't play for self
    gainNode.gain.value = 0;

    let sourceNode, fftBins, analyser;

    analyser = audioContext00.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = smoothing;
    fftBins = new Float32Array(analyser.fftSize);

    //WebRTC Stream
    sourceNode = audioContext00.createMediaStreamSource(stream);
    threshold = threshold || -50;

    sourceNode.connect(analyser);
    if (play) analyser.connect(audioContext00.destination);

    harker.speaking = false;

    harker.setThreshold = function (t) {
      threshold = t;
    };

    harker.setInterval = function (i) {
      interval = i;
    };

    harker.stop = function () {
      running = false;
      harker.emit('volume_change', -100, threshold);
      if (harker.speaking) {
        harker.speaking = false;
        harker.emit('stopped_speaking');
      }
    };
    harker.speakingHistory = [];
    for (let i = 0; i < history; i++) {
      harker.speakingHistory.push(0);
    }

    // Poll the analyser node to determine if speaking
    // and emit events if changed
    const looper = function () {
      setTimeout(function () {
        //check if stop has been called
        if (!running) {
          return;
        }

        const currentVolume = getMaxVolume(analyser, fftBins);

        harker.emit('volume_change', currentVolume, threshold);

        let history = 0;
        if (currentVolume > threshold && !harker.speaking) {
          // trigger quickly, short history
          for (let i = harker.speakingHistory.length - 3; i < harker.speakingHistory.length; i++) {
            history += harker.speakingHistory[i];
          }
          if (history >= 2) {
            harker.speaking = true;
            harker.emit('speaking');
          }
        } else if (currentVolume < threshold && harker.speaking) {
          for (let j = 0; j < harker.speakingHistory.length; j++) {
            history += harker.speakingHistory[j];
          }
          if (history === 0) {
            harker.speaking = false;
            harker.emit('stopped_speaking');
          }
        }
        harker.speakingHistory.shift();
        harker.speakingHistory.push(0 + (currentVolume > threshold));

        looper();
      }, interval);
    };
    looper();

    function getMaxVolume(analyser, fftBins) {
      let maxVolume = -Infinity;
      analyser.getFloatFrequencyData(fftBins);

      let i = 4, ii = fftBins.length;
      for (; i < ii; i++) {
        if (fftBins[i] > maxVolume && fftBins[i] < 0) {
          maxVolume = fftBins[i];
        }
      }

      return maxVolume;
    }

    return harker;
  }
}
