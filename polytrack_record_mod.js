(function() {
    "use strict";

    const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    function fail(msg) { throw new Error(msg); }

   
    function b62decode(input) {
        let bytesOut = [];
        let outPos = 0;
        for (let i = 0; i < input.length; i++) {
            const value = ALPHABET.indexOf(input[i]);
            if (value === -1) fail("Invalid character in base62 payload near position " + i);
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
            fail("Zlib decompression failed — code is corrupt or truncated.");
        }
    }

    function utf8decode(bytes) {
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch (e) {
            return null;
        }
    }

 
    function decodeTrackCode(code) {
        if (code.length < 10) fail("Code is too short to be a PolyTrack export code.");
        const rest = code.slice(10);
        const tdStart = rest.indexOf("4p");
        if (tdStart === -1) fail("Couldn't find the compressed payload marker — is this a valid PolyTrack2 code?");
        const trackDataStr = rest.slice(tdStart);

        const step1 = b62decode(trackDataStr);
        const step2 = inflateZlib(step1);
        const step2Str = utf8decode(step2);
        if (step2Str === null) fail("Inner payload wasn't valid UTF-8 text.");
        const step3 = b62decode(step2Str);
        const step4 = inflateZlib(step3);

        let pos = 0;
        const nameLen = step4[pos]; pos += 1;
        const nameBytes = step4.slice(pos, pos + nameLen); pos += nameLen;
        const name = utf8decode(nameBytes);
        if (name === null) fail("Track name wasn't valid UTF-8.");

        const authorLen = step4[pos]; pos += 1;
        const authorBytes = step4.slice(pos, pos + authorLen); pos += authorLen;
        const author = utf8decode(authorBytes);

        const lastmodExists = step4[pos]; pos += 1;
        if (lastmodExists > 1) fail("Malformed 'last modified' flag in header.");
        let lastModified = null;
        if (lastmodExists === 1) {
            lastModified = (step4[pos] | (step4[pos+1]<<8) | (step4[pos+2]<<16) | (step4[pos+3]<<24)) >>> 0;
            pos += 4;
        }
        const trackData = step4.slice(pos);
        return { name, author, lastModified, trackData };
    }

    async function sha256hex(bytes) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async function fetchUserId() {
        let slot = localStorage.getItem("polytrack_v5_prod_user_slot");
        if (slot === null || slot === undefined) slot = "0";
        
        const userDataStr = localStorage.getItem(`polytrack_v5_prod_user_${slot}`);
        if (!userDataStr) return "Not Found (Login first)";

        try {
            const userData = JSON.parse(userDataStr);
            if (!userData.token) return "No Token Found";
            const tokenBytes = new TextEncoder().encode(userData.token);
            return await sha256hex(tokenBytes);
        } catch (e) {
            return "Error parsing user data";
        }
    }

    async function initMod() {
        const uiContainer = document.body;
        
        const modSection = document.createElement("div");
        modSection.id = "record-injector-mod";
        modSection.style.cssText = `
            position: fixed;
            top: 20px;
            left: 20px;
            width: 320px;
            background: rgba(15, 15, 25, 0.95);
            border: 2px solid #b561c4;
            border-radius: 8px;
            padding: 15px;
            color: #ffffff;
            font-family: 'Inter', sans-serif;
            z-index: 2147483647;
            box-shadow: 0 0 20px rgba(181, 97, 196, 0.3);
            pointer-events: auto;
            transition: all 0.3s ease-in-out;
        `;

        modSection.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <div style="font-weight: bold; font-style: italic; color: #b561c4; font-size: 16px;">Record Injector Mod</div>
                <button id="mod-toggle-btn" style="background: none; border: 1px solid #b561c4; color: #b561c4; border-radius: 4px; cursor: pointer; padding: 2px 8px; font-size: 10px; font-weight: bold;">_</button>
            </div>
            
            <div id="mod-content">
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 10px; color: #ffffff; margin-bottom: 4px; font-weight: bold; font-style: italic;">Track Export ID / Code:</div>
                    <input type="text" id="mod-track-id" placeholder="PolyTrack24..." style="width: 100%; background: #000; border: 1px solid #444; color: #fff; padding: 4px 8px; font-size: 12px; font-family: monospace;">
                </div>

                <div style="margin-bottom: 10px;">
                    <div style="font-size: 10px; color: #ffffff; margin-bottom: 4px; font-weight: bold; font-style: italic;">User ID (Auto-fetched):</div>
                    <input type="text" id="mod-user-id" readonly style="width: 100%; background: #1a1a1a; border: 1px solid #333; color: #aaa; padding: 4px 8px; font-size: 11px; font-family: monospace; cursor: not-allowed;">
                    <div style="font-size: 9px; color: #888; margin-top: 2px; font-style: italic;">Derived from your local session token.</div>
                </div>

                <div style="margin-bottom: 10px;">
                    <div style="font-size: 10px; color: #ffffff; margin-bottom: 4px; font-weight: bold; font-style: italic;">Recording Data:</div>
                    <textarea id="mod-recording" style="width: 100%; height: 50px; background: #000; border: 1px solid #444; color: #fff; padding: 4px 8px; font-size: 10px; font-family: monospace; resize: none;"></textarea>
                    <button id="mod-random-rec-btn" style="width: 100%; background: #2a2a3a; border: 1px solid #444; color: #bbb; padding: 4px; margin-top: 4px; font-size: 9px; cursor: pointer; border-radius: 4px; transition: all 0.2s;">generate random recording</button>
                    <div style="font-size: 9px; color: #888; margin-top: 2px; font-style: italic;">Use old recordings from polyweb.ireo.dev.</div>
                </div>

                <div style="margin-bottom: 12px;">
                    <div style="font-size: 10px; color: #ffffff; margin-bottom: 4px; font-weight: bold; font-style: italic;">Frames:</div>
                    <input type="number" id="mod-frames" value="100" style="width: 100%; background: #000; border: 1px solid #444; color: #fff; padding: 4px 8px; font-size: 12px;">
                    <div style="font-size: 9px; color: #888; margin-top: 2px; font-style: italic;">1000 Frames = 1 second</div>
                </div>

                <button id="mod-inject-btn" style="width: 100%; background: #b561c4; border: none; color: #fff; padding: 8px; font-weight: bold; cursor: pointer; border-radius: 4px; font-size: 12px; transition: background 0.2s;">Inject Record</button>
                
                <div id="mod-status" style="margin-top: 8px; font-size: 10px; font-weight: bold;"></div>
            </div>
        `;

        uiContainer.appendChild(modSection);

        // Minimize logic
        let isMinimized = false;
        const toggleBtn = document.getElementById("mod-toggle-btn");
        const modContent = document.getElementById("mod-content");

        toggleBtn.addEventListener("click", () => {
            isMinimized = !isMinimized;
            if (isMinimized) {
                modContent.style.display = "none";
                modSection.style.width = "180px";
                toggleBtn.innerText = "□";
            } else {
                modContent.style.display = "block";
                modSection.style.width = "320px";
                toggleBtn.innerText = "_";
            }
        });

        // Random recording button logic
        const randomRecBtn = document.getElementById("mod-random-rec-btn");
        const recordingTextarea = document.getElementById("mod-recording");
        randomRecBtn.addEventListener("click", () => {
            recordingTextarea.value = "eNpjYAABRgYEAAAAHgAC";
        });

        // Auto-fetch User ID on load
        const userIdInput = document.getElementById("mod-user-id");
        userIdInput.value = "Fetching...";
        const fetchedId = await fetchUserId();
        userIdInput.value = fetchedId;

        const btn = document.getElementById("mod-inject-btn");
        btn.addEventListener("click", async () => {
            const trackInput = document.getElementById("mod-track-id").value.trim();
            const userId = document.getElementById("mod-user-id").value.trim();
            const recording = document.getElementById("mod-recording").value.trim();
            const frames = parseInt(document.getElementById("mod-frames").value);
            const status = document.getElementById("mod-status");

            if (!trackInput || !userId || userId.includes(" ") || !recording || isNaN(frames)) {
                status.innerText = "Error: Invalid inputs or User ID not found.";
                status.style.color = "#ff4444";
                return;
            }

            try {
                status.innerText = "Processing...";
                status.style.color = "#ffffff";

                let trackId;
                if (trackInput.length === 64 && /^[0-9a-f]+$/.test(trackInput)) {
                    trackId = trackInput;
                } else {
                    const decoded = decodeTrackCode(trackInput);
                    trackId = await sha256hex(decoded.trackData);
                }

                let userSlot = localStorage.getItem("polytrack_v5_prod_user_slot");
                if (userSlot === null || userSlot === undefined) userSlot = "0";

                const storageKey = `polytrack_v5_prod_record_${userSlot}_default_${trackId}`;
                const uploadId = Math.floor(Math.random() * (1000000000 - 351078638)) + 351078638;
                
                const storageValue = {
                    "uploadId": uploadId,
                    "tokenHash": userId,
                    "frames": frames,
                    "recording": recording
                };

                localStorage.setItem(storageKey, JSON.stringify(storageValue));

                status.innerText = "Success: Record injected.";
                status.style.color = "#10b981";
                console.log("Mod injected record for track:", trackId);

            } catch (err) {
                status.innerText = "Error: " + err.message;
                status.style.color = "#ff4444";
            }
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initMod);
    } else {
        initMod();
    }
})();
