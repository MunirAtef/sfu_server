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
      port: 5000,
      configuration: {
        iceServers: [
          {urls: "stun:stun.relay.metered.ca:80"},
          {
            urls: "turn:global.relay.metered.ca:80",
            username: "941563fc8b5b8e8c1a5424cb",
            credential: "spoMfi7SzsfGP9bk"
          },
          {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username:"941563fc8b5b8e8c1a5424cb",
            credential:"spoMfi7SzsfGP9bk"
          },
          {
            urls: "turn:global.relay.metered.ca:443",
            username:"941563fc8b5b8e8c1a5424cb",
            credential:"spoMfi7SzsfGP9bk"
          },
          {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username:"941563fc8b5b8e8c1a5424cb",
            credential:"spoMfi7SzsfGP9bk"
          }
        ]
      }
    };

    this.settings = Object.assign({}, defaultSettings, options);
    this.eventListeners = new Map();
    this.connection = null;
    this.publisherPeerConnections = new Map();
    this.publishers = new Map();

    this.publishersTemp = [];
    this.localPeer = null;
    this.localUUID = null;
    this.localStream = null;
    Object.keys(_EVENTS).forEach(event => {
      this.eventListeners.set(event, []);
    });

    this.initWebSocket();
  }

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.hostname}:${this.settings.port}`;
    this.connection = new WebSocket(url);

    this.connection.onmessage = (data) => this.handleMessage(data);
    this.connection.onclose = () => this.handleClose();
    this.connection.onopen = event => {
      this.trigger(_EVENTS.onConnected, event);
    }
    this.trigger(_EVENTS.onReady);
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


  createAudioElement(username, stream, consumerId) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.id = `remote_${consumerId}`
    audio.srcObject = stream;
    audio.autoplay = true;
    audio.muted = (username === username.value);
    return audio;
  }

  createAudioWrapper(audio, username, consumerId) {
    // Add audio
    const div = document.createElement('div')
    div.id = `user_${consumerId}`;
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

  async handleRemoteTrack(stream, username, consumerId) {
    const userAudio = document.getElementById(`remote_${consumerId}`);
    if (userAudio) {
      // If the track already exists, do not add it again.
      // This can happen when the remote user unmute their mic.
      const tracks = userAudio.srcObject.getTracks();
      const track = stream.getTracks()[0];
      if (tracks.includes(track)) return;

      userAudio.srcObject.addTrack(track)
    } else {
      const audio = this.createAudioElement(username, stream, consumerId);

      const hark = this.hark(stream, {smoothing: 0.1});

      hark.on('volume_change', (dBs, threshold) => {
        this.trigger(_EVENTS.onRemoteVolumeChange, { username, stream, consumerId, dBs, threshold });
      });

      hark.on('stopped_speaking', () => {
        this.trigger(_EVENTS.onRemoteStoppedSpeaking, { username, stream, consumerId });
        audio.classList.remove('speaking');
      });

      hark.on('speaking', () => {
        this.trigger(_EVENTS.onRemoteSpeaking, { username, stream, consumerId });
        audio.classList.add('speaking');
      });

      const div = this.createAudioWrapper(audio, username, consumerId);
      audioInnerDiv.appendChild(div);

      this.trigger(_EVENTS.onRemoteTrack, stream)
    }
  }

  async handleIceCandidate({ candidate }) {
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: 'ice',
        ice: candidate,
        uuid: this.localUUID
      }
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleConsumerIceCandidate(e, id, consumerId) {
    const { candidate } = e;
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: 'consumerIce',
        ice: candidate,
        uuid: id,
        consumerId
      }
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleSubscriptionAnswer({ sdp, consumerId }) { // id,
    const desc = new RTCSessionDescription(sdp);
    this.publisherPeerConnections.get(consumerId).setRemoteDescription(desc).catch(e => console.log(e));
  }

  async createConsumeTransport(peer) {
    const consumerId = this.uuidv4();
    const consumerTransport = new RTCPeerConnection(this.settings.configuration);
    DEFINED_PEERS++;
    this.publishers.get(peer.id).consumerId = consumerId;
    consumerTransport.id = consumerId;
    consumerTransport.peer = peer;
    this.publisherPeerConnections.set(consumerId, consumerTransport);
    // consumerTransport.addTransceiver('video', { direction: "recvonly" })
    consumerTransport.addTransceiver('audio', { direction: "recvonly" })
    const offer = await consumerTransport.createOffer();
    await consumerTransport.setLocalDescription(offer);

    consumerTransport.onicecandidate = (e) => this.handleConsumerIceCandidate(e, peer.id, consumerId);

    consumerTransport.ontrack = (e) => {
      this.handleRemoteTrack(e.streams[0], peer.username, consumerId);
    };

    return consumerTransport;
  }

  async subscribeOnce(peer) {
    const transport = await this.createConsumeTransport(peer);
    const payload = {
      type: 'subscribe',
      id: peer.id,
      consumerId: transport.id,
      sdp: await transport.localDescription
    }

    this.connection.send(JSON.stringify(payload))
  }

  async handlePublishers({ publishers }) {
    if (publishers.length > 0) {
      for (const peer of publishers) {
        const id = peer.id;
        if (this.publishersTemp.includes(id)) return;
        this.publishersTemp.push(id);
        this.publishers.set(id, { username: peer.username });
        await this.subscribeOnce(peer);
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
    this.publishers.set(publisherId, { username }); // id: publisherId,
    await this.subscribeOnce({ id: publisherId, username });
  }

  handleMessage({ data }) {
    const message = JSON.parse(data);

    switch (message.type) {
      case 'welcome':
        this.localUUID = message.id;
        break;
      case 'answer':
        this.handleAnswer(message);
        break;
      case 'publishers':
        this.handlePublishers(message).then(_ => {});
        break;
      case 'subscriptionAnswer':
        this.handleSubscriptionAnswer(message)
        break
      case 'newPublisher':
        this.handleNewPublisher(message).then(_ => {});
        break;
      case 'publisherLeft':
        this.removePublisher(message);
        break;
    }
  }

  removePublisher({ id }) {
    if (!this.publishers.has(id) && !this.publishersTemp.includes(id)) return;
    const { consumerId } = this.publishers.get(id); //  username,
    this.publisherPeerConnections.delete(consumerId);
    this.publishersTemp = this.publishersTemp.filter(item => item !== id);
    this.publishers.delete(id);

    document.getElementById(`remote_${consumerId}`).srcObject.getTracks().forEach(track => track.stop());
    document.getElementById(`user_${consumerId}`).remove();
  }

  async connect() { // Produce media
    await this.initWebSocket()

    const role = roleSelect.value;
    if (role === 'speaker') {
      // TODO: Change stream constrains
      this.localStream = await navigator.mediaDevices.getUserMedia({video: false, audio: true});
      // await this.handleRemoteTrack(stream, usernameInput.value)

      this.localPeer = this.createPeer(true);
      this.localStream.getTracks().forEach(track => this.localPeer.addTrack(track, this.localStream));
      return;
    }

    const roomId = roomIdInput.value.trim();
    await this.connection.send(JSON.stringify({
      type: 'connect',
      role: role,
      // uuid: this.localUUID,
      username: usernameInput.value,
      roomId
    }));

    await this.getAllPublishers();
    // await this.subscribe();
  }

  createPeer(isConnect) {
    // this.localPeer = new RTCPeerConnection(this.configuration);
    this.localPeer = new RTCPeerConnection(this.settings.configuration);
    DEFINED_PEERS++;
    this.localPeer.onicecandidate = (e) => this.handleIceCandidate(e);
    //peer.oniceconnectionstatechange = checkPeerConnection;
    this.localPeer.onnegotiationneeded = () => this.handleNegotiation(isConnect);
    return this.localPeer;
  }

  async setRole() {
    const role = roleSelect.value;
    // if (role === 'listener') {
    if (role === 'listener') {
      // this.localStream.getTracks().forEach(track => {
      //   this.localPeer.removeTrack(track, this.localStream);
      //   track.stop();
      // });

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
        type: "setRole",
        role
      }))
    } else {
      if (!this.localStream)
        this.localStream = await navigator.mediaDevices.getUserMedia({video: false, audio: true});
      // await this.handleRemoteTrack(stream, usernameInput.value)
      this.localPeer = this.createPeer(false);
      this.localStream.getTracks().forEach(track => this.localPeer.addTrack(track, this.localStream));
    }
  }
  // async subscribe() { // Consume media
  //   await this.consumeAll();
  // }

  async getAllPublishers() {
    const payload = {
      type: 'getPublishers',
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
        type: 'connect',
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
      type: "setRole",
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
    this.publisherPeerConnections = null;
  }


  uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
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
