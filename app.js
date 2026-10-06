let supabaseClient = null;
let realtimeChannel = null;
let peerConnection = null;
let localStream = null;
let pendingOffer = null;
let isAudioMuted = false;

// Konfigurasi Server WebRTC STUN Gratis
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// 1. Inisialisasi Supabase & Realtime Broadcast
function connectSupabase() {
  const url = document.getElementById('https://ojlpeqhstbsuzjqccjgk.supabase.co').value.trim();
  const key = document.getElementById('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qbHBlcWhzdGJzdXpqcWNjamdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNjExNTcsImV4cCI6MjEwNTczNzE1N30.hMoVGhKUBUlcktrWhsBaOk5A673irsAsYn_iMdOJKjw').value.trim();
  const roomId = document.getElementById('roomId').value.trim() || 'room-101';
  const role = document.getElementById('userRole').value;

  if (!url || !key) {
    alert('Harap masukkan Supabase URL dan Anon Key!');
    return;
  }

  // Membuat client Supabase
  supabaseClient = window.supabase.createClient(url, key);

  // Berlangganan ke Channel Realtime Supabase Broadcast
  realtimeChannel = supabaseClient.channel(roomId, {
    config: { broadcast: { self: false } }
  });

  // Mendaftarkan Handler Event Broadcast
  realtimeChannel
    .on('broadcast', { event: 'chat-msg' }, ({ payload }) => renderMessage(payload))
    .on('broadcast', { event: 'webrtc-offer' }, ({ payload }) => handleIncomingOffer(payload))
    .on('broadcast', { event: 'webrtc-answer' }, ({ payload }) => handleIncomingAnswer(payload))
    .on('broadcast', { event: 'webrtc-candidate' }, ({ payload }) => handleIncomingCandidate(payload))
    .on('broadcast', { event: 'webrtc-end' }, () => resetCallState("Panggilan diakhiri oleh lawan bicara."))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const badge = document.getElementById('statusBadge');
        badge.className = 'badge connected';
        badge.innerText = `Terhubung sebagai: ${role}`;

        document.getElementById('btnStartCall').disabled = false;
        document.getElementById('chatInput').disabled = false;
        document.getElementById('btnSend').disabled = false;
        document.getElementById('btnConnect').disabled = true;
      }
    });
}

// 2. Fungsi Chat
function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  const role = document.getElementById('userRole').value;

  if (!text || !realtimeChannel) return;

  const payload = { sender: role, text: text, timestamp: new Date().toLocaleTimeString() };

  // Kirim via Broadcast Supabase
  realtimeChannel.send({
    type: 'broadcast',
    event: 'chat-msg',
    payload: payload
  });

  renderMessage({ ...payload, isSelf: true });
  input.value = '';
}

function handleKeyPress(e) {
  if (e.key === 'Enter') sendMessage();
}

function renderMessage({ sender, text, timestamp, isSelf }) {
  const chatMessages = document.getElementById('chatMessages');
  const msgEl = document.createElement('div');
  msgEl.className = `message ${isSelf ? 'sent' : 'received'}`;
  msgEl.innerHTML = `
    <div class="sender">${sender} (${timestamp})</div>
    <div class="text">${escapeHtml(text)}</div>
  `;
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 3. Logika Panggilan Suara (WebRTC)
async function startCall() {
  try {
    document.getElementById('callStatusText').innerText = "Memanggil...";
    setupPeerConnection();

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    realtimeChannel.send({
      type: 'broadcast',
      event: 'webrtc-offer',
      payload: { offer: offer, sender: document.getElementById('userRole').value }
    });

    document.getElementById('btnStartCall').disabled = true;
    document.getElementById('btnEndCall').disabled = false;
    document.getElementById('btnToggleMute').disabled = false;
  } catch (err) {
    alert("Gagal mengakses mikrofon: " + err.message);
    resetCallState();
  }
}

function handleIncomingOffer({ offer, sender }) {
  pendingOffer = offer;
  document.getElementById('callStatusText').innerText = `Panggilan masuk dari ${sender}...`;
  document.getElementById('btnAcceptCall').classList.remove('hidden');
  document.getElementById('btnStartCall').disabled = true;
}

async function acceptCall() {
  try {
    document.getElementById('btnAcceptCall').classList.add('hidden');
    document.getElementById('callStatusText').innerText = "Terhubung dalam panggilan";

    setupPeerConnection();

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    realtimeChannel.send({
      type: 'broadcast',
      event: 'webrtc-answer',
      payload: { answer: answer }
    });

    document.getElementById('btnEndCall').disabled = false;
    document.getElementById('btnToggleMute').disabled = false;
  } catch (err) {
    alert("Gagal menerima panggilan: " + err.message);
    resetCallState();
  }
}

async function handleIncomingAnswer({ answer }) {
  if (peerConnection) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    document.getElementById('callStatusText').innerText = "Terhubung dalam panggilan";
  }
}

async function handleIncomingCandidate({ candidate }) {
  if (peerConnection && candidate) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

function setupPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Menerima stream audio dari lawan
  peerConnection.ontrack = (event) => {
    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio.srcObject !== event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
    }
  };

  // Mengirimkan kandidat ICE via Supabase Broadcast
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'webrtc-candidate',
        payload: { candidate: event.candidate }
      });
    }
  };
}

function toggleMute() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isAudioMuted = !isAudioMuted;
      audioTrack.enabled = !isAudioMuted;
      document.getElementById('btnToggleMute').innerText = isAudioMuted ? "🔇 Unmute" : "🎙️ Mute";
    }
  }
}

function endCall() {
  if (realtimeChannel) {
    realtimeChannel.send({
      type: 'broadcast',
      event: 'webrtc-end',
      payload: {}
    });
  }
  resetCallState("Panggilan diakhiri.");
}

function resetCallState(msg = "Siap untuk melakukan panggilan") {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  pendingOffer = null;
  isAudioMuted = false;

  document.getElementById('callStatusText').innerText = msg;
  document.getElementById('btnStartCall').disabled = false;
  document.getElementById('btnAcceptCall').classList.add('hidden');
  document.getElementById('btnEndCall').disabled = true;
  document.getElementById('btnToggleMute').disabled = true;
  document.getElementById('btnToggleMute').innerText = "🎙️️ Mute";
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}