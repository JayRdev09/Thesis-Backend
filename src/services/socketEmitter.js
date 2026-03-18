class SocketEmitter {
  constructor(io) {
    this.io = io;
  }

  // Emit soil update to specific user
  async emitSoilUpdate(userId, soilData) {
    try {
      if (!this.io) {
        console.warn('⚠️ Socket.IO not available');
        return false;
      }

      const roomName = `soil:${userId}`;
      const room = this.io.sockets.adapter.rooms.get(roomName);
      
      if (!room || room.size === 0) {
        console.log(`⚠️ No clients in room ${roomName}`);
        return false;
      }

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

      // Emit to the room
      this.io.to(roomName).emit('soil-status-update', enhancedStatus);
      
      console.log(`📤 Socket emitter: Soil update sent to room ${roomName}`);
      return true;
      
    } catch (error) {
      console.error('❌ Error in socket emitter:', error);
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
}

module.exports = SocketEmitter;