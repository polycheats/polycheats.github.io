(function() {
    "use strict";

    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    const UI_CONFIG = {
        primary: "#b561c4",
        bg: "rgba(13, 13, 18, 0.98)",
        border: "rgba(181, 97, 196, 0.4)",
        text: "#e2e2e7",
        textMuted: "#8e8e93",
        inputBg: "rgba(0, 0, 0, 0.3)",
        inputBorder: "rgba(255, 255, 255, 0.1)",
        success: "#34c759",
        error: "#ff3b30",
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Menlo', monospace"
    };

    const fail = (msg) => { throw new Error(msg); };


    function b62decode(input) {
        let bytesOut = [];
        let outPos = 0;
        for (let i = 0; i < input.length; i++) {
            const value = ALPHABET.indexOf(input[i]);
            if (value === -1) fail(`Invalid character at pos ${i}`);
            const valueLen = (value & 30) === 30 ? 5 : 6;
            const isLast = i === input.length - 1;
            let byteIndex = Math.floor(outPos / 8);
            while (byteIndex >= bytesOut.length) bytesOut.push(0);
            const offset = outPos - 8 * byteIndex;
            bytesOut[byteIndex] |= (value << offset) & 0xFF;
            if (offset > 8 - valueLen && !isLast) {
                const nextIndex = byteIndex + 1;
                if (nextIndex >= bytesOut.length) bytesOut.push(0);
                bytesOut[nextIndex] |= (value >> (8 - offset)) & 0xFF;
            }
            outPos += valueLen;
        }
        return new Uint8Array(bytesOut);
    }

    function inflateZlib(bytes) {
        try {
            return pako.inflate(bytes);
        } catch (e) {
            fail("Decompression failed: payload corrupted.");
        }
    }

    function utf8decode(bytes) {
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (e) {
            return null;
        }
    }

    async function sha256hex(bytes) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    function decodeTrackCode(code) {
        if (code.length < 10) fail("Code too short.");
        const rest = code.slice(10);
        const tdStart = rest.indexOf("4p");
        if (tdStart === -1) fail("Invalid PolyTrack2 code format.");
        const trackDataStr = rest.slice(tdStart);

        const step1 = b62decode(trackDataStr);
        const step2 = inflateZlib(step1);
        const step2Str = utf8decode(step2);
        if (step2Str === null) fail("Invalid UTF-8 payload.");
        const step3 = b62decode(step2Str);
        const step4 = inflateZlib(step3);

        let pos = 0;
        const nameLen = step4[pos]; pos += 1;
        const nameBytes = step4.slice(pos, pos + nameLen); pos += nameLen;
        const name = utf8decode(nameBytes);
        
        const authorLen = step4[pos]; pos += 1;
        const authorBytes = step4.slice(pos, pos + authorLen); pos += authorLen;
        const author = utf8decode(authorBytes);

        const lastmodExists = step4[pos]; pos += 1;
        let lastModified = null;
        if (lastmodExists === 1) {
            lastModified = (step4[pos] | (step4[pos+1]<<8) | (step4[pos+2]<<16) | (step4[pos+3]<<24)) >>> 0;
            pos += 4;
        }
        const trackData = step4.slice(pos);
        return { name, author, lastModified, trackData };
    }

    async function fetchUserId() {
        const slot = localStorage.getItem("polytrack_v5_prod_user_slot") || "0";
        const userDataStr = localStorage.getItem(`polytrack_v5_prod_user_${slot}`);
        if (!userDataStr) return "UNAUTHENTICATED";

        try {
            const userData = JSON.parse(userDataStr);
            if (!userData.token) return "TOKEN_MISSING";
            const tokenBytes = new TextEncoder().encode(userData.token);
            return await sha256hex(tokenBytes);
        } catch (e) {
            return "PARSE_ERROR";
        }
    }

    
    async function initMod() {
        if (document.getElementById("pt-mod-root")) return;

        const style = document.createElement("style");
        style.textContent = `
            #pt-mod-root {
                position: fixed;
                top: 24px;
                left: 24px;
                width: 300px;
                background: ${UI_CONFIG.bg};
                border: 1px solid ${UI_CONFIG.border};
                border-radius: 12px;
                color: ${UI_CONFIG.text};
                font-family: ${UI_CONFIG.fontFamily};
                font-size: 11px;
                z-index: 9999999;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
                overflow: hidden;
                user-select: none;
                backdrop-filter: blur(10px);
                transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s;
            }
            .pt-header {
                padding: 12px 16px;
                background: rgba(255, 255, 255, 0.03);
                border-bottom: 1px solid ${UI_CONFIG.inputBorder};
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: grab;
            }
            .pt-header:active { cursor: grabbing; }
            .pt-title {
                text-transform: uppercase;
                letter-spacing: 0.1em;
                font-weight: 700;
                color: ${UI_CONFIG.primary};
                font-size: 10px;
            }
            .pt-content {
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .pt-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .pt-label {
                color: ${UI_CONFIG.textMuted};
                font-size: 9px;
                text-transform: uppercase;
                font-weight: 600;
            }
            .pt-input {
                background: ${UI_CONFIG.inputBg};
                border: 1px solid ${UI_CONFIG.inputBorder};
                border-radius: 6px;
                color: #fff;
                padding: 8px 10px;
                font-family: inherit;
                font-size: 11px;
                outline: none;
                transition: border-color 0.2s;
            }
            .pt-input:focus {
                border-color: ${UI_CONFIG.primary};
            }
            .pt-input[readonly] {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .pt-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
            }
            .pt-btn {
                background: ${UI_CONFIG.primary};
                border: none;
                border-radius: 6px;
                color: #fff;
                padding: 10px;
                font-weight: 700;
                font-size: 11px;
                cursor: pointer;
                transition: filter 0.2s, transform 0.1s;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .pt-btn:hover { filter: brightness(1.1); }
            .pt-btn:active { transform: translateY(1px); }
            .pt-btn-secondary {
                background: rgba(255, 255, 255, 0.05);
                color: ${UI_CONFIG.text};
                padding: 6px;
                font-size: 9px;
            }
            .pt-status {
                margin-top: 4px;
                font-size: 10px;
                height: 14px;
                text-align: center;
                font-weight: 500;
            }
            .pt-minimize {
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                border-radius: 4px;
                transition: background 0.2s;
            }
            .pt-minimize:hover { background: rgba(255, 255, 255, 0.1); }
            .minimized {
                transform: translateY(-10px);
                opacity: 0.5;
            }
            .minimized .pt-content { display: none; }
        `;
        document.head.appendChild(style);

        const root = document.createElement("div");
        root.id = "pt-mod-root";
        root.innerHTML = `
            <div class="pt-header">
                <span class="pt-title">Injector v2.0</span>
                <div class="pt-minimize" id="pt-min-btn">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>
                </div>
            </div>
            <div class="pt-content">
                <div class="pt-field">
                    <label class="pt-label">Track Identifier</label>
                    <input type="text" id="pt-track-id" class="pt-input" placeholder="polytrack24...">
                </div>
                <div class="pt-field">
                    <label class="pt-label">Auth Token Hash</label>
                    <input type="text" id="pt-user-id" class="pt-input" readonly value="SYNCHRONIZING...">
                </div>
                <div class="pt-field">
                    <div style="display:flex; justify-content:space-between; align-items:center">
                        <label class="pt-label">Recording Payload</label>
                        <button class="pt-btn pt-btn-secondary" id="pt-gen-btn">LOAD DUMMY</button>
                    </div>
                    <textarea id="pt-recording" class="pt-input" style="height: 60px; resize: none;"></textarea>
                </div>
                <div class="pt-field">
                    <label class="pt-label">Duration (Frames)</label>
                    <input type="number" id="pt-frames" class="pt-input" value="100">
                </div>
                <button class="pt-btn" id="pt-inject-btn">Inject Recording</button>
                <div id="pt-status" class="pt-status"></div>
            </div>
        `;
        document.body.appendChild(root);

        
        const state = {
            minimized: false,
            userId: await fetchUserId()
        };

        const elements = {
            root,
            minBtn: document.getElementById("pt-min-btn"),
            trackId: document.getElementById("pt-track-id"),
            userId: document.getElementById("pt-user-id"),
            recording: document.getElementById("pt-recording"),
            frames: document.getElementById("pt-frames"),
            injectBtn: document.getElementById("pt-inject-btn"),
            genBtn: document.getElementById("pt-gen-btn"),
            status: document.getElementById("pt-status")
        };

        elements.userId.value = state.userId;

        
        elements.minBtn.onclick = () => {
            state.minimized = !state.minimized;
            root.classList.toggle("minimized", state.minimized);
            elements.minBtn.innerHTML = state.minimized 
                ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`
                : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>`;
        };

        elements.genBtn.onclick = () => {
            elements.recording.value = "eNpjYAABRgYEAAAAHgAC";
            showStatus("Dummy payload loaded", UI_CONFIG.textMuted);
        };

        const showStatus = (text, color) => {
            elements.status.innerText = text;
            elements.status.style.color = color;
            setTimeout(() => { if(elements.status.innerText === text) elements.status.innerText = ""; }, 3000);
        };

        elements.injectBtn.onclick = async () => {
            const trackVal = elements.trackId.value.trim();
            const recording = elements.recording.value.trim();
            const frames = parseInt(elements.frames.value);

            if (!trackVal || state.userId.length < 10 || !recording || isNaN(frames)) {
                return showStatus("Invalid configuration", UI_CONFIG.error);
            }

            try {
                showStatus("Processing...", UI_CONFIG.primary);
                
                let trackId;
                if (trackVal.length === 64 && /^[0-9a-f]+$/.test(trackVal)) {
                    trackId = trackVal;
                } else {
                    const decoded = decodeTrackCode(trackVal);
                    trackId = await sha256hex(decoded.trackData);
                }

                const slot = localStorage.getItem("polytrack_v5_prod_user_slot") || "0";
                const storageKey = `polytrack_v5_prod_record_${slot}_default_${trackId}`;
                
                const payload = {
                    uploadId: Math.floor(Math.random() * 648921362) + 351078638,
                    tokenHash: state.userId,
                    frames: frames,
                    recording: recording
                };

                localStorage.setItem(storageKey, JSON.stringify(payload));
                showStatus("Injection successful", UI_CONFIG.success);
                console.log(`[PT-MOD] Injected: ${trackId}`);
            } catch (e) {
                showStatus(e.message, UI_CONFIG.error);
            }
        };

        // Simple Draggable logic
        let isDragging = false, currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;
        const header = root.querySelector(".pt-header");

        header.onmousedown = (e) => {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            if (e.target === header || header.contains(e.target)) isDragging = true;
        };

        window.onmousemove = (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;
                root.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
            }
        };

        window.onmouseup = () => { isDragging = false; };
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initMod);
    } else {
        initMod();
    }
})();
