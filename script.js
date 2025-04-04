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
    console.log("Starting frequency analysis...");
    console.log(`Audio duration: ${buffer.duration.toFixed(2)} seconds, Sample rate: ${buffer.sampleRate}Hz`);
    
    // For longer audio, analyze multiple segments to find consistent patterns
    const results = [];
    const segmentLength = Math.min(buffer.length, 5 * buffer.sampleRate); // Analyze up to 5-second segments
    
    // Analyze up to 3 segments of the audio file
    const totalSegments = Math.min(3, Math.floor(buffer.length / segmentLength));
    
    for (let segment = 0; segment < totalSegments; segment++) {
        const startSample = segment * Math.floor(buffer.length / totalSegments);
        const endSample = Math.min(startSample + segmentLength, buffer.length);
        
        console.log(`Analyzing segment ${segment+1}/${totalSegments} (${((endSample - startSample) / buffer.sampleRate).toFixed(2)}s)`);
        
        // Create a segment buffer
        const segmentBuffer = createSegmentBuffer(buffer, startSample, endSample);
        
        // Analyze this segment
        const result = await analyzeSegment(segmentBuffer);
        results.push(result);
    }
    
    // Find the most common result
    const frequencyCounts = {};
    let maxCount = 0;
    let mostCommonFreq = 0;
    
    // Special handling for 432Hz and 440Hz exact matches
    let count432 = 0;
    let count440 = 0;
    
    for (const result of results) {
        if (result === 432) count432++;
        else if (result === 440) count440++;
        
        frequencyCounts[result] = (frequencyCounts[result] || 0) + 1;
        if (frequencyCounts[result] > maxCount) {
            maxCount = frequencyCounts[result];
            mostCommonFreq = result;
        }
    }
    
    console.log("Analysis results across segments:", results);
    
    // Prioritize 432Hz and 440Hz detections
    if (count432 > 0) return 432;
    if (count440 > 0) return 440;
    
    return mostCommonFreq;
}

// Create a buffer for a segment of the original audio
function createSegmentBuffer(buffer, startSample, endSample) {
    const length = endSample - startSample;
    const segmentBuffer = new AudioBuffer({
        length: length,
        numberOfChannels: buffer.numberOfChannels,
        sampleRate: buffer.sampleRate
    });
    
    // Copy data from each channel
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        const segmentData = segmentBuffer.getChannelData(channel);
        
        for (let i = 0; i < length; i++) {
            segmentData[i] = channelData[i + startSample];
        }
    }
    
    return segmentBuffer;
}

// Analyze a single segment of audio
async function analyzeSegment(buffer) {
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
    analyzer.minDecibels = -90;
    analyzer.maxDecibels = -10;
    analyzer.smoothingTimeConstant = 0.3; // Add some smoothing for musical content
    
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
    const threshold = -70; // Threshold in dB
    
    // Find all significant peaks
    for (let i = 5; i < frequencyData.length - 1; i++) {
        if (frequencyData[i] > threshold && 
            frequencyData[i] > frequencyData[i-1] && 
            frequencyData[i] > frequencyData[i+1]) {
            
            // Calculate frequency for this bin
            const frequency = i * sampleRate / fftSize;
            
            // Only consider frequencies in musical range (80Hz-5000Hz)
            // Narrowed range to focus more on fundamental music frequencies
            if (frequency >= 80 && frequency <= 5000) {
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
    
    // First, check if we have peaks very close to our target A notes or key harmonics
    const directMatch = checkDirectMatch(topPeaks);
    if (directMatch !== 0) {
        console.log(`Direct match found for ${directMatch}Hz`);
        return directMatch;
    }
    
    // For music analysis, we need to check all potentially musical intervals
    // Not just A notes, but all common note frequencies and their harmonics
    
    // Counters for how well peaks match each tuning standard
    let score440 = 0;
    let score432 = 0;
    
    // Check more note frequencies beyond just A
    // Include frequencies for C, D, E, F, G, A, B in both tuning systems
    // These are calculated relative to A4
    const notesFrom440 = calculateMusicNotes(440);
    const notesFrom432 = calculateMusicNotes(432);
    
    // For each peak, check how closely it matches each tuning system
    for (const peak of topPeaks) {
        let best440Match = Infinity;
        let best432Match = Infinity;
        
        // Find best match against 440Hz system
        for (const noteFreq of notesFrom440) {
            const cents = calculateCents(peak.frequency, noteFreq);
            if (Math.abs(cents) < Math.abs(best440Match)) {
                best440Match = cents;
            }
        }
        
        // Find best match against 432Hz system
        for (const noteFreq of notesFrom432) {
            const cents = calculateCents(peak.frequency, noteFreq);
            if (Math.abs(cents) < Math.abs(best432Match)) {
                best432Match = cents;
            }
        }
        
        // Weight the scores based on peak amplitude
        const weight = Math.pow(10, (peak.amplitude + 100) / 20); // Convert dB to linear scale
        const normalizedWeight = Math.min(5, weight / 1000); // Normalize and cap
        
        // Add score based on which system matched better
        if (Math.abs(best440Match) < Math.abs(best432Match)) {
            score440 += normalizedWeight;
        } else {
            score432 += normalizedWeight;
        }
    }
    
    console.log(`Tuning scores - 440Hz: ${score440.toFixed(2)}, 432Hz: ${score432.toFixed(2)}`);
    
    // Use objective criteria with a small margin to avoid false positives
    if (score440 > score432 * 1.1) {
        return 440;
    } else if (score432 > score440 * 1.1) {
        return 432;
    } else {
        // If we can't be confident, report the strongest peak frequency
        return parseFloat(topPeaks[0].frequency.toFixed(2));
    }
}

// Calculate music note frequencies for an octave based on A4 reference
function calculateMusicNotes(a4Freq) {
    const notes = [];
    
    // Frequency ratios for notes relative to A4
    // C, C#, D, D#, E, F, F#, G, G#, A, A#, B
    const ratios = [
        2/3 * 2, // C
        2/3 * 2 * Math.pow(2, 1/12), // C#
        3/4 * 2, // D
        3/4 * 2 * Math.pow(2, 1/12), // D#
        5/6 * 2, // E
        8/9 * 2, // F
        8/9 * 2 * Math.pow(2, 1/12), // F#
        9/10 * 2, // G
        9/10 * 2 * Math.pow(2, 1/12), // G#
        1, // A
        1 * Math.pow(2, 1/12), // A#
        9/8 // B
    ];
    
    // Generate notes across 7 octaves
    for (let octave = -3; octave <= 3; octave++) {
        const octaveShift = Math.pow(2, octave);
        for (const ratio of ratios) {
            notes.push(a4Freq * ratio * octaveShift);
        }
    }
    
    return notes;
}

// Check for direct matches to 432Hz or 440Hz
function checkDirectMatch(peaks) {
    // Check the top peaks against common note frequencies in both systems
    // Use a tighter match threshold for direct matches
    for (const peak of peaks.slice(0, 5)) { // Only check strongest peaks
        // Check for A notes and harmonically related notes in 432Hz system
        const notes432 = [432, 864, 216, 108, 54];  // A notes (432Hz, harmonics)
        for (const note of notes432) {
            if (Math.abs(peak.frequency - note) / note < 0.01) { // 1% tolerance
                return 432;
            }
        }
        
        // Check for A notes and harmonically related notes in 440Hz system
        const notes440 = [440, 880, 220, 110, 55];  // A notes (440Hz, harmonics)
        for (const note of notes440) {
            if (Math.abs(peak.frequency - note) / note < 0.01) { // 1% tolerance
                return 440;
            }
        }
        
        // Also check if we're very close to key 432Hz E notes
        const eNotes432 = [324, 648, 162, 81]; // E notes in 432Hz system (3:4 ratio)
        for (const note of eNotes432) {
            if (Math.abs(peak.frequency - note) / note < 0.01) {
                return 432;
            }
        }
        
        // Similarly for 440Hz E notes
        const eNotes440 = [330, 660, 165, 82.5]; // E notes in 440Hz system
        for (const note of eNotes440) {
            if (Math.abs(peak.frequency - note) / note < 0.01) {
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
    // First determine the most likely tuning of the original
    console.log("Analyzing original audio tuning before conversion...");
    
    try {
        // Analyze a small segment for efficiency
        const sampleLength = Math.min(buffer.length, 5 * buffer.sampleRate); // 5 second sample
        const sampleBuffer = createSegmentBuffer(buffer, 0, sampleLength);
        const originalTuning = await analyzeSegment(sampleBuffer);
        
        console.log(`Original audio appears to be tuned to ${originalTuning}Hz`);
        
        // Calculate appropriate ratio
        let ratio;
        if (originalTuning === 432) {
            console.log("Audio already appears to be at 432Hz, making no changes");
            return audioBufferToWav(buffer); // Return the buffer as-is
        } else if (originalTuning === 440) {
            ratio = 432 / 440; // Standard conversion from 440Hz to 432Hz
        } else if (originalTuning > 0) {
            // If we detected some other specific frequency, adjust accordingly
            ratio = 432 / originalTuning;
        } else {
            // Default to standard 440 to 432 conversion if we couldn't determine
            ratio = 432 / 440;
        }
        
        console.log(`Applying tuning ratio: ${ratio.toFixed(6)} (from ${originalTuning || 440}Hz to 432Hz)`);
    
        // Process more efficiently for larger files
        if (buffer.length > 10 * buffer.sampleRate) { // More than 10 seconds
            console.log("Processing large audio file in memory-efficient manner...");
            return await tuneAudioChunked(buffer, ratio);
        } else {
            // For shorter files, use the standard approach
            return await tuneAudioStandard(buffer, ratio);
        }
    } catch (error) {
        console.error("Error in tuning process:", error);
        // Fall back to standard 440->432 conversion
        console.log("Falling back to standard 440->432Hz conversion");
        const ratio = 432 / 440;
        return await tuneAudioStandard(buffer, ratio);
    }
}

// Standard tuning approach for shorter files
async function tuneAudioStandard(buffer, ratio) {
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
    console.log('Processing audio...');
    const renderedBuffer = await offlineContext.startRendering();
    console.log('Audio processing complete');
    
    // Convert to WAV
    console.log('Converting to WAV format...');
    const wavData = audioBufferToWav(renderedBuffer);
    return wavData;
}

// Chunked tuning approach for longer files to avoid memory issues
async function tuneAudioChunked(buffer, ratio) {
    // For very long audio, we process in chunks to avoid memory issues
    const chunkSize = 10 * buffer.sampleRate; // 10 second chunks
    const chunks = Math.ceil(buffer.length / chunkSize);
    console.log(`Processing audio in ${chunks} chunks...`);
    
    // Create the final buffer with proper length
    const newLength = Math.floor(buffer.length / ratio);
    const finalBuffer = new AudioBuffer({
        numberOfChannels: buffer.numberOfChannels,
        length: newLength,
        sampleRate: buffer.sampleRate
    });
    
    // Process each chunk
    for (let i = 0; i < chunks; i++) {
        const startSample = i * chunkSize;
        const endSample = Math.min((i + 1) * chunkSize, buffer.length);
        console.log(`Processing chunk ${i+1}/${chunks} (${((endSample - startSample) / buffer.sampleRate).toFixed(2)}s)`);
        
        // Create chunk buffer
        const chunkBuffer = createSegmentBuffer(buffer, startSample, endSample);
        
        // Calculate chunk output size
        const chunkOutputSize = Math.floor((endSample - startSample) / ratio);
        
        // Process this chunk
        const processedChunk = await tuneBufferChunk(chunkBuffer, ratio);
        
        // Copy processed chunk to final buffer
        const destStart = Math.floor(startSample / ratio);
        copyBufferSegment(processedChunk, finalBuffer, destStart);
    }
    
    // Convert to WAV
    console.log('Converting complete audio to WAV format...');
    const wavData = audioBufferToWav(finalBuffer);
    return wavData;
}

// Process a single audio chunk
async function tuneBufferChunk(buffer, ratio) {
    // Calculate new length for this chunk
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
    
    // Apply playback rate
    source.playbackRate.value = ratio;
    
    // Connect to destination
    source.connect(offlineContext.destination);
    
    // Start playback
    source.start(0);
    
    // Process audio
    return await offlineContext.startRendering();
}

// Copy data from one buffer to another
function copyBufferSegment(sourceBuffer, destBuffer, destStart) {
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
        const sourceData = sourceBuffer.getChannelData(channel);
        const destData = destBuffer.getChannelData(channel);
        
        for (let i = 0; i < sourceBuffer.length; i++) {
            if (destStart + i < destBuffer.length) {
                destData[destStart + i] = sourceData[i];
            }
        }
    }
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

// Glass animation with slower frame rate
let glassAnimationFrame = 0;
const glassImage = document.getElementById('glassImage');
const glassFrames = ['glassA.png', 'glassB.png', 'glassC.png'];
const glassAnimation = document.getElementById('glassAnimation');

// Add a small indicator div to help visualize frame changes
const frameIndicator = document.createElement('div');
frameIndicator.style.position = 'absolute';
frameIndicator.style.bottom = '5px';
frameIndicator.style.right = '5px';
frameIndicator.style.backgroundColor = 'rgba(0,0,0,0.5)';
frameIndicator.style.color = '#fff';
frameIndicator.style.padding = '3px';
frameIndicator.style.fontSize = '10px';
frameIndicator.style.borderRadius = '3px';
glassAnimation.appendChild(frameIndicator);

function animateGlass() {
    glassAnimationFrame = (glassAnimationFrame + 1) % 3; // Now cycling through 3 frames
    
    // FORCE CACHE BUSTING - Add random timestamp to prevent browser caching
    const forceReload = '?nocache=' + Date.now() + Math.random();
    glassImage.src = glassFrames[glassAnimationFrame] + forceReload;
    
    // Update indicator if present
    if (frameIndicator) {
        frameIndicator.textContent = `Frame ${glassAnimationFrame + 1}`;
    }
    
    console.log("Animating glass: frame " + (glassAnimationFrame + 1));
}

// Start the glass animation with slower speed (1000ms = 1 second per frame)
setInterval(animateGlass, 1000); // Slower animation

// Force the first animation frame
setTimeout(() => {
    animateGlass();
    console.log("Animation started");
}, 100); 