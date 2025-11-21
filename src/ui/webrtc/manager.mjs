/**
 * WebRTC Manager
 * Handles P2P connections, signaling, and data channels
 */
export class WebRTCManager {
  constructor(signalingCallback, onDataChannelMessage, onRemoteStream) {
    this.sendSignal = signalingCallback;
    this.onDataChannelMessage = onDataChannelMessage;
    this.onRemoteStream = onRemoteStream;
    this.peers = new Map(); // username -> RTCPeerConnection
    this.dataChannels = new Map(); // username -> RTCDataChannel
    this.localStream = null;

    this.config = {
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
    };
  }

  /**
   * Initiate a connection to a target user
   * @param {string} targetUser - Username to connect to
   */
  async connect(targetUser) {
    // Check if already connected or connecting
    if (this.peers.has(targetUser)) {
      const pc = this.peers.get(targetUser);
      const state = pc.connectionState;

      // Only reconnect if connection is closed or failed
      if (state === 'connected' || state === 'connecting' || state === 'new') {
        console.log(`WebRTC: Already ${state} to ${targetUser}, skipping...`);
        return;
      }

      // Clean up failed connection before reconnecting
      if (state === 'failed' || state === 'closed') {
        console.log(`WebRTC: Cleaning up ${state} connection to ${targetUser}`);
        this.cleanup(targetUser);
      }
    }

    console.log(`WebRTC: Connecting to ${targetUser}...`);
    const pc = this.createPeerConnection(targetUser);

    // Create Data Channel
    const dc = pc.createDataChannel('chat');
    this.setupDataChannel(dc, targetUser);

    // Create Offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.sendSignal(targetUser, { type: 'offer', sdp: offer });
    } catch (err) {
      console.error('WebRTC: Error creating offer', err);
    }
  }

  createPeerConnection(targetUser) {
    const pc = new RTCPeerConnection(this.config);

    // Batch ICE candidates to reduce message count
    const iceCandidates = [];
    let iceBatchTimer = null;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Collect candidates
        iceCandidates.push(event.candidate);

        // Clear existing timer
        if (iceBatchTimer) {
          clearTimeout(iceBatchTimer);
        }

        // Send batch after 100ms of no new candidates
        iceBatchTimer = setTimeout(() => {
          if (iceCandidates.length > 0) {
            console.log(
              `WebRTC: Sending ${iceCandidates.length} ICE candidates in batch`,
            );
            this.sendSignal(targetUser, {
              type: 'candidates', // Note: plural
              candidates: [...iceCandidates],
            });
            iceCandidates.length = 0; // Clear array
          }
        }, 100);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(
        `WebRTC: Connection state with ${targetUser}: ${pc.connectionState}`,
      );
      if (
        pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed'
      ) {
        this.cleanup(targetUser);
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(event.channel, targetUser);
    };

    pc.ontrack = (event) => {
      console.log('WebRTC: Received remote track', event.streams[0]);
      if (this.onRemoteStream) {
        this.onRemoteStream(targetUser, event.streams[0]);
      }
    };

    this.peers.set(targetUser, pc);
    return pc;
  }

  setupDataChannel(dc, targetUser) {
    dc.onopen = async () => {
      console.log(`WebRTC: Data channel open with ${targetUser}`);
      this.dataChannels.set(targetUser, dc);

      // Add contact to DM list (RxDB)
      try {
        const { addContact } = await import('../utils/p2p-database.mjs');
        await addContact(targetUser);
        console.log(`✅ Added ${targetUser} to DM contacts`);
      } catch (err) {
        console.error('Failed to add contact to DM list:', err);
      }

      // Send a hello message
      dc.send(
        JSON.stringify({
          type: 'system',
          message: 'P2P Connection Established',
        }),
      );
    };

    dc.onmessage = async (event) => {
      // Check if this is an RxDB replication message
      const { handleDataChannelMessage } = await import(
        '../utils/p2p-database.mjs'
      );
      const handled = handleDataChannelMessage(dc, event.data);

      // If not handled by RxDB, pass to app message handler
      if (!handled) {
        this.onDataChannelMessage(targetUser, event.data);
      }
    };
  }

  /**
   * Handle incoming signaling message
   * @param {string} sender - Username of the sender
   * @param {Object} data - Signal data (offer, answer, candidate)
   */
  async handleSignal(sender, data) {
    // If we receive an offer from someone we don't have a connection with, create one
    if (!this.peers.has(sender)) {
      if (data.type === 'offer') {
        this.createPeerConnection(sender);
      } else {
        console.warn(
          `WebRTC: Received ${data.type} from unknown peer ${sender}`,
        );
        return;
      }
    }

    const pc = this.peers.get(sender);

    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal(sender, { type: 'answer', sdp: answer });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === 'candidate') {
        // Handle single candidate (backwards compatibility)
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else if (data.type === 'candidates') {
        // Handle batch of candidates
        console.log(
          `WebRTC: Received ${data.candidates.length} ICE candidates in batch`,
        );
        for (const candidate of data.candidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    } catch (err) {
      console.error('WebRTC: Error handling signal', err);
    }
  }

  /**
   * Start screen sharing with a target user
   * @param {string} targetUser
   */
  async startScreenShare(targetUser) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true, // System audio
      });
      this.localStream = stream;

      const pc = this.peers.get(targetUser);
      if (pc) {
        // Add tracks to connection
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // Renegotiate
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(targetUser, { type: 'offer', sdp: offer });

        // Handle stream stop (user clicks "Stop Sharing" in browser UI)
        stream.getVideoTracks()[0].onended = () => {
          this.stopScreenShare(targetUser);
        };
      }
    } catch (err) {
      console.error('Error sharing screen:', err);
    }
  }

  stopScreenShare(targetUser) {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    // TODO: Remove tracks from PC and renegotiate?
    // For now, just let the track end event handle it on the other side
  }

  /**
   * Get Data Channel for a user
   * @param {string} targetUser
   * @returns {RTCDataChannel|null}
   */
  getDataChannel(targetUser) {
    return this.dataChannels.get(targetUser) || null;
  }

  /**
   * Send a message via Data Channel
   * @param {string} targetUser
   * @param {string|Object} message
   */
  sendMessage(targetUser, message) {
    const dc = this.dataChannels.get(targetUser);
    if (dc && dc.readyState === 'open') {
      const payload =
        typeof message === 'string' ? message : JSON.stringify(message);
      dc.send(payload);
      return true;
    }
    return false;
  }

  cleanup(targetUser) {
    const pc = this.peers.get(targetUser);
    if (pc) pc.close();
    this.peers.delete(targetUser);
    this.dataChannels.delete(targetUser);
  }
}
