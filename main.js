const video = document.getElementById('videoElement');
        const outputCanvas = document.getElementById('outputCanvas');
        const switchButton = document.getElementById('switchButton');
        const recordButton = document.getElementById('recordButton');
        const debugInfo = document.getElementById('debugInfo');
        const canvasCtx = outputCanvas.getContext('2d');
        let currentFacingMode = 'user';
        let cameraRunning = false;
        let currentStream = null;
        let mediaRecorder = null;
        let recordedChunks = [];
        let isRecording = false;

        function updateMirrorEffect(facingMode) {
            // Only mirror for front-facing camera
            if (facingMode === 'user') {
                video.classList.add('user-camera');
                canvasCtx.setTransform(-1, 0, 0, 1, outputCanvas.width, 0);
            } else {
                video.classList.remove('user-camera');
                canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
            }
            updateDebugInfo(`Camera mode: ${facingMode}`);
        }

        function getSupportedMimeType() {
            const types = [
                'video/webm',
                'video/webm;codecs=vp8',
                'video/webm;codecs=h264',
                'video/mp4'
            ];

            for (const type of types) {
                if (MediaRecorder.isTypeSupported(type)) {
                    updateDebugInfo(`Using MIME type: ${type}`);
                    return type;
                }
            }
            
            throw new Error('No supported MIME type found for MediaRecorder');
        }

        function updateDebugInfo(message) {
            const timestamp = new Date().toLocaleTimeString();
            debugInfo.innerHTML += `${timestamp}: ${message}<br>`;
            debugInfo.scrollTop = debugInfo.scrollHeight;
        }

        function updateCanvasSize() {
            outputCanvas.width = window.innerWidth;
            outputCanvas.height = window.innerHeight;
            // Reapply transform when resizing
            updateMirrorEffect(currentFacingMode);
        }
        
        updateCanvasSize();

        const hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        hands.onResults((results) => {
            canvasCtx.save();
            canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
            
            // Reset transform before drawing the image
            canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
            canvasCtx.drawImage(results.image, 0, 0, outputCanvas.width, outputCanvas.height);
            
            // Reapply mirror effect if needed
            if (currentFacingMode === 'user') {
                canvasCtx.setTransform(-1, 0, 0, 1, outputCanvas.width, 0);
            }

            if (results.multiHandLandmarks) {
                for (let index = 0; index < results.multiHandLandmarks.length; index++) {
                    const classification = results.multiHandedness[index];
                    const isRightHand = classification.label === 'Right';
                    const landmarks = results.multiHandLandmarks[index];
                    
                    drawConnectors(
                        canvasCtx, 
                        landmarks, 
                        HAND_CONNECTIONS,
                        {color: isRightHand ? '#00FF00' : '#FF0000'}
                    );
                    
                    drawLandmarks(
                        canvasCtx, 
                        landmarks, 
                        {
                            color: isRightHand ? '#00FF00' : '#FF0000',
                            fillColor: isRightHand ? '#FF0000' : '#00FF00',
                            radius: 5
                        }
                    );
                }
            }
            canvasCtx.restore();
        });

        async function setupCamera(facingMode) {
            try {
                if (currentStream) {
                    currentStream.getTracks().forEach(track => track.stop());
                }

                currentStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: facingMode,
                        width: { ideal: 1280 },
                        height: { ideal: 720 }
                    }
                });

                video.srcObject = currentStream;
                updateMirrorEffect(facingMode);

                await new Promise((resolve) => {
                    video.onloadedmetadata = () => resolve();
                });

                await video.play();

                const processFrame = async () => {
                    if (currentStream.active) {
                        await hands.send({image: video});
                        requestAnimationFrame(processFrame);
                    }
                };

                requestAnimationFrame(processFrame);

                cameraRunning = true;
                updateDebugInfo(`Camera initialized with facing mode: ${facingMode}`);
                return true;

            } catch (error) {
                updateDebugInfo(`Camera setup error: ${error.message}`);
                return false;
            }
        }

        async function switchCamera() {
            if (switchButton.disabled) return;
            
            switchButton.disabled = true;
            updateDebugInfo('Switching camera...');

            try {
                currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
                await setupCamera(currentFacingMode);
            } catch (error) {
                updateDebugInfo(`Switch camera error: ${error.message}`);
                currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
            } finally {
                switchButton.disabled = false;
            }
        }

        function startRecording() {
            try {
                recordedChunks = [];
                const stream = outputCanvas.captureStream(30);
                const mimeType = getSupportedMimeType();
                
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: mimeType,
                    videoBitsPerSecond: 2500000
                });

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        recordedChunks.push(event.data);
                    }
                };

                mediaRecorder.onstop = () => {
                    const blob = new Blob(recordedChunks, {
                        type: mimeType
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
                    a.download = `hand-detection-${new Date().toISOString()}.${extension}`;
                    a.click();
                    URL.revokeObjectURL(url);
                    updateDebugInfo('Recording saved');
                };

                mediaRecorder.start(1000);
                isRecording = true;
                recordButton.textContent = 'Stop Recording';
                recordButton.classList.add('recording');
                updateDebugInfo('Recording started');
            } catch (error) {
                updateDebugInfo(`Recording error: ${error.message}`);
                alert('Failed to start recording: ' + error.message);
            }
        }

        function stopRecording() {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                isRecording = false;
                recordButton.textContent = 'Start Recording';
                recordButton.classList.remove('recording');
            }
        }

        window.addEventListener('resize', updateCanvasSize);

        document.addEventListener('click', () => {
            if (!cameraRunning) {
                setupCamera(currentFacingMode);
            }
        }, { once: true });

        switchButton.addEventListener('click', switchCamera);
        recordButton.addEventListener('click', () => {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });

        updateDebugInfo('Page loaded. Click anywhere to start camera.');