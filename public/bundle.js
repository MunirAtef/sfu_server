
// file SimpleSFUClient.js

'use strict'

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
          { 'urls': 'stun:stun.stunprotocol.org:3478' },
          { 'urls': 'stun:stun.l.google.com:19302' },
        ]
      }
    };

    this.settings = Object.assign({}, defaultSettings, options);
    // this._isOpen = false;
    this.eventListeners = new Map();
    this.connection = null;
    this.consumers = new Map();
    this.clients = new Map();
    this.localPeer = null;
    this.localUUID = null;
    this.localStream = null;
    Object.keys(_EVENTS).forEach(event => {
      this.eventListeners.set(event, []);
    });

    this.initWebSocket();
    this.trigger(_EVENTS.onReady);
  }

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.hostname}:${this.settings.port}`;
    this.connection = new WebSocket(url);
    this.connection.onmessage = (data) => this.handleMessage(data);
    this.connection.onclose = () => this.handleClose();
    this.connection.onopen = event => {
      this.trigger(_EVENTS.onConnected, event);
      // this._isOpen = true;
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

  findUserVideo(consumerId) {
    const video = document.querySelector(`#remote_${consumerId}`)
    if (!video) {
      return false;
    }
    return video
  }

  createVideoElement(username, stream, consumerId) {
    const video = document.createElement('video');
    video.id = `remote_${consumerId}`
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = (username === username.value);
    return video;
  }

  createDisplayName(username) {
    const nameContainer = document.createElement('div');
    nameContainer.classList.add('display_name')
    const textNode = document.createTextNode(username);
    nameContainer.appendChild(textNode);
    return nameContainer;
  }

  createVideoWrapper(video, username, consumerId) {
    const div = document.createElement('div')
    div.id = `user_${consumerId}`;
    div.classList.add('videoWrap')
    div.appendChild(this.createDisplayName(username));
    div.appendChild(video);
    return div;
  }

  async handleRemoteTrack(stream, username, consumerId) {
    const userVideo = this.findUserVideo(consumerId);
    if (userVideo) {
      // If the track already exists, do not add it again.
      // This can happen when the remote user unmute their mic.
      const tracks = userVideo.srcObject.getTracks();
      const track = stream.getTracks()[0];
      if (tracks.includes(track)) {
        return;
      }

      userVideo.srcObject.addTrack(track)
    } else {
      const video = this.createVideoElement(username, stream, consumerId);

      const Hark = this.hark(stream);

      Hark.on('volume_change', (dBs, threshold) => {
        this.trigger(_EVENTS.onRemoteVolumeChange, { username, stream, consumerId, dBs, threshold });
      });

      Hark.on('stopped_speaking', () => {
        this.trigger(_EVENTS.onRemoteStoppedSpeaking, { username, stream, consumerId });
        video.classList.remove('speaking');
      });

      Hark.on('speaking', () => {
        this.trigger(_EVENTS.onRemoteSpeaking, { username, stream, consumerId });
        video.classList.add('speaking');
      });

      const div = this.createVideoWrapper(video, username, consumerId);
      document.querySelector('.videos-inner').appendChild(div);

      this.trigger(_EVENTS.onRemoteTrack, stream)
    }

    this.recalculateLayout();
  }

  async handleIceCandidate({ candidate }) {
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: 'ice',
        ice: candidate,
        uqid: this.localUUID
      }
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleConsumerIceCandidate(e, id, consumerId) {
    const { candidate } = e;
    if (candidate && candidate.candidate && candidate.candidate.length > 0) {
      const payload = {
        type: 'consumer_ice',
        ice: candidate,
        uqid: id,
        consumerId
      }
      this.connection.send(JSON.stringify(payload));
    }
  }

  handleConsume({ sdp, consumerId }) { // id,
    const desc = new RTCSessionDescription(sdp);
    this.publisherPeerConnections.get(consumerId).setRemoteDescription(desc).catch(e => console.log(e));
  }

  async createConsumeTransport(peer) {
    const consumerId = this.uuidv4();
    const consumerTransport = new RTCPeerConnection(this.settings.configuration);
    this.publishers.get(peer.id).consumerId = consumerId;
    consumerTransport.id = consumerId;
    consumerTransport.peer = peer;
    this.publisherPeerConnections.set(consumerId, consumerTransport);
    this.publisherPeerConnections.get(consumerId).addTransceiver('video', { direction: "recvonly" })
    this.publisherPeerConnections.get(consumerId).addTransceiver('audio', { direction: "recvonly" })
    const offer = await this.publisherPeerConnections.get(consumerId).createOffer();
    await this.publisherPeerConnections.get(consumerId).setLocalDescription(offer);

    this.publisherPeerConnections.get(consumerId).onicecandidate = (e) => this.handleConsumerIceCandidate(e, peer.id, consumerId);

    this.publisherPeerConnections.get(consumerId).ontrack = (e) => {
      this.handleRemoteTrack(e.streams[0], peer.username, consumerId);
    };

    return consumerTransport;
  }

  async consumeOnce(peer) {
    const transport = await this.createConsumeTransport(peer);
    const payload = {
      type: 'consume',
      id: peer.id,
      consumerId: transport.id,
      sdp: await transport.localDescription
    }

    this.connection.send(JSON.stringify(payload))
  }

  async handlePeers({ peers }) {
    if (peers.length > 0) {
      for (const peer in peers) {
        this.publishers.set(peers[peer].id, peers[peer]);
        await this.consumeOnce(peers[peer]);
      }
    }
  }

  handleAnswer({ sdp }) {
    const desc = new RTCSessionDescription(sdp);
    this.localPeer.setRemoteDescription(desc).catch(e => console.log(e));
  }

  async handleNewProducer({ id, username }) {
    if (id === this.localUUID) return;

    this.publishers.set(id, { id, username });

    await this.consumeOnce({ id, username });
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
      case 'peers':
        this.handlePeers(message).then(_ => {});
        break;
      case 'consume':
        this.handleConsume(message)
        break
      case 'newProducer':
        this.handleNewProducer(message).then(_ => {});
        break;
      case 'user_left':
        this.removeUser(message);
        break;
    }
  }

  removeUser({ id }) {
    const { consumerId } = this.publishers.get(id); //  username,
    this.publisherPeerConnections.delete(consumerId);
    this.publishers.delete(id);
    document.querySelector(`#remote_${consumerId}`).srcObject.getTracks().forEach(track => track.stop());
    document.querySelector(`#user_${consumerId}`).remove();

    this.recalculateLayout();
  }

  async connect() { // Produce media
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    await this.handleRemoteTrack(stream, username.value)
    this.localStream = stream;

    this.localPeer = this.createPeer();
    this.localStream.getTracks().forEach(track => this.localPeer.addTrack(track, this.localStream));
    await this.subscribe();
  }

  createPeer() {
    // this.localPeer = new RTCPeerConnection(this.configuration);
    this.localPeer = new RTCPeerConnection(this.settings.configuration);
    this.localPeer.onicecandidate = (e) => this.handleIceCandidate(e);
    //peer.oniceconnectionstatechange = checkPeerConnection;
    this.localPeer.onnegotiationneeded = () => this.handleNegotiation();
    return this.localPeer;
  }

  async subscribe() { // Consume media
    await this.consumeAll();
  }

  async consumeAll() {
    const payload = {
      type: 'getPeers',
      uqid: this.localUUID
    }

    this.connection.send(JSON.stringify(payload));
  }

  async handleNegotiation() {  // peer, type
    console.log('*** negotiating ***')
    const offer = await this.localPeer.createOffer();
    await this.localPeer.setLocalDescription(offer);

    this.connection.send(JSON.stringify({ type: 'connect', sdp: this.localPeer.localDescription, uqid: this.localUUID, username: username.value }));
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

  recalculateLayout() {
    const container = remoteContainer;
    const videoContainer = document.querySelector('.videos-inner');
    const videoCount = container.querySelectorAll('.videoWrap').length;

    if (videoCount >= 3) {
      videoContainer.style.setProperty("--grow", 0 + "");
    } else {
      videoContainer.style.setProperty("--grow", 1 + "");
    }
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
