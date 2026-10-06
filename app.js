/**
 * IT Support Chat & Voice Calling Application
 * Connected to Supabase Cloud
 */

// Supabase Credentials
const SUPABASE_URL = 'https://ojlpeqhstbsuzjqccjgk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbHBlcWhzdGJzdXpqcWNjamdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNjExNTcsImV4cCI6MjEwNTczNzE1N30.hMoVGhKUBUlcktrWhsBaOk5A673irsAsYn_iMdOJKjw';

// Initialize Supabase Client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Application State
let currentRole = 'user'; // 'user' or 'it_support'
let localStream = null;
let peerConnection = null;
let realtimeChannel = null;
let callTimerInterval = null;
let callSeconds = 0;
let isAudioMuted = false;
let audioCtx = null;
let ringtoneOscillator = null;

// STUN Server Configuration for WebRTC
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// DOM Content Loaded Handler
document.addEventListener('DOMContentLoaded', () => {
    initRealtimeConnection();
    loadChatHistory();
});

// Role Switcher Handler
function switchRole(role) {
    currentRole = role;
    document.getElementById('btnRoleUser').classList.toggle('active', role === 'user');
    document.getElementById('btnRoleIT').classList.toggle('active', role === 'it_support');

    const targetTitle = document.getElementById('targetTitle');
    const targetAvatar = document.getElementById('targetAvatar');
    const roleInfo = document.getElementById('roleInfoText');

    if (role === 'user') {
        targetTitle.innerText = "IT Specialist Support";
        targetAvatar.innerHTML = '<i class="fa-solid fa-user-shield"></i>';
        roleInfo.innerHTML = 'Anda bertindak sebagai <strong>End-User</strong> meminta bantuan teknis.';
    } else {
        targetTitle.innerText = "User Client (Tiket #1042)";
        targetAvatar.innerHTML = '<i class="fa-solid fa-user"></i>';
        roleInfo.innerHTML = 'Anda bertindak sebagai <strong>IT Support</strong> melayani panggilan & pesan user.';
    }
}

// Supabase Realtime Setup
function initRealtimeConnection() {
    realtimeChannel = supabaseClient.channel('it-support-room', {
        config: { broadcast: { self: false } }
    });

    // Listen for Realtime Broadcast Messages (Chat & Voice Signal)
    realtimeChannel
        .on('broadcast', { event: 'chat-message' }, payload => {
            renderMessage(payload.payload, false);
        })
        .on('broadcast', { event: 'webrtc-signal' }, payload => {
            handleWebRTCSignal(payload.payload);
        })
        .subscribe(status => {
            const connStatus = document.getElementById('connStatus');
            if (status === 'SUBSCRIBED') {
                connStatus.innerHTML = '<i class="fa-solid fa-wifi text-success"></i> Terhubung Realtime';
            } else {
                connStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-danger"></i> Memenghubungkan...';
            }
        });

    // Listen for PostgreSQL database changes if table exists
    supabaseClient
        .channel('schema-db-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, payload => {
            // Render only if message was sent by other role
            if (payload.new.sender_role !== currentRole) {
                renderMessage(payload.new, false);
            }
        })
        .subscribe();
}

// Load Chat History from Supabase Database
async function loadChatHistory() {
    try {
        const { data, error } = await supabaseClient
            .from('chat_messages')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(50);

        if (error) {
            console.log('PostgreSQL Table belum siap, menggunakan mode Realtime Broadcast.');
            return;
        }

        if (data && data.length > 0) {
            const chatLog = document.getElementById('chatMessages');
            data.forEach(msg => {
                const isSelf = msg.sender_role === currentRole;
                renderMessage(msg, isSelf);
            });
        }
    } catch (err) {
        console.warn('Fallback ke broadcast channel mode:', err);
    }
}

// Send Chat Message
async function handleSendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;

    const senderName = currentRole === 'user' ? 'User (Anda)' : 'IT Support Specialist';
    const msgData = {
        sender_role: currentRole,
        sender_name: senderName,
        message: text,
        created_at: new Date().toISOString()
    };

    // Render locally immediately
    renderMessage(msgData, true);
    input.value = '';

    // 1. Broadcast to peer realtime
    realtimeChannel.send({
        type: 'broadcast',
        event: 'chat-message',
        payload: msgData
    });

    // 2. Persist in database
    try {
        await supabaseClient.from('chat_messages').insert([msgData]);
    } catch (err) {
        console.log('Database insert skipped, broadcast delivered.');
    }
}

// Render Bubble Message to DOM
function renderMessage(msg, isSelf) {
    const chatLog = document.getElementById('chatMessages');

    const wrapper = document.createElement('div');
    wrapper.className = `msg-bubble-wrapper ${isSelf ? 'self' : 'other'}`;

    const sender = document.createElement('div');
    sender.className = 'msg-sender-name';
    sender.innerText = isSelf ? 'Anda' : msg.sender_name;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerText = msg.message;

    const time = document.createElement('div');
    time.className = 'msg-time';
    const dateObj = new Date(msg.created_at || Date.now());
    time.innerText = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    bubble.appendChild(time);
    wrapper.appendChild(sender);
    wrapper.appendChild(bubble);

    chatLog.appendChild(wrapper);
    chatLog.scrollTop = chatLog.scrollHeight;
}

// WebRTC Voice Call Logic
async function initiateVoiceCall() {
    openCallOverlay('Memanggil IT Specialist / User...', false);
    startRingtone();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupPeerConnection();

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Send Offer via Supabase Realtime Signal
        sendSignal({ type: 'offer', offer: offer, senderRole: currentRole });

    } catch (err) {
        alert('Gagal mengakses mikrofon: ' + err.message);
        endVoiceCall();
    }
}

function setupPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            sendSignal({ type: 'candidate', candidate: event.candidate, senderRole: currentRole });
        }
    };

    peerConnection.ontrack = event => {
        stopRingtone();
        const remoteAudio = document.getElementById('remoteAudio');
        remoteAudio.srcObject = event.streams[0];
        document.getElementById('callStatusText').innerText = 'Panggilan Berlangsung';
        startCallTimer();
    };
}

// Handle Received Signals
async function handleWebRTCSignal(data) {
    if (data.senderRole === currentRole) return; // Ignore own signals

    if (data.type === 'offer') {
        startRingtone();
        openCallOverlay(`Panggilan Masuk dari ${data.senderRole === 'user' ? 'User' : 'IT Support'}`, true);
        window.incomingOffer = data.offer;

    } else if (data.type === 'answer' && peerConnection) {
        stopRingtone();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));

    } else if (data.type === 'candidate' && peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error('Candidate Error:', e);
        }

    } else if (data.type === 'hangup') {
        endVoiceCall(false);
    }
}

// Accept Incoming Call
async function acceptIncomingCall() {
    stopRingtone();
    document.getElementById('btnAcceptCall').style.display = 'none';
    document.getElementById('callStatusText').innerText = 'Menghubungkan Suara...';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setupPeerConnection();

        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        sendSignal({ type: 'answer', answer: answer, senderRole: currentRole });

    } catch (err) {
        alert('Gagal menerima panggilan: ' + err.message);
        endVoiceCall();
    }
}

// Helper: Send WebRTC Signal via Supabase
function sendSignal(signalData) {
    if (realtimeChannel) {
        realtimeChannel.send({
            type: 'broadcast',
            event: 'webrtc-signal',
            payload: signalData
        });
    }
}

// End or Reject Voice Call
function endVoiceCall(notifyPeer = true) {
    stopRingtone();
    if (notifyPeer) {
        sendSignal({ type: 'hangup', senderRole: currentRole });
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    clearInterval(callTimerInterval);
    callSeconds = 0;
    document.getElementById('callTimer').innerText = '00:00';
    document.getElementById('callOverlay').classList.remove('active');
}

// Call Mute Toggle
function toggleMuteAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            isAudioMuted = !isAudioMuted;
            audioTrack.enabled = !isAudioMuted;
            const btnMute = document.getElementById('btnMuteCall');
            btnMute.classList.toggle('muted', isAudioMuted);
            btnMute.innerHTML = isAudioMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
        }
    }
}

// UI Call Overlay Helper
function openCallOverlay(statusText, isIncoming = false) {
    document.getElementById('callStatusText').innerText = statusText;
    document.getElementById('callPeerName').innerText = currentRole === 'user' ? 'IT Specialist Support' : 'User Client';
    document.getElementById('btnAcceptCall').style.display = isIncoming ? 'inline-flex' : 'none';
    document.getElementById('callOverlay').classList.add('active');
}

// Call Timer Interval
function startCallTimer() {
    clearInterval(callTimerInterval);
    callSeconds = 0;
    callTimerInterval = setInterval(() => {
        callSeconds++;
        const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const secs = String(callSeconds % 60).padStart(2, '0');
        document.getElementById('callTimer').innerText = `${mins}:${secs}`;
    }, 1000);
}

// Web Audio API Ringtone Synthesizer (No External MP3 File needed)
function startRingtone() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (ringtoneOscillator) return;

        ringtoneOscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        ringtoneOscillator.type = 'sine';
        ringtoneOscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 Tone

        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        ringtoneOscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        ringtoneOscillator.start();
    } catch (e) {
        console.log('Audio Context restricted until user interaction.');
    }
}

function stopRingtone() {
    if (ringtoneOscillator) {
        try {
            ringtoneOscillator.stop();
            ringtoneOscillator.disconnect();
        } catch (e) {}
        ringtoneOscillator = null;
    }
}

// Modal Helpers
function toggleSqlModal() {
    const modal = document.getElementById('sqlModal');
    modal.classList.toggle('active');
}

function copySql() {
    const sqlText = document.getElementById('sqlCode').innerText;
    navigator.clipboard.writeText(sqlText).then(() => {
        alert('SQL Query berhasil disalin!');
    });
}
