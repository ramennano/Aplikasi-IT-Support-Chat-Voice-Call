// Konfigurasi Supabase Hardcoded
const SUPABASE_URL = 'https://ojlpeqhstbsuzjqccjgk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbHBlcWhzdGJzdXpqcWNjamdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNjExNTcsImV4cCI6MjEwNTczNzE1N30.hMoVGhKUBUlcktrWhsBaOk5A673irsAsYn_iMdOJKjw';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// State Aplikasi
const state = {
    role: 'user', // 'user' atau 'it'
    clientId: Math.random().toString(36).substring(2, 15),
    peerConnection: null,
    localStream: null,
    isCallActive: false
};

// Konfigurasi WebRTC (Menggunakan server Google STUN gratis)
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Elemen DOM
const dom = {
    roleSelect: document.getElementById('roleSelect'),
    dbStatus: document.getElementById('dbStatus'),
    dbStatusText: document.getElementById('dbStatusText'),
    chatHeaderTitle: document.getElementById('chatHeaderTitle'),
    messagesContainer: document.getElementById('messagesContainer'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    callBtn: document.getElementById('callBtn'),
    callModal: document.getElementById('callModal'),
    callStatusText: document.getElementById('callStatusText'),
    callRoleText: document.getElementById('callRoleText'),
    acceptCallBtn: document.getElementById('acceptCallBtn'),
    rejectCallBtn: document.getElementById('rejectCallBtn'),
    remoteAudio: document.getElementById('remoteAudio')
};

// Inisialisasi Realtime Channel
const channel = supabase.channel('support-room', {
    config: { broadcast: { self: false } }
});

// Setup Realtime Listeners
channel
    .on('broadcast', { event: 'chat' }, (payload) => renderMessage(payload.payload))
    .on('broadcast', { event: 'call-offer' }, handleCallOffer)
    .on('broadcast', { event: 'call-answer' }, handleCallAnswer)
    .on('broadcast', { event: 'ice-candidate' }, handleIceCandidate)
    .on('broadcast', { event: 'call-ended' }, endCall)
    .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            dom.dbStatus.classList.replace('disconnected', 'connected');
            dom.dbStatusText.textContent = 'Terhubung ke Server';
            loadChatHistory();
        } else {
            dom.dbStatus.classList.replace('connected', 'disconnected');
            dom.dbStatusText.textContent = 'Terputus (Menghubungkan ulang...)';
        }
    });

// Event Listeners DOM
dom.roleSelect.addEventListener('change', (e) => {
    state.role = e.target.value;
    dom.chatHeaderTitle.textContent = state.role === 'user' ? 'Chat dengan IT Support' : 'Chat dengan User';
});

dom.sendBtn.addEventListener('click', sendMessage);
dom.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

dom.callBtn.addEventListener('click', startCall);
dom.rejectCallBtn.addEventListener('click', endCall);
dom.acceptCallBtn.addEventListener('click', acceptCall);

// --- LOGIKA CHAT ---

async function sendMessage() {
    const text = dom.messageInput.value.trim();
    if (!text) return;

    const msgData = {
        id: Date.now(),
        clientId: state.clientId,
        role: state.role,
        message: text,
        created_at: new Date().toISOString()
    };

    // Tampilkan di layar sendiri
    renderMessage(msgData);
    dom.messageInput.value = '';

    // Broadcast Realtime ke lawan bicara
    channel.send({ type: 'broadcast', event: 'chat', payload: msgData });

    // Simpan ke database Supabase (Pastikan sudah buat tabel 'chat_messages' di Supabase)
    try {
        await supabase.from('chat_messages').insert([{
            sender_role: msgData.role,
            message: msgData.message
        }]);
    } catch (e) {
        console.warn("Gagal menyimpan ke database (pastikan tabel sudah dibuat):", e);
    }
}

async function loadChatHistory() {
    try {
        const { data, error } = await supabase
            .from('chat_messages')
            .select('*')
            .order('created_at', { ascending: true })
            .limit(50);

        if (data) {
            dom.messagesContainer.innerHTML = '';
            data.forEach(msg => {
                renderMessage({
                    role: msg.sender_role,
                    message: msg.message,
                    clientId: 'db' // Mencegah format salah saat load dari DB
                });
            });
        }
    } catch (e) {
        console.warn("Database belum disetup, menggunakan Realtime chat mode.");
    }
}

function renderMessage(data) {
    const isMine = data.clientId === state.clientId || (data.role === state.role && data.clientId === 'db');
    const div = document.createElement('div');
    div.className = `message ${isMine ? 'mine' : 'theirs'}`;
    
    const roleName = data.role === 'it' ? 'IT Support' : 'User';
    div.innerHTML = `<div class="msg-sender">${isMine ? 'Anda' : roleName}</div>${data.message}`;
    
    dom.messagesContainer.appendChild(div);
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
}

// --- LOGIKA WEB RTC (VOICE CALL) ---

async function setupWebRTC() {
    state.peerConnection = new RTCPeerConnection(rtcConfig);
    
    try {
        state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        state.localStream.getTracks().forEach(track => {
            state.peerConnection.addTrack(track, state.localStream);
        });
    } catch (error) {
        console.error("Izin mikrofon ditolak!", error);
        alert("Izinkan akses mikrofon untuk melakukan panggilan suara.");
        return false;
    }

    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            channel.send({
                type: 'broadcast',
                event: 'ice-candidate',
                payload: { candidate: event.candidate, targetRole: state.role === 'user' ? 'it' : 'user' }
            });
        }
    };

    state.peerConnection.ontrack = (event) => {
        dom.remoteAudio.srcObject = event.streams[0];
    };

    return true;
}

async function startCall() {
    if (state.isCallActive) return;
    const ready = await setupWebRTC();
    if (!ready) return;

    state.isCallActive = true;
    showCallModal("Memanggil...", `Ke: ${state.role === 'user' ? 'IT Support' : 'User'}`, true);

    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);

    channel.send({
        type: 'broadcast',
        event: 'call-offer',
        payload: { offer, callerRole: state.role }
    });
}

async function handleCallOffer(payload) {
    const { offer, callerRole } = payload.payload;
    if (callerRole === state.role) return; // Abaikan dari role yang sama
    
    state.isCallActive = true;
    showCallModal("Panggilan Masuk", `Dari: ${callerRole === 'it' ? 'IT Support' : 'User'}`, false);
    
    // Simpan offer sementara sampai user menekan Terima
    state.pendingOffer = offer;
}

async function acceptCall() {
    const ready = await setupWebRTC();
    if (!ready) return;

    dom.acceptCallBtn.style.display = 'none';
    dom.callStatusText.textContent = "Terhubung dalam panggilan";

    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(state.pendingOffer));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);

    channel.send({
        type: 'broadcast',
        event: 'call-answer',
        payload: { answer, answererRole: state.role }
    });
}

async function handleCallAnswer(payload) {
    const { answer, answererRole } = payload.payload;
    if (answererRole === state.role) return;
    
    dom.callStatusText.textContent = "Panggilan Terhubung";
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleIceCandidate(payload) {
    const { candidate, targetRole } = payload.payload;
    if (targetRole !== state.role || !state.peerConnection) return;
    
    try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
        console.error("Gagal menambahkan ICE candidate", e);
    }
}

function endCall() {
    state.isCallActive = false;
    dom.callModal.classList.remove('active');
    dom.remoteAudio.srcObject = null;
    
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => track.stop());
        state.localStream = null;
    }
    
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }

    channel.send({ type: 'broadcast', event: 'call-ended', payload: {} });
}

function showCallModal(statusText, roleText, isCaller) {
    dom.callStatusText.textContent = statusText;
    dom.callRoleText.textContent = roleText;
    dom.callModal.classList.add('active');
    
    if (isCaller) {
        dom.acceptCallBtn.style.display = 'none';
    } else {
        dom.acceptCallBtn.style.display = 'flex';
    }
}