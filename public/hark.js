

// file hark.js

function hark(stream, options) {
    const audioContextType = window.webkitAudioContext || window.AudioContext;

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
                for (var j = 0; j < harker.speakingHistory.length; j++) {
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
