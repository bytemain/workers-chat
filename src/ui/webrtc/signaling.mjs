/**
 * Signaling Service
 * Wraps the WebSocket connection to send WebRTC signaling messages
 */
export class SignalingService {
  /**
   * @param {Function} sendFunction - Function to send data over WebSocket (data) => void
   */
  constructor(sendFunction) {
    this.sendFunction = sendFunction;
  }

  /**
   * Send a signaling message to a specific user
   * @param {string} targetUser - Username of the target
   * @param {Object} payload - The signal data (offer/answer/candidate)
   */
  send(targetUser, payload) {
    this.sendFunction({
      type: 'signal',
      target: targetUser,
      payload: payload,
    });
  }
}
