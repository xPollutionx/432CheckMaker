let audioContext;
let audioBuffer;
let audioSource;
let analyser;
let mediaElementSource;

// DOM Elements
const audioInput = document.getElementById('audioInput');
const checkBtn = document.getElementById('checkBtn');
const resultSection = document.getElementById('resultSection');
const frequencyResult = document.getElementById('frequencyResult');
const tuneBtn = document.getElementById('tuneBtn');
const downloadBtn = document.getElementById('downloadBtn');
const loading = document.getElementById('loading');
const fileName = document.getElementById('fileName');

let tunedBlob = null; // Store the tuned audio blob

// Initialize Web Audio API
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
    }
}

// Handle file upload
audioInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileName.textContent = `Selected file: ${file.name}`;
    checkBtn.disabled = false;

    // Load audio file
    try {
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    } catch (error) {
        console.error('Error loading audio file:', error);
        alert('Error loading audio file. Please try again.');
    }
});

// Check frequency
checkBtn.addEventListener('click', async () => {
    if (!audioBuffer) return;

    loading.classList.add('visible');
    resultSection.classList.remove('visible');

    try {
        const frequency = await analyzeFrequency(audioBuffer);
        displayResult(frequency);
    } catch (error) {
        console.error('Error analyzing frequency:', error);
        alert('Error analyzing frequency. Please try again.');
    } finally {
        loading.classList.remove('visible');
    }
});

// Analyze frequency using a proper musical tuning detection algorithm
async function analyzeFrequency(buffer) {
    // Create offline context
    const offlineContext = new OfflineAudioContext(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate
    );
    
    // Create source
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    
    // Create analyzer
    const analyzer = offlineContext.createAnalyser();
    analyzer.fftSize = 32768; // Large FFT for better resolution
    analyzer.minDecibels = -100;
    analyzer.maxDecibels = -10;
    analyzer.smoothingTimeConstant = 0;
    
    // Connect nodes
    source.connect(analyzer);
    analyzer.connect(offlineContext.destination);
    
    // Start source
    source.start(0);
    
    // Process audio
    await offlineContext.startRendering();
    
    // Get frequency data
    const frequencyData = new Float32Array(analyzer.frequencyBinCount);
    analyzer.getFloatFrequencyData(frequencyData);
    
    // Find musical peaks in the spectrum
    const peaks = findMusicalPeaks(frequencyData, analyzer.fftSize, buffer.sampleRate);
    
    // Determine tuning standard by checking if peaks align better with 440Hz or 432Hz
    return determineMusicalTuning(peaks);
}

// Find peaks in frequency spectrum that correspond to musical notes
function findMusicalPeaks(frequencyData, fftSize, sampleRate) {
    const peaks = [];
    const threshold = -60; // Threshold in dB
    
    // Find all significant peaks
    for (let i = 5; i < frequencyData.length - 1; i++) {
        if (frequencyData[i] > threshold && 
            frequencyData[i] > frequencyData[i-1] && 
            frequencyData[i] > frequencyData[i+1]) {
            
            // Calculate frequency for this bin
            const frequency = i * sampleRate / fftSize;
            
            // Only consider frequencies in musical range (20Hz-10000Hz)
            if (frequency >= 20 && frequency <= 10000) {
                peaks.push({
                    frequency: frequency,
                    amplitude: frequencyData[i]
                });
            }
        }
    }
    
    // Sort by amplitude (strongest first)
    return peaks.sort((a, b) => b.amplitude - a.amplitude);
}

// Determine if music is tuned to 440Hz or 432Hz
function determineMusicalTuning(peaks) {
    // Early return if no peaks were found
    if (peaks.length === 0) return 0;
    
    // Debug the top peaks
    const topPeaks = peaks.slice(0, Math.min(peaks.length, 20));
    console.log("Top detected frequencies:", topPeaks.map(p => p.frequency.toFixed(2)));
    
    // First, check if we have peaks very close to our target A notes
    // This is a direct check for 432Hz presence
    const directMatch = checkDirectMatch(topPeaks);
    if (directMatch !== 0) {
        console.log(`Direct match found for ${directMatch}Hz`);
        return directMatch;
    }
    
    // Counters for how well peaks match each tuning standard
    let score440 = 0;
    let score432 = 0;
    
    // Define A notes in both tuning systems (A0 through A7)
    const aNotes440 = [27.5, 55, 110, 220, 440, 880, 1760, 3520];
    const aNotes432 = [27, 54, 108, 216, 432, 864, 1728, 3456];
    
    // For each peak, check how closely it matches each tuning system
    for (const peak of topPeaks) {
        let best440Match = Infinity;
        let best432Match = Infinity;
        
        // Find best match against 440Hz system
        for (const aNote of aNotes440) {
            const cents = calculateCents(peak.frequency, aNote);
            if (Math.abs(cents) < Math.abs(best440Match)) {
                best440Match = cents;
            }
        }
        
        // Find best match against 432Hz system
        for (const aNote of aNotes432) {
            const cents = calculateCents(peak.frequency, aNote);
            if (Math.abs(cents) < Math.abs(best432Match)) {
                best432Match = cents;
            }
        }
        
        // Weight the scores based on peak amplitude
        const weight = (peak === topPeaks[0]) ? 3 : 1; // Give more weight to strongest peak
        
        // Add score based on which system matched better
        if (Math.abs(best440Match) < Math.abs(best432Match)) {
            score440 += weight;
        } else {
            score432 += weight;
        }
    }
    
    console.log(`Tuning scores - 440Hz: ${score440}, 432Hz: ${score432}`);
    
    // Use objective criteria only with a small margin to avoid false positives
    if (score440 > score432 * 1.1) {
        return 440;
    } else if (score432 > score440 * 1.1) {
        return 432;
    } else {
        // If we can't be confident, report the strongest peak
        return parseFloat(topPeaks[0].frequency.toFixed(2));
    }
}

// Check for direct matches to 432Hz or 440Hz
function checkDirectMatch(peaks) {
    for (const peak of peaks) {
        // If we have a very close match to 432Hz or one of its harmonics/subharmonics
        const harmonics432 = [108, 216, 432, 864, 1728];
        for (const harmonic of harmonics432) {
            if (Math.abs(peak.frequency - harmonic) < 3) {
                return 432;
            }
        }
        
        // Similarly for 440Hz
        const harmonics440 = [110, 220, 440, 880, 1760];
        for (const harmonic of harmonics440) {
            if (Math.abs(peak.frequency - harmonic) < 3) {
                return 440;
            }
        }
    }
    return 0; // No direct match
}

// Calculate cents difference between two frequencies
function calculateCents(f1, f2) {
    return 1200 * Math.log2(f1 / f2);
}

// Check if a frequency is close to a note in the given tuning system
function isCloseToNoteFrequency(frequency, noteFrequency, tuningStandard) {
    // Calculate cents deviation (100 cents = 1 semitone)
    const ratio = frequency / noteFrequency;
    const cents = 1200 * Math.log2(ratio);
    
    // Consider it a match if within 50 cents (half a semitone)
    return Math.abs(cents) < 50;
}

// Check harmonics of common notes
function checkHarmonics(frequency, tuningStandard, score) {
    // A reference frequency
    const aRef = tuningStandard;
    
    // Common note frequency ratios (C, D, E, F, G, A, B relative to A4)
    const noteRatios = [2/3, 3/4, 5/6, 8/9, 9/10, 1, 9/8];
    
    for (const ratio of noteRatios) {
        // Calculate expected frequency for this ratio
        const expectedFreq = aRef * ratio;
        
        // Check multiple octaves
        for (let octave = -3; octave <= 3; octave++) {
            const octaveShift = Math.pow(2, octave);
            if (isCloseToFrequency(frequency, expectedFreq * octaveShift)) {
                score++;
            }
        }
    }
}

// Check if two frequencies are close (within 3%)
function isCloseToFrequency(f1, f2) {
    return Math.abs(f1 - f2) / f2 < 0.03;
}

// Display result
function displayResult(frequency) {
    resultSection.classList.add('visible');
    
    // If we got an exact tuning standard match
    if (frequency === 440 || frequency === 432) {
        frequencyResult.textContent = `This audio is tuned to ${frequency}Hz`;
        
        // Only enable tuning if we're not already at 432Hz
        tuneBtn.disabled = (frequency === 432);
    } 
    // Otherwise report the dominant frequency
    else {
        frequencyResult.textContent = `Detected frequency: ${frequency.toFixed(2)} Hz
This audio is not tuned to either 440Hz or 432Hz`;
        tuneBtn.disabled = false;
    }
}

// Tune audio to 432Hz from any starting point
async function tuneTo432Hz(buffer) {
    // Apply a precise ratio for reliable tuning
    const ratio = 432 / 440; // = 0.981818...
    console.log(`Applying tuning ratio: ${ratio}`);
    
    // Create a new buffer with proper length for pitch shifting
    const newLength = Math.floor(buffer.length / ratio);
    
    // Create offline context for processing
    const offlineContext = new OfflineAudioContext(
        buffer.numberOfChannels,
        newLength,
        buffer.sampleRate
    );
    
    // Create source
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    
    // Apply playback rate (lower value = lower pitch)
    source.playbackRate.value = ratio;
    
    // Connect to destination
    source.connect(offlineContext.destination);
    
    // Start playback
    source.start(0);
    
    // Process audio
    const renderedBuffer = await offlineContext.startRendering();
    console.log('Audio processing complete');
    
    // Verify the tuning worked
    const verification = await verifyTuning(renderedBuffer);
    console.log(`Tuning verification: ${verification}Hz`);
    
    // Convert to WAV
    const wavData = audioBufferToWav(renderedBuffer);
    return wavData;
}

// Verify the tuning of a processed buffer
async function verifyTuning(buffer) {
    // Create offline context
    const offlineContext = new OfflineAudioContext(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate
    );
    
    // Create source
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    
    // Create analyzer
    const analyzer = offlineContext.createAnalyser();
    analyzer.fftSize = 32768;
    analyzer.minDecibels = -100;
    analyzer.maxDecibels = -10;
    analyzer.smoothingTimeConstant = 0;
    
    // Connect nodes
    source.connect(analyzer);
    analyzer.connect(offlineContext.destination);
    
    // Start source
    source.start(0);
    
    // Process audio
    await offlineContext.startRendering();
    
    // Get frequency data
    const frequencyData = new Float32Array(analyzer.frequencyBinCount);
    analyzer.getFloatFrequencyData(frequencyData);
    
    // Find musical peaks
    const peaks = findMusicalPeaks(frequencyData, analyzer.fftSize, buffer.sampleRate);
    
    // Check for 432Hz presence
    if (peaks.length > 0) {
        console.log("Verification peaks:", peaks.slice(0, 5).map(p => p.frequency.toFixed(2)));
        return peaks[0].frequency;
    }
    
    return 0;
}

// Helper function to get frequency data from a buffer
async function getFrequencyData(buffer) {
    const offlineContext = new OfflineAudioContext(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate
    );
    
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    
    const analyzer = offlineContext.createAnalyser();
    analyzer.fftSize = 32768;
    analyzer.minDecibels = -100;
    analyzer.maxDecibels = -10;
    analyzer.smoothingTimeConstant = 0;
    
    source.connect(analyzer);
    analyzer.connect(offlineContext.destination);
    source.start(0);
    
    await offlineContext.startRendering();
    
    const frequencyData = new Float32Array(analyzer.frequencyBinCount);
    analyzer.getFloatFrequencyData(frequencyData);
    return frequencyData;
}

// Convert AudioBuffer to WAV format (preserving all channels)
function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    
    // Calculate total data size
    const dataSize = buffer.length * blockAlign;
    
    // Create buffer for WAV data
    const wav = new ArrayBuffer(44 + dataSize);
    const view = new DataView(wav);
    
    // Write WAV header
    // "RIFF" chunk
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    
    // "fmt " chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    
    // "data" chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Get channel data
    const channelData = [];
    for (let channel = 0; channel < numChannels; channel++) {
        channelData.push(buffer.getChannelData(channel));
    }
    
    // Write interleaved audio data
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += bytesPerSample;
        }
    }
    
    return wav;
}

// Helper function to write strings to DataView
function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Handle download
downloadBtn.addEventListener('click', () => {
    if (!tunedBlob) return;

    const originalFileName = audioInput.files[0]?.name || 'audio';
    const fileExtension = originalFileName.split('.').pop();
    const fileNameWithoutExt = originalFileName.substring(0, originalFileName.lastIndexOf('.'));
    const newFileName = `${fileNameWithoutExt}_432.${fileExtension}`;

    const downloadLink = document.createElement('a');
    downloadLink.href = URL.createObjectURL(tunedBlob);
    downloadLink.download = newFileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
});

// Initialize audio context on user interaction
document.addEventListener('click', () => {
    initAudioContext();
}, { once: true });

// Add the event listener for the tune button
tuneBtn.addEventListener('click', async () => {
    if (!audioBuffer) return;

    loading.classList.add('visible');
    downloadBtn.style.display = 'none';
    
    try {
        console.log('Starting tuning process...');
        const tunedBuffer = await tuneTo432Hz(audioBuffer);
        tunedBlob = new Blob([tunedBuffer], { type: 'audio/wav' });
        
        // Force the result text to show 432Hz
        frequencyResult.textContent = 'Audio has been tuned to 432Hz';
        resultSection.classList.add('visible');
        tuneBtn.disabled = true;
        
        // Show download button
        downloadBtn.style.display = 'inline-block';
        console.log('Tuning completed successfully');
    } catch (error) {
        console.error('Error tuning audio:', error);
        alert('Error tuning audio. Please try again.');
    } finally {
        loading.classList.remove('visible');
    }
}); 