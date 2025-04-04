const mongoose = require('mongoose');

const ApplicationSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    index: true
  },
  username: {
    type: String,
    default: 'Нет username'
  },
  firstName: {
    type: String,
    default: 'Нет имени'
  },
  lastName: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  inviteLink: {
    type: String,
    default: null
  },
  processedBy: {
    type: Number,
    default: null
  },
  processedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Application', ApplicationSchema);