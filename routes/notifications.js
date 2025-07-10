/**
 * Notification Routes
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');
const { WebSocketService } = require('../services/websocketService');

/**
 * @route   GET /api/notifications
 * @desc    Get user's notifications
 * @access  Private
 */
router.get('/', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50);
    
    return res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching notifications' 
    });
  }
});

/**
 * @route   GET /api/notifications/unread
 * @desc    Get user's unread notifications
 * @access  Private
 */
router.get('/unread', auth, async (req, res) => {
  try {
    const notifications = await Notification.find({ 
      userId: req.user.id,
      read: false
    }).sort({ createdAt: -1 });
    
    return res.json({
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching unread notifications:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error fetching unread notifications' 
    });
  }
});

/**
 * @route   POST /api/notifications
 * @desc    Create a notification
 * @access  Private
 */
router.post('/', auth, async (req, res) => {
  try {
    const { title, message, type = 'info', data = {} } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and message are required' 
      });
    }
    
    const notification = new Notification({
      userId: req.user.id,
      title,
      message,
      type,
      data
    });
    
    await notification.save();
    
    // Send notification via WebSocket if available
    const wsService = WebSocketService.getInstance();
    if (wsService) {
      wsService.sendNotification(req.user.id, notification);
    }
    
    return res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error creating notification' 
    });
  }
});

/**
 * @route   PUT /api/notifications/:id
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!notification) {
      return res.status(404).json({ 
        success: false, 
        message: 'Notification not found' 
      });
    }
    
    notification.read = true;
    await notification.save();
    
    return res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error marking notification as read' 
    });
  }
});

/**
 * @route   PUT /api/notifications
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/', auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user.id, read: false },
      { $set: { read: true } }
    );
    
    return res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error marking all notifications as read' 
    });
  }
});

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete a notification
 * @access  Private
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!notification) {
      return res.status(404).json({ 
        success: false, 
        message: 'Notification not found' 
      });
    }
    
    await notification.remove();
    
    return res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error deleting notification' 
    });
  }
});

/**
 * @route   DELETE /api/notifications
 * @desc    Delete all notifications
 * @access  Private
 */
router.delete('/', auth, async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user.id });
    
    return res.json({
      success: true,
      message: 'All notifications deleted'
    });
  } catch (error) {
    console.error('Error deleting all notifications:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error deleting all notifications' 
    });
  }
});

module.exports = router;
