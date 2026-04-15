// services/SocketEmitter.js
class SocketEmitter {
  constructor(io) {
    this.io = io;
  }

  // Emit soil update to specific user - FIXED: Always emit without room check
  async emitSoilUpdate(userId, soilData) {
    try {
      if (!this.io) {
        console.warn('⚠️ Socket.IO not available');
        return false;
      }

      const roomName = `soil:${userId}`;
      
      // REMOVED THE ROOM CHECK - Always try to emit
      // Even if no clients, the emit will be queued for when they reconnect
      
      // Calculate data freshness
      const now = new Date();
      const soilTime = new Date(soilData.date_gathered);
      const dataAgeHours = (now - soilTime) / (1000 * 60 * 60);
      
      let dataFreshness = 'unknown';
      let dataStatus = 'fresh';
      
      if (dataAgeHours <= 1) {
        dataFreshness = 'very_fresh';
        dataStatus = 'fresh';
      } else if (dataAgeHours <= 6) {
        dataFreshness = 'fresh';
        dataStatus = 'fresh';
      } else if (dataAgeHours <= 24) {
        dataFreshness = 'acceptable';
        dataStatus = 'fresh';
      } else {
        dataFreshness = 'stale';
        dataStatus = 'stale';
      }

      const enhancedStatus = {
        success: true,
        npk_levels: {
          nitrogen: `${soilData.nitrogen || 0}mg/kg`,
          phosphorus: `${soilData.phosphorus || 0}mg/kg`,
          potassium: `${soilData.potassium || 0}mg/kg`
        },
        other_parameters: {
          ph: `${(soilData.ph_level || soilData.ph || 0).toFixed(1)} pH`,
          moisture: `${soilData.moisture || 0}%`,
          temperature: `${soilData.temperature || 0}°C`
        },
        data_status: dataStatus,
        data_age_hours: parseFloat(dataAgeHours.toFixed(1)),
        data_freshness: dataFreshness,
        last_updated: soilData.date_gathered,
        can_analyze: dataStatus === 'fresh',
        message: dataStatus === 'fresh' ? 
          'Soil data is current and ready for analysis' :
          `Soil data is ${dataAgeHours.toFixed(1)} hours old.`,
        user_id: userId,
        timestamp: new Date().toISOString(),
        source: 'socket-emitter'
      };

      // ALWAYS emit to the room (will be received when client reconnects)
      this.io.to(roomName).emit('soil-status-update', enhancedStatus);
      
      // Log client count for debugging (does not affect emission)
      const room = this.io.sockets.adapter.rooms.get(roomName);
      const clientCount = room ? room.size : 0;
      console.log(`📤 Socket emitter: Soil update sent to room ${roomName} (${clientCount} clients active)`);
      
      return true;
      
    } catch (error) {
      console.error('❌ Error in socket emitter:', error);
      return false;
    }
  }

  // Emit soil update to specific socket (direct, no room)
  emitToSocket(socketId, soilData) {
    try {
      if (!this.io) {
        console.warn('⚠️ Socket.IO not available');
        return false;
      }

      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) {
        console.log(`⚠️ Socket ${socketId} not found`);
        return false;
      }

      const now = new Date();
      const soilTime = new Date(soilData.date_gathered);
      const dataAgeHours = (now - soilTime) / (1000 * 60 * 60);
      
      let dataStatus = dataAgeHours <= 24 ? 'fresh' : 'stale';
      
      const enhancedStatus = {
        success: true,
        npk_levels: {
          nitrogen: `${soilData.nitrogen || 0}mg/kg`,
          phosphorus: `${soilData.phosphorus || 0}mg/kg`,
          potassium: `${soilData.potassium || 0}mg/kg`
        },
        other_parameters: {
          ph: `${(soilData.ph_level || soilData.ph || 0).toFixed(1)} pH`,
          moisture: `${soilData.moisture || 0}%`,
          temperature: `${soilData.temperature || 0}°C`
        },
        data_status: dataStatus,
        data_age_hours: parseFloat(dataAgeHours.toFixed(1)),
        last_updated: soilData.date_gathered,
        can_analyze: dataStatus === 'fresh',
        user_id: soilData.user_id,
        timestamp: new Date().toISOString(),
        source: 'direct-socket'
      };

      socket.emit('soil-status-update', enhancedStatus);
      console.log(`📤 Socket emitter: Direct update sent to socket ${socketId}`);
      return true;
      
    } catch (error) {
      console.error('❌ Error in direct socket emit:', error);
      return false;
    }
  }

  // Broadcast to all soil rooms (admin feature)
  broadcastToAllSoil(data) {
    try {
      const rooms = this.io.sockets.adapter.rooms;
      let broadcastCount = 0;
      
      rooms.forEach((sockets, roomName) => {
        if (roomName.startsWith('soil:')) {
          this.io.to(roomName).emit('soil-broadcast', {
            ...data,
            broadcast_time: new Date().toISOString()
          });
          broadcastCount++;
        }
      });
      
      console.log(`📢 Broadcasted to ${broadcastCount} soil rooms`);
      return broadcastCount;
    } catch (error) {
      console.error('❌ Error broadcasting:', error);
      return 0;
    }
  }

  // Get all connected clients in a soil room
  getRoomClients(userId) {
    try {
      const roomName = `soil:${userId}`;
      const room = this.io.sockets.adapter.rooms.get(roomName);
      
      if (!room) {
        return [];
      }
      
      const clients = Array.from(room);
      console.log(`📊 Room ${roomName} has ${clients.length} clients`);
      return clients;
    } catch (error) {
      console.error('❌ Error getting room clients:', error);
      return [];
    }
  }

  // Emit error to specific user
  emitError(userId, errorMessage) {
    try {
      const roomName = `soil:${userId}`;
      this.io.to(roomName).emit('soil-update-error', {
        error: errorMessage,
        timestamp: new Date().toISOString()
      });
      console.log(`⚠️ Error sent to room ${roomName}: ${errorMessage}`);
      return true;
    } catch (error) {
      console.error('❌ Error emitting error:', error);
      return false;
    }
  }
}

module.exports = SocketEmitter;
