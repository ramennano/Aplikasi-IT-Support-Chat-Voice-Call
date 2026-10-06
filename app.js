let supabase = null;
let realtimeChannel = null;
let localStream = null;
let peerConnection = null;
let isMuted = false;

const ROOM_ID = 'support-room';
const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// 1. Inisialisasi Supabase
function initSupabase() {
    const url = document.getElementById('https://ojlpeqhstbsuzjqccjgk.supabase.co').value.trim();
    const key = document.getElementById('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbHBlcWhzdGJzdXpqcWNjamdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNjExNTcsImV4cCI6MjEwNTczNzE1N30.hMoVGhKUBUlcktrWhsBaOk5A673irsAsYn_iMdOJKjw').value.trim();

    if (!url || !key) {
        alert('Harap masukkan Supabase URL dan Key terlebih dahulu.');
        return;
    }

    try {
        supabase = window.supabase.createClient(url, key);
        document.getElementById('connectionBadge').className = 'badge online';
        document.getElementById('connectionBadge').innerText = 'Terhubung';
        document.getElementById('messageInput').disabled = false;
        document.getElementById('btnSend').disabled = false;

        loadChatHistory();
        subscribeRealtime();
        setupWebRTCChannel();

        alert('Berhasil terhubung ke Supabase!');
    } catch (err) {
        alert('Gagal terhubung ke Supabase: ' + err.message);
    }
}

// 2. Mengambil Riwayat Chat dari Database
async function loadChatHistory() {
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', ROOM_ID)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Gagal memuat pesan:', error);
        return;
    }

    const chatContainer = document.getElementById('chatMessages');
    chatContainer.innerHTML = ''; // Bersihkan kontainer

    data.forEach(msg => appendMessage(msg));
}

// 3. Mengirim Pesan
async function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    const senderRole = document.getElementById('roleSelect').value;
    const senderName = document.getElementById('userNameInput').value.trim() || senderRole;

    if (!text || !supabase) return;

    input.value = '';

    const { error } = await supabase.from('messages').insert([
        {
            sender_role: senderRole,
            sender_name: senderName,
            message: text,
            room_id: ROOM_ID
        }
    ]);

    if (error) {
        console.error('Gagal mengirim pesan:', error);
    }
}

// 4. Langganan Realtime Chat Database
function subscribeRealtime() {
    supabase
        .channel('public:messages')
        .on('postgres_changes', 
            { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${ROOM_ID}` },
            (payload) => {
                appendMessage(payload.new);
            }
        )
        .subscribe();
}

// Render Pesan ke DOM
function appendMessage(msg) {
    const chatContainer = document.getElementById('chatMessages');
    const currentName = document.getElementById('userNameInput').value.trim();
    
    const isSentByMe = msg.sender_name === currentName;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message-bubble ${isSentByMe ? 'sent' : 'received'}`;

    msgDiv.innerHTML = `
        <div class="sender-info">${msg.sender_name} (${msg.sender_role})</div>
        <div>${escapeHtml(msg.message)}</div>
    `;

    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// 5. Signal Channel WebRTC via Supabase Broadcast
function setupWebRTCChannel() {
    realtimeChannel = supabase.channel(`call-${ROOM_ID}`);

    realtimeChannel
        .on('broadcast', { event: 'signal' }, async ({ payload }) => {
            handleSignalPayload(payload);
        })
        .subscribe();
}

async function handleSignalPayload(payload) {
    const currentRole = document.getElementById('roleSelect').value;
    
    // Abaikan sinyal dari diri sendiri
    if (payload.senderRole === currentRole) return;

    if (payload.type === 'offer') {
        if (confirm(`Panggilan suara masuk dari ${payload.senderRole}. Terima?`)) {
            await createPeerConnection();
            await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.offer));
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            sendSignal({ type: 'answer', answer });
            updateCallUI('Terhubung', true);
        }
    } else if (payload.type === 'answer' && peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer));
        updateCallUI('Terhubung', true);
    } else if (payload.type === 'candidate' && peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } else if (payload.type === 'end') {
        closeCall();
    }
}

function sendSignal(payload) {
    const senderRole = document.getElementById('roleSelect').value;
    realtimeChannel.send({
        type: 'broadcast',
        event: 'signal',
        payload: { ...payload, senderRole }
    });
}

// 6. Kontrol WebRTC (Voice Call)
async function startCall() {
    if (!supabase) {
        alert('Hubungkan ke Supabase terlebih dahulu!');
        return;
    }
    updateCallUI('Memanggil...', true);
    await createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    sendSignal({ type: 'offer', offer });
}

async function createPeerConnection() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
        alert('Gagal mengakses mikrofon: ' + err.message);
        updateCallUI('Terputus', false);
        return;
    }

    peerConnection = new RTCPeerConnection(RTC_CONFIG);

    // Tambahkan audio track lokal
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Terima track audio remote
    peerConnection.ontrack = (event) => {
        const remoteAudio = document.getElementById('remoteAudio');
        remoteAudio.srcObject = event.streams[0];
    };

    // Kirim ICE Candidate
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal({ type: 'candidate', candidate: event.candidate });
        }
    };
}

function toggleMute() {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks()[0].enabled = !isMuted;
        document.getElementById('btnMute').innerText = isMuted ? '🔊 Unmute' : '🔇 Mute';
    }
}

function endCall() {
    sendSignal({ type: 'end' });
    closeCall();
}

function closeCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    updateCallUI('Terputus', false);
}

function updateCallUI(statusText, inCall) {
    document.getElementById('callStatus').innerText = statusText;
    document.getElementById('btnStartCall').disabled = inCall;
    document.getElementById('btnEndCall').disabled = !inCall;
    document.getElementById('btnMute').disabled = !inCall;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
}